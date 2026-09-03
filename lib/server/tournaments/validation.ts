/**
 * Validation d'une saisie de tournoi — création comme édition.
 *
 * Sortie de la route `POST /api/tournaments` pour être partagée avec
 * `PATCH /api/tournaments/[id]/edit`. Sans ce partage, les deux jeux de règles
 * divergent au premier format ajouté : la création accepte ce que l'édition
 * refuse, ou l'inverse.
 *
 * Le module ne connaît pas HTTP : il rend un **code d'erreur**, que l'appelant
 * traduit en statut (`fail(code, 400)`) ou en exception.
 */
import { isValidMatchFormat, type MatchFormat } from "@/lib/shared/match-format";
import { isParticipantType, type ParticipantType } from "@/lib/shared/participants";
import { DEFAULT_SWISS_POINTS } from "@/lib/shared/swiss";
import type { PhaseConfig } from "@/lib/shared/tournament-phases";
import type { TournamentFormat, TournamentGame } from "@/lib/shared/types";

/** Phase telle qu'envoyée par le client, avant normalisation. */
type RawPhase = {
  format?: string;
  name?: string | null;
  qualifierMode?: string;
  qualifierValue?: number;
  hasThirdPlaceMatch?: boolean;
  swissTotalRounds?: number | null;
  survivalRoundsBeforeFirstCut?: number | null;
  survivalRoundsPerCut?: number | null;
};

const PHASE_FORMATS = ["SINGLE", "DOUBLE", "SWISS", "SURVIVAL"];

function isPositiveInt(value: unknown): boolean {
  return Number.isInteger(Number(value)) && Number(value) >= 1;
}

/**
 * Valide le tableau de phases reçu du client et renvoie un code d'erreur, ou
 * null si tout est correct.
 *
 * L'ordre des contrôles est significatif : on refuse d'abord ce qui rend la
 * phase illisible (format, cible de qualification), puis la cohérence du plan
 * dans son ensemble, et seulement ensuite les réglages propres à un format. Un
 * plan dont les qualifications montent doit être signalé comme tel même si une
 * cadence de survie manque par ailleurs — c'est l'erreur la plus parlante.
 */
function validateRawPhases(phases: unknown): string | null {
  if (!Array.isArray(phases) || phases.length === 0) return "MISSING_PHASES";

  const list = phases as RawPhase[];

  for (const phase of list) {
    if (!phase || !PHASE_FORMATS.includes(String(phase.format))) return "INVALID_PHASE_FORMAT";
  }

  for (let i = 0; i < list.length; i += 1) {
    if (list[i].format === "DOUBLE" && i !== list.length - 1) {
      return "DOUBLE_MUST_BE_LAST_PHASE";
    }
  }

  for (const phase of list) {
    const value = Number(phase.qualifierValue);
    if (phase.qualifierMode === "PERCENT") {
      if (!Number.isInteger(value) || value < 1 || value > 100) return "INVALID_QUALIFIER_VALUE";
    } else if (!isPositiveInt(value)) {
      return "INVALID_QUALIFIER_VALUE";
    }
  }

  // Une phase ne peut pas qualifier PLUS que celle qui la précède. On ne compare
  // que des cibles de même nature : opposer « 16 équipes » à « 50 % » n'a pas de sens.
  for (let i = 0; i + 1 < list.length; i += 1) {
    const current = list[i];
    const next = list[i + 1];
    if (
      current.qualifierMode === next.qualifierMode &&
      Number(next.qualifierValue) > Number(current.qualifierValue)
    ) {
      return "INVALID_QUALIFIER_COUNT";
    }
  }

  for (const phase of list) {
    if (phase.format === "SURVIVAL") {
      if (!isPositiveInt(phase.survivalRoundsPerCut)) return "INVALID_SURVIVAL_ROUNDS";
      if (
        phase.survivalRoundsBeforeFirstCut !== undefined &&
        phase.survivalRoundsBeforeFirstCut !== null &&
        !isPositiveInt(phase.survivalRoundsBeforeFirstCut)
      ) {
        return "INVALID_SURVIVAL_ROUNDS";
      }
    }
    if (phase.format === "SWISS" && !isPositiveInt(phase.swissTotalRounds)) {
      return "INVALID_SWISS_ROUNDS";
    }
  }

  return null;
}

/**
 * Codes d'erreur relatifs aux phases (format MULTI), toutes origines
 * confondues : le contrôle « ami » de {@link validateRawPhases} (repris ici)
 * et le contrôle strict de `validatePhases` (`lib/shared/tournament-phases.ts`),
 * appliqué plus tard par `createTournament` sur le plan normalisé. Le `catch`
 * de la route les traite indifféremment comme des 400.
 */
