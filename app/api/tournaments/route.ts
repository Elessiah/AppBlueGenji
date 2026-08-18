import { getCurrentUser } from "@/lib/server/auth";
import { fail, ok } from "@/lib/server/http";
import { createTournament, listTournamentBuckets } from "@/lib/server/tournaments-service";
import { isParticipantType, type ParticipantType } from "@/lib/shared/participants";
import { can } from "@/lib/shared/permissions";
import { DEFAULT_SWISS_POINTS } from "@/lib/shared/swiss";
import type { TournamentFormat } from "@/lib/shared/types";

export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user) return fail("UNAUTHORIZED", 401);

  const url = new URL(req.url);
  const search = url.searchParams.get("search");

  const buckets = await listTournamentBuckets(search);
  return ok({ buckets });
}

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

const PHASE_ERROR_CODES = new Set([
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

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return fail("UNAUTHORIZED", 401);
  if (!can(user, "tournaments")) return fail("FORBIDDEN", 403);

  try {
    const body = (await req.json()) as {
      name?: string;
      description?: string | null;
      format?: TournamentFormat;
      game?: "OW2" | "MR";
      participantType?: ParticipantType;
      maxTeams?: number;
      startVisibilityAt?: string;
      registrationOpenAt?: string;
      registrationCloseAt?: string;
      startAt?: string;
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
    };

    if (!body.name?.trim()) return fail("MISSING_NAME", 400);
    if (
      body.format !== "SINGLE" &&
      body.format !== "DOUBLE" &&
      body.format !== "SURVIVAL" &&
      body.format !== "SWISS" &&
      body.format !== "MULTI" &&
      body.format !== "BG_SURVIE"
    ) {
      return fail("INVALID_FORMAT", 400);
    }

    if (body.format === "MULTI") {
      const phaseError = validateRawPhases(body.phases);
      if (phaseError) return fail(phaseError, 400);
    }
    if (body.game && body.game !== "OW2" && body.game !== "MR") return fail("INVALID_GAME", 400);
    // Type de participant : équipes (défaut) ou joueurs inscrits individuellement.
    if (body.participantType !== undefined && !isParticipantType(body.participantType)) {
      return fail("INVALID_PARTICIPANT_TYPE", 400);
    }

    const maxTeams = Number(body.maxTeams ?? 0);
    if (!Number.isInteger(maxTeams) || maxTeams < 2 || maxTeams > 256) {
      return fail("INVALID_MAX_TEAMS", 400);
    }

    let survivalRoundsPerCut: number | null = null;
    let survivalRoundsBeforeFirstCut: number | null = null;
    if (body.format === "SURVIVAL") {
      survivalRoundsPerCut = Number(body.survivalRoundsPerCut ?? 0);
      if (!Number.isInteger(survivalRoundsPerCut) || survivalRoundsPerCut < 1 || survivalRoundsPerCut > 50) {
        return fail("INVALID_SURVIVAL_ROUNDS", 400);
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
        return fail("INVALID_SURVIVAL_FIRST_CUT", 400);
      }
    }

    // BlueGenji Survie : barème d'endurance. Tout est facultatif — le moteur
    // retombe sur 9 points, ±1 et des play-offs à 8.
    let endurancePoints: number | null = null;
    let enduranceWinDelta: number | null = null;
    let enduranceLossDelta: number | null = null;
    let endurancePlayoffSize: number | null = null;
    if (body.format === "BG_SURVIE") {
      const settings: [unknown, number, number, (v: number) => void][] = [
        [body.endurancePoints, 1, 99, (v) => (endurancePoints = v)],
        [body.enduranceWinDelta, 1, 20, (v) => (enduranceWinDelta = v)],
        [body.enduranceLossDelta, 1, 20, (v) => (enduranceLossDelta = v)],
        [body.endurancePlayoffSize, 2, 32, (v) => (endurancePlayoffSize = v)],
      ];

      for (const [raw, min, max, assign] of settings) {
        if (raw == null) continue;
        const value = Number(raw);
        if (!Number.isInteger(value) || value < min || value > max) {
          return fail("INVALID_ENDURANCE_SETTINGS", 400);
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
          return fail("INVALID_SWISS_ROUNDS", 400);
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
          return fail("INVALID_SWISS_POINTS", 400);
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
        return fail("INVALID_SWISS_POINTS", 400);
      }
    }

    const id = await createTournament(user.id, {
      name: body.name.trim(),
      description: body.description ?? null,
      format: body.format,
      game: body.game ?? "OW2",
      participantType: body.participantType ?? "TEAM",
      maxTeams,
      startVisibilityAt: body.startVisibilityAt ?? "",
      registrationOpenAt: body.registrationOpenAt ?? "",
      registrationCloseAt: body.registrationCloseAt ?? "",
      startAt: body.startAt ?? "",
      hasThirdPlaceMatch: body.hasThirdPlaceMatch,
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
      // Les phases ne concernent que le format MULTI : on ne les transmet pas
      // aux autres formats, même si le client en a envoyé.
      ...(body.format === "MULTI" ? { phases: body.phases as never } : {}),
    });

    return ok({ id }, 201);
  } catch (error) {
    const message = (error as Error).message;
    if (message === "INVALID_DATES" || message === "INVALID_DATE_ORDER") return fail(message, 400);
    if (PHASE_ERROR_CODES.has(message)) return fail(message, 400);
    return fail(message || "TOURNAMENT_CREATE_FAILED", 500);
  }
}
