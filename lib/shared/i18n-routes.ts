/**
 * Liste blanche des routes **traduites** — la seule porte vers une page `/en/…`.
 *
 * Une route n'entre ici que dans la PR qui extrait **tous** ses textes en clés
 * de traduction et rédige leur anglais (`docs/features/I18N.md`). Tant qu'elle
 * n'y est pas :
 *
 * - `/en/<route>` répond **307** vers `/<route>` (`middleware.ts`) : jamais un
 *   contenu français servi sous une adresse anglaise, que les moteurs
 *   prendraient pour un doublon ;
 * - aucun lien n'y mène en anglais (`localeHref`), le sélecteur de langue se
 *   tait, ni `hreflang` ni entrée anglaise au sitemap.
 *
 * Un motif est un chemin sans préfixe de langue ; un segment `[x]` vaut un
 * segment quelconque (`/regles/[slug]`). Le lot 0 l'a laissée vide ; chaque lot
 * de pages y ajoute ses routes (lot 2 : l'accueil ; lot 3 : les règles ; lot 4 :
 * le classement ; lot 6 : la connexion ; lot 5a : le bot et sa documentation).
 *
 * Module à part de `locales.ts` pour que les tests puissent simuler une liste
 * remplie sans toucher aux fonctions qui la lisent.
 */
export const MIGRATED_ROUTES: readonly string[] = [
  // Lot 2 — accueil. Ses textes éditables servent l'anglais enregistré ou
  // l'anglais d'origine, jamais le français (`resolveSiteCopy`).
  "/",
  // Lot 3 — règles.
  "/regles",
  "/regles/[slug]",
  // Lot 4 — classement. Titre et sous-titre éditables : anglais du lot 2.
  "/classement",
  // Lot 6 — connexion (page, refus, exposé de suspension, modale d'entrée).
  // `noindex` et hors sitemap dans les deux langues, comme avant.
  "/connexion",
  // Lot 5a — page du bot et sa documentation. Le guide sert `help.md` sous
  // `/en` ; les pages réservées au staff, françaises seulement, y sont
  // annoncées `lang="fr"` (`lib/shared/bot-doc-sections.ts`).
  "/bot",
  "/bot/docs",
  "/bot/docs/[slug]",
];
