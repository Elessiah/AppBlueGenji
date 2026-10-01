"use client";

/* L'image recadrée est un fichier **local** (`blob:`) que personne n'a encore
   envoyé : `next/image` ne sait pas l'optimiser. Même exception que les
   aperçus du sélecteur d'image de tournoi. */
/* eslint-disable @next/next/no-img-element */

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { useBackdropDismiss } from "@/lib/shared/hooks/useBackdropDismiss";
import { useDialogBehavior } from "@/lib/shared/hooks/useDialogBehavior";
import {
  CROP_HANDLES,
  CROP_SCALE_STEP,
  IMAGE_CROP_ASPECTS,
  IMAGE_CROP_FIELD,
  IMAGE_CROP_ROUND,
  cropBoxFromKey,
  cropToSend,
  defaultCropBox,
  moveCropBox,
  resizeCropBox,
  scaleCropBox,
  serializeCropRect,
  type CropBox,
  type CropHandle,
  type CropRect,
  type ImageSize,
  type ImageUploadKind,
} from "@/lib/shared/image-crop";
import s from "./image-crop-dialog.module.css";

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

interface ImageCropDialogProps {
  file: File;
  kind: ImageUploadKind;
  /** Titre de la modale (« Recadrer ton avatar »). */
  title: string;
  onCancel: () => void;
  onConfirm: (crop: CropRect | null) => void;
}

type Drag =
  | { mode: "move"; pointerId: number; startX: number; startY: number; startBox: CropBox }
  | { mode: "resize"; handle: CropHandle; pointerId: number; startX: number; startY: number; startBox: CropBox };

const HANDLE_LABELS: Record<CropHandle, string> = {
  nw: "coin haut gauche",
  ne: "coin haut droit",
  sw: "coin bas gauche",
  se: "coin bas droit",
};

const pct = (value: number) => `${value}%`;

/** La poignée sous le pointeur, ou `null` pour le cadre lui-même. */
function handleOf(target: EventTarget): CropHandle | null {
  const handle = (target as HTMLElement).dataset?.handle;
  return (CROP_HANDLES as readonly string[]).includes(handle ?? "") ? (handle as CropHandle) : null;
}

/**
 * Modale de recadrage manuel, commune à tous les imports d'image.
 *
 * Le cadre s'ouvre sur **ce que le serveur appliquait seul** (`defaultCropBox`) :
 * valider sans toucher donne le fichier d'avant l'outil. On le déplace en le
 * faisant glisser, on le redimensionne par ses coins — aux proportions du
 * gabarit quand il en impose (avatar carré, bandeau 3:1), librement sinon.
 * Au clavier, le cadre est focalisable : flèches pour le déplacer, `+` / `-`
 * pour l'agrandir ou le réduire, Origine pour revenir au cadre proposé ; les
 * mêmes gestes ont leurs boutons.
 *
 * Portée dans `document.body`, pile commune de modales, voile fermé par
 * `useBackdropDismiss` — les trois règles de `docs/features/MODAL_DIALOGS.md`.
 */
