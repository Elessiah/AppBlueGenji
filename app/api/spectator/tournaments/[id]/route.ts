import {
  clientNetworkKey,
  enforceRateLimit,
  requestClientIp,
  SPECTATOR_READ_RULE,
} from "@/lib/server/api-guard";
import { fail } from "@/lib/server/http";
import { acceptsGzip } from "@/lib/server/sse-gzip";
import { currentSpectatorLoadLevel, recordSpectatorRead } from "@/lib/server/spectator-load";
import {
  getSpectatorPayload,
  gzippedSpectatorBody,
  SpectatorRebuildRefused,
  staleSpectatorPayload,
  type SpectatorPayload,
} from "@/lib/server/spectator-snapshot";
import {
  parseTournamentId,
  SPECTATOR_FRESHNESS_HEADER,
  SPECTATOR_MAX_COPY_AGE_MS,
  SPECTATOR_POLL_HEADER,
  spectatorFreshnessMs,
  spectatorPollIntervalMs,
  spectatorUnavailableRetryMs,
  type SpectatorLoadLevel,
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
 *
 * Le prix d'une reconstruction (jeton du réseau, places de construction) se
 * décide dans `getSpectatorPayload`, au moment même où elle est lancée ; un
 * refus est servi par la dernière réponse si elle a moins de 150 s
 * (`SPECTATOR_MAX_COPY_AGE_MS`), sinon par le refus lui-même.
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

/**
 * Le visiteur sans compte recule le premier : il garde ce qu'il affiche et
 * revient après une attente que la charge allonge (une minute au calme, dix au
 * pire). Son relecteur double ensuite l'attente à chaque nouvel échec.
 */
function unavailable(level: SpectatorLoadLevel): Response {
  const retryMs = spectatorUnavailableRetryMs(level);
  const response = fail("TOURNAMENT_LOAD_FAILED", 503);
  for (const [name, value] of Object.entries(pollHeaders(retryMs))) response.headers.set(name, value);
  response.headers.set("Retry-After", String(retryMs / 1000));
  return response;
}

/**
 * La réponse à servir pour une reconstruction refusée.
 *
 * - **Plafond du réseau** (`rate`) : le refus `429`, pour tous — qu'une copie
 *   récente existe ou non, la réponse ne dit pas si quelqu'un d'autre vient de
 *   lire ce tournoi, et un réseau sans jeton ne tire plus de corps de la copie
 *   (bande passante plafonnée). La seule exception est le `304` : un client qui
 *   détient déjà la version de la copie apprend qu'elle n'a pas bougé, sans
 *   corps. La copie est alors rendue, et le chemin commun répond `304`.
 * - **Places prises** (`busy`, toutes adresses confondues) : la copie récente
 *   si elle existe, sinon `503`.
 */
function refusedRead(
  tournamentId: number,
  refusal: SpectatorRebuildRefused,
  level: SpectatorLoadLevel,
  ifNoneMatch: string | null,
): SpectatorPayload | Response {
  const stale = staleSpectatorPayload(tournamentId);
  if (refusal.kind === "rate") {
    if (stale && matchesEtag(ifNoneMatch, etagOf(stale))) return stale;
    return refusal.response ?? unavailable(level);
  }
  return stale ?? refusal.response ?? unavailable(level);
}

/** `ETag` fort de la réponse, un par codage (le corps gzip porte le suffixe `-gzip`). */
function etagOf(payload: SpectatorPayload, gzip = false): string {
  return `"${payload.version}${gzip ? "-gzip" : ""}"`;
}

/**
 * La réponse publique à servir, ou la réponse d'erreur : reconstruction refusée
 * ({@link refusedRead}), base injoignable (la copie de moins de 150 s tient la
 * page, sinon `503`). `stale` : la copie servie est périmée, son âge annoncé
 * passe au maximum déclaré.
 */
async function readPayload(
  req: Request,
  tournamentId: number,
  level: SpectatorLoadLevel,
  client: string | null,
): Promise<{ payload: SpectatorPayload | null; stale: boolean } | Response> {
  try {
    return { payload: await getSpectatorPayload(tournamentId, level, client), stale: false };
  } catch (error) {
    if (error instanceof SpectatorRebuildRefused) {
      const served = refusedRead(tournamentId, error, level, req.headers.get("if-none-match"));
      return served instanceof Response ? served : { payload: served, stale: true };
    }
    // Base injoignable ou saturée : la copie de moins de 150 s tient la page
    // (sinon les spectateurs passaient en « réessaie » alors que le plateau
    // de la minute précédente était encore là).
    console.error("[spectator] lecture publique impossible :", error);
    const copy = staleSpectatorPayload(tournamentId);
    return copy === null ? unavailable(level) : { payload: copy, stale: true };
  }
}

export async function GET(req: Request, context: { params: Promise<{ id: string }> }) {
  // Un réseau, pas une adresse : un hôte IPv6 qui tourne dans son `/64` reste
  // un seul client (plafonds et part dans la charge).
  const client = clientNetworkKey(requestClientIp(req));
  const throttled = enforceRateLimit(SPECTATOR_READ_RULE, client);
  if (throttled) return throttled;

  const { id } = await context.params;
  const tournamentId = parseTournamentId(id);
  if (tournamentId === null) return fail("INVALID_TOURNAMENT_ID", 400);
  const level = currentSpectatorLoadLevel();

  const read = await readPayload(req, tournamentId, level, client);
  if (read instanceof Response) return read;
  const { payload, stale } = read;
  if (!payload) return fail("TOURNAMENT_NOT_FOUND", 404);
  // Seules les lectures d'un tournoi servi pèsent dans la charge : des
  // identifiants au hasard ne ralentissent pas les vrais spectateurs, et la
  // part d'un même réseau est plafonnée (`SPECTATOR_READS_PER_CLIENT`).
  recordSpectatorRead(Date.now(), client);

  const pollMs = spectatorPollIntervalMs(payload.state, level);
  // Une copie servie périmée peut avoir jusqu'à l'âge déclaré : c'est lui que
  // le témoin annonce alors, pas la durée de vie qu'elle avait reçue.
  const ageMs = stale ? SPECTATOR_MAX_COPY_AGE_MS : payload.ttlMs;
  const gzipped = acceptsGzip(req.headers.get("accept-encoding"));
  // Un `ETag` par codage (RFC 9110) : un cache partagé qui revalide ne sert pas
  // le corps gzip à qui attend le corps brut.
  const etag = etagOf(payload, gzipped);
  const headers = {
    ...pollHeaders(pollMs),
    [SPECTATOR_FRESHNESS_HEADER]: String(spectatorFreshnessMs(pollMs, ageMs)),
    ETag: etag,
    Vary: "Accept-Encoding",
  };
  if (matchesEtag(req.headers.get("if-none-match"), etag)) {
    return new Response(null, { status: 304, headers });
  }
  const jsonHeaders = { ...headers, "Content-Type": "application/json; charset=utf-8" };
  if (gzipped) {
    // Compressé une fois pour tous ses lecteurs ; Next laisse passer une
    // réponse déjà encodée sans la recompresser.
    const bytes = await gzippedSpectatorBody(payload);
    return new Response(bytes, { status: 200, headers: { ...jsonHeaders, "Content-Encoding": "gzip" } });
  }
  return new Response(payload.body, { status: 200, headers: jsonHeaders });
}
