import { enforceRateLimit, requestClientIp, SPECTATOR_READ_RULE } from "@/lib/server/api-guard";
import { fail } from "@/lib/server/http";
import { currentSpectatorLoadLevel, recordSpectatorRead } from "@/lib/server/spectator-load";
import { getSpectatorPayload } from "@/lib/server/spectator-snapshot";
import {
  parseTournamentId,
  SPECTATOR_MAX_POLL_MS,
  SPECTATOR_FRESHNESS_HEADER,
  SPECTATOR_POLL_HEADER,
  spectatorCacheTtlMs,
  spectatorFreshnessMs,
  spectatorPollIntervalMs,
} from "@/lib/shared/spectator-view";

/**
 * Lecture publique d'un tournoi, pour la fiche sans compte
 * (`/suivre/tournois/[id]`, `docs/features/SPECTATOR_VIEW.md`).
 *
 * **Lecture seule, aucune session lue** : la route ne connaît pas le lecteur et
 * ne calcule aucun contexte — c'est la séparation voulue avec l'espace
 * connecté, où vivent toutes les actions. Le serveur décide de la prochaine
 * lecture (`x-bg-poll-after-ms`) selon sa charge, et répond `304` sans corps
 * quand rien n'a bougé depuis la version que le client détient.
 */
export const dynamic = "force-dynamic";

/** `If-None-Match` désigne-t-il cette version ? (liste, faibles compris, `*`) */
function matchesEtag(header: string | null, etag: string): boolean {
  if (!header) return false;
  return header
    .split(",")
    .map((tag) => tag.trim().replace(/^W\//, ""))
    .some((tag) => tag === "*" || tag === etag);
}

function pollHeaders(pollAfterMs: number): Record<string, string> {
  return { "Cache-Control": "no-store", [SPECTATOR_POLL_HEADER]: String(pollAfterMs) };
}

export async function GET(req: Request, context: { params: Promise<{ id: string }> }) {
  const throttled = enforceRateLimit(SPECTATOR_READ_RULE, requestClientIp(req));
  if (throttled) return throttled;

  const { id } = await context.params;
  const tournamentId = parseTournamentId(id);
  if (tournamentId === null) return fail("INVALID_TOURNAMENT_ID", 400);

  const level = currentSpectatorLoadLevel();

  let payload;
  try {
    payload = await getSpectatorPayload(tournamentId, spectatorCacheTtlMs(level));
  } catch (error) {
    // Base injoignable ou saturée : le visiteur sans compte est le premier à
    // reculer — il garde ce qu'il affiche et revient au plus tard possible.
    console.error("[spectator] lecture publique impossible :", error);
    const response = fail("TOURNAMENT_LOAD_FAILED", 503);
    for (const [name, value] of Object.entries(pollHeaders(SPECTATOR_MAX_POLL_MS))) response.headers.set(name, value);
    response.headers.set("Retry-After", String(SPECTATOR_MAX_POLL_MS / 1000));
    return response;
  }
  if (!payload) return fail("TOURNAMENT_NOT_FOUND", 404);
  // Seules les lectures d'un tournoi servi pèsent dans la charge : des
  // identifiants au hasard ne ralentissent pas les vrais spectateurs.
  recordSpectatorRead();

  const etag = `"${payload.version}"`;
  const pollMs = spectatorPollIntervalMs(payload.state, level);
  const headers = {
    ...pollHeaders(pollMs),
    [SPECTATOR_FRESHNESS_HEADER]: String(spectatorFreshnessMs(pollMs, payload.ttlMs)),
    ETag: etag,
  };
  if (matchesEtag(req.headers.get("if-none-match"), etag)) {
    return new Response(null, { status: 304, headers });
  }
  return new Response(payload.body, {
    status: 200,
    headers: { ...headers, "Content-Type": "application/json; charset=utf-8" },
  });
}
