"use client";

import { CSSProperties, FormEvent, useState } from "react";
import Link from "next/link";
import { localDateTimeInput } from "@/lib/shared/dates";
import type { TournamentFormat, TournamentGame } from "@/lib/shared/types";
import type { PhaseConfig } from "@/lib/shared/tournament-phases";
import { validatePhases } from "@/lib/shared/tournament-phases";
import { computeRecommendedRounds } from "@/lib/shared/swiss";
import {
  DEFAULT_MATCH_FORMAT,
  MATCH_FORMAT_BOUNDS,
  isValidMatchFormat,
  matchFormatDescription,
  matchFormatLabel,
  type MatchFormat,
  type MatchFormatType,
} from "@/lib/shared/match-format";
import { participantWording, type ParticipantType } from "@/lib/shared/participants";
import type { TournamentField } from "@/lib/shared/tournament-edit";
import { useToast } from "@/components/ui/toast";
import { CyberCard, CyberButton } from "@/components/cyber";
import { PhaseBuilder } from "../creer/PhaseBuilder";
import { createDefaultPhase, phaseErrorMessage } from "../creer/phase-form";

/**
 * Formulaire de tournoi, partagé par la création et l'édition.
 *
 * La page qui l'accueille garde ce qui relève de la route — en-tête, retour à
 * l'accueil, garde de permission, appel réseau. Le composant ne connaît que des
 * valeurs et une liste de champs modifiables : tout champ absent de
 * `editableFields` est rendu non interactif, jamais masqué, pour que
 * l'organisateur voie le réglage qu'il ne peut plus toucher.
 */

// Rythme vertical du formulaire : sections séparées par un filet, même gouttière
// de grille partout, textes d'aide sur les tokens « cyber ».
const SECTION_STACK: CSSProperties = { display: "flex", flexDirection: "column", gap: 28 };
const SECTION_SEPARATOR: CSSProperties = {
  paddingTop: 28,
  borderTop: "1px solid var(--line-soft)",
};
const EYEBROW: CSSProperties = { margin: "0 0 16px" };
const GRID: CSSProperties = { gap: 16 };
const FULL_WIDTH: CSSProperties = { gridColumn: "1 / -1" };
const HINT: CSSProperties = {
  margin: "2px 0 0",
  fontSize: 12.5,
  color: "var(--ink-mute)",
  lineHeight: 1.5,
};

/**
 * Miroir client des valeurs éditables (`EditableTournamentValues`), à deux
 * différences près, imposées par les contrôles HTML :
 *
 * - les quatre dates sont des chaînes `datetime-local` (`YYYY-MM-DDTHH:mm`,
 *   heure locale), pas de l'ISO — `toApiPayload` / `toFormValues` font le pont ;
 * - les réglages propres à un format ne sont jamais `null` : un tournoi en
 *   élimination simple garde les défauts de survie sous la main, prêts à servir
 *   si l'organisateur bascule le format.
 */
export type TournamentFormValues = {
  name: string;
  description: string;
  game: TournamentGame;
  format: TournamentFormat;
  participantType: ParticipantType;
  maxTeams: number;
  startVisibilityAt: string;
  registrationOpenAt: string;
  registrationCloseAt: string;
  startAt: string;
  hasThirdPlaceMatch: boolean;
  survivalRoundsBeforeFirstCut: number;
  survivalRoundsPerCut: number;
  swissTotalRounds: number;
  swissPointsWin: number;
  swissPointsDraw: number;
  swissPointsLoss: number;
  endurancePoints: number;
  enduranceWinDelta: number;
  enduranceLossDelta: number;
  endurancePlayoffSize: number;
  matchFormat: MatchFormat | null;
  phases: PhaseConfig[];
};

/**
 * Valeurs telles que les rend `GET /api/tournaments/[id]/edit`.
 *
 * Déclaré ici plutôt qu'importé : `EditableTournamentValues` vit dans
 * `lib/server/`, interdit à un composant client.
 */
