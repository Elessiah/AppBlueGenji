"use client";

import { useCallback, useEffect, useRef, useState, type ComponentType, type ReactNode } from "react";
import { useAppLocale } from "@/components/i18n/locale-context";
import { useShellText } from "@/components/i18n/shell-text";
import { useToast } from "@/components/ui/toast";
import { IMAGE_CROP_FIELD, serializeCropRect, type CropRect, type ImageUploadKind } from "@/lib/shared/image-crop";
import { isChunkLoadError, onceLoader, quietPreload } from "@/lib/shared/lazy-component";
import type { ImageCropDialogProps, ImageCropMessages } from "./image-crop-dialog-view";

/**
 * La modale de recadrage, chargée **à la demande** (revue de performance du
 * lot 9-2) : elle ne s'ouvre qu'après le choix d'un fichier, et son code et ses
 * deux langues pesaient sur le premier chargement de chaque écran qui l'offre
 * — l'accueil compris.
 *
 * Chargement **à la main**, comme le formulaire de signalement, plutôt que
 * `next/dynamic` + `orReload` : l'écran qui l'ouvre est un formulaire en cours
 * de saisie — le recharger d'office la perdrait —, et `next/dynamic` garderait
 * un échec réseau sous la forme d'un composant vide jusqu'au rechargement. Ici,
 * un échec est dit (toast), `cropImage` rend `null` (rien ne part) et le choix
 * suivant retente.
 */
type CropDialog = ComponentType<ImageCropDialogProps>;
const cropDialogLoader = onceLoader<CropDialog>(() => import("./image-crop-dialog-view").then((module) => module.ImageCropDialog));
/** L'anglais de la modale, sous `/en` seulement (hors écran du staff, en français). */
const englishCropLoader = onceLoader<ImageCropMessages>(() => import("@/messages/en/imageCrop.json").then((module) => module.default));

const preloadCropDialog = quietPreload(() => cropDialogLoader.load());

/**
 * Précharge la modale : à poser sur le `<input type="file">` qui la précède
 * (`onClick`, déclenché aussi par un `.click()` du bouton qui l'ouvre) — le
 * morceau arrive pendant que le lecteur choisit son fichier, et la modale
 * s'ouvre sans attente. Un échec reste muet et se tait un moment
 * (`quietPreload`) : l'ouverture, elle, retente et le dit.
 */
export function preloadImageCropDialog(): void {
  if (cropDialogLoader.loaded()) return;
  preloadCropDialog();
}

/** Une image choisie et sa zone gardée, prête à partir. */
export interface CroppedImage {
  file: File;
  /** `null` : rien à découper, le gabarit du serveur s'applique seul. */
  crop: CropRect | null;
}

/**
 * Joint une image recadrée à un envoi : le fichier d'origine **et** le
 * rectangle — c'est le serveur qui découpe (`lib/shared/image-crop.ts`).
 */
export function appendCroppedImage(form: FormData, image: CroppedImage): void {
  form.append("file", image.file);
  if (image.crop) form.append(IMAGE_CROP_FIELD, serializeCropRect(image.crop));
}

/** Plus grand côté d'un aperçu : il ne sert qu'à l'écran. */
const PREVIEW_MAX_SIDE = 1200;

/**
 * Aperçu local d'une image recadrée, en `Blob` — pour les écrans qui montrent
 * l'image avant de l'envoyer (logo d'équipe, image de tournoi) : sans lui, ils
 * montreraient l'image entière alors que c'est la zone choisie qui partira.
 *
 * **Jamais envoyé** : le serveur reçoit le fichier d'origine et le rectangle.
 * `null` si le navigateur ne sait pas dessiner l'image (l'écran retombe alors
 * sur le fichier entier).
 */
export async function croppedPreviewBlob(image: CroppedImage): Promise<Blob | null> {
  if (!image.crop) return image.file;
  if (typeof createImageBitmap !== "function" || typeof document === "undefined") return null;
  try {
    // Même repère que la modale et que `sharp` : l'image redressée par l'EXIF.
    const bitmap = await createImageBitmap(image.file, { imageOrientation: "from-image" });
    const sx = image.crop.x * bitmap.width;
    const sy = image.crop.y * bitmap.height;
    const sw = image.crop.width * bitmap.width;
    const sh = image.crop.height * bitmap.height;
    const ratio = Math.min(1, PREVIEW_MAX_SIDE / Math.max(sw, sh));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(sw * ratio));
    canvas.height = Math.max(1, Math.round(sh * ratio));
    const context = canvas.getContext("2d");
    if (!context) {
      bitmap.close();
      return null;
    }
    context.drawImage(bitmap, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    return await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  } catch {
    return null;
  }
}

