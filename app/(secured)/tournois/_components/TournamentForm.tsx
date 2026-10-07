"use client";

import { FormEvent, useState, type ReactNode } from "react";
import { LocaleLink } from "@/components/i18n/locale-navigation";
import { richNodes } from "@/components/i18n/shell-text";
import type { TournamentFormat, TournamentGame, TournamentState } from "@/lib/shared/types";
import { findPhaseIssue } from "@/lib/shared/tournament-phases";
import { computeRecommendedRounds } from "@/lib/shared/swiss";
import {
  DEFAULT_MATCH_FORMAT,
  MATCH_FORMAT_BOUNDS,
  isValidMatchFormat,
  isValidMatchMaxMaps,
  matchAllowsDraw,
  matchMaxMaps,
  matchWinsRequired,
  naturalMaxMaps,
  type MatchFormat,
  type MatchFormatType,
} from "@/lib/shared/match-format";
import { toParticipantType, type ParticipantType } from "@/lib/shared/participants";
import {
  MIN_PLAYERS_BOUNDS,
  PLAYER_REQUIREMENTS,
  type PlayerRequirement,
} from "@/lib/shared/registration-filters";
import type { TournamentField } from "@/lib/shared/tournament-edit";
import { useToast } from "@/components/ui/toast";
import { CyberCard, CyberButton } from "@/components/cyber";
import { conditionsText, formatHintText, invalidFormatText, phaseIssueText, useFormText } from "../_lib/form-text";
import { useErrorsText } from "../[id]/_lib/error-map";
import { FormatSettings } from "./FormatSettings";
import { TournamentImagePicker } from "./TournamentImagePicker";
import { RefereeSchedulingField } from "./RefereeSchedulingField";
import { initialImagePickerValue, type ImagePickerValue } from "../_lib/image-picker";
import {
  sectionEyebrow,
  FULL_WIDTH,
  GRID,
  HINT,
  SECTION_SEPARATOR,
  SECTION_STACK,
} from "../_lib/form-styles";
import {
  DEFAULT_QUALIFICATION_DRAWS,
  effectiveMatchFormat,
  misplacedDateField,
  type TournamentFormValues,
} from "../_lib/tournament-form-values";
import {
  TOURNAMENT_FIELD_ERRORS,
  describedBy,
  errorCode,
  type TournamentFormField,
} from "@/lib/shared/field-errors";
import { useFieldErrors } from "@/lib/shared/hooks/useFieldErrors";
import { FieldErrorText } from "@/components/ui/field-error-text";
import { NumberInput } from "@/components/ui/number-input";

/** Contrôles que peut désigner un refus de l'envoi. */
const FIELD_IDS: Readonly<Record<TournamentFormField, string>> = {
  name: "tournament-name",
  maxTeams: "max-teams",
  matchFormatValue: "match-format-value",
  startVisibilityAt: "visibility-at",
  registrationOpenAt: "registration-open-at",
  registrationCloseAt: "registration-close-at",
  startAt: "start-at",
};

// Les valeurs et leurs conversions vivent dans `_lib/tournament-form-values`.
// Réexportées ici : les deux pages qui montent ce formulaire (création et
// édition) n'ont qu'un import à faire, et les tests existants ne bougent pas.
export {
  defaultTournamentFormValues,
  toApiPayload,
  toFormValues,
  type TournamentApiValues,
  type TournamentFormValues,
} from "../_lib/tournament-form-values";

/**
 * Formulaire de tournoi, partagé par la création et l'édition.
 *
 * La page qui l'accueille garde ce qui relève de la route — en-tête, retour à
 * l'accueil, garde de permission, appel réseau. Le composant ne connaît que des
 * valeurs et une liste de champs modifiables : tout champ absent de
 * `editableFields` est rendu non interactif, jamais masqué, pour que
 * l'organisateur voie le réglage qu'il ne peut plus toucher.
 */