export type TournamentApiValues = {
  name: string;
  description: string | null;
  game: TournamentGame;
  format: TournamentFormat;
  participantType: ParticipantType;
  maxTeams: number;
  startVisibilityAt: string;
  registrationOpenAt: string;
  registrationCloseAt: string;
  startAt: string;
  hasThirdPlaceMatch: boolean;
  survivalRoundsBeforeFirstCut: number | null;
  survivalRoundsPerCut: number | null;
  swissTotalRounds: number | null;
  swissPointsWin: number | null;
  swissPointsDraw: number | null;
  swissPointsLoss: number | null;
  endurancePoints: number | null;
  enduranceWinDelta: number | null;
  enduranceLossDelta: number | null;
  endurancePlayoffSize: number | null;
  matchFormat: MatchFormat | null;
  phases: PhaseConfig[] | null;
};

/** Valeurs proposées à la création d'un tournoi. */
export function defaultTournamentFormValues(): TournamentFormValues {
  return {
    name: "",
    description: "",
    game: "OW2",
    format: "SINGLE",
    // Équipes (défaut) ou joueurs inscrits individuellement. Le format de
    // bracket est indépendant : tous fonctionnent dans les deux cas.
    participantType: "TEAM",
    maxTeams: 16,
    startVisibilityAt: localDateTimeInput(1),
    registrationOpenAt: localDateTimeInput(3),
    registrationCloseAt: localDateTimeInput(24),
    startAt: localDateTimeInput(30),
    hasThirdPlaceMatch: false,
    survivalRoundsBeforeFirstCut: 3,
    survivalRoundsPerCut: 3,
    swissTotalRounds: computeRecommendedRounds(16),
    swissPointsWin: 3,
    swissPointsDraw: 1,
    swissPointsLoss: 0,
    // BlueGenji Survie : capital d'endurance et barème (défauts du règlement).
    endurancePoints: 9,
    enduranceWinDelta: 1,
    enduranceLossDelta: 1,
    endurancePlayoffSize: 8,
    // « Libre » (`null`) conserve la saisie de score sans contrainte, comme les
    // tournois créés avant la fonctionnalité.
    matchFormat: { ...DEFAULT_MATCH_FORMAT },
    phases: [createDefaultPhase(1, "SWISS"), createDefaultPhase(2, "DOUBLE")],
  };
}

/**
 * Instant ISO → saisie `datetime-local` en heure locale.
 *
 * Cette conversion ISO → `datetime-local` est correcte uniquement parce que le
 * chargement et la soumission du formulaire se font dans le même navigateur, à
 * la même heure de fuseau horaire. Un aller-retour sur plusieurs sessions ou
 * plusieurs fuseaux perdrait l'information. Cette asymétrie est volontaire :
 * le formulaire stocke des chaînes locales (ce que HTML5 exige pour
 * `<input type="datetime-local">`) tandis que l'API parle en ISO 8601
 * (fuseau-agnostique). Le réseau ne voit jamais la fuseau du navigateur.
 */