export const PHASE_ERROR_CODES: ReadonlySet<string> = new Set([
  "MISSING_PHASES",
  "INVALID_PHASE_FORMAT",
  "DOUBLE_MUST_BE_LAST_PHASE",
  "INVALID_QUALIFIER_VALUE",
  "INVALID_QUALIFIER_COUNT",
  "INVALID_SURVIVAL_ROUNDS",
  "INVALID_SWISS_ROUNDS",
  "INVALID_PHASE_COUNT",
  "INVALID_PHASE_POSITIONS",
  "INVALID_PHASE_QUALIFIER",
  "NON_DECREASING_PHASE_QUALIFIERS",
  "INVALID_PHASE_SWISS_ROUNDS",
  "INVALID_PHASE_SURVIVAL_ROUNDS",
]);

export type TournamentInputBody = {
  name?: string;
  description?: string | null;
  format?: TournamentFormat;
  game?: TournamentGame;
  participantType?: ParticipantType;
  maxTeams?: number;
  hasThirdPlaceMatch?: boolean;
  survivalRoundsBeforeFirstCut?: number;
  survivalRoundsPerCut?: number;
  phases?: unknown;
  swissTotalRounds?: number;
  swissPointsWin?: number;
  swissPointsDraw?: number;
  swissPointsLoss?: number;
  endurancePoints?: number;
  enduranceWinDelta?: number;
  enduranceLossDelta?: number;
  endurancePlayoffSize?: number;
  enduranceMaxRounds?: number;
  matchFormatType?: string | null;
  matchFormatValue?: number | null;
};

export type ValidatedTournamentInput = {
  name: string;
  description: string | null;
  format: TournamentFormat;
  game: TournamentGame;
  participantType: ParticipantType;
  maxTeams: number;
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
  /**
   * Phases du format MULTI, **brutes** (telles que reçues du client) : non
   * normalisées — `position`, `name`, `hasThirdPlaceMatch`… peuvent être
   * absents. C'est exactement le type accepté par `normalizePhaseConfigs`
   * (`lib/shared/tournament-phases.ts`), qui doit être appelé — puis
   * `validatePhases` — avant de lire un champ ou d'insérer quoi que ce soit ;
   * `createTournament` s'en charge, `updateTournament` devra faire de même.
   * `null` hors format MULTI.
   */
  phases: readonly Partial<PhaseConfig>[] | null;
};