export function ImageCropDialog({ file, kind, title, onCancel, onConfirm }: ImageCropDialogProps) {
  const titleId = useId();
  const hintId = useId();
  const aspect = IMAGE_CROP_ASPECTS[kind];
  const round = IMAGE_CROP_ROUND[kind];
  const [mounted, setMounted] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  const [size, setSize] = useState<ImageSize | null>(null);
  const [box, setBox] = useState<CropBox | null>(null);
  const [failed, setFailed] = useState(false);
  const imageRef = useRef<HTMLImageElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<Drag | null>(null);

  const dialogRef = useDialogBehavior({ open: mounted, onClose: onCancel });
  const backdrop = useBackdropDismiss(onCancel);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    const objectUrl = URL.createObjectURL(file);
    setUrl(objectUrl);
    setSize(null);
    setBox(null);
    setFailed(false);
    return () => URL.revokeObjectURL(objectUrl);
  }, [file]);

  // Le cadre n'existe qu'une fois l'image chargée, après le focus initial de la
  // modale (posé sur « Annuler ») : il le reprend alors, une fois, pour que les
  // flèches servent sans passer par la tabulation.
  const ready = size !== null && box !== null;
  const focusedRef = useRef(false);
  useEffect(() => {
    if (!ready || focusedRef.current) return;
    focusedRef.current = true;
    frameRef.current?.focus();
  }, [ready]);

  const onImageLoad = () => {
    const image = imageRef.current;
    if (!image?.naturalWidth || !image.naturalHeight) {
      setFailed(true);
      return;
    }
    // `naturalWidth` est mesuré sur l'image **redressée** (`image-orientation:
    // from-image`, défaut des navigateurs) : le repère de `sharp.autoOrient`.
    const natural = { width: image.naturalWidth, height: image.naturalHeight };
    setSize(natural);
    setBox(defaultCropBox(natural, aspect));
  };

  /** Pixels d'écran → pixels de l'image. */
  const screenToImage = useCallback(() => {
    const image = imageRef.current;
    if (!image || !size) return 1;
    const rect = image.getBoundingClientRect();
    return rect.width > 0 ? size.width / rect.width : 1;
  }, [size]);

  const startDrag = (event: PointerEvent<HTMLElement>, handle: CropHandle | null) => {
    if (!box || event.button !== 0) return;
    event.preventDefault();
    const base = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, startBox: box };
    dragRef.current = handle === null ? { mode: "move", ...base } : { mode: "resize", handle, ...base };
    event.currentTarget.setPointerCapture(event.pointerId);
    // Le focus suit le geste : les flèches reprennent là où la souris s'arrête.
    frameRef.current?.focus();
  };

  const onDragMove = (event: PointerEvent<HTMLElement>) => {
    const drag = dragRef.current;
    if (drag?.pointerId !== event.pointerId || !size) return;
    const factor = screenToImage();
    const dx = (event.clientX - drag.startX) * factor;
    const dy = (event.clientY - drag.startY) * factor;
    setBox(
      drag.mode === "move"
        ? moveCropBox(drag.startBox, dx, dy, size)
        : resizeCropBox(drag.startBox, drag.handle, dx, dy, size, aspect),
    );
  };

  const endDrag = (event: PointerEvent<HTMLElement>) => {
    if (dragRef.current?.pointerId === event.pointerId) dragRef.current = null;
  };

  const onFrameKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!box || !size) return;
    const next = cropBoxFromKey(box, event.key, event.shiftKey, size, aspect);
    if (next === null) return;
    event.preventDefault();
    setBox(next);
  };

  const scale = (factor: number) => {
    if (box && size) setBox(scaleCropBox(box, factor, size, aspect));
  };

  if (!mounted) return null;

  const frameStyle = ready
    ? {
        left: pct((box.x / size.width) * 100),
        top: pct((box.y / size.height) * 100),
        width: pct((box.width / size.width) * 100),
        height: pct((box.height / size.height) * 100),
      }
    : undefined;
  // Aperçu du résultat : l'image entière décalée dans une fenêtre aux
  // proportions du cadre — la forme exacte de ce qui sera gardé.
  const previewImageStyle = ready
    ? {
        width: pct((size.width / box.width) * 100),
        height: pct((size.height / box.height) * 100),
        left: pct((-box.x / box.width) * 100),
        top: pct((-box.y / box.height) * 100),
      }
    : undefined;
  const frameLabel = ready
    ? `Zone gardée : ${Math.round((box.width / size.width) * 100)} % de la largeur, ${Math.round(
        (box.height / size.height) * 100,
      )} % de la hauteur, à ${Math.round((box.x / size.width) * 100)} % du bord gauche et ${Math.round(
        (box.y / size.height) * 100,
      )} % du haut`
    : "Zone gardée";

  let body: ReactNode;
  if (failed) {
    body = <p className={s.error}>Cette image ne peut pas être affichée ici. Choisis-en une autre.</p>;
  } else {
    body = (
      <div className={s.layout}>
        <div className={s.stageWrap}>
          <div className={s.stage}>
            {url && (
              <img
                ref={imageRef}
                src={url}
                alt=""
                className={s.image}
                draggable={false}
                onLoad={onImageLoad}
                onError={() => setFailed(true)}
              />
            )}
            {ready && (
              <div // NOSONAR S6847 — cadre `role="application"` piloté au pointeur et au clavier (onFrameKey)
                ref={frameRef}
                className={`${s.frame} ${round ? s.frameRound : ""}`}
                style={frameStyle}
                role="application"
                aria-roledescription="cadre de recadrage"
                aria-label={frameLabel}
                aria-describedby={hintId}
                tabIndex={0} // NOSONAR S6845 — le cadre se déplace au clavier, il doit recevoir le focus
                onKeyDown={onFrameKey}
                // Un seul écouteur pour le cadre et ses poignées : la poignée
                // saisie se lit sur la cible, sans quoi l'appui remonterait au
                // cadre et changerait le redimensionnement en déplacement.
                onPointerDown={(event) => startDrag(event, handleOf(event.target))}
                onPointerMove={onDragMove}
                onPointerUp={endDrag}
                onPointerCancel={endDrag}
              >
                <span className={s.grid} aria-hidden="true" />
                {CROP_HANDLES.map((handle) => (
                  <span
                    key={handle}
                    className={`${s.handle} ${s["handle_" + handle]}`}
                    aria-hidden="true"
                    data-handle={handle}
                    title={`Redimensionner par le ${HANDLE_LABELS[handle]}`}
                  />
                ))}
              </div>
            )}
          </div>
          <p id={hintId} className={s.hint}>
            Fais glisser le cadre pour choisir la zone gardée, tire un coin pour le redimensionner
            {aspect !== null ? " (proportions imposées)" : ""}.
            {/* L'aide clavier quitte l'écran tactile, où les boutons de
                l'aperçu tiennent le même rôle, mais reste lue avec le cadre. */}
            <span className={s.hintKeys}>
              {" "}
              Au clavier : flèches pour le déplacer (Maj pour aller plus vite), + et − pour
              l&apos;agrandir ou le réduire, Origine pour revenir au cadre proposé.
            </span>
          </p>
        </div>

        {ready && url && (
          <div className={s.side}>
            <p className={s.caption}>Aperçu</p>
            <div
              className={`${s.preview} ${round ? s.previewRound : ""}`}
              style={{
                aspectRatio: `${box.width} / ${box.height}`,
                // Largeur **et** hauteur bornées par la largeur seule : un plafond
                // de hauteur posé à part écraserait la fenêtre sans la rétrécir,
                // et l'aperçu ne montrerait plus la forme gardée.
                // Le plus grand côté vient de la feuille (`--crop-preview-box`) :
                // réduit sur un petit écran, où un aperçu de 180 px dépassait la
                // zone de recadrage elle-même et repoussait les actions.
                width: `min(100%, calc(var(--crop-preview-box) * ${Math.min(1, box.width / box.height).toFixed(4)}))`,
              }}
            >
              <img src={url} alt="" className={s.previewImage} style={previewImageStyle} draggable={false} />
            </div>
            <div className={s.tools} data-tap-zone>
              {/* Le libellé est le texte visible, pas un `aria-label` : un
                  symbole seul nommé autrement ne répondrait plus à la commande
                  vocale de ce qu'on lit dessus (WCAG 2.5.3). */}
              <button type="button" className="btn ghost" onClick={() => scale(1 / CROP_SCALE_STEP)}>
                <span aria-hidden="true">− </span>Réduire
              </button>
              <button type="button" className="btn ghost" onClick={() => scale(CROP_SCALE_STEP)}>
                <span aria-hidden="true">+ </span>Agrandir
              </button>
              <button type="button" className="btn ghost" onClick={() => setBox(defaultCropBox(size, aspect))}>
                Réinitialiser
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }

  return createPortal(
    <div role="presentation" className={s.backdrop} {...backdrop}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} className={s.dialog}>
        <h2 id={titleId} className={s.title}>
          {title}
        </h2>
        {body}
        <div className={s.footer}>
          <button type="button" className={s.cancel} onClick={onCancel}>
            Annuler
          </button>
          <button
            type="button"
            className="btn"
            disabled={!ready}
            onClick={() => {
              if (box && size) onConfirm(cropToSend(box, size));
            }}
          >
            Valider le recadrage
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
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
export function useImageCropper(): {
  cropImage: (file: File, kind: ImageUploadKind, title: string) => Promise<CroppedImage | null>;
  cropDialog: ReactNode;
} {
  const [request, setRequest] = useState<CropRequest | null>(null);
  const requestRef = useRef<CropRequest | null>(null);

  const settle = useCallback((image: CroppedImage | null) => {
    const current = requestRef.current;
    requestRef.current = null;
    setRequest(null);
    current?.resolve(image);
  }, []);

  const cropImage = useCallback((file: File, kind: ImageUploadKind, title: string) => {
    requestRef.current?.resolve(null);
    return new Promise<CroppedImage | null>((resolve) => {
      const next = { file, kind, title, resolve };
      requestRef.current = next;
      setRequest(next);
    });
  }, []);

  // Écran quitté modale ouverte : l'attente se résout en annulation plutôt
  // que de rester pendante.
  useEffect(() => () => requestRef.current?.resolve(null), []);

  const cropDialog = request ? (
    <ImageCropDialog
      key={`${request.file.name}-${request.file.size}-${request.file.lastModified}`}
      file={request.file}
      kind={request.kind}
      title={request.title}
      onCancel={() => settle(null)}
      onConfirm={(crop) => settle({ file: request.file, crop })}
    />
  ) : null;

  return { cropImage, cropDialog };
}
