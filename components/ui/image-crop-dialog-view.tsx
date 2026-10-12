"use client";

/* L'image choisie est un fichier **local** (`blob:`) que personne n'a encore
   envoyé : `next/image` ne sait pas l'optimiser. */
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
  IMAGE_CROP_ROUND,
  cropBoxFromKey,
  cropToSend,
  defaultCropBox,
  moveCropBox,
  resizeCropBox,
  scaleCropBox,
  type CropBox,
  type CropHandle,
  type CropRect,
  type ImageSize,
  type ImageUploadKind,
} from "@/lib/shared/image-crop";
import frImageCrop from "@/messages/fr/imageCrop.json";
import { scopedText, type Leaves, type ScopedText } from "@/lib/shared/scoped-text";
import s from "./image-crop-dialog.module.css";

/*
 * La modale elle-même, **chargée à la demande** par `useImageCropper`
 * (`image-crop-dialog.tsx`, revue de performance du lot 9-2) : elle ne sert
 * qu'après le choix d'un fichier, et son code et ses deux langues ne pèsent
 * plus sur le premier chargement des écrans qui l'offrent (accueil, bénévoles,
 * profil, équipes, tournois).
 */

export interface ImageCropDialogProps {
  file: File;
  kind: ImageUploadKind;
  /** Titre de la modale (« Recadrer ton avatar »). */
  title: string;
  onCancel: () => void;
  onConfirm: (crop: CropRect | null) => void;
  /**
   * Langue de la modale quand elle diffère de la page : `"fr"` pour un écran
   * du staff (en français, D4) ouvert sous `/en` — portée dans `document.body`,
   * elle n'hérite pas du `lang` de l'éditeur qui l'ouvre.
   */
  lang?: "fr";
  /**
   * L'anglais de la modale, chargé avec elle sous `/en` par `useImageCropper`
   * (revue de performance du lot 9-2) : absent, le français — jamais
   * l'anglais dans le morceau d'un lecteur français.
   */
  englishMessages?: ImageCropMessages;
}

export type ImageCropMessages = typeof frImageCrop;

type Drag =
  | { mode: "move"; pointerId: number; startX: number; startY: number; startBox: CropBox }
  | { mode: "resize"; handle: CropHandle; pointerId: number; startX: number; startY: number; startBox: CropBox };

/**
 * Textes de la modale (espace `imageCrop`, lot 9-2) : son français voyage
 * avec elle, dans son morceau chargé à la demande ; l'anglais arrive à part,
 * sous `/en` seulement (`englishMessages`, chargé par `useImageCropper`).
 * `lang="fr"` (outil du staff, D4) impose le français.
 */
const FR_CROP_TEXT: ScopedText<Leaves<ImageCropMessages>> = scopedText("fr", frImageCrop);
/** Un texte anglais par paquet de messages reçu (un seul en pratique). */
const englishTexts = new WeakMap<ImageCropMessages, ScopedText<Leaves<ImageCropMessages>>>();

function cropText(lang: "fr" | undefined, englishMessages: ImageCropMessages | undefined): ScopedText<Leaves<ImageCropMessages>> {
  if (lang === "fr" || !englishMessages) return FR_CROP_TEXT;
  let text = englishTexts.get(englishMessages);
  if (!text) {
    text = scopedText("en", englishMessages);
    englishTexts.set(englishMessages, text);
  }
  return text;
}

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
export function ImageCropDialog({ file, kind, title, onCancel, onConfirm, lang, englishMessages }: Readonly<ImageCropDialogProps>) {
  const { t } = cropText(lang, englishMessages);
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
    ? t("frameDetail", {
        width: Math.round((box.width / size.width) * 100),
        height: Math.round((box.height / size.height) * 100),
        left: Math.round((box.x / size.width) * 100),
        top: Math.round((box.y / size.height) * 100),
      })
    : t("frame");

  let body: ReactNode;
  if (failed) {
    body = <p className={s.error}>{t("failed")}</p>;
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
                aria-roledescription={t("frameRole")}
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
                    title={t("resizeBy", { handle: t(`handles.${handle}`) })}
                  />
                ))}
              </div>
            )}
          </div>
          <p id={hintId} className={s.hint}>
            {aspect !== null ? t("hintFixed") : t("hint")}
            {/* L'aide clavier quitte l'écran tactile, où les boutons de
                l'aperçu tiennent le même rôle, mais reste lue avec le cadre. */}
            <span className={s.hintKeys}>{` ${t("hintKeys")}`}</span>
          </p>
        </div>

        {ready && url && (
          <div className={s.side}>
            <p className={s.caption}>{t("preview")}</p>
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
                <span aria-hidden="true">− </span>
                {t("shrink")}
              </button>
              <button type="button" className="btn ghost" onClick={() => scale(CROP_SCALE_STEP)}>
                <span aria-hidden="true">+ </span>
                {t("grow")}
              </button>
              <button type="button" className="btn ghost" onClick={() => setBox(defaultCropBox(size, aspect))}>
                {t("reset")}
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }

  return createPortal(
    <div /* NOSONAR S6819 — voile de modale, sans équivalent natif */ role="presentation" className={s.backdrop} {...backdrop}>
      <div /* NOSONAR S6819 — modale portée dans body (useDialogBehavior) : `<dialog>` changerait couche, Échap et ::backdrop */ ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} className={s.dialog} lang={lang}>
        <h2 id={titleId} className={s.title}>
          {title}
        </h2>
        {body}
        <div className={s.footer}>
          <button type="button" className={s.cancel} onClick={onCancel}>
            {t("cancel")}
          </button>
          <button
            type="button"
            className="btn"
            disabled={!ready}
            onClick={() => {
              if (box && size) onConfirm(cropToSend(box, size));
            }}
          >
            {t("confirm")}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