export function validateTournamentInput(
  body: TournamentInputBody,
): { error: string } | { value: ValidatedTournamentInput } {
  if (!body.name?.trim()) return { error: "MISSING_NAME" };
  if (
    body.format !== "SINGLE" &&
    body.format !== "DOUBLE" &&
    body.format !== "SURVIVAL" &&
    body.format !== "SWISS" &&
    body.format !== "MULTI" &&
    body.format !== "BG_SURVIE"
  ) {
    return { error: "INVALID_FORMAT" };
  }

  if (body.format === "MULTI") {
    const phaseError = validateRawPhases(body.phases);
    if (phaseError) return { error: phaseError };
  }
  if (body.game && body.game !== "OW2" && body.game !== "MR") return { error: "INVALID_GAME" };
  // Type de participant : équipes (défaut) ou joueurs inscrits individuellement.
  if (body.participantType !== undefined && !isParticipantType(body.participantType)) {
    return { error: "INVALID_PARTICIPANT_TYPE" };
  }

  const maxTeams = Number(body.maxTeams ?? 0);
  if (!Number.isInteger(maxTeams) || maxTeams < 2 || maxTeams > 256) {
    return { error: "INVALID_MAX_TEAMS" };
  }

  // Format des matchs (BO5, FT3…) — commun à tous les formats de tournoi.
  // Les deux champs vont ensemble : omettre les deux laisse la saisie libre,
  // n'en envoyer qu'un est une erreur du client plutôt qu'un demi-réglage.
  let matchFormat: MatchFormat | null = null;
  const hasMatchFormatType = body.matchFormatType != null;
  const hasMatchFormatValue = body.matchFormatValue != null;
  if (hasMatchFormatType !== hasMatchFormatValue) {
    return { error: "INVALID_MATCH_FORMAT" };
  }
  if (hasMatchFormatType && hasMatchFormatValue) {
    if (!isValidMatchFormat(body.matchFormatType, body.matchFormatValue)) {
      return { error: "INVALID_MATCH_FORMAT" };
    }
    matchFormat = {
      type: body.matchFormatType as MatchFormat["type"],
      value: Number(body.matchFormatValue),
    };
  }

  let survivalRoundsPerCut: number | null = null;
  let survivalRoundsBeforeFirstCut: number | null = null;
  if (body.format === "SURVIVAL") {
    survivalRoundsPerCut = Number(body.survivalRoundsPerCut ?? 0);
    if (!Number.isInteger(survivalRoundsPerCut) || survivalRoundsPerCut < 1 || survivalRoundsPerCut > 50) {
      return { error: "INVALID_SURVIVAL_ROUNDS" };
    }
    // Non fourni : la première coupe tombe au bout d'un intervalle standard.
    survivalRoundsBeforeFirstCut = Number(
      body.survivalRoundsBeforeFirstCut ?? survivalRoundsPerCut,
    );
    if (
      !Number.isInteger(survivalRoundsBeforeFirstCut) ||
      survivalRoundsBeforeFirstCut < 1 ||
      survivalRoundsBeforeFirstCut > 50
    ) {
      return { error: "INVALID_SURVIVAL_FIRST_CUT" };
    }
  }

  // BlueGenji Survie : barème d'endurance. Tout est facultatif — le moteur
  // retombe sur 9 points, ±1 et des play-offs à 8.
  let endurancePoints: number | null = null;
  let enduranceWinDelta: number | null = null;
  let enduranceLossDelta: number | null = null;
  let endurancePlayoffSize: number | null = null;
  // `null` = phase à durée libre : elle s'arrête sur l'effectif, jamais sur le
  // calendrier. C'est le comportement d'origine du mode, et il reste le défaut.
  let enduranceMaxRounds: number | null = null;
  if (body.format === "BG_SURVIE") {
    const settings: [unknown, number, number, (v: number) => void][] = [
      [body.endurancePoints, 1, 99, (v) => (endurancePoints = v)],
      [body.enduranceWinDelta, 1, 20, (v) => (enduranceWinDelta = v)],
      [body.enduranceLossDelta, 1, 20, (v) => (enduranceLossDelta = v)],
      [body.endurancePlayoffSize, 2, 32, (v) => (endurancePlayoffSize = v)],
      [body.enduranceMaxRounds, 1, 50, (v) => (enduranceMaxRounds = v)],
    ];

    for (const [raw, min, max, assign] of settings) {
      if (raw == null) continue;
      const value = Number(raw);
      if (!Number.isInteger(value) || value < min || value > max) {
        return { error: "INVALID_ENDURANCE_SETTINGS" };
      }
      assign(value);
    }
  }

  // Ronde suisse : nombre de rondes et barème. `null` laisse le moteur retomber
  // sur la recommandation ⌈log₂(N)⌉ + 1, calculée au démarrage sur l'effectif
  // réellement inscrit plutôt que sur la capacité annoncée.
  let swissTotalRounds: number | null = null;
  let swissPointsWin: number | null = null;
  let swissPointsDraw: number | null = null;
  let swissPointsLoss: number | null = null;
  if (body.format === "SWISS") {
    if (body.swissTotalRounds != null) {
      swissTotalRounds = Number(body.swissTotalRounds);
      if (!Number.isInteger(swissTotalRounds) || swissTotalRounds < 1 || swissTotalRounds > 20) {
        return { error: "INVALID_SWISS_ROUNDS" };
      }
    }

    const points: [number | undefined, number, (v: number | null) => void][] = [
      [body.swissPointsWin, DEFAULT_SWISS_POINTS.win, (v) => (swissPointsWin = v)],
      [body.swissPointsDraw, DEFAULT_SWISS_POINTS.draw, (v) => (swissPointsDraw = v)],
      [body.swissPointsLoss, DEFAULT_SWISS_POINTS.loss, (v) => (swissPointsLoss = v)],
    ];

    // Valeurs **effectives** : un champ omis n'est pas « pas de contrainte »,
    // c'est le défaut que `createTournament` appliquera derrière. Valider les
    // valeurs brutes laissait passer `{swissPointsWin: 0}` seul, qui produit
    // un barème victoire = défaite = 0.
    const effective: number[] = [];
    for (const [raw, fallback, assign] of points) {
      if (raw == null) {
        effective.push(fallback);
        assign(null);
        continue;
      }
      const value = Number(raw);
      if (!Number.isInteger(value) || value < 0 || value > 99) {
        return { error: "INVALID_SWISS_POINTS" };
      }
      effective.push(value);
      assign(value);
    }

    const [win, draw, loss] = effective;
    // Le barème doit rester monotone : un nul ne peut pas rapporter plus
    // qu'une victoire ni moins qu'une défaite, et une victoire doit valoir
    // strictement plus qu'une défaite. Sinon le classement — et donc les
    // appariements par groupe de points — n'a plus de sens.
    if (win <= loss || draw > win || draw < loss) {
      return { error: "INVALID_SWISS_POINTS" };
    }
  }

  return {
    value: {
      name: body.name.trim(),
      description: body.description ?? null,
      format: body.format,
      game: body.game ?? "OW2",
      participantType: body.participantType ?? "TEAM",
      maxTeams,
      // La petite finale n'a de sens qu'en élimination simple : on la neutralise
      // ailleurs plutôt que de la stocker telle quelle. `createTournament`
      // portait seule cette règle, si bien qu'une **édition** basculant un
      // tournoi de `SINGLE` à `DOUBLE` laissait la case cochée en base là où sa
      // création l'aurait mise à zéro : le formulaire la rouvrait cochée au
      // retour vers `SINGLE`, activant une petite finale que personne n'avait
      // redemandée. (`rankEliminationPhase` lit bien la colonne quel que soit le
      // format, mais ne s'en sert que dans sa branche `SINGLE`.)
      hasThirdPlaceMatch: body.format === "SINGLE" && Boolean(body.hasThirdPlaceMatch),
      survivalRoundsBeforeFirstCut,
      survivalRoundsPerCut,
      swissTotalRounds,
      swissPointsWin,
      swissPointsDraw,
      swissPointsLoss,
      endurancePoints,
      enduranceWinDelta,
      enduranceLossDelta,
      endurancePlayoffSize,
      enduranceMaxRounds,
      matchFormat,
      // Les phases ne concernent que le format MULTI : on ne les transmet pas
      // aux autres formats, même si le client en a envoyé. Voir le
      // commentaire du champ `phases` de `ValidatedTournamentInput` ci-dessus :
      // elles restent brutes ici, à normaliser par l'appelant.
      phases: body.format === "MULTI" ? (body.phases as Partial<PhaseConfig>[]) : null,
    },
  };
}

