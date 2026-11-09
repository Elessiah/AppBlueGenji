"use client";

import { useId } from "react";
import { InfoHint, InfoHintRow } from "@/components/ui/info-hint";
import { FieldErrorText } from "@/components/ui/field-error-text";
import { fieldAria } from "@/lib/shared/field-errors";
import { MAX_CAST_BATTLETAG_LENGTH, isValidCastBattletag } from "@/lib/shared/cast-settings";
import {
  LIVE_PLATFORMS,
  MATCH_LIVE_TRIGGERS,
  MAX_STREAM_URL_LENGTH,
  normalizeStreamUrl,
  requiresMatchStartAt,
  type MatchLiveTrigger,
} from "@/lib/shared/live-streams";
import { formatMatchStartAt } from "@/lib/shared/match-schedule";
import type { BracketMatch } from "@/lib/shared/types";
import { useActionsText } from "../_lib/actions-text";
import styles from "./CastSettingsFields.module.css";

/** Les plateformes acceptées, telles que les aides les citent. */
export const CAST_PLATFORMS = LIVE_PLATFORMS.join(", ");

/** Un lien de stream saisi est-il refusé d'avance (non vide et non reconnu) ? */
export function castUrlInvalid(url: string): boolean {
  return url.trim() !== "" && normalizeStreamUrl(url) === null;
}

/** Un BattleTag de cast saisi est-il refusé d'avance ? */
export function castBattletagInvalid(value: string): boolean {
  return value.trim() !== "" && !isValidCastBattletag(value);
}

/**
 * Le mode que montre `CastTriggerField` : verrouillé, celui **du match** (que
 * le flux tient à jour), jamais le choix local de la fenêtre, figé à son
 * ouverture ; sinon le choix local.
 */
export function lockedTrigger(
  locked: boolean,
  matchTrigger: MatchLiveTrigger | null,
  picked: MatchLiveTrigger,
): MatchLiveTrigger {
  return locked && matchTrigger !== null ? matchTrigger : picked;
}

/**
 * Le mode choisi demande-t-il une date de début que le match n'a pas ? Le
 * serveur refuse ce couple (`MATCH_START_AT_REQUIRED`) : la fenêtre désarme en
 * amont plutôt que de laisser buter dessus.
 */
export function castTriggerNeedsDate(trigger: MatchLiveTrigger, startAt: BracketMatch["startAt"]): boolean {
  return requiresMatchStartAt(trigger) && formatMatchStartAt(startAt) === null;
}

/**
 * Lien du stream d'un caster — **obligatoire** à l'inscription
 * (`docs/features/CAST_SETTINGS.md` : un stream sans lien n'apparaissait sur
 * aucune vue). `fieldError` rattache au champ le refus que le serveur a
 * prononcé (`useFieldErrors`, `ACCESSIBILITY_FORM_ERRORS_STATEMENT.md`).
 */
export function CastUrlField({
  id,
  value,
  onChange,
  invalid,
  fieldError,
  readOnlyNote,
  required = false,
  missing = false,
}: Readonly<{
  id: string;
  value: string;
  onChange: (value: string) => void;
  /** Lien refusé : contrôle fait avant l'envoi, ou refus du serveur rattaché au champ. */
  invalid: boolean;
  fieldError?: string | null;
  /** Le stream est celui du staff : le lien se lit, il ne s'écrit pas ici. */
  readOnlyNote?: string;
  /** Le lien est exigé pour valider (inscription) : dit dans le libellé et `aria-required`. */
  required?: boolean;
  /** Le lien a été vidé alors qu'il est exigé : la note dit pourquoi « Enregistrer » est désarmé. */
  missing?: boolean;
}>) {
  const { t } = useActionsText();
  const hintId = useId();
  const infoId = useId();
  const locked = readOnlyNote !== undefined;
  // Une ligne sous le champ seulement pour un refus ou un lien vidé :
  // l'explication, stream en lecture compris, vit derrière le « i » (`INFO_HINTS.md`).
  // Le refus du serveur porte sa propre phrase (`FieldErrorText`) : la note de
  // format ne s'y ajoute pas, sinon le champ dirait deux choses contraires.
  const formatNote = invalid && !fieldError;
  let note: string | null = null;
  if (formatNote) note = t("cardActions.castSettings.urlInvalid", { platforms: CAST_PLATFORMS });
  // Lien vidé : une note calme (pas une erreur avant l'envoi) qui dit pourquoi « Enregistrer » est désarmé.
  else if (missing && !fieldError) note = t("cardActions.castSettings.urlEmpty");
  return (
    <div className="field">
      <InfoHintRow>
        <label htmlFor={id}>{t(required ? "cardActions.castSettings.urlRequired" : "cardActions.castSettings.url")}</label>
        <InfoHint id={infoId} subject={t("cardActions.castSettings.urlSubject")}>
          {/* Stream de l'organisation : le lien se lit, l'aide dit d'abord pourquoi (pas « obligatoire »). */}
          <p>{readOnlyNote ?? t("cardActions.castSettings.urlHint", { platforms: CAST_PLATFORMS })}</p>
        </InfoHint>
      </InfoHintRow>
      <input
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        maxLength={MAX_STREAM_URL_LENGTH}
        inputMode="url"
        placeholder="https://twitch.tv/…"
        readOnly={locked}
        aria-required={required || undefined}
        // Le refus est lu avant l'aide (`fieldAria`), et l'aide reste lisible.
        {...fieldAria(id, invalid, note === null ? null : hintId, infoId)}
      />
      {note !== null && (
        <p id={hintId} className={formatNote ? styles.hintInvalid : styles.hint}>
          {note}
        </p>
      )}
      <FieldErrorText fieldId={id} message={fieldError ?? null} />
    </div>
  );
}

