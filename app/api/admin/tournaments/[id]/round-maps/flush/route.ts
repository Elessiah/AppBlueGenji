import { getCurrentUser } from "@/lib/server/auth";
import { fail, ok } from "@/lib/server/http";
import { parseMatchIdParam } from "@/lib/server/tournaments/match-launch-routes";
import { flushRoundMapsNotice } from "@/lib/server/tournaments/round-maps-notice";
import { readOptionalJsonBody } from "@/lib/server/request-body";
import { can } from "@/lib/shared/permissions";
import { ROUND_MAPS_FLUSH_ROUNDS_MAX } from "@/lib/shared/round-maps";

/** 1024 clés de 31 caractères (ASCII) au plus, guillemets et virgules compris : au-delà, le corps n'est pas lu. */
const BODY_MAX_BYTES = 40_000;
const ROUND_KEY_PATTERN = /^\d{1,9}:[A-Z_]{1,16}:\d{1,4}$/;

/**
 * Manches que l'écran déclare avoir écrites (corps `{ rounds: string[] }`) :
 * `undefined` sans corps ni liste (ancien client : tout part), un refus si la
 * liste est mal formée (`INVALID_ROUNDS`), le corps trop lourd (413) ou d'un
 * autre type que JSON (415). La lecture est bornée **avant** d'être gardée en
 * mémoire (`readOptionalJsonBody`).
 */
async function ownRoundsOf(req: Request): Promise<{ rounds: string[] | undefined } | { refusal: string }> {
  const read = await readOptionalJsonBody(req, "INVALID_ROUNDS", BODY_MAX_BYTES);
  if ("refusal" in read) return read;
  const body = read.body;
  if (typeof body !== "object" || body === null) return { refusal: "INVALID_ROUNDS" };
  const { rounds } = body as { rounds?: unknown };
  if (rounds === undefined) return { rounds: undefined };
  if (!Array.isArray(rounds) || rounds.length > ROUND_MAPS_FLUSH_ROUNDS_MAX) return { refusal: "INVALID_ROUNDS" };
  if (!rounds.every((key) => typeof key === "string" && ROUND_KEY_PATTERN.test(key))) return { refusal: "INVALID_ROUNDS" };
  return { rounds: rounds as string[] };
}

/**
 * Fermeture de l'écran des cartes : envoie tout de suite l'annonce Discord en
 * attente (`round-maps-notice.ts`). Un simple accélérateur — sans cet appel
 * (onglet fermé), la fenêtre de silence échue l'envoie quand même. Le corps
 * liste les manches écrites par l'écran : une annonce qui en porte d'autres
 * (un autre membre du staff règle encore sa série) n'est pas devancée.
 */
export async function POST(req: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return fail("UNAUTHORIZED", 401);
  if (!can(user, "tournaments")) return fail("FORBIDDEN", 403);
  const tournamentId = parseMatchIdParam((await context.params).id);
  if (tournamentId === null) return fail("INVALID_TOURNAMENT_ID", 400);
  const own = await ownRoundsOf(req);
  if ("refusal" in own) return fail(own.refusal, 400);
  try {
    return ok({ sent: await flushRoundMapsNotice(tournamentId, own.rounds) });
  } catch {
    return fail("ROUND_MAPS_FAILED", 500);
  }
}
