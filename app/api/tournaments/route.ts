import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
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
import { readJsonBody } from "@/lib/server/request-body";
import type { TournamentBuckets } from "@/lib/shared/types";

/**
 * Corps sérialisé et empreinte, gardés **avec la valeur mise en cache** : la
 * liste mutualisée (`list-cache.ts`) rend le même objet à chaque lecteur tant
 * qu'elle n'est pas vidée, et le client relit toutes les minutes. Sans cela,
 * chaque relecture resérialisait toute la liste (descriptions comprises) et la
 * renvoyait entière pour un corps que le client jette quand rien n'a changé.
 * La clé est l'objet lui-même : vidée, la liste en recrée un, l'ancien corps
 * part avec lui. Seules les listes publiques mutualisées passent par ici : la
 * portée `hidden` (non publiée) sort plus tôt, en `no-store` et **sans**
 * empreinte — n'y en remettre aucune (copie sur le disque d'un poste partagé).
 */
const serializedLists = new WeakMap<TournamentBuckets, { body: string; etag: string }>();

function serializedList(buckets: TournamentBuckets): { body: string; etag: string } {
  let entry = serializedLists.get(buckets);
  if (!entry) {
    const body = JSON.stringify({ buckets });
    entry = { body, etag: `"${createHash("sha256").update(body).digest("base64url")}"` };
    serializedLists.set(buckets, entry);
  }
  return entry;
}

/** Les empreintes de la requête (`If-None-Match`), faibles ou non, sans guillemets. */
function matchesEtag(header: string | null, etag: string): boolean {
  if (!header) return false;
  return header.split(",").some((candidate) => {
    const value = candidate.trim();
    return value === "*" || value.replace(/^W\//, "") === etag;
  });
}

export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user) return fail("UNAUTHORIZED", 401);

  // Plafond large : la page se rafraîchit d'elle-même à la minute au plus vite
  // (`lib/shared/refresh-tiers.ts`). Seul un client parti en boucle l'atteint.
  const throttled = enforceRateLimit(TOURNAMENT_READ_RULE, user.id);
  if (throttled) return throttled;

  const url = new URL(req.url);
  // `scope=hidden` : les tournois programmés que personne ne voit encore.
  // Réservé au staff `tournaments` (ADMIN, ARBITRE) — sans quoi la date de
  // visibilité ne protégerait plus rien.
  const hiddenOnly = url.searchParams.get("scope") === "hidden";
  if (hiddenOnly && !can(user, "tournaments")) return fail("FORBIDDEN", 403);

  // `finished=all` : l'archive entière des tournois terminés, que la liste
  // courante tronque aux plus récents (`finishedTotals` dit ce qui manque).
  // `/tournois` ne la demande qu'une fois le lecteur allé la chercher.
  const allFinished = url.searchParams.get("finished") === "all";

  const finishedScope = allFinished ? { allFinished: true } : {};
  // Pas de paramètre `search` : le client filtre en mémoire la liste reçue, et
  // un terme libre contournait le cache partagé en chargeant toute l'archive.
  let buckets: TournamentBuckets;
  try {
    buckets = await listTournamentBuckets(null, hiddenOnly ? { hiddenOnly: true } : finishedScope);
  } catch (error) {
    // Un code, jamais la page d'erreur de Next ni le message de la base.
    console.error("[tournaments] lecture de la liste en échec", error);
    return fail("TOURNAMENT_LIST_FAILED", 500);
  }
  // `private` : la réponse dépend de la session (la lecture est refusée sans
  // elle, et `scope=hidden` au seul staff) — jamais rangée dans un cache partagé.
  // `no-cache` : le navigateur la garde mais la revalide à chaque lecture, d'où
  // le 304 sans corps quand la liste n'a pas bougé. Le refus d'accès passe
  // **avant** : une empreinte ne sert jamais un lecteur sans droit.
  // `scope=hidden` fait exception : `no-store`, sans empreinte. Ces tournois ne
  // sont pas encore publiés, et une copie gardée sur le disque d'un poste
  // partagé resterait lisible après la déconnexion du staff ; la liste,
  // rebâtie à chaque appel, ne profitait de toute façon d'aucun 304 côté serveur.
  if (hiddenOnly) {
    return NextResponse.json({ buckets }, { headers: { "Cache-Control": "private, no-store" } });
  }
  const { body, etag } = serializedList(buckets);
  const headers = { ETag: etag, "Cache-Control": "private, no-cache" };
  if (matchesEtag(req.headers.get("if-none-match"), etag)) {
    return new NextResponse(null, { status: 304, headers });
  }
  return new NextResponse(body, { status: 200, headers: { ...headers, "Content-Type": "application/json" } });
}

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return fail("UNAUTHORIZED", 401);
  if (!can(user, "tournaments")) return fail("FORBIDDEN", 403);

  try {
    const body = (await readJsonBody(req)) as TournamentInputBody & {
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
