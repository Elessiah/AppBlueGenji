/**
 * Garde-fous de débit des routes API.
 *
 * Le site tient sur un Raspberry Pi. Le cache
 * (`lib/server/cache.ts`) rend les lectures répétées presque gratuites, mais
 * « presque » n'est pas « rien » : chaque requête coûte encore une
 * désérialisation, une résolution de session, une réponse à sérialiser. Un
 * navigateur qui martèle F5 — ou un onglet parti en boucle — doit finir par se
 * heurter à un mur poli plutôt que par faire tomber le site pour les
 * quatre-vingt-dix-neuf autres.
 *
 * Les plafonds sont **larges** : personne n'y touche en naviguant normalement.
 * Ils bornent l'anormal, ils ne disciplinent pas l'usage.
 */
import { NextResponse } from "next/server";
import { consumeRateLimit, rateLimitIdentity, type RateLimitRule } from "./rate-limit";
import { clientIpFromForwardedFor, parseTrustedProxyHops } from "@/lib/shared/site-visits";

/**
 * IP du client telle que l'a vue le proxy de confiance.
 *
 * Même lecture que le compteur de fréquentation (`X-Forwarded-For` parcouru
 * depuis la droite sur `TRUSTED_PROXY_HOPS` relais) : un en-tête forgé par le
 * client ne doit pas permettre de se fabriquer une identité neuve à chaque
 * requête, sans quoi le plafond ne borne plus rien.
 */
export function requestClientIp(req: Request): string | null {
  return (
    clientIpFromForwardedFor(
      req.headers.get("x-forwarded-for"),
      parseTrustedProxyHops(process.env.TRUSTED_PROXY_HOPS),
    ) ?? req.headers.get("x-real-ip")
  );
}

/** Lectures d'un utilisateur connecté : liste et détail des tournois. */
export const TOURNAMENT_READ_RULE: RateLimitRule = {
  name: "tournament-read",
  limit: 90,
  windowMs: 60_000,
};

/** Lectures publiques de la vitrine, par IP. */
export const LANDING_READ_RULE: RateLimitRule = {
  name: "landing-read",
  limit: 180,
  windowMs: 60_000,
};

/**
 * Applique un plafond. Renvoie la réponse 429 à retourner tel quel, ou `null`
 * si la requête peut continuer.
 *
 * `Retry-After` est renseigné : un client correct saura attendre plutôt que
 * réessayer aussitôt.
 */
export function enforceRateLimit(
  rule: RateLimitRule,
  identity: string | number | null | undefined,
): NextResponse | null {
  const state = consumeRateLimit(rule, rateLimitIdentity(identity));
  if (state.allowed) return null;

  return NextResponse.json(
    { error: "TOO_MANY_REQUESTS" },
    {
      status: 429,
      headers: {
        "Retry-After": String(Math.max(1, Math.ceil(state.retryAfterMs / 1000))),
        "Cache-Control": "no-store",
      },
    },
  );
}
