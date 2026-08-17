import { getCurrentUser } from "@/lib/server/auth";
import { fail, ok } from "@/lib/server/http";
import { createTournament, listTournamentBuckets } from "@/lib/server/tournaments-service";
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
      swissTotalRounds?: number;
      swissPointsWin?: number;
      swissPointsDraw?: number;
      swissPointsLoss?: number;
    };

    if (!body.name?.trim()) return fail("MISSING_NAME", 400);
    if (
      body.format !== "SINGLE" &&
      body.format !== "DOUBLE" &&
      body.format !== "SWISS" &&
      body.format !== "SURVIVAL"
    ) {
      return fail("INVALID_FORMAT", 400);
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
    });

    return ok({ id }, 201);
  } catch (error) {
    const message = (error as Error).message;
    if (message === "INVALID_DATES" || message === "INVALID_DATE_ORDER") return fail(message, 400);
    return fail(message || "TOURNAMENT_CREATE_FAILED", 500);
  }
}