function isoToLocalInput(iso: string): string {
  const time = new Date(iso).getTime();
  if (!Number.isFinite(time)) return "";
  const date = new Date(time);
  date.setSeconds(0, 0);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

/**
 * Corps de requête attendu par `POST /api/tournaments` et
 * `PATCH /api/tournaments/[id]/edit`.
 *
 * Attention à une asymétrie assumée : le format de match voyage **aplati** en
 * `matchFormatType` / `matchFormatValue`, alors que `TournamentField` ne connaît
 * qu'un seul champ, `matchFormat`. Un appelant qui filtre ce corps par champ
 * éditable doit donc traiter ces deux clés comme une seule.
 *
 * Les réglages propres à un format ne partent que pour le format qui les
 * possède : envoyer une cadence de survie sur un bracket à élimination simple
 * écrirait un réglage que rien ne relira.
 */
export function toApiPayload(values: TournamentFormValues): Record<string, unknown> {
  const { format } = values;
  return {
    name: values.name,
    description: values.description,
    game: values.game,
    format,
    participantType: values.participantType,
    maxTeams: values.maxTeams,
    startVisibilityAt: new Date(values.startVisibilityAt).toISOString(),
    registrationOpenAt: new Date(values.registrationOpenAt).toISOString(),
    registrationCloseAt: new Date(values.registrationCloseAt).toISOString(),
    startAt: new Date(values.startAt).toISOString(),
    hasThirdPlaceMatch: format === "SINGLE" ? values.hasThirdPlaceMatch : false,
    survivalRoundsPerCut: format === "SURVIVAL" ? values.survivalRoundsPerCut : undefined,
    survivalRoundsBeforeFirstCut:
      format === "SURVIVAL" ? values.survivalRoundsBeforeFirstCut : undefined,
    phases: format === "MULTI" ? values.phases : undefined,
    swissTotalRounds: format === "SWISS" ? values.swissTotalRounds : undefined,
    swissPointsWin: format === "SWISS" ? values.swissPointsWin : undefined,
    swissPointsDraw: format === "SWISS" ? values.swissPointsDraw : undefined,
    swissPointsLoss: format === "SWISS" ? values.swissPointsLoss : undefined,
    endurancePoints: format === "BG_SURVIE" ? values.endurancePoints : undefined,
    enduranceWinDelta: format === "BG_SURVIE" ? values.enduranceWinDelta : undefined,
    enduranceLossDelta: format === "BG_SURVIE" ? values.enduranceLossDelta : undefined,
    endurancePlayoffSize: format === "BG_SURVIE" ? values.endurancePlayoffSize : undefined,
    matchFormatType: values.matchFormat?.type ?? null,
    matchFormatValue: values.matchFormat?.value ?? null,
  };
}

/**
 * Inverse de `toApiPayload` : préremplit le formulaire depuis les valeurs
 * stockées. Un réglage absent (`null` — le tournoi n'est pas dans ce format)
 * retombe sur le défaut de création, pour que basculer le format ne présente
 * jamais un champ vide.
 */
export function toFormValues(apiValues: TournamentApiValues): TournamentFormValues {
  const defaults = defaultTournamentFormValues();
  const or = (value: number | null, fallback: number) => (value === null ? fallback : value);

  return {
    name: apiValues.name,
    description: apiValues.description ?? "",
    game: apiValues.game,
    format: apiValues.format,
    participantType: apiValues.participantType,
    maxTeams: apiValues.maxTeams,
    startVisibilityAt: isoToLocalInput(apiValues.startVisibilityAt),
    registrationOpenAt: isoToLocalInput(apiValues.registrationOpenAt),
    registrationCloseAt: isoToLocalInput(apiValues.registrationCloseAt),
    startAt: isoToLocalInput(apiValues.startAt),
    hasThirdPlaceMatch: apiValues.hasThirdPlaceMatch,
    survivalRoundsBeforeFirstCut: or(
      apiValues.survivalRoundsBeforeFirstCut,
      defaults.survivalRoundsBeforeFirstCut,
    ),
    survivalRoundsPerCut: or(apiValues.survivalRoundsPerCut, defaults.survivalRoundsPerCut),
    swissTotalRounds: or(apiValues.swissTotalRounds, computeRecommendedRounds(apiValues.maxTeams)),
    swissPointsWin: or(apiValues.swissPointsWin, defaults.swissPointsWin),
    swissPointsDraw: or(apiValues.swissPointsDraw, defaults.swissPointsDraw),
    swissPointsLoss: or(apiValues.swissPointsLoss, defaults.swissPointsLoss),
    endurancePoints: or(apiValues.endurancePoints, defaults.endurancePoints),
    enduranceWinDelta: or(apiValues.enduranceWinDelta, defaults.enduranceWinDelta),
    enduranceLossDelta: or(apiValues.enduranceLossDelta, defaults.enduranceLossDelta),
    endurancePlayoffSize: or(apiValues.endurancePlayoffSize, defaults.endurancePlayoffSize),
    matchFormat: apiValues.matchFormat,
    phases: apiValues.phases ?? defaults.phases,
  };
}

export type TournamentFormProps = {
  mode: "create" | "edit";
  initialValues: TournamentFormValues;
  editableFields: ReadonlySet<TournamentField>;
  submitLabel: string;
  onSubmit: (values: TournamentFormValues) => Promise<void>;
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

  const [values, setValues] = useState<TournamentFormValues>(initialValues);
  const set = <K extends keyof TournamentFormValues>(key: K, value: TournamentFormValues[K]) =>
    setValues((prev) => ({ ...prev, [key]: value }));

  const locked = (field: TournamentField) => !editableFields.has(field);
  const lockedAttr = (field: TournamentField) => (locked(field) && explanationId ? { "aria-describedby": explanationId } : {});

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

  const { format, maxTeams, phases } = values;
  const wording = participantWording(values.participantType);

  const matchFormatType: MatchFormatType | "LIBRE" = values.matchFormat?.type ?? "LIBRE";
  const matchFormatValue = values.matchFormat?.value ?? lastMatchFormatValue;
  const isLibre = matchFormatType === "LIBRE";
  const matchFormat = isLibre ? null : { type: matchFormatType, value: matchFormatValue };
  const matchFormatValid = isLibre || isValidMatchFormat(matchFormatType, matchFormatValue);

  const recommendedRounds = computeRecommendedRounds(maxTeams);
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
    setLoading(true);
    try {
      if (!matchFormatValid) {
        showError(
          matchFormatType === "BO"
            ? "Un Best of doit se jouer en nombre impair de manches (BO1, BO3, BO5…)."
            : "Nombre de manches du format de match invalide.",
        );
        setLoading(false);
        return;
      }

      // Validate phases for MULTI format
      if (format === "MULTI") {
        const error = validatePhases(phases);
        if (error) {
          showError(phaseErrorMessage(error));
          setLoading(false);
          return;
        }
      }

      await onSubmit(values);
    } catch (e) {
      showError((e as Error).message);
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
                {...lockedAttr("name")}
              />
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
                <option value="OW2">Overwatch</option>
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
                aria-describedby={`participant-type-hint${locked("participantType") && explanationId ? ` ${explanationId}` : ""}`}
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
              <input
                id="max-teams"
                type="number"
                min={2}
                max={256}
                disabled={locked("maxTeams")}
                value={maxTeams}
                onChange={(e) => setMaxTeams(Number(e.target.value))}
                {...lockedAttr("maxTeams")}
              />
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
                  set("matchFormat", { type: next, value });
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
                <input
                  id="match-format-value"
                  type="number"
                  min={MATCH_FORMAT_BOUNDS[matchFormatType].min}
                  max={MATCH_FORMAT_BOUNDS[matchFormatType].max}
                  step={matchFormatType === "BO" ? 2 : 1}
                  disabled={locked("matchFormat")}
                  value={matchFormatValue}
                  onChange={(e) => {
                    const value = Number(e.target.value);
                    setLastMatchFormatValue(value);
                    set("matchFormat", { type: matchFormatType, value });
                  }}
                  {...lockedAttr("matchFormat")}
                />
                <p style={HINT}>
                  {matchFormatType === "BO"
                    ? "Le score d'une équipe ne peut pas dépasser la moitié supérieure : 3 en BO5."
                    : "Objectif à atteindre pour remporter le match : 3 en FT3."}
                </p>
              </div>
            )}

            {format === "MULTI" && (
              <div style={FULL_WIDTH}>
                <PhaseBuilder
                  phases={phases}
                  maxTeams={maxTeams}
                  disabled={locked("phases")}
                  onChange={(next) => set("phases", next)}
                />
              </div>
            )}

            {format === "BG_SURVIE" && (
              <>
                <div className="field">
                  <label htmlFor="endurance-points">Capital d&apos;endurance</label>
                  <input
                    id="endurance-points"
                    type="number"
                    min={1}
                    max={99}
                    disabled={locked("endurancePoints")}
                    value={values.endurancePoints}
                    onChange={(e) => set("endurancePoints", Number(e.target.value))}
                    {...lockedAttr("endurancePoints")}
                  />
                  <p style={HINT}>
                    Points de départ de chaque équipe. À 0, elle est éliminée.
                  </p>
                </div>

                <div className="field">
                  <label htmlFor="endurance-win">Points par victoire de map</label>
                  <input
                    id="endurance-win"
                    type="number"
                    min={1}
                    max={20}
                    disabled={locked("enduranceWinDelta")}
                    value={values.enduranceWinDelta}
                    onChange={(e) => set("enduranceWinDelta", Number(e.target.value))}
                    {...lockedAttr("enduranceWinDelta")}
                  />
                </div>

                <div className="field">
                  <label htmlFor="endurance-loss">Points par défaite de map</label>
                  <input
                    id="endurance-loss"
                    type="number"
                    min={1}
                    max={20}
                    disabled={locked("enduranceLossDelta")}
                    value={values.enduranceLossDelta}
                    onChange={(e) => set("enduranceLossDelta", Number(e.target.value))}
                    {...lockedAttr("enduranceLossDelta")}
                  />
                </div>

                <div className="field">
                  <label htmlFor="endurance-playoff">Équipes en play-offs</label>
                  <input
                    id="endurance-playoff"
                    type="number"
                    min={2}
                    max={32}
                    disabled={locked("endurancePlayoffSize")}
                    value={values.endurancePlayoffSize}
                    onChange={(e) => set("endurancePlayoffSize", Number(e.target.value))}
                    {...lockedAttr("endurancePlayoffSize")}
                  />
                  <p style={HINT}>
                    La phase d&apos;endurance s&apos;arrête à cet effectif. À 8, l&apos;arbre
                    suit le tableau du règlement (8v4, 6v2, 1v5, 3v7) avec petite finale.
                  </p>
                </div>
              </>
            )}

            {format === "SURVIVAL" && (
              <>
                <div className="field">
                  <label htmlFor="survival-first-cut">Rounds avant la première coupe</label>
                  <input
                    id="survival-first-cut"
                    type="number"
                    min={1}
                    max={50}
                    disabled={locked("survivalRoundsBeforeFirstCut")}
                    value={values.survivalRoundsBeforeFirstCut}
                    onChange={(e) =>
                      set("survivalRoundsBeforeFirstCut", Number(e.target.value))
                    }
                    {...lockedAttr("survivalRoundsBeforeFirstCut")}
                  />
                  <p style={HINT}>
                    Laisse le classement se former avant la première élimination.
                  </p>
                </div>

                <div className="field">
                  <label htmlFor="survival-rounds">Rounds entre les coupes suivantes</label>
                  <input
                    id="survival-rounds"
                    type="number"
                    min={1}
                    max={50}
                    disabled={locked("survivalRoundsPerCut")}
                    value={values.survivalRoundsPerCut}
                    onChange={(e) => set("survivalRoundsPerCut", Number(e.target.value))}
                    {...lockedAttr("survivalRoundsPerCut")}
                  />
                  <p style={HINT}>
                    Cadence appliquée après la première coupe.
                  </p>
                </div>

                <p style={{ ...HINT, ...FULL_WIDTH }}>
                  Toutes les équipes s&apos;affrontent par paires selon leur classement. À
                  chaque coupe, les deux dernières équipes sont éliminées, jusqu&apos;à la
                  championne. Si le nombre d&apos;inscrites est impair, un barrage entre les
                  deux dernières ouvre le tournoi — aucune victoire d&apos;office n&apos;est
                  distribuée.
                </p>
              </>
            )}

            {format === "SWISS" && (
              <>
                <div className="field">
                  <label htmlFor="swiss-rounds">Nombre de rondes</label>
                  <input
                    id="swiss-rounds"
                    type="number"
                    min={1}
                    max={20}
                    disabled={locked("swissTotalRounds")}
                    value={values.swissTotalRounds}
                    onChange={(e) => setSwissTotalRounds(Number(e.target.value))}
                    {...lockedAttr("swissTotalRounds")}
                  />
                  <p style={HINT}>
                    Recommandé pour {maxTeams} {wording.many} : {recommendedRounds} ronde
                    {recommendedRounds > 1 ? "s" : ""}.
                  </p>
                </div>

                <div className="field">
                  <label htmlFor="swiss-points-win">Barème (victoire / nul / défaite)</label>
                  <div style={{ display: "flex", gap: 8 }}>
                    <input
                      id="swiss-points-win"
                      type="number"
                      min={0}
                      max={99}
                      aria-label="Points par victoire"
                      disabled={locked("swissPointsWin")}
                      value={values.swissPointsWin}
                      onChange={(e) => set("swissPointsWin", Number(e.target.value))}
                      {...lockedAttr("swissPointsWin")}
                    />
                    <input
                      type="number"
                      min={0}
                      max={99}
                      aria-label="Points par match nul"
                      disabled={locked("swissPointsDraw")}
                      value={values.swissPointsDraw}
                      onChange={(e) => set("swissPointsDraw", Number(e.target.value))}
                      {...lockedAttr("swissPointsDraw")}
                    />
                    <input
                      type="number"
                      min={0}
                      max={99}
                      aria-label="Points par défaite"
                      disabled={locked("swissPointsLoss")}
                      value={values.swissPointsLoss}
                      onChange={(e) => set("swissPointsLoss", Number(e.target.value))}
                      {...lockedAttr("swissPointsLoss")}
                    />
                  </div>
                  <p style={HINT}>
                    Une victoire d&apos;office rapporte autant qu&apos;une victoire.
                  </p>
                </div>

                <p style={{ ...HINT, ...FULL_WIDTH }}>
                  Aucune élimination : toutes les équipes jouent les {values.swissTotalRounds}{" "}
                  rondes.
                  À chaque ronde, on affronte une équipe ayant un total de points proche du
                  sien, sans jamais rejouer le même adversaire tant que c&apos;est possible. À
                  égalité de points, le départage se fait au Buchholz (somme des points des
                  adversaires rencontrés).
                </p>
              </>
            )}

            {format === "SINGLE" && (
              <div className="field" style={FULL_WIDTH}>
                <label htmlFor="third-place" style={{ marginBottom: 6 }}>
                  Options supplémentaires
                </label>
                <div
                  className="checkbox-card"
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
                    border: `1.5px solid ${
                      values.hasThirdPlaceMatch ? "var(--blue-500)" : "var(--line-strong-cy)"
                    }`,
                    borderRadius: 10,
                    cursor: locked("hasThirdPlaceMatch") ? "not-allowed" : "pointer",
                    opacity: locked("hasThirdPlaceMatch") ? 0.6 : 1,
                    transition: "border-color 0.2s ease, background-color 0.2s ease, opacity 0.2s ease",
                    backgroundColor: values.hasThirdPlaceMatch
                      ? "rgba(90, 200, 255, 0.07)"
                      : "transparent",
                  }}
                >
                  <input
                    id="third-place"
                    type="checkbox"
                    disabled={locked("hasThirdPlaceMatch")}
                    checked={values.hasThirdPlaceMatch}
                    onChange={(e) => set("hasThirdPlaceMatch", e.target.checked)}
                    style={{
                      width: 18,
                      height: 18,
                      accentColor: "var(--blue-500)",
                      cursor: locked("hasThirdPlaceMatch") ? "not-allowed" : "pointer",
                      flexShrink: 0,
                      marginTop: 2,
                    }}
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
                        color: "var(--ink)",
                      }}
                    >
                      Petite finale
                    </label>
                    <p style={{ ...HINT, margin: 0 }}>
                      Ajoute un match pour déterminer la 3ᵉ place entre les deux perdants des
                      demi-finales.
                    </p>
                  </div>
                </div>
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
                {...lockedAttr("startVisibilityAt")}
              />
            </div>
            <div className="field">
              <label htmlFor="registration-open-at">Début inscriptions</label>
              <input
                id="registration-open-at"
                type="datetime-local"
                disabled={locked("registrationOpenAt")}
                value={values.registrationOpenAt}
                onChange={(e) => set("registrationOpenAt", e.target.value)}
                {...lockedAttr("registrationOpenAt")}
              />
            </div>
            <div className="field">
              <label htmlFor="registration-close-at">Fin inscriptions</label>
              <input
                id="registration-close-at"
                type="datetime-local"
                disabled={locked("registrationCloseAt")}
                value={values.registrationCloseAt}
                onChange={(e) => set("registrationCloseAt", e.target.value)}
                {...lockedAttr("registrationCloseAt")}
              />
            </div>
            <div className="field">
              <label htmlFor="start-at">Début tournoi</label>
              <input
                id="start-at"
                type="datetime-local"
                disabled={locked("startAt")}
                value={values.startAt}
                onChange={(e) => set("startAt", e.target.value)}
                {...lockedAttr("startAt")}
              />
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
