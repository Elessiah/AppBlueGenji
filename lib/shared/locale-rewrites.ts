/**
 * Réécriture des adresses anglaises vers la route sans préfixe
 * (`docs/features/I18N.md` § Middleware), servie par `rewrites()` de
 * `next.config.ts`.
 *
 * Le middleware **décide** (route traduite ou non, `/en/api/…` refusé) et
 * marque la requête `x-bg-locale: en` ; Next **réécrit** ici, sur la foi de
 * cette marque. Une réécriture de configuration ne porte qu'un chemin, là où
 * celle du middleware porte une adresse absolue que Next prenait pour externe
 * derrière le mandataire TLS (500 sur toute page anglaise, production,
 * 2026-10-06 — voir `forward` dans `middleware.ts`).
 *
 * Deux verrous, et les deux sont voulus :
 * - **`has`** : seule une requête que le middleware a marquée anglaise est
 *   réécrite. Il remplace toujours `x-bg-locale` reçu d'un client, et toute
 *   adresse `/en/…` passe par lui (troisième entrée du `matcher`, les
 *   préchargements compris) : une route pas encore traduite part en 307 avant
 *   d'arriver ici.
 * - **`/api` exclu du motif** : même si le middleware cessait un jour de voir
 *   `/en/api/…`, la réécriture ne mènerait pas à `/api/…`, que le contrôle de
 *   provenance des écritures ne garde que sous son vrai chemin. Le motif de
 *   Next ignore la casse : l'exclusion aussi.
 *
 * Module pur, sans alias `@/` : `next.config.ts` l'importe avant toute
 * résolution d'alias.
 */
import { LOCALE_HEADER } from "./locales";

/** Une règle de `rewrites()` (sous-ensemble du type de Next). */
export type LocaleRewrite = {
  source: string;
  destination: string;
  has: { type: "header"; key: string; value: string }[];
};

const MARKED_ENGLISH = [{ type: "header" as const, key: LOCALE_HEADER, value: "en" }];

export const LOCALE_REWRITES: readonly LocaleRewrite[] = [
  { source: "/en", destination: "/", has: MARKED_ENGLISH },
  { source: "/en/:path((?!api(?:/|$)).+)", destination: "/:path", has: MARKED_ENGLISH },
];
