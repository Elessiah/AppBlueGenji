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

/**
 * URL `blob:` d'un fichier local, révoquée dès qu'elle ne sert plus.
 *
 * L'URL est rendue **avec le fichier qu'elle désigne** et n'est lue que si ce
 * fichier est toujours le courant : l'effet ne s'exécutant qu'après le rendu,
 * le rendu qui suit un changement de fichier verrait sinon l'URL — déjà
 * révoquée — du fichier précédent.
 */
function useObjectUrl(file: File | null): string | null {
  const [entry, setEntry] = useState<{ file: File; url: string } | null>(null);
  useEffect(() => {
    if (!file) {
      setEntry(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setEntry({ file, url });
    return () => URL.revokeObjectURL(url);
  }, [file]);
  return entry !== null && entry.file === file ? entry.url : null;
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
  // Un fichier survole la zone vide : on le dit avant qu'il soit lâché.
  const [dropping, setDropping] = useState(false);
  const baseId = useId();
  const objectUrl = useObjectUrl(value.file);

  // Un fichier choisi ne se montre que **lui-même** : tant que son URL locale
  // n'existe pas, on n'affiche rien plutôt que l'image enregistrée (retirée
  // peut-être), qui se serait montrée un instant sous les réglages du nouveau
  // fichier. Pas d'écran « vide » pour autant : `hasImage` tient compte du
  // fichier.
  const displayUrl = value.file !== null ? objectUrl : value.removed ? null : existing?.url ?? null;
  const hasImage = value.file !== null || displayUrl !== null;
  const { settings } = value;
  const isCover = settings.fit === "COVER";

  const setSettings = (patch: Partial<TournamentImageSettings>) =>
    onChange({ ...value, settings: { ...settings, ...patch } });

  // Numéro du dernier fichier choisi : la lecture de ses dimensions est
  // asynchrone, et deux choix rapprochés peuvent se résoudre dans le désordre —
  // seul le dernier a le droit d'écrire le brouillon.
  const pickSeqRef = useRef(0);

  const onFileChosen = async (file: File | undefined) => {
    if (fileInputRef.current) fileInputRef.current.value = "";
    if (!file) return;
    const refusal = rejectImageFile(file);
    if (refusal) {
      showError(refusal);
      return;
    }
    const seq = ++pickSeqRef.current;
    const size = await readImageSize(file);
    if (seq !== pickSeqRef.current) return;
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
          className={`${s.empty} ${dropping ? s.emptyDropping : ""}`}
          disabled={disabled}
          onClick={() => fileInputRef.current?.click()}
          // Glisser un fichier sur la zone vaut le choisir : c'est le geste
          // qu'on tente d'abord devant une grande cible en pointillés.
          onDragOver={(event) => {
            if (disabled) return;
            event.preventDefault();
            setDropping(true);
          }}
          // `dragleave` part aussi en passant sur un enfant de la zone : on
          // n'éteint l'état que quand le pointeur la quitte vraiment.
          onDragLeave={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropping(false);
          }}
          onDrop={(event) => {
            event.preventDefault();
            setDropping(false);
            if (!disabled) void onFileChosen(event.dataTransfer.files?.[0]);
          }}
          aria-describedby={hintId}
        >
          <span className={s.emptyIcon} aria-hidden="true">
            +
          </span>
          <span className={s.emptyTitle}>
            {dropping ? "Dépose l'image ici" : "Ajouter une illustration ou un logo"}
          </span>
          <span id={hintId} className={s.emptyHint}>
            Facultatif · PNG, JPEG ou WebP, 5 Mo max · toutes dimensions acceptées, rien n&apos;est
            rogné à l&apos;envoi
          </span>
        </button>
      ) : (
        <>
          <fieldset className={s.modes}>
            <legend className="sr-only">Type d&apos;image</legend>
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
          </fieldset>

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
                    // Un glisser commencé avant l'envoi s'arrête avec lui : le
                    // brouillon ne doit plus bouger une fois parti.
                    if (draggingRef.current && !disabled) moveFocus(event);
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
              onClick={() => {
                // Un fichier dont les dimensions se lisent encore ne revient pas
                // après un retrait.
                pickSeqRef.current += 1;
                onChange({ ...value, file: null, removed: true });
              }}
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
