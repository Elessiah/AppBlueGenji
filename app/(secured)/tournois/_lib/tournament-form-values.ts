/**
 * Valeurs du formulaire de tournoi, et les deux ponts avec l'API.
 *
 * Séparés du composant : ce sont des fonctions pures, testées telles quelles
 * (`tests/tournois/tournament-form.test.ts`), et le composant n'a pas à porter
 * la table de correspondance en plus de son rendu.
 */
import { localDateTimeInput } from "@/lib/shared/dates";
import type { TournamentFormat, TournamentGame } from "@/lib/shared/types";
import type { PhaseConfig } from "@/lib/shared/tournament-phases";
import { computeRecommendedRounds } from "@/lib/shared/swiss";
import { DEFAULT_MATCH_FORMAT, type MatchFormat } from "@/lib/shared/match-format";
import type { ParticipantType } from "@/lib/shared/participants";
import { createDefaultPhase } from "../creer/phase-form";

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
  /**
   * Plafond de manches qualificatives, **0 valant « aucune limite »**. Le
   * formulaire ne manipule que des nombres ; c'est `toApiPayload` qui traduit
   * ce zéro en `null`, donc en `NULL` côté base.
   */
  enduranceMaxRounds: number;
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
  enduranceMaxRounds: number | null;
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
    // Aucun plafond de manches : la phase s'arrête sur l'effectif, comme elle
    // l'a toujours fait.
    enduranceMaxRounds: 0,
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
    // 0 n'est pas une valeur à enregistrer, c'est l'absence de plafond — et
    // c'est `null` qui le dit, jamais `undefined` : la liste blanche de
    // `PATCH .../edit` ne recopie que les champs dont `body[field] !==
    // undefined`, et `updateTournament` fusionne le patch sur les valeurs
    // courantes. Un champ omis vaut donc « on ne touche pas », si bien qu'un
    // plafond une fois posé ne pourrait plus jamais être retiré. Hors du mode,
    // en revanche, on ne touche effectivement à rien (comme le reste du barème
    // d'endurance).
    enduranceMaxRounds:
      format === "BG_SURVIE" ? (values.enduranceMaxRounds > 0 ? values.enduranceMaxRounds : null) : undefined,
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
    // `null` en base = pas de plafond : le champ retombe sur 0, qui le dit.
    enduranceMaxRounds: apiValues.enduranceMaxRounds ?? 0,
    matchFormat: apiValues.matchFormat,
    phases: apiValues.phases ?? defaults.phases,
  };
}