/** Les quatre jalons d'un tournoi, en ISO. */
export type TournamentDateStrings = {
  startVisibilityAt: string;
  registrationOpenAt: string;
  registrationCloseAt: string;
  startAt: string;
};

/** Les mêmes, une fois analysés. */
export type TournamentDates = Record<keyof TournamentDateStrings, Date>;

export type DateOrderError = "INVALID_DATES" | "INVALID_DATE_ORDER";

/**
 * Analyse les quatre jalons **et** vérifie leur ordre chronologique.
 *
 * Rend les `Date` construites au passage : l'appelant qui va les insérer n'a pas
 * à les reconstruire, ce que faisait `createTournament` — quatre `new Date` sur
 * des chaînes que cette fonction venait d'analyser, avec le risque qu'un jour
 * les deux analyses ne portent plus sur les mêmes valeurs.
 *
 * L'ordre `startVisibilityAt <= registrationOpenAt` n'est pas décoratif : c'est
 * lui qui garantit qu'un tournoi encore invisible est toujours `UPCOMING`, et
 * donc que les routes d'écriture n'ont pas à connaître la visibilité
 * (`docs/features/TOURNAMENT_VISIBILITY_ACCESS.md`).
 */
export function parseTournamentDates(
  dates: TournamentDateStrings,
): { error: DateOrderError; value?: never } | { error?: never; value: TournamentDates } {
  const startVisibilityAt = new Date(dates.startVisibilityAt);
  const registrationOpenAt = new Date(dates.registrationOpenAt);
  const registrationCloseAt = new Date(dates.registrationCloseAt);
  const startAt = new Date(dates.startAt);

  if (
    Number.isNaN(startVisibilityAt.getTime()) ||
    Number.isNaN(registrationOpenAt.getTime()) ||
    Number.isNaN(registrationCloseAt.getTime()) ||
    Number.isNaN(startAt.getTime())
  ) {
    return { error: "INVALID_DATES" };
  }

  if (
    !(
      startVisibilityAt <= registrationOpenAt &&
      registrationOpenAt <= registrationCloseAt &&
      registrationCloseAt <= startAt
    )
  ) {
    return { error: "INVALID_DATE_ORDER" };
  }

  return { value: { startVisibilityAt, registrationOpenAt, registrationCloseAt, startAt } };
}

/**
 * Ordre chronologique des quatre jalons, sans les valeurs analysées.
 *
 * Déplacé depuis `createTournament` pour que l'édition applique la même règle
 * sur les valeurs **résultantes** — champs modifiés et champs conservés mêlés.
 */
export function validateDateOrder(dates: TournamentDateStrings): DateOrderError | null {
  return parseTournamentDates(dates).error ?? null;
}
