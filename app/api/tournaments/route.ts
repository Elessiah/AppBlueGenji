import { getCurrentUser } from "@/lib/server/auth";
import { fail, ok } from "@/lib/server/http";
import { createTournament, listTournamentBuckets } from "@/lib/server/tournaments-service";
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

  try {
    const body = (await req.json()) as {
      name?: string;
      description?: string | null;
      format?: TournamentFormat;
      maxTeams?: number;
      startVisibilityAt?: string;
      registrationOpenAt?: string;
      registrationCloseAt?: string;
      startAt?: string;
      hasThirdPlaceMatch?: boolean;
    };

    if (!body.name?.trim()) return fail("MISSING_NAME", 400);
    if (body.format !== "SINGLE" && body.format !== "DOUBLE") return fail("INVALID_FORMAT", 400);

    const maxTeams = Number(body.maxTeams ?? 0);
    if (!Number.isInteger(maxTeams) || maxTeams < 2 || maxTeams > 256) {
      return fail("INVALID_MAX_TEAMS", 400);
    }

    const id = await createTournament(user.id, {
      name: body.name.trim(),
      description: body.description ?? null,
      format: body.format,
      maxTeams,
      startVisibilityAt: body.startVisibilityAt ?? "",
      registrationOpenAt: body.registrationOpenAt ?? "",
      registrationCloseAt: body.registrationCloseAt ?? "",
      startAt: body.startAt ?? "",
      hasThirdPlaceMatch: body.hasThirdPlaceMatch,
    });

    return ok({ id }, 201);
  } catch (error) {
    const message = (error as Error).message;
    if (message === "INVALID_DATES" || message === "INVALID_DATE_ORDER") return fail(message, 400);
    return fail(message || "TOURNAMENT_CREATE_FAILED", 500);
  }
}