export type TournamentFormProps = {
  mode: "create" | "edit";
  initialValues: TournamentFormValues;
  editableFields: ReadonlySet<TournamentField>;
  submitLabel: string;
  /**
   * `image` : brouillon d'illustration, rempli à la **création** seulement —
   * l'image d'un tournoi existant se règle depuis sa fiche, dans tous les états
   * (`TournamentImageDialog`), là où ce formulaire se ferme au coup d'envoi.
   */
  onSubmit: (values: TournamentFormValues, image: ImagePickerValue) => Promise<void>;
  explanationId?: string;
  /**
   * La planification par l'arbitrage survit à la fenêtre d'édition : modifiable
   * jusqu'à la clôture (`canToggleRefereeScheduling`). Défaut : modifiable.
   */
  refereeSchedulingEditable?: boolean;
  /** État du tournoi édité — en cours, cocher la planification défait des lancements. */
  tournamentState?: TournamentState;
};

export function TournamentForm({
  mode,
  initialValues,
  editableFields,
  submitLabel,
  onSubmit,
  explanationId,
  refereeSchedulingEditable = true,
  tournamentState,
}: Readonly<TournamentFormProps>) {
  const { showError } = useToast();
  const text = useFormText();
  const { t } = text;
  const errorsText = useErrorsText();
  const em = (children: ReadonlyArray<ReactNode>) => <em>{richNodes(children)}</em>;
  const strong = (children: ReadonlyArray<ReactNode>) => <strong>{richNodes(children)}</strong>;
  const fieldErrors = useFieldErrors(TOURNAMENT_FIELD_ERRORS, FIELD_IDS);

  const [values, setValues] = useState<TournamentFormValues>(initialValues);
  const set = <K extends keyof TournamentFormValues>(key: K, value: TournamentFormValues[K]) => {
    setValues((prev) => ({ ...prev, [key]: value }));
    if (key in FIELD_IDS) fieldErrors.clear(key as TournamentFormField);
  };

  const locked = (field: TournamentField) => !editableFields.has(field);
  const lockedAttr = (field: TournamentField) => (locked(field) && explanationId ? { "aria-describedby": explanationId } : {});
  /**
   * Attributs d'un champ qu'un refus peut désigner : le signalement **et**
   * l'explication du verrou, dans un seul `aria-describedby` — deux
   * décompositions successives feraient perdre l'une à l'autre.
   */
  const fieldAttrs = (key: TournamentField & TournamentFormField, ...helpIds: string[]) =>
    fieldErrors.aria(key, locked(key) && explanationId, ...helpIds);

  // Ronde suisse : le nombre de rondes suit la recommandation ⌈log₂(N)⌉ + 1 tant
  // que l'organisateur n'a pas saisi la sienne — sinon un changement d'effectif
  // écraserait son choix. À l'édition, la valeur enregistrée fait foi d'emblée.
  const [swissRoundsTouched, setSwissRoundsTouched] = useState(mode === "edit");
  // « Libre » ne retient pas de nombre de manches : on garde le dernier saisi
  // pour le restituer si l'organisateur revient à un BO ou un FT.
  const [lastMatchFormatValue, setLastMatchFormatValue] = useState(
    initialValues.matchFormat?.value ?? DEFAULT_MATCH_FORMAT.value,
  );
  const [loading, setLoading] = useState(false);
  // Incrémenté à chaque refus d'un plan de phases invalide (`PhaseBuilder`).
  const [phaseFocusRequest, setPhaseFocusRequest] = useState(0);
  const [image, setImage] = useState<ImagePickerValue>(() => initialImagePickerValue(null));

  const { format, maxTeams, phases } = values;
  const entrantType = toParticipantType(values.participantType);
  const isSolo = values.participantType === "SOLO";
  const conditionsSummary = conditionsText(
    text,
    {
      discordRequirement: values.registrationDiscordRequirement,
      blizzardRequirement: values.registrationBlizzardRequirement,
      minPlayers: values.registrationMinPlayers,
    },
    isSolo,
  );

  const matchFormatType: MatchFormatType | "LIBRE" = values.matchFormat?.type ?? "LIBRE";
  const matchFormatValue = values.matchFormat?.value ?? lastMatchFormatValue;
  const isLibre = matchFormatType === "LIBRE";
  // Le format **effectif**, celui que `toApiPayload` enverra : lire
  // `values.matchFormat` tel quel annoncerait « map nulle » sous le format d'un
  // tournoi à élimination (les égalités sont cochées par défaut) et y offrirait
  // un plafond ignoré. `values.matchFormat` garde les réglages pour une bascule.
  const matchFormat: MatchFormat | null = isLibre
    ? null
    : effectiveMatchFormat(format, {
        type: matchFormatType,
        value: matchFormatValue,
        maxMaps: values.matchFormat?.maxMaps ?? null,
        drawsAllowed: values.matchFormat?.drawsAllowed ?? false,
      });
  const matchFormatValid = isLibre || isValidMatchFormat(matchFormatType, matchFormatValue);
  const formatHint = formatHintText(text, matchFormatType, matchFormatValid, matchFormat);

  /**
   * Modifie le format de match **sans perdre ses réglages voisins**.
   *
   * Le plafond de maps et les égalités vivent sur le même objet que le type et
   * le nombre de manches : réécrire `{ type, value }` les effaçait à chaque
   * frappe, et une case cochée se décochait dès qu'on touchait au FT.
   *
   * Le plafond est **revalidé** contre le nouveau format : il se borne à
   * l'objectif et au plafond naturel, tous deux dérivés du nombre de manches.
   * Passer d'un FT3 plafonné à 4 maps vers un FT2 laisserait sinon une valeur
   * que le serveur refuse, sur un formulaire qui s'annonce valide.
   */
  const patchMatchFormat = (patch: Partial<MatchFormat>) => {
    const next: MatchFormat = {
      type: matchFormatType === "LIBRE" ? DEFAULT_MATCH_FORMAT.type : matchFormatType,
      value: matchFormatValue,
      maxMaps: values.matchFormat?.maxMaps ?? null,
      // Au retour de « Libre », rien n'est en mémoire : on repart du défaut de
      // création plutôt que de décocher la case en silence.
      drawsAllowed: values.matchFormat?.drawsAllowed ?? DEFAULT_QUALIFICATION_DRAWS,
      ...patch,
    };

    if (!isValidMatchMaxMaps(next, next.maxMaps)) next.maxMaps = null;
    // Le plafond tombe avec les égalités, comme dans `withoutDraws` : décocher
    // la case laisserait sinon un réglage que le serveur refuse
    // (`MATCH_FORMAT_MAX_MAPS_REQUIRES_DRAWS`), sur un champ que le formulaire
    // vient de masquer — donc introuvable pour le corriger.
    if (!next.drawsAllowed) next.maxMaps = null;
    set("matchFormat", next);
  };

  const setMaxTeams = (value: number) =>
    setValues((prev) => ({
      ...prev,
      maxTeams: value,
      swissTotalRounds: swissRoundsTouched ? prev.swissTotalRounds : computeRecommendedRounds(value),
    }));
  const setSwissTotalRounds = (value: number) => {
    setSwissRoundsTouched(true);
    set("swissTotalRounds", value);
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    fieldErrors.clear();
    setLoading(true);
    try {
      if (!matchFormatValid) {
        const message = invalidFormatText(text, matchFormatType);
        fieldErrors.flag("matchFormatValue", message);
        showError(message);
        setLoading(false);
        return;
      }

      // Validate phases for MULTI format
      const phaseIssue = format === "MULTI" ? findPhaseIssue(phases) : null;
      if (phaseIssue) {
        showError(phaseIssueText(text, errorsText, phaseIssue));
        // Le plan désigne lui-même le réglage fautif : `PhaseBuilder` déplie
        // la phase et y porte le focus — sauf plan figé par la fenêtre
        // d'édition, dont les champs désactivés ne prennent pas le focus :
        // la notification reste alors seule à parler.
        if (!locked("phases")) setPhaseFocusRequest((n) => n + 1);
        setLoading(false);
        return;
      }

      await onSubmit(values, image);
    } catch (e) {
      const message = (e as Error).message;
      const code = errorCode(e);
      // Les deux refus de date ne disent pas **laquelle** : le premier jalon
      // mal placé se relit sur les valeurs qui viennent de partir.
      const dateField = misplacedDateField(code, values);
      if (dateField) fieldErrors.flag(dateField, message);
      else fieldErrors.report(code, message);
      showError(message);
    } finally {
      setLoading(false);
    }
  };

  const loadingLabel = mode === "create" ? t("form.creating") : t("form.saving");

  return (
    <CyberCard ticks style={{ padding: "clamp(20px, 3vw, 32px)" }}>
      <form onSubmit={handleSubmit} style={SECTION_STACK}>
        <section>
          <p className="eyebrow" style={sectionEyebrow("identity")}>
            {t("form.sections.identity")}
          </p>
          <div className="form-grid" style={GRID}>
            <div className="field">
              <label htmlFor="tournament-name">{t("form.name")}</label>
              <input
                id="tournament-name"
                required
                disabled={locked("name")}
                value={values.name}
                onChange={(e) => set("name", e.target.value)}
                placeholder={t("form.namePlaceholder")}
                {...fieldAttrs("name")}
              />
              <FieldErrorText fieldId={FIELD_IDS.name} message={fieldErrors.message("name")} />
            </div>
            <div className="field">
              <label htmlFor="tournament-game">{t("form.game")}</label>
              <select
                id="tournament-game"
                disabled={locked("game")}
                value={values.game}
                onChange={(e) => set("game", e.target.value as TournamentGame)}
                {...lockedAttr("game")}
              >
                <option value="OW">{t("form.games.OW")}</option>
                <option value="MR">{t("form.games.MR")}</option>
              </select>
            </div>
            <div className="field" style={FULL_WIDTH}>
              <label htmlFor="tournament-description">{t("form.description")}</label>
              <textarea
                id="tournament-description"
                disabled={locked("description")}
                value={values.description}
                onChange={(e) => set("description", e.target.value)}
                placeholder={t("form.descriptionPlaceholder")}
                {...lockedAttr("description")}
              />
            </div>
          </div>
        </section>

        {mode === "create" && (
          <section style={SECTION_SEPARATOR}>
            <p className="eyebrow" style={sectionEyebrow("image")}>
              {t("form.sections.image")}
            </p>
            <TournamentImagePicker existing={null} value={image} onChange={setImage} disabled={loading} />
          </section>
        )}

        <section style={SECTION_SEPARATOR}>
          <p className="eyebrow" style={sectionEyebrow("format")}>
            {t("form.sections.format")}
          </p>
          <div className="form-grid" style={GRID}>
            <div className="field">
              <label htmlFor="tournament-format">{t("form.bracketFormat")}</label>
              <select
                id="tournament-format"
                disabled={locked("format")}
                value={format}
                onChange={(e) =>
                  setValues((prev) => ({
                    ...prev,
                    format: e.target.value as TournamentFormat,
                    hasThirdPlaceMatch: false,
                  }))
                }
                {...lockedAttr("format")}
              >
                {(["SINGLE", "DOUBLE", "SWISS", "SURVIVAL", "BG_SURVIE", "MULTI"] as const).map((value) => (
                  <option key={value} value={value}>
                    {t(`form.formats.${value}`)}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="participant-type">{t("form.participantType")}</label>
              <select
                id="participant-type"
                aria-describedby={describedBy("participant-type-hint", locked("participantType") && explanationId)}
                disabled={locked("participantType")}
                value={values.participantType}
                onChange={(e) => set("participantType", e.target.value as ParticipantType)}
              >
                <option value="TEAM">{t("form.participantTypes.TEAM")}</option>
                <option value="SOLO">{t("form.participantTypes.SOLO")}</option>
              </select>
              <p id="participant-type-hint" style={HINT}>
                {t("form.participantTypeHint")}
              </p>
            </div>
            <div className="field">
              <label htmlFor="max-teams">{t(`form.maxEntrants.${entrantType}`)}</label>
              <NumberInput
                id="max-teams"
                min={2}
                max={256}
                disabled={locked("maxTeams")}
                value={maxTeams}
                onValueChange={setMaxTeams}
                onEdit={() => fieldErrors.clear("maxTeams")}
                {...fieldAttrs("maxTeams")}
              />
              <FieldErrorText fieldId={FIELD_IDS.maxTeams} message={fieldErrors.message("maxTeams")} />
            </div>

            <div className="field">
              <label htmlFor="match-format-type">{t("form.matchFormat")}</label>
              <select
                id="match-format-type"
                disabled={locked("matchFormat")}
                value={matchFormatType}
                onChange={(e) => {
                  const next = e.target.value as MatchFormatType | "LIBRE";
                  if (next === "LIBRE") {
                    set("matchFormat", null);
                    return;
                  }
                  // Les deux notations n'ont ni les mêmes bornes ni la même
                  // parité : on ramène la valeur héritée dans le domaine du
                  // nouveau type plutôt que de laisser un état invalide que
                  // l'organisateur devrait corriger à la main.
                  const bounds = MATCH_FORMAT_BOUNDS[next];
                  let value = Math.min(Math.max(matchFormatValue, bounds.min), bounds.max);
                  if (next === "BO" && value % 2 === 0) value -= 1;
                  setLastMatchFormatValue(value);
                  patchMatchFormat({ type: next, value });
                }}
                {...lockedAttr("matchFormat")}
              >
                <option value="BO">{t("form.matchFormats.BO")}</option>
                <option value="FT">{t("form.matchFormats.FT")}</option>
                <option value="LIBRE">{t("form.matchFormats.LIBRE")}</option>
              </select>
              <p style={HINT}>
                {formatHint}
              </p>
            </div>

            {!isLibre && (
              <div className="field">
                <label htmlFor="match-format-value">
                  {t(`form.matchFormatValue.${matchFormatType}`)}
                </label>
                <NumberInput
                  id="match-format-value"
                  min={MATCH_FORMAT_BOUNDS[matchFormatType].min}
                  max={MATCH_FORMAT_BOUNDS[matchFormatType].max}
                  step={matchFormatType === "BO" ? 2 : 1}
                  disabled={locked("matchFormat")}
                  value={matchFormatValue}
                  onValueChange={(value) => {
                    setLastMatchFormatValue(value);
                    patchMatchFormat({ value });
                  }}
                  onEdit={() => fieldErrors.clear("matchFormatValue")}
                  {...fieldErrors.aria(
                    "matchFormatValue",
                    locked("matchFormat") && explanationId,
                    "match-format-value-hint",
                  )}
                />
                <FieldErrorText
                  fieldId={FIELD_IDS.matchFormatValue}
                  message={fieldErrors.message("matchFormatValue")}
                />
                <p id="match-format-value-hint" style={HINT}>
                  {t(`form.matchFormatValueHint.${matchFormatType}`)}
                </p>
              </div>
            )}

            {/*
              Le plafond de maps ne s'offre **qu'avec les égalités**, parce qu'il
              n'est rien d'autre que leur fenêtre : l'abaisser sur un format qui
              exige un vainqueur ne retire que des issues, au point qu'une
              rencontre arrivée à égalité n'a plus aucun score enregistrable
              (`matchMaxMapsNeedsDraws`, refusé côté serveur). La case qui
              l'ouvre est plus bas, dans les réglages de BlueGenji Survie (le
              format effectif n'a donc d'égalités qu'en BG Survie).
            */}
            {!isLibre &&
              matchFormatValid &&
              matchAllowsDraw(matchFormat) &&
              naturalMaxMaps(matchFormat!) > matchWinsRequired(matchFormat!) && (
              <div className="field">
                <label htmlFor="match-format-max-maps">{t("form.maxMaps")}</label>
                <NumberInput
                  id="match-format-max-maps"
                  min={matchWinsRequired(matchFormat!)}
                  max={naturalMaxMaps(matchFormat!)}
                  disabled={locked("matchFormat")}
                  value={matchMaxMaps(matchFormat!)}
                  onValueChange={(value) => {
                    // Le plafond naturel n'est pas un réglage : le stocker
                    // ferait porter à la ligne une contrainte qui n'en est pas
                    // une, et l'étiquette du tournoi afficherait « FT3 · 5 maps »
                    // là où « FT3 » dit déjà tout.
                    patchMatchFormat({
                      maxMaps: value >= naturalMaxMaps(matchFormat!) ? null : value,
                    });
                  }}
                  {...lockedAttr("matchFormat")}
                />
                <p style={HINT}>
                  {t("form.maxMapsHint", { max: naturalMaxMaps(matchFormat!) })}
                </p>
              </div>
            )}

            <FormatSettings
              values={values}
              set={set}
              locked={locked}
              lockedAttr={lockedAttr}
              onSwissTotalRoundsChange={setSwissTotalRounds}
              phaseFocusRequest={phaseFocusRequest}
            />
          </div>
        </section>

        <section style={SECTION_SEPARATOR}>
          <p className="eyebrow" style={sectionEyebrow("registration")}>
            {t("form.sections.registration")}
          </p>
          <p style={{ ...HINT, margin: "0 0 14px" }}>
            {richNodes(text.rich("form.registrationIntro", {}, { strong }))}
          </p>
          {/*
            La phrase que liront les engagés, telle quelle : c'est la même
            fonction qui l'écrit sur la fiche du tournoi
            (`registrationFiltersSummary`). L'organisateur voit donc ce qu'il
            annonce, et non une reformulation qui pourrait en dire autre chose.
          */}
          <p
            style={{ ...HINT, margin: "0 0 14px", color: "var(--ink-mute)" }}
            aria-live="polite"
          >
            {conditionsSummary === null
              ? t("form.conditionsOpen")
              : t("form.conditionsRead", { summary: conditionsSummary })}
          </p>
          <div className="form-grid" style={GRID}>
            <div className="field">
              <label htmlFor="registration-discord">{t("form.discord")}</label>
              <select
                id="registration-discord"
                disabled={locked("registrationDiscordRequirement")}
                value={values.registrationDiscordRequirement}
                onChange={(e) =>
                  set("registrationDiscordRequirement", e.target.value as PlayerRequirement)
                }
                aria-describedby="registration-discord-hint"
                {...lockedAttr("registrationDiscordRequirement")}
              >
                {PLAYER_REQUIREMENTS.map((value) => (
                  <option key={value} value={value}>
                    {t(`form.requirements.${value}`)}
                  </option>
                ))}
              </select>
              <p id="registration-discord-hint" style={HINT}>
                {richNodes(text.rich(`form.discordHint.${entrantType}`, {}, { em }))}
              </p>
            </div>

            <div className="field">
              <label htmlFor="registration-blizzard">{t("form.blizzard")}</label>
              <select
                id="registration-blizzard"
                disabled={locked("registrationBlizzardRequirement")}
                value={values.registrationBlizzardRequirement}
                onChange={(e) =>
                  set("registrationBlizzardRequirement", e.target.value as PlayerRequirement)
                }
                aria-describedby="registration-blizzard-hint"
                {...lockedAttr("registrationBlizzardRequirement")}
              >
                {PLAYER_REQUIREMENTS.map((value) => (
                  <option key={value} value={value}>
                    {t(`form.requirements.${value}`)}
                  </option>
                ))}
              </select>
              <p id="registration-blizzard-hint" style={HINT}>
                {richNodes(text.rich(`form.blizzardHint.${entrantType}`, {}, { em }))}
                {values.game === "MR" ? ` ${t("form.blizzardMarvel")}` : ""}
              </p>
            </div>

            {/*
              L'effectif minimal ne s'affiche pas en tournoi individuel : un
              engagé y est **une** personne, et la condition n'y est pas lue
              (`checkRegistrationFilters`). Montrer « 5 joueurs minimum » sur un
              tournoi solo annoncerait une condition fausse. La valeur reste
              enregistrée, prête à resservir si le type de participants rebascule.
            */}
            {!isSolo && (
              <div className="field">
                <label htmlFor="registration-min-players">{t("form.minPlayers")}</label>
                <NumberInput
                  id="registration-min-players"
                  min={MIN_PLAYERS_BOUNDS.min}
                  max={MIN_PLAYERS_BOUNDS.max}
                  disabled={locked("registrationMinPlayers")}
                  value={values.registrationMinPlayers}
                  onValueChange={(next) => set("registrationMinPlayers", next)}
                  aria-describedby="registration-min-players-hint"
                  {...lockedAttr("registrationMinPlayers")}
                />
                <p id="registration-min-players-hint" style={HINT}>
                  {t("form.minPlayersHint", { min: MIN_PLAYERS_BOUNDS.min })}
                </p>
              </div>
            )}
          </div>
        </section>

        <section style={SECTION_SEPARATOR}>
          <p className="eyebrow" style={sectionEyebrow("planning")}>
            {t("form.sections.planning")}
          </p>
          <div className="form-grid" style={GRID}>
            <div className="field">
              <label htmlFor="visibility-at">{t("form.dates.startVisibilityAt")}</label>
              <input
                id="visibility-at"
                type="datetime-local"
                disabled={locked("startVisibilityAt")}
                value={values.startVisibilityAt}
                onChange={(e) => set("startVisibilityAt", e.target.value)}
                {...fieldAttrs("startVisibilityAt")}
              />
              <FieldErrorText fieldId={FIELD_IDS.startVisibilityAt} message={fieldErrors.message("startVisibilityAt")} />
            </div>
            <div className="field">
              <label htmlFor="registration-open-at">{t("form.dates.registrationOpenAt")}</label>
              <input
                id="registration-open-at"
                type="datetime-local"
                disabled={locked("registrationOpenAt")}
                value={values.registrationOpenAt}
                onChange={(e) => set("registrationOpenAt", e.target.value)}
                {...fieldAttrs("registrationOpenAt")}
              />
              <FieldErrorText fieldId={FIELD_IDS.registrationOpenAt} message={fieldErrors.message("registrationOpenAt")} />
            </div>
            <div className="field">
              <label htmlFor="registration-close-at">{t("form.dates.registrationCloseAt")}</label>
              <input
                id="registration-close-at"
                type="datetime-local"
                disabled={locked("registrationCloseAt")}
                value={values.registrationCloseAt}
                onChange={(e) => set("registrationCloseAt", e.target.value)}
                {...fieldAttrs("registrationCloseAt")}
              />
              <FieldErrorText fieldId={FIELD_IDS.registrationCloseAt} message={fieldErrors.message("registrationCloseAt")} />
            </div>
            <div className="field">
              <label htmlFor="start-at">{t("form.dates.startAt")}</label>
              <input
                id="start-at"
                type="datetime-local"
                disabled={locked("startAt")}
                value={values.startAt}
                onChange={(e) => set("startAt", e.target.value)}
                {...fieldAttrs("startAt")}
              />
              <FieldErrorText fieldId={FIELD_IDS.startAt} message={fieldErrors.message("startAt")} />
            </div>
          </div>

          <RefereeSchedulingField
            mode={mode}
            checked={values.refereeScheduling}
            editable={refereeSchedulingEditable}
            warnUndoesLaunches={
              tournamentState === "RUNNING" && values.refereeScheduling && !initialValues.refereeScheduling
            }
            onChange={(checked) => set("refereeScheduling", checked)}
          />
        </section>

        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            justifyContent: "flex-end",
            gap: 12,
            paddingTop: 24,
            borderTop: "1px solid var(--line-soft)",
          }}
        >
          <CyberButton variant="ghost" asChild>
            <LocaleLink href="/tournois">{t("form.cancel")}</LocaleLink>
          </CyberButton>
          <CyberButton
            variant="primary"
            type="submit"
            disabled={loading}
            style={{ opacity: loading ? 0.6 : 1, cursor: loading ? "not-allowed" : "pointer" }}
          >
            {loading ? loadingLabel : submitLabel}
          </CyberButton>
        </div>
      </form>
    </CyberCard>
  );
}
