"use client";

import { computeRecommendedRounds } from "@/lib/shared/swiss";
import { DEFAULT_MATCH_FORMAT, MATCH_FORMAT_BOUNDS } from "@/lib/shared/match-format";
import { toParticipantType } from "@/lib/shared/participants";
import { formatDescriptionText, useFormText } from "../_lib/form-text";
import type { TournamentField } from "@/lib/shared/tournament-edit";
import { PhaseBuilder } from "../creer/PhaseBuilder";
import { checkboxCardChrome, FULL_WIDTH, HINT } from "../_lib/form-styles";
import type { TournamentFormValues } from "../_lib/tournament-form-values";
import { NumberInput } from "@/components/ui/number-input";
import { FieldErrorText } from "@/components/ui/field-error-text";
import { InfoHint, InfoHintRow } from "@/components/ui/info-hint";
import { describedBy } from "@/lib/shared/field-errors";
import type { FieldAria } from "@/lib/shared/field-errors";
import { earlyExitBlocker, type EarlyExitBlocker } from "@/lib/shared/bg-survie/config";

/**
 * Identifiant de la case « sortie anticipée » : son `id`, la cible du refus
 * (`FieldErrorText`) et l'entrée de `FIELD_IDS` du formulaire, qui en tire
 * `aria-describedby` et le focus d'un refus — une seule source pour les trois.
 */
export const EARLY_EXIT_FIELD_ID = "endurance-early-exit";
/** Aide de la case, toujours rattachée par `aria-describedby`. */
export const EARLY_EXIT_HINT_ID = `${EARLY_EXIT_FIELD_ID}-hint`;

/** Raison affichée sous la case « sortie anticipée » grisée, par empêchement. */
const EARLY_EXIT_REASONS = {
  NO_CAP: "settings.enduranceEarlyExitNoCap",
  FREE_SCORE: "settings.enduranceEarlyExitFreeScore",
} as const satisfies Record<EarlyExitBlocker, string>;

/**
 * Raison à dire sous la case grisée, `null` s'il n'y a rien à dire. Elle n'est
 * dite que si l'organisateur peut y remédier : figés, la case ou le réglage en
 * cause relèvent du verrou, que son explication dit déjà.
 */
function earlyExitReasonKey(
  blocker: EarlyExitBlocker | null,
  locked: (field: TournamentField) => boolean,
): (typeof EARLY_EXIT_REASONS)[EarlyExitBlocker] | null {
  if (blocker === null || locked("enduranceEarlyExit")) return null;
  const blockingField: TournamentField = blocker === "NO_CAP" ? "enduranceMaxRounds" : "matchFormat";
  return locked(blockingField) ? null : EARLY_EXIT_REASONS[blocker];
}

/**
 * Réglages propres au format choisi : phases (MULTI), endurance (BG Survie),
 * cadence des coupes (Survie), rondes et barème (Suisse), petite finale
 * (élimination simple).
 *
 * Sortis de `TournamentForm`, qui approchait les 900 lignes : ces cinq blocs
 * s'excluent mutuellement et ne partagent rien d'autre que les valeurs du
 * formulaire. Le composant ne tient aucun état — il lit `values` et rend la
 * main par `set`, comme le reste du formulaire.
 */
export type FormatSettingsProps = {
  values: TournamentFormValues;
  set: <K extends keyof TournamentFormValues>(key: K, value: TournamentFormValues[K]) => void;
  /** Le champ est-il figé par la fenêtre d'édition ? */
  locked: (field: TournamentField) => boolean;
  /** Attributs d'accessibilité à poser sur un champ figé (renvoie vers l'explication). */
  lockedAttr: (field: TournamentField) => { "aria-describedby"?: string };
  /**
   * Le nombre de rondes suisses n'est pas un `set` ordinaire : le saisir à la
   * main coupe le suivi automatique de la recommandation, que seul le
   * formulaire connaît.
   */
  onSwissTotalRoundsChange: (value: number) => void;
  /** Demande de focus sur le réglage de phase fautif (voir `PhaseBuilder`). */
  phaseFocusRequest?: number;
  /**
   * Attributs ARIA de la case « sortie anticipée » (BG Survie) : aide, verrou
   * et refus du serveur rattaché, composés par le `fieldAttrs` du formulaire —
   * obligatoires, pour qu'aucun appelant ne rende une case figée dont le
   * verrou ne serait pas annoncé.
   */
  earlyExitAria: FieldAria;
  /** Refus du serveur rattaché à cette case, `null` s'il n'y en a pas. */
  earlyExitError: string | null;
};

