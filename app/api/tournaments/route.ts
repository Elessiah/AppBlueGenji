import { getCurrentUser } from "@/lib/server/auth";
import { fail, ok } from "@/lib/server/http";
import { createTournament, listTournamentBuckets } from "@/lib/server/tournaments-service";
import { can } from "@/lib/shared/permissions";
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
      maxTeams?: number;
      startVisibilityAt?: string;
      registrationOpenAt?: string;
      registrationCloseAt?: string;
      startAt?: string;
      hasThirdPlaceMatch?: boolean;
      survivalRoundsBeforeFirstCut?: number;
      survivalRoundsPerCut?: number;
      phases?: unknown;
    };

    if (!body.name?.trim()) return fail("MISSING_NAME", 400);
    if (
      body.format !== "SINGLE" &&
      body.format !== "DOUBLE" &&
      body.format !== "SURVIVAL" &&
      body.format !== "SWISS" &&
      body.format !== "MULTI"
    ) {
      return fail("INVALID_FORMAT", 400);
    }

    if (body.format === "MULTI") {
      const phaseError = validateRawPhases(body.phases);
      if (phaseError) return fail(phaseError, 400);
    }
    if (body.game && body.game !== "OW2" && body.game !== "MR") return fail("INVALID_GAME", 400);

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

    const id = await createTournament(user.id, {
      name: body.name.trim(),
      description: body.description ?? null,
      format: body.format,
      game: body.game ?? "OW2",
      maxTeams,
      startVisibilityAt: body.startVisibilityAt ?? "",
      registrationOpenAt: body.registrationOpenAt ?? "",
      registrationCloseAt: body.registrationCloseAt ?? "",
      startAt: body.startAt ?? "",
      hasThirdPlaceMatch: body.hasThirdPlaceMatch,
      survivalRoundsBeforeFirstCut,
      survivalRoundsPerCut,
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