/**
 * URL `blob:` de l'aperçu recadré, révoquée dès qu'elle ne sert plus.
 *
 * L'URL n'est rendue que si elle désigne **l'image courante** : l'aperçu se
 * dessine de façon asynchrone, et un nouveau recadrage ne doit pas montrer un
 * instant la zone précédente. `null` tant qu'il se dessine, ou sans image.
 */
export function useCroppedPreviewUrl(image: CroppedImage | null): string | null {
  const [entry, setEntry] = useState<{ image: CroppedImage; url: string } | null>(null);
  useEffect(() => {
    if (!image) {
      setEntry(null);
      return;
    }
    let cancelled = false;
    let url: string | null = null;
    void croppedPreviewBlob(image).then((blob) => {
      if (cancelled) return;
      // Dessin impossible : le fichier entier plutôt que rien.
      url = URL.createObjectURL(blob ?? image.file);
      setEntry({ image, url });
    });
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [image]);
  return entry !== null && entry.image === image ? entry.url : null;
}

interface CropRequest {
  file: File;
  kind: ImageUploadKind;
  title: string;
  resolve: (image: CroppedImage | null) => void;
}

/**
 * Le recadrage comme une étape `await`-able d'un envoi :
 *
 * ```ts
 * const image = await cropImage(file, "avatar", "Recadrer ton avatar");
 * if (!image) return; // annulé
 * appendCroppedImage(form, image);
 * ```
 *
 * `cropDialog` est à rendre une fois dans l'écran. Une demande neuve pendant
 * qu'une autre est ouverte annule la première : seule la dernière image
 * choisie peut partir.
 */
export function useImageCropper(options: Readonly<{ lang?: "fr" }> = {}): {
  cropImage: (file: File, kind: ImageUploadKind, title: string) => Promise<CroppedImage | null>;
  cropDialog: ReactNode;
} {
  const [request, setRequest] = useState<CropRequest | null>(null);
  const requestRef = useRef<CropRequest | null>(null);
  const { showError } = useToast();
  const { t } = useShellText();
  // Le français imposé (écran du staff) n'a pas besoin de l'anglais.
  const english = useAppLocale() === "en" && options.lang !== "fr";

  const settle = useCallback((image: CroppedImage | null) => {
    const current = requestRef.current;
    requestRef.current = null;
    setRequest(null);
    current?.resolve(image);
  }, []);

  const cropImage = useCallback(
    async (file: File, kind: ImageUploadKind, title: string) => {
      try {
        await Promise.all([cropDialogLoader.load(), english ? englishCropLoader.load() : null]);
      } catch (error) {
        // Rien ne part : l'écran garde sa saisie, le lecteur peut rechoisir.
        showError(t(isChunkLoadError(error) ? "imageCropLoad.reloading" : "imageCropLoad.failed"));
        return null;
      }
      return new Promise<CroppedImage | null>((resolve) => {
        // Une demande neuve annule celle encore ouverte : seule la dernière image part.
        requestRef.current?.resolve(null);
        const next = { file, kind, title, resolve };
        requestRef.current = next;
        setRequest(next);
      });
    },
    [english, showError, t],
  );

  // Écran quitté modale ouverte : l'attente se résout en annulation plutôt
  // que de rester pendante.
  useEffect(() => () => requestRef.current?.resolve(null), []);

  // Toujours là quand une demande existe : `cropImage` l'attend avant de la poser.
  const ImageCropDialog = cropDialogLoader.loaded();
  const cropDialog = request && ImageCropDialog ? (
    <ImageCropDialog
      key={`${request.file.name}-${request.file.size}-${request.file.lastModified}`}
      file={request.file}
      kind={request.kind}
      title={request.title}
      onCancel={() => settle(null)}
      onConfirm={(crop) => settle({ file: request.file, crop })}
      lang={options.lang}
      englishMessages={english ? (englishCropLoader.loaded() ?? undefined) : undefined}
    />
  ) : null;

  return { cropImage, cropDialog };
}
