"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import type { TournamentFormat, TournamentGame } from "@/lib/shared/types";
import { findPhaseIssue } from "@/lib/shared/tournament-phases";
import { computeRecommendedRounds } from "@/lib/shared/swiss";
import {
  DEFAULT_MATCH_FORMAT,
  MATCH_FORMAT_BOUNDS,
  isValidMatchFormat,
  isValidMatchMaxMaps,
  matchAllowsDraw,
  matchFormatDescription,
  matchFormatLabel,
  matchMaxMaps,
  matchWinsRequired,
  naturalMaxMaps,
  type MatchFormat,
  type MatchFormatType,
} from "@/lib/shared/match-format";
import { participantWording, type ParticipantType } from "@/lib/shared/participants";
import {
  MIN_PLAYERS_BOUNDS,
  PLAYER_REQUIREMENTS,
  PLAYER_REQUIREMENT_LABELS,
  registrationFiltersSummary,
  type PlayerRequirement,
} from "@/lib/shared/registration-filters";
import type { TournamentField } from "@/lib/shared/tournament-edit";
import { useToast } from "@/components/ui/toast";
import { CyberCard, CyberButton } from "@/components/cyber";
import { phaseIssueMessage } from "../creer/phase-form";
import { FormatSettings } from "./FormatSettings";
import { TournamentImagePicker } from "./TournamentImagePicker";
import { initialImagePickerValue, type ImagePickerValue } from "../_lib/image-picker";
import {
  EYEBROW,
  FULL_WIDTH,
  GRID,
  HINT,
  SECTION_SEPARATOR,
  SECTION_STACK,
} from "../_lib/form-styles";
import {
  DEFAULT_QUALIFICATION_DRAWS,
  defaultTournamentFormValues,
  toApiPayload,
  toFormValues,
  type TournamentApiValues,
  type TournamentFormValues,
} from "../_lib/tournament-form-values";
import {
  DATE_ORDER_CODES,
  TOURNAMENT_FIELD_ERRORS,
  describedBy,
  errorCode,
  firstMisplacedDate,
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
};

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
};

