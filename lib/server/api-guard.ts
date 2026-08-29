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
import {
  ANONYMOUS_IDENTITY,
  consumeRateLimit,
  rateLimitIdentity,
  type RateLimitRule,
} from "./rate-limit";
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
 * Ouvertures du flux temps réel, par utilisateur.
 *
 * Distinct du plafond de flux *simultanés* (`MAX_STREAMS_PER_USER`) : celui-ci
 * borne le rythme d'ouverture, que le premier laisse passer puisqu'une
 * fermeture libère aussitôt la place. Large : un onglet ouvre un flux et le
 * garde, une reconnexion en rafale est plafonnée par l'attente exponentielle.
 */
export const STREAM_OPEN_RULE: RateLimitRule = {
  name: "tournament-stream-open",
  limit: 30,
  windowMs: 60_000,
};

/**
 * Enregistrement d'une visite, par IP.
 *
 * Plafond de **requêtes**, distinct du plafond d'**insertions** appliqué par
 * `site-visits-service` : celui-ci borne le travail fait avant même de savoir
 * s'il y a une visite à enregistrer (résolution de session, lecture de la
 * fenêtre). Large — un visiteur normal envoie deux pings par heure.
 */
export const VISIT_REQUEST_RULE: RateLimitRule = {
  name: "site-visits-request",
  limit: 60,
  windowMs: 60_000,
};

/**
 * Applique un plafond. Renvoie la réponse 429 à retourner tel quel, ou `null`
 * si la requête peut continuer.
 *
 * **Une identité absente n'est pas plafonnée.** C'est délibéré : sans en-tête
 * de proxy — `next start` exposé directement, reverse-proxy déployé sans
 * `proxy_set_header X-Forwarded-For`, banc d'essai local — *tous* les visiteurs
 * partageraient sinon le même seau, et cent joueurs se verraient refuser la
 * page d'accueil au bout de 180 requêtes cumulées. Le garde-fou provoquerait la
 * panne qu'il doit éviter. On préfère ne pas compter que compter faux : la
 * borne de croissance de la table de fréquentation, elle, reste assurée côté
 * `site-visits-service`, qui plafonne les **insertions**.
 *
 * `Retry-After` est renseigné : un client correct saura attendre plutôt que
 * réessayer aussitôt.
 */
export function enforceRateLimit(
  rule: RateLimitRule,
  identity: string | number | null | undefined,
): NextResponse | null {
  const key = rateLimitIdentity(identity);
  if (key === ANONYMOUS_IDENTITY) return null;

  const state = consumeRateLimit(rule, key);
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