export function FormatSettings({
  values,
  set,
  locked,
  lockedAttr,
  onSwissTotalRoundsChange,
  phaseFocusRequest,
  earlyExitAria,
  earlyExitError,
}: Readonly<FormatSettingsProps>) {
  const { format, maxTeams, phases } = values;
  const text = useFormText();
  const { t } = text;
  const entrantType = toParticipantType(values.participantType);
  const recommendedRounds = computeRecommendedRounds(maxTeams);
  // Sans plafond ou en saisie libre, la sortie anticipée ne peut pas jouer :
  // la case est grisée, comme « Égalités », et l'aide dit pourquoi.
  const earlyExitBlocked = earlyExitBlocker(values.enduranceMaxRounds, values.matchFormat);
  const reasonKey = earlyExitReasonKey(earlyExitBlocked, locked);
  // L'aide derrière le « i », plus l'explication du verrou quand le champ est figé.
  const hintAndLock = (hintId: string, field: TournamentField) =>
    describedBy(hintId, lockedAttr(field)["aria-describedby"]);

  return (
    <>
      {format === "MULTI" && (
        <div style={FULL_WIDTH}>
          <PhaseBuilder
            phases={phases}
            maxTeams={maxTeams}
            disabled={locked("phases")}
            focusRequest={phaseFocusRequest}
            onChange={(next) => set("phases", next)}
          />
        </div>
      )}

      {format === "BG_SURVIE" && (
        <>
          <div className="field">
            <label htmlFor="endurance-points">{t("settings.endurancePoints")}</label>
            <NumberInput
              id="endurance-points"
              min={1}
              max={99}
              disabled={locked("endurancePoints")}
              value={values.endurancePoints}
              onValueChange={(next) => set("endurancePoints", next)}
              {...lockedAttr("endurancePoints")}
            />
            <p style={HINT}>
              {t("settings.endurancePointsHint")}
            </p>
          </div>

          <div className="field">
            <label htmlFor="endurance-win">{t("settings.enduranceWin")}</label>
            <NumberInput
              id="endurance-win"
              min={1}
              max={20}
              disabled={locked("enduranceWinDelta")}
              value={values.enduranceWinDelta}
              onValueChange={(next) => set("enduranceWinDelta", next)}
              {...lockedAttr("enduranceWinDelta")}
            />
          </div>

          <div className="field">
            <label htmlFor="endurance-loss">{t("settings.enduranceLoss")}</label>
            <NumberInput
              id="endurance-loss"
              min={1}
              max={20}
              disabled={locked("enduranceLossDelta")}
              value={values.enduranceLossDelta}
              onValueChange={(next) => set("enduranceLossDelta", next)}
              {...lockedAttr("enduranceLossDelta")}
            />
          </div>

          <div className="field">
            <InfoHintRow>
              <label htmlFor="endurance-playoff">{t("settings.endurancePlayoff")}</label>
              <InfoHint id="endurance-playoff-hint" subject={t("settings.endurancePlayoff")}>
                <p>{t("settings.endurancePlayoffHint")}</p>
              </InfoHint>
            </InfoHintRow>
            <NumberInput
              id="endurance-playoff"
              min={2}
              max={32}
              disabled={locked("endurancePlayoffSize")}
              value={values.endurancePlayoffSize}
              onValueChange={(next) => set("endurancePlayoffSize", next)}
              aria-describedby={hintAndLock("endurance-playoff-hint", "endurancePlayoffSize")}
            />
          </div>

          <div className="field">
            <InfoHintRow>
              <label htmlFor="endurance-max-rounds">{t("settings.enduranceMaxRounds")}</label>
              <InfoHint id="endurance-max-rounds-hint" subject={t("settings.enduranceMaxRounds")}>
                <p>{t("settings.enduranceMaxRoundsHint")}</p>
              </InfoHint>
            </InfoHintRow>
            <NumberInput
              id="endurance-max-rounds"
              min={0}
              max={50}
              disabled={locked("enduranceMaxRounds")}
              value={values.enduranceMaxRounds}
              onValueChange={(next) => set("enduranceMaxRounds", next)}
              aria-describedby={hintAndLock("endurance-max-rounds-hint", "enduranceMaxRounds")}
            />
          </div>

          <div className="field" style={FULL_WIDTH}>
            <InfoHintRow>
            <label htmlFor={EARLY_EXIT_FIELD_ID} style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <input
                id={EARLY_EXIT_FIELD_ID}
                type="checkbox"
                disabled={locked("enduranceEarlyExit") || earlyExitBlocked !== null}
                // Grisée faute de pouvoir jouer, elle se montre décochée, comme
                // « Égalités » : la valeur enregistrée reste, sans effet.
                checked={values.enduranceEarlyExit && earlyExitBlocked === null}
                onChange={(e) => set("enduranceEarlyExit", e.target.checked)}
                {...earlyExitAria}
              />{/* NOSONAR S6772 — label en flex avec `gap` : l'espace est posé par la mise en page */}
              {t("settings.enduranceEarlyExit")}
            </label>
            {/* Comme « Égalités » : grisée, l'aide ne dit que la raison, visible —
                le fonctionnement (« dernière manche », « trait ») ne vaut pas
                sans elle ; sinon il passe derrière le « i », même identifiant. */}
            {reasonKey ? null : (
              <InfoHint id={EARLY_EXIT_HINT_ID} subject={t("settings.enduranceEarlyExit")}>
                <p>{t("settings.enduranceEarlyExitHint")}</p>
              </InfoHint>
            )}
            </InfoHintRow>
            <FieldErrorText fieldId={EARLY_EXIT_FIELD_ID} message={earlyExitError} />
            {reasonKey ? (
              <p id={EARLY_EXIT_HINT_ID} style={HINT}>
                {t(reasonKey)}
              </p>
            ) : null}
          </div>

          <div className="field" style={FULL_WIDTH}>
            <InfoHintRow>
            <label htmlFor="endurance-draws" style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <input
                id="endurance-draws"
                type="checkbox"
                disabled={locked("matchFormat") || values.matchFormat === null}
                checked={values.matchFormat?.drawsAllowed ?? false}
                onChange={(e) => {
                  if (!values.matchFormat) return;
                  // Décocher rend aussi son plafond naturel au format : le
                  // plafond **est** la fenêtre du nul, et le laisser posé sans
                  // elle rendrait certaines rencontres inachevables — le serveur
                  // le refuse (`MATCH_FORMAT_MAX_MAPS_REQUIRES_DRAWS`) sur un
                  // champ que le formulaire vient de masquer.
                  set("matchFormat", {
                    ...values.matchFormat,
                    drawsAllowed: e.target.checked,
                    ...(e.target.checked ? {} : { maxMaps: null }),
                  });
                }}
                aria-describedby={hintAndLock("endurance-draws-hint", "matchFormat")}
              />{/* NOSONAR S6772 — label en flex avec `gap` : l'espace est posé par la mise en page */}
              {t("settings.draws")}
            </label>
            {/* Indisponible, la raison reste visible ; sinon le fonctionnement
                passe derrière le « i », même identifiant. */}
            {values.matchFormat === null ? null : (
              <InfoHint id="endurance-draws-hint" subject={t("settings.draws")}>
                <p>{t("settings.drawsHint")}</p>
              </InfoHint>
            )}
            </InfoHintRow>
            {values.matchFormat === null ? (
              <p id="endurance-draws-hint" style={HINT}>
                {t("settings.drawsUnavailable")}
              </p>
            ) : null}
          </div>

          <div className="field">
            <InfoHintRow>
              <label htmlFor="endurance-playoff-format-type">{t("settings.playoffFormat")}</label>
              <InfoHint id="endurance-playoff-format-hint" subject={t("settings.playoffFormat")}>
                <p>{t("settings.playoffFormatHint")}</p>
              </InfoHint>
            </InfoHintRow>
            <select
              id="endurance-playoff-format-type"
              disabled={locked("endurancePlayoffFormat")}
              value={values.endurancePlayoffFormat?.type ?? "MEME"}
              onChange={(e) => {
                const next = e.target.value;
                if (next === "MEME") {
                  set("endurancePlayoffFormat", null);
                  return;
                }
                const type = next as "BO" | "FT";
                const bounds = MATCH_FORMAT_BOUNDS[type];
                let value = values.endurancePlayoffFormat?.value ?? DEFAULT_MATCH_FORMAT.value;
                value = Math.min(Math.max(value, bounds.min), bounds.max);
                if (type === "BO" && value % 2 === 0) value -= 1;
                set("endurancePlayoffFormat", { type, value });
              }}
              aria-describedby={hintAndLock("endurance-playoff-format-hint", "endurancePlayoffFormat")}
            >
              <option value="MEME">{t("settings.playoffFormats.MEME")}</option>
              <option value="BO">{t("settings.playoffFormats.BO")}</option>
              <option value="FT">{t("settings.playoffFormats.FT")}</option>
            </select>
          </div>

          {values.endurancePlayoffFormat && (
            <div className="field">
              <label htmlFor="endurance-playoff-format-value">
                {t(`settings.playoffFormatValue.${values.endurancePlayoffFormat.type}`)}
              </label>
              <NumberInput
                id="endurance-playoff-format-value"
                min={MATCH_FORMAT_BOUNDS[values.endurancePlayoffFormat.type].min}
                max={MATCH_FORMAT_BOUNDS[values.endurancePlayoffFormat.type].max}
                step={values.endurancePlayoffFormat.type === "BO" ? 2 : 1}
                disabled={locked("endurancePlayoffFormat")}
                value={values.endurancePlayoffFormat.value}
                onValueChange={(raw) => {
                  if (!values.endurancePlayoffFormat) return;
                  // Un zéro ou une valeur hors bornes, que le `?? null` de `toApiPayload`
                  // ne rattrape pas : il partait au serveur et revenait en
                  // `INVALID_ENDURANCE_PLAYOFF_FORMAT` brut dans un toast, là où
                  // le format principal est intercepté avant l'aller-retour.
                  const type = values.endurancePlayoffFormat.type;
                  const bounds = MATCH_FORMAT_BOUNDS[type];
                  const value = Number.isInteger(raw)
                    ? Math.min(Math.max(raw, bounds.min), bounds.max)
                    : values.endurancePlayoffFormat.value;
                  set("endurancePlayoffFormat", { type, value });
                }}
                {...lockedAttr("endurancePlayoffFormat")}
              />
              <p style={HINT}>{formatDescriptionText(text, values.endurancePlayoffFormat)}</p>
            </div>
          )}
        </>
      )}

      {format === "SURVIVAL" && (
        <>
          <div className="field">
            <label htmlFor="survival-first-cut">{t("settings.survivalFirstCut")}</label>
            <NumberInput
              id="survival-first-cut"
              min={1}
              max={50}
              disabled={locked("survivalRoundsBeforeFirstCut")}
              value={values.survivalRoundsBeforeFirstCut}
              onValueChange={(next) =>
                set("survivalRoundsBeforeFirstCut", next)
              }
              {...lockedAttr("survivalRoundsBeforeFirstCut")}
            />
            <p style={HINT}>
              {t("settings.survivalFirstCutHint")}
            </p>
          </div>

          <div className="field">
            <label htmlFor="survival-rounds">{t("settings.survivalRounds")}</label>
            <NumberInput
              id="survival-rounds"
              min={1}
              max={50}
              disabled={locked("survivalRoundsPerCut")}
              value={values.survivalRoundsPerCut}
              onValueChange={(next) => set("survivalRoundsPerCut", next)}
              {...lockedAttr("survivalRoundsPerCut")}
            />
            <p style={HINT}>
              {t("settings.survivalRoundsHint")}
            </p>
          </div>
        </>
      )}

      {format === "SWISS" && (
        <>
          <div className="field">
            <label htmlFor="swiss-rounds">{t("settings.swissRounds")}</label>
            <NumberInput
              id="swiss-rounds"
              min={1}
              max={20}
              disabled={locked("swissTotalRounds")}
              value={values.swissTotalRounds}
              onValueChange={(next) => onSwissTotalRoundsChange(next)}
              {...lockedAttr("swissTotalRounds")}
            />
            <p style={HINT}>
              {t(`settings.swissRecommended.${entrantType}`, { count: maxTeams, rounds: recommendedRounds })}
            </p>
          </div>

          <div className="field">
            <label htmlFor="swiss-points-win">{t("settings.swissPoints")}</label>
            <div style={{ display: "flex", gap: 8 }}>
              <NumberInput
                id="swiss-points-win"
                min={0}
                max={99}
                aria-label={t("settings.swissPointsWin")}
                disabled={locked("swissPointsWin")}
                value={values.swissPointsWin}
                onValueChange={(next) => set("swissPointsWin", next)}
                {...lockedAttr("swissPointsWin")}
              />
              <NumberInput
                min={0}
                max={99}
                aria-label={t("settings.swissPointsDraw")}
                disabled={locked("swissPointsDraw")}
                value={values.swissPointsDraw}
                onValueChange={(next) => set("swissPointsDraw", next)}
                {...lockedAttr("swissPointsDraw")}
              />
              <NumberInput
                min={0}
                max={99}
                aria-label={t("settings.swissPointsLoss")}
                disabled={locked("swissPointsLoss")}
                value={values.swissPointsLoss}
                onValueChange={(next) => set("swissPointsLoss", next)}
                {...lockedAttr("swissPointsLoss")}
              />
            </div>
            <p style={HINT}>
              {t("settings.swissByeHint")}
            </p>
          </div>
        </>
      )}

      {format === "SINGLE" && (
        <div className="field" style={FULL_WIDTH}>
          <label htmlFor="third-place" style={{ marginBottom: 6 }}>
            {t("settings.options")}
          </label>
          <div // NOSONAR S1082 — raccourci souris ; le clavier passe par la case native qu'elle contient
            className="checkbox-card"
            // Verrouillée, la carte n'a plus de geste — et rien à déclarer pour
            // le dire : `globals.css` retire le halo et le balayage du survol
            // dès que la case qu'elle contient est `disabled`.
            onClick={
              locked("hasThirdPlaceMatch")
                ? undefined
                : () => set("hasThirdPlaceMatch", !values.hasThirdPlaceMatch)
            }
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: 12,
              padding: "14px 16px",
              // Cadre et fond viennent de `checkboxCardChrome`, partagé avec la
              // carte jumelle de `PhaseCard` : deux copies auraient divergé au
              // premier réglage, et la divergence se serait vue à l'écran.
              ...checkboxCardChrome(values.hasThirdPlaceMatch, locked("hasThirdPlaceMatch")),
              borderRadius: 10,
              cursor: locked("hasThirdPlaceMatch") ? "not-allowed" : "pointer",
              // Pas de `color` dans la liste : la carte ne change jamais la
              // sienne, ce sont ses enfants qui portent les leurs.
              transition: "border-color 0.2s ease, background-color 0.2s ease",
            }}
          >
            <input
              id="third-place"
              type="checkbox"
              disabled={locked("hasThirdPlaceMatch")}
              checked={values.hasThirdPlaceMatch}
              onChange={(e) => set("hasThirdPlaceMatch", e.target.checked)}
              // Taille, teinte et curseur viennent de `globals.css` : les
              // redire en ligne, c'est reprendre la main sur la règle et
              // redonner à cet écran une case que ses voisins n'ont pas.
              style={{ marginTop: 2 }}
              {...lockedAttr("hasThirdPlaceMatch")}
            />
            <div style={{ flex: 1 }}>
              <label
                htmlFor="third-place"
                style={{
                  display: "block",
                  margin: "0 0 4px",
                  cursor: locked("hasThirdPlaceMatch") ? "not-allowed" : "pointer",
                  userSelect: "none",
                  fontSize: 14,
                  fontWeight: 500,
                  color: locked("hasThirdPlaceMatch") ? "var(--ink-mute)" : "var(--ink)",
                }}
              >
                {t("settings.thirdPlace")}
              </label>
              <p
                style={{
                  ...HINT,
                  margin: 0,
                  ...(locked("hasThirdPlaceMatch") ? { color: "var(--ink-dim)" } : {}),
                }}
              >
                {t("settings.thirdPlaceHint")}
              </p>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