export function TournamentForm({
  mode,
  initialValues,
  editableFields,
  submitLabel,
  onSubmit,
  explanationId,
}: TournamentFormProps) {
  const { showError } = useToast();
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
  const wording = participantWording(values.participantType);
  const isSolo = values.participantType === "SOLO";
  const conditionsSummary = registrationFiltersSummary(
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
  const matchFormat: MatchFormat | null = isLibre
    ? null
    : {
        type: matchFormatType,
        value: matchFormatValue,
        maxMaps: values.matchFormat?.maxMaps ?? null,
        drawsAllowed: values.matchFormat?.drawsAllowed ?? false,
      };
  const matchFormatValid = isLibre || isValidMatchFormat(matchFormatType, matchFormatValue);

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
        const message =
          matchFormatType === "BO"
            ? "Un Best of doit se jouer en nombre impair de manches (BO1, BO3, BO5…)."
            : "Nombre de manches du format de match invalide.";
        fieldErrors.flag("matchFormatValue", message);
        showError(message);
        setLoading(false);
        return;
      }

      // Validate phases for MULTI format
      if (format === "MULTI") {
        const issue = findPhaseIssue(phases);
        if (issue) {
          showError(phaseIssueMessage(issue));
          // Le plan désigne lui-même le réglage fautif : `PhaseBuilder` déplie
          // la phase et y porte le focus — sauf plan figé par la fenêtre
          // d'édition, dont les champs désactivés ne prennent pas le focus :
          // la notification reste alors seule à parler.
          if (!locked("phases")) setPhaseFocusRequest((n) => n + 1);
          setLoading(false);
          return;
        }
      }

      await onSubmit(values, image);
    } catch (e) {
      const message = (e as Error).message;
      const code = errorCode(e);
      // Les deux refus de date ne disent pas **laquelle** : le premier jalon
      // mal placé se relit sur les valeurs qui viennent de partir.
      const dateField =
        code && DATE_ORDER_CODES.has(code)
          ? firstMisplacedDate<TournamentFormField>([
              ["startVisibilityAt", values.startVisibilityAt],
              ["registrationOpenAt", values.registrationOpenAt],
              ["registrationCloseAt", values.registrationCloseAt],
              ["startAt", values.startAt],
            ])
          : null;
      if (dateField) fieldErrors.flag(dateField, message);
      else fieldErrors.report(code, message);
      showError(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <CyberCard ticks style={{ padding: "clamp(20px, 3vw, 32px)" }}>
      <form onSubmit={handleSubmit} style={SECTION_STACK}>
        <section>
          <p className="eyebrow" style={EYEBROW}>
            Identité
          </p>
          <div className="form-grid" style={GRID}>
            <div className="field">
              <label htmlFor="tournament-name">Nom du tournoi</label>
              <input
                id="tournament-name"
                required
                disabled={locked("name")}
                value={values.name}
                onChange={(e) => set("name", e.target.value)}
                placeholder="Mon tournoi"
                {...fieldAttrs("name")}
              />
              <FieldErrorText fieldId={FIELD_IDS.name} message={fieldErrors.message("name")} />
            </div>
            <div className="field">
              <label htmlFor="tournament-game">Jeu</label>
              <select
                id="tournament-game"
                disabled={locked("game")}
                value={values.game}
                onChange={(e) => set("game", e.target.value as TournamentGame)}
                {...lockedAttr("game")}
              >
                <option value="OW">Overwatch</option>
                <option value="MR">Marvel Rivals</option>
              </select>
            </div>
            <div className="field" style={FULL_WIDTH}>
              <label htmlFor="tournament-description">Description</label>
              <textarea
                id="tournament-description"
                disabled={locked("description")}
                value={values.description}
                onChange={(e) => set("description", e.target.value)}
                placeholder="Description du tournoi..."
                {...lockedAttr("description")}
              />
            </div>
          </div>
        </section>

        {mode === "create" && (
          <section style={SECTION_SEPARATOR}>
            <p className="eyebrow" style={EYEBROW}>
              Image
            </p>
            <TournamentImagePicker existing={null} value={image} onChange={setImage} disabled={loading} />
          </section>
        )}

        <section style={SECTION_SEPARATOR}>
          <p className="eyebrow" style={EYEBROW}>
            Format
          </p>
          <div className="form-grid" style={GRID}>
            <div className="field">
              <label htmlFor="tournament-format">Format de bracket</label>
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
                <option value="SINGLE">Simple élimination</option>
                <option value="DOUBLE">Double élimination</option>
                <option value="SWISS">Ronde suisse</option>
                <option value="SURVIVAL">Survie</option>
                <option value="BG_SURVIE">BlueGenji Survie (endurance)</option>
                <option value="MULTI">Multi-phases</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="participant-type">Type de participants</label>
              <select
                id="participant-type"
                aria-describedby={describedBy("participant-type-hint", locked("participantType") && explanationId)}
                disabled={locked("participantType")}
                value={values.participantType}
                onChange={(e) => set("participantType", e.target.value as ParticipantType)}
              >
                <option value="TEAM">Équipes</option>
                <option value="SOLO">Joueurs (individuel)</option>
              </select>
              <p id="participant-type-hint" style={HINT}>
                En individuel, chaque joueur s&apos;inscrit lui-même, sans passer par une
                équipe.
              </p>
            </div>
            <div className="field">
              <label htmlFor="max-teams">{wording.maxLabel}</label>
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
              <label htmlFor="match-format-type">Format de match</label>
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
                <option value="BO">Best of (BO)</option>
                <option value="FT">First to (FT)</option>
                <option value="LIBRE">Libre (aucune limite)</option>
              </select>
              <p style={HINT}>
                {isLibre
                  ? "Les scores sont saisis sans contrainte."
                  : matchFormatValid
                    ? `${matchFormatLabel(matchFormat)} — ${matchFormatDescription(matchFormat)}`
                    : matchFormatType === "BO"
                      ? "Un Best of se joue en nombre impair de manches (BO1, BO3, BO5…)."
                      : "Saisis le nombre de manches à gagner."}
              </p>
            </div>

            {!isLibre && (
              <div className="field">
                <label htmlFor="match-format-value">
                  {matchFormatType === "BO" ? "Manches jouées (impair)" : "Manches à gagner"}
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
                  {matchFormatType === "BO"
                    ? "Le score d'une équipe ne peut pas dépasser la moitié supérieure : 3 en BO5."
                    : "Objectif à atteindre pour remporter le match : 3 en FT3."}
                </p>
              </div>
            )}

            {/*
              Le plafond de maps ne s'offre **qu'avec les égalités**, parce qu'il
              n'est rien d'autre que leur fenêtre : l'abaisser sur un format qui
              exige un vainqueur ne retire que des issues, au point qu'une
              rencontre arrivée à égalité n'a plus aucun score enregistrable
              (`matchMaxMapsNeedsDraws`, refusé côté serveur). La case qui
              l'ouvre est plus bas, dans les réglages de BlueGenji Survie — et comme
              elle, il n'existe qu'en BG Survie : les égalités étant cochées par
              défaut, ne tester qu'elles l'offrirait sur tout format, où le
              serveur l'ignore.
            */}
            {format === "BG_SURVIE" &&
              !isLibre &&
              matchFormatValid &&
              matchAllowsDraw(matchFormat) &&
              naturalMaxMaps(matchFormat!) > matchWinsRequired(matchFormat!) && (
              <div className="field">
                <label htmlFor="match-format-max-maps">Maps décisives au maximum</label>
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
                  Somme des deux scores au maximum. Une map nulle ne compte dans aucun des deux et
                  n&apos;entame donc pas ce plafond. L&apos;abaisser sous {naturalMaxMaps(matchFormat!)}{" "}
                  rend l&apos;égalité possible.
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
          <p className="eyebrow" style={EYEBROW}>
            Conditions d&apos;inscription
          </p>
          <p style={{ ...HINT, margin: "0 0 14px" }}>
            Contrôlées à chaque inscription d&apos;un joueur. Les{" "}
            <strong>équipes fantômes</strong> inscrites par le staff n&apos;y sont pas soumises, et
            les engagés déjà inscrits ne sont jamais relus.
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
              ? "En l'état, ce tournoi est ouvert à tous : aucune condition ne sera affichée."
              : `Les participants liront : « ${conditionsSummary} ».`}
          </p>
          <div className="form-grid" style={GRID}>
            <div className="field">
              <label htmlFor="registration-discord">Discord vérifié</label>
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
                    {PLAYER_REQUIREMENT_LABELS[value]}
                  </option>
                ))}
              </select>
              <p id="registration-discord-hint" style={HINT}>
                Un tag Discord <em>vérifié</em> est un tag dont le joueur a prouvé qu&apos;il lui
                appartient : c&apos;est la seule façon pour l&apos;organisation de joindre
                {isSolo ? " le joueur" : " l'équipe"} pendant le tournoi.
              </p>
            </div>

            <div className="field">
              <label htmlFor="registration-blizzard">Compte Blizzard</label>
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
                    {PLAYER_REQUIREMENT_LABELS[value]}
                  </option>
                ))}
              </select>
              <p id="registration-blizzard-hint" style={HINT}>
                Un compte Battle.net <em>rattaché</em> depuis « Mon profil » atteste le BattleTag
                {isSolo ? " du joueur" : " de chaque joueur"} : un tag simplement saisi ne prouve
                rien.
                {values.game === "MR"
                  ? " Sans objet sur un tournoi Marvel Rivals : mieux vaut laisser « Aucun joueur »."
                  : ""}
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
                <label htmlFor="registration-min-players">Joueurs minimum dans l&apos;équipe</label>
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
                  Membres actifs du roster, coach et manager compris. {MIN_PLAYERS_BOUNDS.min} =
                  aucune exigence.
                </p>
              </div>
            )}
          </div>
        </section>

        <section style={SECTION_SEPARATOR}>
          <p className="eyebrow" style={EYEBROW}>
            Planning
          </p>
          <div className="form-grid" style={GRID}>
            <div className="field">
              <label htmlFor="visibility-at">Début visibilité</label>
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
              <label htmlFor="registration-open-at">Début inscriptions</label>
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
              <label htmlFor="registration-close-at">Fin inscriptions</label>
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
              <label htmlFor="start-at">Début tournoi</label>
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
            <Link href="/tournois">Annuler</Link>
          </CyberButton>
          <CyberButton
            variant="primary"
            type="submit"
            disabled={loading}
            style={{ opacity: loading ? 0.6 : 1, cursor: loading ? "not-allowed" : "pointer" }}
          >
            {loading ? (mode === "create" ? "Création..." : "Enregistrement...") : submitLabel}
          </CyberButton>
        </div>
      </form>
    </CyberCard>
  );
}
