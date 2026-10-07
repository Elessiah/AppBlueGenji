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
 * le classement ; lot 6 : la connexion ; lot 5a : le bot et sa documentation ;
 * lot 5b : l'association, les bénévoles, le recrutement ; lot 7a : les
 * documents légaux du bot ; lot 7b-1 : conditions, mentions légales,
 * déclaration d'accessibilité ; lot 7b-2 : politique de confidentialité et
 * registre des traitements).
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
  // Lot 5b — reste de la vitrine. Le contenu saisi par le staff n'y est rendu
  // qu'avec son anglais (`lib/shared/staff-translation.ts`) : jamais de
  // français sur ces pages anglaises.
  "/association",
  "/benevoles",
  "/recrutement",
  // Redirection vers la section « Partenaires » de l'accueil, dans sa langue.
  "/partenaires",
  // Lot 7a — documents légaux du bot : chaque langue de `BilingualDoc` à son
  // adresse, texte repris tel quel. Les adresses françaises, déclarées au
  // portail développeur de Discord, ne changent pas.
  "/privacy-policy-bot",
  "/terms-of-service-bot",
  // Lot 7b-1 — textes légaux du site : conditions d'utilisation, mentions
  // légales, déclaration d'accessibilité. Le français, qui fait foi, est
  // inchangé ; l'anglais est une traduction qui le dit (`TranslationNotice`).
  // `TERMS_VERSION` ne bouge pas : accepter sous `/en`, c'est accepter la même
  // version.
  "/conditions-utilisation",
  "/mentions-legales",
  "/accessibilite",
  // Lot 7b-2 — politique de confidentialité (historique des changements
  // compris) et registre des traitements. L'export CSV du registre
  // (`/rgpd/registre.csv`) reste français : `/en/rgpd/registre.csv` répond 307.
  "/rgpd",
  "/rgpd/registre",
  // Lot 8a-1 — liste des tournois (espace sécurisé : `noindex`, hors sitemap,
  // comme en français). La carte « Connexion requise » suit la langue.
  "/tournois",
  // Lot 8a-2 — fiche d'un tournoi (consultation). `[id]` n'accepte qu'un
  // entier : `/tournois/creer` n'est pas une fiche. Ses gestes (inscription,
  // score, litiges, outils du staff) sont traduits au lot 8b-1.
  "/tournois/[id]",
  // Lot 8b-2 — création et édition d'un tournoi (staff, `noindex`, hors
  // sitemap). Restent français, annoncés `lang="fr"` : la modale de
  // recadrage commune au site et le réglage des notifications (lot 9).
  "/tournois/creer",
  "/tournois/[id]/modifier",
];
