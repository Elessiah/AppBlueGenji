import type { NextConfig } from "next";

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
 * Volontairement **pas** de `Content-Security-Policy` : Next injecte ses
 * propres scripts en ligne, une politique écrite à l'aveugle casserait la page
 * sans qu'aucun test ne le voie. Ni de `Strict-Transport-Security` : le
 * chiffrement se termine au reverse proxy, c'est à lui de l'annoncer — et posé
 * ici, il s'appliquerait aussi à un déploiement servi en clair.
 */
const SECURITY_HEADERS = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
];

const nextConfig: NextConfig = {
  async headers() {
    return [{ source: "/:path*", headers: SECURITY_HEADERS }];
  },
};

export default nextConfig;
