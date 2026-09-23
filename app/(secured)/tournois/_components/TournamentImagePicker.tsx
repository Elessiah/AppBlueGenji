"use client";

/* Les aperçus sont des `<img>` bruts, et c'est voulu : ils montrent un fichier
   **local** (`blob:`) que personne n'a encore envoyé — `next/image` ne sait pas
   l'optimiser —, ou l'image déjà enregistrée, recadrée à la volée. Même
   exception que l'aperçu de la modale des partenaires. */
/* eslint-disable @next/next/no-img-element */

import { useEffect, useId, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { useToast } from "@/components/ui/toast";
import {
  TOURNAMENT_IMAGE_ACCEPT,
  TOURNAMENT_IMAGE_FITS,
  TOURNAMENT_IMAGE_FIT_LABELS,
  focusFromKey,
  focusFromPoint,
  imageObjectPosition,
  type TournamentImage,
  type TournamentImageSettings,
} from "@/lib/shared/tournament-image";
import {
  rejectImageFile,
  suggestImageFit,
  withNewFile,
  type ImagePickerValue,
} from "../_lib/image-picker";
import s from "./TournamentImagePicker.module.css";

interface TournamentImagePickerProps {
  /** Image déjà enregistrée ; `null` à la création. */
  existing: TournamentImage | null;
  value: ImagePickerValue;
  onChange: (value: ImagePickerValue) => void;
  disabled?: boolean;
}

/** URL `blob:` d'un fichier local, révoquée dès qu'elle ne sert plus. */
function useObjectUrl(file: File | null): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!file) {
      setUrl(null);
      return;
    }
    const next = URL.createObjectURL(file);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [file]);
  return url;
}

/** Dimensions d'un fichier image ; `null` si le navigateur ne sait pas les lire. */
async function readImageSize(file: File): Promise<{ width: number; height: number } | null> {
  if (typeof createImageBitmap !== "function") return null;
  try {
    const bitmap = await createImageBitmap(file);
    const size = { width: bitmap.width, height: bitmap.height };
    bitmap.close();
    return size;
  } catch {
    return null;
  }
}

/**
 * Sélecteur de l'illustration ou du logo d'un tournoi — **facultatif**.
 *
 * Trois gestes, dans l'ordre où ils se posent :
 *
 * 1. **Choisir un fichier**, de n'importe quelles dimensions : rien n'est
 *    recadré à l'envoi (`lib/server/image-upload.ts`, gabarit
 *    `tournament-image`). Un mode est proposé d'après les proportions.
 * 2. **Dire ce que c'est** : une illustration remplit un bandeau, un logo est
 *    toujours montré en entier.
 * 3. Pour une illustration, **désigner le point qui doit rester visible** —
 *    clic ou flèches du clavier sur l'image entière. Les aperçus à côté
 *    montrent le résultat aux deux proportions réelles du site (bandeau de la
 *    fiche, carte de la liste), si bien qu'on voit ce que le cadre coupe.
 *
 * Le composant est contrôlé : il ne fait qu'un brouillon, que la page enregistre.
 */
