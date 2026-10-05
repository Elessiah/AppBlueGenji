import path from "node:path";
import type { NextConfig } from "next";

/**
 * Configuration par requête de `next-intl` (messages et formats, **sans son
 * routage** — `docs/features/I18N.md`), que la bibliothèque importe sous le nom
 * `next-intl/config`.
 *
 * Désignée par deux alias, et non par `createNextIntlPlugin` : le greffon ne
 * fait rien d'autre pour ce site, mais son module charge à l'import l'extracteur
 * de messages, donc le binaire natif de `@swc/core` — un binaire de plus à
 * réussir à charger à chaque `next build`, `next dev` et lecture de ce fichier
 * (tests compris), pour une fonction qu'on n'utilise pas.
 */
const I18N_REQUEST_CONFIG = "./lib/server/i18n-request.ts";

/**
 * En-têtes de sécurité posés sur **toutes** les réponses.
 *
 * Le site n'en envoyait aucun. Trois manquaient vraiment, et ce sont les trois
 * qui ne demandent aucune adaptation du code :
 *
 * - `X-Content-Type-Options: nosniff` — le site sert des fichiers téléversés
 *   (`/api/uploads/…`) et une image relayée depuis un CDN tiers
 *   (`/api/landing/sponsors/[id]/logo`, qui le pose déjà pour son compte).
 *   Tous sont réencodés ou filtrés par type, mais l'interdiction de deviner un
 *   type plus permissif que celui qu'on annonce ne doit pas dépendre de la
 *   route qui a pensé à l'écrire.
 * - `Referrer-Policy: strict-origin-when-cross-origin` — sans elle, l'URL
 *   complète part chez le tiers qu'on visite. Les fiches de tournoi, d'équipe
 *   et de joueur portent des identifiants dans leur chemin, et la page de
 *   connexion porte sa destination en paramètre.
 * - `X-Frame-Options: SAMEORIGIN` — le site n'a aucune fonction d'intégration,
 *   donc rien à perdre. `SameSite=lax` sur le cookie de session couvre déjà
 *   l'essentiel (il ne part pas dans un cadre d'un autre domaine, la page
 *   encadrée s'y affiche déconnectée) ; celui-ci ferme le cas résiduel et ne
 *   coûte rien.
 *
 * La `Content-Security-Policy` n'est **pas** ici, et pas par omission : elle
 * porte un nonce qui change à chaque réponse, alors que cette liste est
 * statique. Elle vit donc dans le middleware, seul endroit qui voie une
 * requête — voir `middleware.ts` et `lib/shared/csp.ts`.
 *
 * Toujours pas de `Strict-Transport-Security` : le chiffrement se termine au
 * reverse proxy, c'est à lui de l'annoncer — et posé ici, il s'appliquerait
 * aussi à un déploiement servi en clair.
 */
const SECURITY_HEADERS = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
];

const nextConfig: NextConfig = {
  /**
   * Ne pas annoncer le serveur qui rend la page.
   *
   * Next pose `X-Powered-By: Next.js` sur **toutes** ses réponses, et la
   * production le servait à chaque visiteur. Ce n'est pas une faille : c'est un
   * renseignement offert, qui dit quelle famille d'avis de sécurité consulter
   * avant même d'avoir sondé le site.
   *
   * Corrigé **ici** et non dans nginx, alors que le reverse proxy sait le
   * retirer (`proxy_hide_header`) : cette configuration-là n'est pas versionnée
   * dans ce dépôt, elle est partagée avec un autre site, et elle ne suivrait
   * pas un déploiement fait ailleurs. Les trois `proxy_hide_header` qui y
   * figurent servent d'ailleurs un tout autre but — ils écartent les doublons
   * des en-têtes que nginx repose lui-même, pas celui-ci, qu'aucun des deux
   * n'émettait.
   */
  poweredByHeader: false,

  /**
   * Le bouton « N » des outils de développement de Next occupait le coin
   * bas-gauche, **sous** le bouton d'accessibilité, et interceptait ses clics.
   * Sans effet en production, où l'indicateur n'existe pas.
   */
  devIndicators: { position: "top-right" },

  // `next-intl/config` → {@link I18N_REQUEST_CONFIG}, pour Turbopack (`next
  // dev`, chemin relatif exigé) comme pour webpack (`next build`, chemin absolu).
  turbopack: { resolveAlias: { "next-intl/config": I18N_REQUEST_CONFIG } },
  webpack(config: { context?: string; resolve?: { alias?: Record<string, string> } }) {
    config.resolve ??= {};
    config.resolve.alias = {
      ...config.resolve.alias,
      "next-intl/config": path.resolve(config.context ?? process.cwd(), I18N_REQUEST_CONFIG),
    };
    return config;
  },

  async headers() {
    return [{ source: "/:path*", headers: SECURITY_HEADERS }];
  },
};

export default nextConfig;