/**
 * Mode de passage à l'antenne du match (`MatchLiveTrigger`), réglé par son
 * caster comme il l'était par la configuration du direct. « À la date de début »
 * reste désarmé tant que le match n'a pas d'horaire : la date se pose avec la
 * permission `tournaments`.
 *
 * `locked` : le mode appartient à un autre (le caster qui l'a posé, ou le
 * staff — `viewerMayChangeLiveTrigger`) ; il se lit sans contrôle, plutôt
 * qu'un choix que le serveur refuserait (`LIVE_TRIGGER_NOT_OWNED`). L'appelant
 * passe alors le mode **du match** (`lockedTrigger`), jamais son choix local.
 */
export function CastTriggerField({
  trigger,
  startAt,
  onChange,
  locked = false,
}: Readonly<{
  /** `null` : aucun mode coché (match démarqué) — chaque choix se clique. */
  trigger: MatchLiveTrigger | null;
  startAt: BracketMatch["startAt"];
  onChange: (trigger: MatchLiveTrigger) => void;
  locked?: boolean;
}>) {
  const { t, locale } = useActionsText();
  const name = useId();
  const hintId = useId();
  const startAtLabel = formatMatchStartAt(startAt, locale);
  const startAtMissing = startAtLabel === null;
  if (locked) {
    if (trigger === null) return null;
    return (
      <InfoHintRow inline>
        <p className={styles.locked}>
          {t("cardActions.castSettings.triggerLocked", {
            mode: t(`cardActions.castSettings.triggers.${trigger}`),
          })}
        </p>
        <InfoHint id={hintId} subject={t("cardActions.castSettings.trigger")}>
          <p>{t("cardActions.castSettings.triggerLockedHint")}</p>
        </InfoHint>
      </InfoHintRow>
    );
  }
  return (
    <fieldset className={styles.group}>
      {/* Légende en texte seul (nom du groupe) ; l'aide, hors légende. */}
      <legend className="sr-only">{t("cardActions.castSettings.trigger")}</legend>
      <InfoHintRow>
        <span className={styles.legend} aria-hidden="true">
          {t("cardActions.castSettings.trigger")}
        </span>
        <InfoHint id={hintId} subject={t("cardActions.castSettings.trigger")}>
          <p>{t("cardActions.castSettings.autoStop")}</p>
          {startAtMissing && <p>{t("cardActions.castSettings.noStartAt")}</p>}
        </InfoHint>
      </InfoHintRow>
      {MATCH_LIVE_TRIGGERS.map((option) => {
        const off = requiresMatchStartAt(option) && startAtMissing;
        return (
          <label key={option} className={off ? `${styles.option} ${styles.optionOff}` : styles.option}>
            <input
              type="radio"
              name={name}
              value={option}
              checked={trigger === option}
              disabled={off}
              onChange={() => onChange(option)}
            />
            {/* NOSONAR S6772 — label en flex avec `gap` */}
            {t(`cardActions.castSettings.triggers.${option}`)}
            {requiresMatchStartAt(option) && startAtLabel && ` (${startAtLabel})`}
          </label>
        );
      })}
    </fieldset>
  );
}

/**
 * BattleTag donné pour **ce** cast (`docs/features/CAST_SETTINGS.md`) : celui
 * sur lequel le caster sera en jeu, montré dans la fenêtre « Contacts » et sur
 * la page du match à la place de celui de son compte. Overwatch seulement —
 * l'appelant ne monte le champ que là (`battletagRelevantFor`).
 */
export function CastBattletagField({
  id,
  value,
  onChange,
  invalid,
  fieldError,
}: Readonly<{
  id: string;
  value: string;
  onChange: (value: string) => void;
  invalid: boolean;
  /** Refus du serveur rattaché au champ (`INVALID_CAST_BATTLETAG`, `useFieldErrors`). */
  fieldError?: string | null;
}>) {
  const { t } = useActionsText();
  const hintId = useId();
  const infoId = useId();
  return (
    <div className="field">
      <InfoHintRow>
        <label htmlFor={id}>{t("cardActions.castSettings.battletag")}</label>
        <InfoHint id={infoId} subject={t("cardActions.castSettings.battletagSubject")}>
          <p>{t("cardActions.castSettings.battletagHint")}</p>
        </InfoHint>
      </InfoHintRow>
      <input
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        maxLength={MAX_CAST_BATTLETAG_LENGTH}
        placeholder="Pseudo#1234"
        // Le refus est lu avant l'aide (`fieldAria`), comme pour le lien.
        {...fieldAria(id, invalid, invalid && !fieldError ? hintId : null, infoId)}
      />
      {invalid && !fieldError && (
        <p id={hintId} className={styles.hintInvalid}>
          {t("cardActions.castSettings.battletagInvalid")}
        </p>
      )}
      <FieldErrorText fieldId={id} message={fieldError ?? null} />
    </div>
  );
}