export function TournamentImagePicker({ existing, value, onChange, disabled }: TournamentImagePickerProps) {
  const { showError } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const draggingRef = useRef(false);
  const baseId = useId();
  const objectUrl = useObjectUrl(value.file);

  const displayUrl = objectUrl ?? (value.removed ? null : existing?.url ?? null);
  // Le fichier local n'a pas encore d'URL au premier rendu qui suit son choix :
  // on ne bascule pas sur l'écran « vide » pour autant.
  const hasImage = value.file !== null || displayUrl !== null;
  const { settings } = value;
  const isCover = settings.fit === "COVER";

  const setSettings = (patch: Partial<TournamentImageSettings>) =>
    onChange({ ...value, settings: { ...settings, ...patch } });

  const onFileChosen = async (file: File | undefined) => {
    if (fileInputRef.current) fileInputRef.current.value = "";
    if (!file) return;
    const refusal = rejectImageFile(file);
    if (refusal) {
      showError(refusal);
      return;
    }
    const size = await readImageSize(file);
    onChange(withNewFile(file, size ? suggestImageFit(size.width, size.height) : settings.fit));
  };

  const moveFocus = (event: PointerEvent<HTMLDivElement>) => {
    setSettings(focusFromPoint(event.clientX, event.clientY, event.currentTarget.getBoundingClientRect()));
  };

  const onFocusKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const next = focusFromKey(settings, event.key, event.shiftKey);
    if (next === null) return;
    event.preventDefault();
    setSettings(next);
  };

  const hintId = `${baseId}-hint`;
  const focusHintId = `${baseId}-focus-hint`;

  return (
    <div className={s.root}>
      <input
        ref={fileInputRef}
        type="file"
        accept={TOURNAMENT_IMAGE_ACCEPT}
        onChange={(e) => void onFileChosen(e.target.files?.[0])}
        style={{ display: "none" }}
        tabIndex={-1}
        aria-hidden="true"
      />

      {!hasImage ? (
        <button
          type="button"
          className={s.empty}
          disabled={disabled}
          onClick={() => fileInputRef.current?.click()}
          aria-describedby={hintId}
        >
          <span className={s.emptyIcon} aria-hidden="true">
            +
          </span>
          <span className={s.emptyTitle}>Ajouter une illustration ou un logo</span>
          <span id={hintId} className={s.emptyHint}>
            Facultatif · PNG, JPEG ou WebP, 5 Mo max · toutes dimensions acceptées, rien n&apos;est
            rogné à l&apos;envoi
          </span>
        </button>
      ) : (
        <>
          <div className={s.modes} role="radiogroup" aria-label="Type d'image">
            {TOURNAMENT_IMAGE_FITS.map((fit) => (
              <label key={fit} className={`${s.mode} ${settings.fit === fit ? s.modeActive : ""}`}>
                <input
                  type="radio"
                  name={`${baseId}-fit`}
                  value={fit}
                  checked={settings.fit === fit}
                  disabled={disabled}
                  onChange={() => setSettings({ fit })}
                />
                <span className={s.modeText}>
                  <span className={s.modeLabel}>{TOURNAMENT_IMAGE_FIT_LABELS[fit].label}</span>
                  <span className={s.modeHint}>{TOURNAMENT_IMAGE_FIT_LABELS[fit].hint}</span>
                </span>
              </label>
            ))}
          </div>

          {displayUrl && isCover && (
            <div className={s.editor}>
              <div className={s.column}>
                <p className={s.caption}>Point de cadrage</p>
                <div
                  className={s.stage}
                  role="application"
                  aria-roledescription="sélecteur de point de cadrage"
                  aria-label={`Point de cadrage : ${settings.focusX} % depuis la gauche, ${settings.focusY} % depuis le haut`}
                  aria-describedby={focusHintId}
                  aria-disabled={disabled || undefined}
                  tabIndex={disabled ? -1 : 0}
                  onKeyDown={disabled ? undefined : onFocusKey}
                  onPointerDown={
                    disabled
                      ? undefined
                      : (event) => {
                          draggingRef.current = true;
                          event.currentTarget.setPointerCapture(event.pointerId);
                          moveFocus(event);
                        }
                  }
                  onPointerMove={(event) => {
                    if (draggingRef.current) moveFocus(event);
                  }}
                  onPointerUp={() => {
                    draggingRef.current = false;
                  }}
                  onPointerCancel={() => {
                    draggingRef.current = false;
                  }}
                >
                  <img src={displayUrl} alt="" className={s.stageImage} draggable={false} />
                  <span
                    className={s.marker}
                    style={{ left: `${settings.focusX}%`, top: `${settings.focusY}%` }}
                    aria-hidden="true"
                  />
                </div>
                <p id={focusHintId} className={s.hint}>
                  Clique ou fais glisser sur l&apos;image ; au clavier, flèches (Maj pour aller plus
                  vite), Origine pour recentrer.
                </p>
              </div>

              <div className={s.column}>
                <p className={s.caption}>Aperçu</p>
                <div className={s.previewStack}>
                  <figure className={s.previewFigure}>
                    <div className={`${s.previewFrame} ${s.previewWide}`}>
                      <img
                        src={displayUrl}
                        alt=""
                        className={s.previewImage}
                        style={{ objectPosition: imageObjectPosition(settings) }}
                      />
                    </div>
                    <figcaption className={s.previewCaption}>Bandeau de la fiche</figcaption>
                  </figure>
                  <figure className={s.previewFigure}>
                    <div className={`${s.previewFrame} ${s.previewCard}`}>
                      <img
                        src={displayUrl}
                        alt=""
                        className={s.previewImage}
                        style={{ objectPosition: imageObjectPosition(settings) }}
                      />
                    </div>
                    <figcaption className={s.previewCaption}>Carte de la liste</figcaption>
                  </figure>
                </div>
              </div>
            </div>
          )}

          {displayUrl && !isCover && (
            <div className={s.logoPreview}>
              <div className={s.logoTile}>
                <img src={displayUrl} alt="" className={s.logoImage} />
              </div>
              <p className={s.hint}>
                Le logo s&apos;affiche en entier à côté du nom du tournoi, sur la fiche comme sur les
                cartes. Un fond transparent y rend le mieux.
              </p>
            </div>
          )}

          <div className={s.actions}>
            <button
              type="button"
              className="btn ghost"
              disabled={disabled}
              onClick={() => fileInputRef.current?.click()}
              style={{ padding: "8px 16px", fontSize: 13 }}
            >
              Remplacer l&apos;image
            </button>
            <button
              type="button"
              className="btn ghost"
              disabled={disabled}
              onClick={() => onChange({ ...value, file: null, removed: true })}
              style={{ padding: "8px 16px", fontSize: 13 }}
            >
              Retirer l&apos;image
            </button>
          </div>
        </>
      )}
    </div>
  );
}
