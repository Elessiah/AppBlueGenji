import { getCurrentUser } from "@/lib/server/auth";
import { enforceRateLimit, TOURNAMENT_READ_RULE } from "@/lib/server/api-guard";
import { fail, ok } from "@/lib/server/http";
import { createTournament, listTournamentBuckets } from "@/lib/server/tournaments-service";
import { can } from "@/lib/shared/permissions";
import {
  PHASE_ERROR_CODES,
  validateTournamentInput,
  type TournamentInputBody,
} from "@/lib/server/tournaments/validation";

export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user) return fail("UNAUTHORIZED", 401);

  // Plafond large : la page se rafraîchit d'elle-même à la minute au plus vite
  // (`lib/shared/refresh-tiers.ts`). Seul un client parti en boucle l'atteint.
  const throttled = enforceRateLimit(TOURNAMENT_READ_RULE, user.id);
  if (throttled) return throttled;

  const url = new URL(req.url);
  const search = url.searchParams.get("search");
  // `scope=hidden` : les tournois programmés que personne ne voit encore.
  // Réservé au staff `tournaments` (ADMIN, ARBITRE) — sans quoi la date de
  // visibilité ne protégerait plus rien.
  const hiddenOnly = url.searchParams.get("scope") === "hidden";
  if (hiddenOnly && !can(user, "tournaments")) return fail("FORBIDDEN", 403);

  const buckets = await listTournamentBuckets(search, hiddenOnly ? { hiddenOnly: true } : {});
  return ok({ buckets });
}

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return fail("UNAUTHORIZED", 401);
  if (!can(user, "tournaments")) return fail("FORBIDDEN", 403);

  try {
    const body = (await req.json()) as TournamentInputBody & {
      startVisibilityAt?: string;
      registrationOpenAt?: string;
      registrationCloseAt?: string;
      startAt?: string;
    };

    const validation = validateTournamentInput(body);
    if ("error" in validation) return fail(validation.error, 400);
    // `phases` est exclu du spread : `createTournament` ne l'accepte pas à
    // `null` (seulement absent hors MULTI), contrairement au reste des champs.
    const { phases, ...input } = validation.value;

    const id = await createTournament(user.id, {
      ...input,
      startVisibilityAt: body.startVisibilityAt ?? "",
      registrationOpenAt: body.registrationOpenAt ?? "",
      registrationCloseAt: body.registrationCloseAt ?? "",
      startAt: body.startAt ?? "",
      ...(phases ? { phases } : {}),
    });

    return ok({ id }, 201);
  } catch (error) {
    const message = (error as Error).message;
    if (message === "INVALID_DATES" || message === "INVALID_DATE_ORDER") return fail(message, 400);
    if (PHASE_ERROR_CODES.has(message)) return fail(message, 400);
    return fail(message || "TOURNAMENT_CREATE_FAILED", 500);
  }
}
