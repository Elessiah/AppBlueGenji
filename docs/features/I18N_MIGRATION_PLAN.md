# Site bilingue FR/EN — plan de migration

> **Statut : plan, rien n'est implémenté.** Décision du 2026-10-05 : le site devient bilingue
> avec des **adresses indexées distinctes** par langue. Ce document mesure le chantier, fixe le
> choix technique et découpe le travail en lots livrables chacun en une PR. Chaque point marqué
> **« décision requise »** attend un arbitrage avant le lot qui en dépend.

## Forme retenue (rappel de la décision)

- **Français** : adresses actuelles, **sans préfixe** (`/regles`, `/classement`…) — rien
  d'existant ne casse, aucun lien externe ni signet n'est perdu.
- **Anglais** : sous `/en/...` (`/en/regles`, `/en/classement`…).
- `hreflang` + `canonical` + sitemap **par langue** ; sélecteur de langue visible.
- **Jamais** de redirection automatique sur `Accept-Language` ni sur un cookie : un robot doit
  voir les deux versions, et l'URL est la **seule source de vérité** de la langue d'une page.
- Migration **progressive** : pages publiques (SEO) d'abord, espace connecté ensuite.

## État des lieux (re-vérifié le 2026-10-05 sur `main`)

| Constat | Où | Conséquence |
|---|---|---|
| Aucune bibliothèque i18n installée | `package.json` | Choix libre (§ Choix technique). |
| Tout le texte d'interface est écrit en dur en français, au tutoiement | `app/`, `components/`, `lib/shared/` | Extraction complète, ~5 100 chaînes (§ Mesure). |
| `<html lang="fr">` écrit en dur | `app/layout.tsx` | À dériver de la langue de la requête. |
| Le layout racine lit `headers()` (nonce CSP) : **tout le site est rendu dynamiquement** | `app/layout.tsx` | Lire la langue dans un en-tête de requête ne coûte rien de plus — aucun rendu statique n'est perdu. |
| Le middleware tire le nonce, pose la CSP, `x-pathname`, l'avis de suspension, efface `g_state`, garde les écritures `/api/` | `middleware.ts` | Le routage de langue s'y **greffe**, il ne le remplace pas. |
| SEO : `app/sitemap.ts` (liste tenue par `lib/shared/sitemap.ts`), `app/robots.ts`, JSON-LD (`lib/shared/structured-data.ts`), `pageMetadata()` qui pose `alternates.canonical` (`lib/shared/page-metadata.ts`) | — | `pageMetadata()` est le point unique où ajouter `alternates.languages`. |
| Textes éditables : `<EditableCopy>` + `lib/shared/site-copy.ts`, valeurs en base `bg_settings` sous `copy_<clé>` | `EDITABLE_SITE_COPY.md` | Il faut une valeur par langue (§ Textes éditables). |
| Erreurs d'API : la réponse ne porte **qu'un code** (`fail`), traduit côté client par des tables code → phrase | `lib/shared/api-error-code.ts`, `app/(secured)/**/_lib/*-errors.ts`, `tournois/[id]/_lib/error-map.ts` | Très favorable : les tables deviennent des clés `errors.<CODE>`, l'API ne bouge pas. |
| Espace connecté : `AuthGate` rend une carte « Connexion requise » en 200 ; ni les tournois ni les fiches équipe/joueur ne sont au sitemap | `app/(secured)/layout.tsx`, `lib/shared/sitemap.ts` | Aucune valeur SEO en `/en` pour ces pages — elles viennent après. |
| Pluriels faits main (`plural()`, `pluralSuffix()` qui ajoutent un `s`) | `lib/shared/plural.ts` + ~100 ternaires `=== 1 ? … : …` | À remplacer par ICU (`{count, plural, …}`). |
| Dates/nombres : 90 appels `fr-FR` / `toLocale*String` / `Intl.*` dans 31 fichiers | dont `lib/shared/dates.ts` | Un formateur unique par langue. |
| Pas de courriel envoyé par le site | — | Hors périmètre. |
| Documents du bot déjà bilingues : `/privacy-policy-bot`, `/terms-of-service-bot` (`lib/shared/bot-legal-content.ts`) ; doc du bot servie depuis `help.md` / `helpfr.md` du dépôt `blueGenjiBot` | — | Contenus anglais déjà disponibles, à brancher sur `/en`. |

## 1. Mesure (scriptée)

Script jetable (non commité) : parcours de `app/`, `components/`, `lib/` en `.ts`/`.tsx`, hors
tests, docs et seed ; commentaires retirés ; compte (a) les nœuds texte JSX, (b) les littéraux
des props d'interface (`aria-label`, `ariaLabel`, `title`, `placeholder`, `alt`, `label`,
`description`), (c) les autres littéraux reconnus comme français (accent, mot-outil français, ou
phrase capitalisée), SQL, chemins, codes et classes CSS exclus. **Ordre de grandeur, pas
inventaire** : un texte JSX coupé par une interpolation (`{n} appareils abonnés à ton compte`)
n'est pas compté (sous-estimation des nœuds JSX, ~+20 %), quelques littéraux techniques à
accent passent (surestimation des « autres littéraux » côté `lib/server`).

| Zone | Fichiers | Nœuds JSX | Props UI | Autres littéraux | **Chaînes** | **~Mots** |
|---|---:|---:|---:|---:|---:|---:|
| P0 Textes éditables (défauts `site-copy.ts`) | 1 | 0 | 5 | 10 | 15 | 211 |
| P1 Vitrine (accueil, association, bénévoles, partenaires, recrutement, bot, OG, pages d'erreur) | 43 | 133 | 48 | 256 | 437 | 2 309 |
| P2 Règles (`/regles`, `tournament-rules.ts`, `components/rules`) | 7 | 44 | 81 | 201 | 326 | 4 100 |
| P3 Classement (`/classement`, `components/stats`) | 4 | 13 | 27 | 33 | 73 | 369 |
| P4 Connexion | 5 | 15 | 3 | 32 | 50 | 435 |
| C1 Composants partagés (nav, `ui/`, accessibilité, notifications…) | 19 | 41 | 11 | 48 | 100 | 497 |
| C2 `lib/shared` (libellés de formats/états, tables d'erreurs, formats) | 81 | 0 | 113 | 633 | 746 | 6 319 |
| T Tournois (pages `(secured)/tournois`, `match-launch`) | 86 | 215 | 84 | 697 | 996 | 6 265 |
| U Espace connecté (équipes, joueurs, profil, signalements) | 41 | 176 | 54 | 311 | 541 | 3 677 |
| A Admin | 6 | 16 | 9 | 62 | 87 | 455 |
| S7 Notifications push (`push-messages.ts`, `push-notifications.ts`) | 2 | 0 | 28 | 51 | 79 | 582 |
| S8 Discord / bot côté serveur (`discord-notifications`, `bot-logs`, `staff-audit`, `notify`…) | 4 | 0 | 1 | 29 | 30 | 158 |
| S9 Routes `app/api` | 23 | 0 | 0 | 34 | 34 | 205 |
| S9 `lib/server` (autre) | 74 | 0 | 18 | 304 | 322 | 2 330 |
| **L Légal / RGPD** (voir ci-dessous) | 21 | 322 | 126 | 837 | **1 285** | **22 803** |
| **Total** | **417** | | | | **~5 100** | **~50 700** |

Hors légal : **~3 800 chaînes, ~28 000 mots**. Les métadonnées (`title`/`description` de page)
vivent dans 34 fichiers, déjà comptées ci-dessus.

**Lecture.** Les 322 chaînes de `lib/server` (hors API) sont surtout des journaux pm2 et des
libellés internes : à **trier** au lot qui touche chaque fichier — un texte destiné au journal
reste en français, un texte qui finit à l'écran devient un code ou une clé. Les routes `api/`
n'ont que 34 littéraux : la règle « une erreur ne porte qu'un code » paie ici.

### Périmètre des canaux hors page

| Canal | Proposition | Justification |
|---|---|---|
| Toasts / erreurs d'API | **Dans le périmètre**, résolus côté client par la langue de la page | L'API ne renvoie que des codes ; rien ne change côté serveur. |
| Notifications push | **Dans le périmètre, lot tardif** : langue = préférence du compte | Une push n'a pas d'URL d'où lire la langue. **Décision requise** (D5). |
| Messages Discord (bot, annonces, journaux staff) | **Hors périmètre, restent en français** | Communauté Discord francophone ; le bot gère déjà sa propre langue (`help.md` / `helpfr.md`). **Décision requise** (D6). |
| Journaux pm2 | Hors périmètre (français) | Lus par l'équipe seulement. |
| Courriels | Sans objet | Le site n'en envoie pas. |

### Textes légaux — **décision requise** (D1)

| Texte | Source | Remarque |
|---|---|---|
| Mentions légales | `app/mentions-legales/` | Obligation française (LCEN). |
| Conditions d'utilisation | `app/conditions-utilisation/`, `lib/shared/terms-of-use.ts` (`TERMS_VERSION = 3`) | Contrat accepté : une version anglaise a valeur juridique. Avancer `TERMS_VERSION` pour une simple traduction ferait ré-accepter tout le monde — à éviter. |
| Politique RGPD | `app/rgpd/`, `lib/shared/rgpd-policy.ts`, `lib/shared/privacy-changes.ts` | Information due « dans des termes clairs » (art. 12 RGPD) au public visé — un public anglophone visé plaide pour une version anglaise. |
| Registre des traitements | `app/rgpd/registre/`, `lib/shared/processing-register.ts` | Document de conformité, destiné d'abord à la CNIL. |
| Déclaration d'accessibilité | `app/accessibilite/`, `lib/shared/accessibility-statement.ts` | Format réglementaire français (RGAA). |
| Documents du bot | `/privacy-policy-bot`, `/terms-of-service-bot` | **Déjà bilingues** — seulement à exposer aussi sous `/en`. |

Options : **(a)** tout traduire, la version française faisant foi (mention en tête de chaque
page anglaise) ; **(b)** garder les textes en français seulement, avec une **page anglaise de
synthèse** (« Legal summary ») qui renvoie aux originaux ; **(c)** traduire CGU et RGPD (ce que
l'utilisateur accepte ou doit comprendre), garder mentions légales, registre et déclaration
d'accessibilité en français avec un résumé anglais. **Recommandation : (c)**, relue par un
humain compétent, avec la clause « la version française fait foi ». Quel que soit le choix, la
traduction ne change pas `TERMS_VERSION` ; toute modification **de fond** ultérieure doit être
portée dans les deux langues dans la même PR (test de parité, § Garde-fous).

## 2. Choix technique

### Bibliothèque : `next-intl` 4.x — confirmé, **sans son routage**

- Compatible : `next-intl` 4.14.9 déclare `next ^15` et `react ^18` en pairs (vérifié par
  `npm view` le 2026-10-05) ; Next 15.5.27 et React 18.3 sont couverts.
- Apporte ce qu'on écrirait sinon à la main : messages ICU (pluriels, `select`), formatage de
  dates/nombres par langue, API serveur (`getTranslations`) et client (`useTranslations`),
  messages **typés** par augmentation de module (`AppConfig.Messages = typeof fr`).
- Alternatives écartées : `react-i18next`/`i18next` (pensé client d'abord, RSC à la main) ;
  `@lingui` (macro de compilation, ajoute une chaîne SWC/Babel à un projet qui n'en a pas) ;
  solution maison (ICU et typage à refaire).

**Le routage, en revanche, reste à nous.** Le routage de `next-intl` impose de déplacer **tout**
`app/` sous `app/[locale]/` (~400 fichiers déplacés, historique et PR en cours cassés, conflit
certain avec le travail parallèle) et remplace le middleware par le sien, qu'il faut ensuite
recomposer avec le nonce CSP. Proposition plus légère, compatible avec `localePrefix:
'as-needed'` dans l'esprit :

1. **Middleware** (`middleware.ts`) : si le chemin commence par `/en` (exactement `/en` ou
   `/en/`), **réécrire** (`NextResponse.rewrite`) vers le même chemin sans préfixe et poser
   l'en-tête de requête `x-bg-locale: en` (sinon `fr`) — **au même endroit** que le nonce,
   `content-security-policy` et `x-pathname`, dans les mêmes `requestHeaders`. L'en-tête reçu
   d'un client est toujours retiré (comme `SUSPENSION_NOTICE_HEADER`). `/fr/...` → **308** vers
   l'adresse sans préfixe (une seule URL par contenu). `x-pathname` reçoit le chemin **sans
   préfixe** (le layout le compare à `/recrutement` pour taire la mise en avant ; le sélecteur
   en dérive l'équivalent), la langue voyageant à part dans `x-bg-locale`.
   **`/api/` ne prend jamais de préfixe — règle explicite, testée** : `/en/api/...` répond
   **404** dans le middleware, jamais réécrit. Sinon un `POST /en/api/...` intersite serait
   réécrit vers `/api/...` sans passer par `guardApiRequest`, qui ne garde que les chemins
   commençant par `/api/` (contournement du 403 `CROSS_SITE_REQUEST`).
   **Préchargement** : le premier `matcher` exclut aujourd'hui les requêtes portant
   `next-router-prefetch` ou `purpose: prefetch` ; un préchargement de `/en/regles` ne serait
   donc pas réécrit et viserait une route inexistante (404 mis en cache, navigation client
   cassée). Le lot 0 ajoute une entrée de `matcher` dédiée à `/en/:path*` **sans** cette
   exclusion ; sur un préchargement, le middleware fait la réécriture **et** pose
   `x-bg-locale: en` (en retirant celui du client, comme partout), sans tirer de nonce — sinon
   la page préchargée serait rendue en français puis réutilisée à la navigation. Pas de repli
   par `rewrites` de `next.config.ts` : ces réécritures passent **après** le middleware, qui
   verrait `/en/api/...` sans le garder (contournement ci-dessus) et ne poserait pas la langue.
   **Avis de suspension** : le cookie est posé avec `path: "/connexion"` (`oauth-flow.ts`) et le
   middleware compare `pathname === "/connexion"` sur le chemin **demandé** ; sous
   `/en/connexion` le motif ne serait ni envoyé ni effacé. La comparaison se fait sur le chemin
   sans préfixe, et le cookie prend `path: "/"` limité par le contrôle de chemin du middleware
   (ou un second cookie par langue) — tranché et testé au lot 6, `/en/connexion` restant hors
   liste blanche d'ici là.
2. **Arborescence inchangée** : `app/regles/page.tsx` sert `/regles` et `/en/regles`.
3. **`next-intl` « sans routage »** : `i18n/request.ts` → `getRequestConfig` lit
   `x-bg-locale` dans `headers()` (déjà lu par le layout : aucun coût de rendu) et charge les
   messages de la langue.
4. **Liste blanche des routes migrées** (`lib/shared/locales.ts`) : `/en/<x>` pour une route
   pas encore traduite → **307 vers `/<x>`** (pas un contenu français dupliqué sous `/en`, qui
   serait un doublon pour les moteurs). Ce n'est pas une redirection sur `Accept-Language`.

Points à **prouver dans le lot 0** (spike + tests) : `usePathname()` côté client après réécriture
(doit rendre le chemin du navigateur, préfixe compris — sinon helper `useLocalePathname`) ;
navigation client **et préchargement** RSC de `/en/...` (cf. exclusion des préchargements
ci-dessus) ; `/en/api/x` → 404 ; nonce présent sur `/` **et** `/en/` (test e2e qui lit
l'attribut `nonce` des scripts) ; `npm run typecheck` (TS 7) et `typecheck:ts5` acceptent
l'augmentation `AppConfig` et l'import JSON (`resolveJsonModule`).

### Raccordement, sujet par sujet

| Sujet | Règle proposée |
|---|---|
| `<html lang>` | `app/layout.tsx` lit la langue de la requête. |
| Liens internes | Helper `localeHref(path, locale)` + composant `<LocaleLink>` (enveloppe de `next/link`) ; `TeamLink`/`PlayerLink`/`EntrantLink` le prennent en interne — un seul endroit à changer. `router.push` passe par `useLocaleRouter()`. Un lien vers une route **non migrée** reste sans préfixe (liste blanche). |
| Sélecteur de langue | Dans l'en-tête de `PublicPageShell` et la nav : lien `<a hreflang>` vers l'**équivalent** de la page courante (`x-pathname` côté serveur) ; masqué si la route n'est pas migrée. |
| Erreurs d'API | Inchangées (codes). Les tables `*-errors.ts` / `error-map.ts` deviennent `errors.<CODE>` dans les messages ; repli `errors.INTERNAL_ERROR`. `CodedError` / `useFieldErrors` inchangés. |
| SSE | Le flux transporte des données, pas de texte : aucun changement. Vérifier au lot T qu'aucun libellé français n'y est sérialisé. |
| Dates / nombres / pluriels | `lib/shared/dates.ts` et `plural.ts` prennent une langue (ou cèdent la place à `useFormatter()` / ICU) ; les 90 appels `fr-FR`/`toLocale*` migrent avec leur lot. Fuseau : inchangé. |
| Métadonnées | `pageMetadata({ path, locale })` pose `canonical` **dans la langue** et `alternates.languages = { fr, en, 'x-default': fr }` — seulement si la route est migrée. `openGraph.locale` `fr_FR`/`en_US`. |
| Sitemap | `app/sitemap.ts` : une entrée par langue et par route migrée, avec `alternates.languages` (supporté par `MetadataRoute.Sitemap`). `robots.ts` inchangé. |
| JSON-LD | `inLanguage` sur `WebSite`/`WebPage` ; `BreadcrumbList` aux noms traduits ; organisation inchangée. |
| Image OG | `opengraph-image.tsx` lit `x-bg-locale` (accessible via `/en/opengraph-image` réécrite) ; `DEFAULT_SHARE_IMAGE` préfixé selon la langue. |
| Textes éditables | Clé de base `copy_<clé>` (français, inchangée — aucune migration de données) + `copy_<clé>__en` ; repli **sur le défaut anglais du code**, jamais sur la valeur française éditée. L'éditeur admin gagne un onglet de langue. Changement de schéma : aucun (`bg_settings` clé/valeur) — vérifier la longueur de colonne de la clé. |
| Préférence de langue | **URL = source de vérité.** Pas de cookie au lot 0 (rien à déclarer). Langue **du compte** (`bg_users.locale`) seulement au lot des push, pour choisir la langue d'une notification — **décision requise** (D5), avec entrée `PRIVACY_CHANGES` + registre si retenu. |
| Discord | Inchangé (français), voir D6. |
| CSP | Inchangée ; le nonce suit la requête réécrite (à tester). |

## 3. Plan par lots

Chaque lot = une PR, mêmes règles de pipeline que d'habitude (`docs/WORKFLOW.md`,
`docs/REVIEW_CYCLES.md`). Un lot de pages **inclut** : extraction des chaînes en clés, rédaction
anglaise, ajout des routes à la liste blanche, `hreflang`/sitemap automatiques, tests.

| # | Lot | Contenu | Chaînes ~ | Risques | Revue |
|---|---|---|---:|---|---|
| 0 | **Infrastructure** | `next-intl`, `i18n/request.ts`, `messages/fr/*.json` + `messages/en/*.json` par espace de noms, réécriture `/en` dans `middleware.ts`, en-tête `x-bg-locale`, liste blanche, `<html lang>`, `LocaleLink`/`localeHref`/`useLocaleRouter`, sélecteur, `pageMetadata` + sitemap + JSON-LD multilingues, formateurs, test de parité des clés, règle ESLint, glossaire, doc `I18N.md`, règle `CLAUDE.md`. **Aucune page migrée** (liste blanche vide → `/en/*` redirige). | ~0 | Middleware (CSP, provenance API, suspension) ; `usePathname` après réécriture ; double TypeScript | **Critique** : deux cycles propres consécutifs + sécurité + performance |
| 1 | Coquille partagée | Nav, pied de page, `PublicPageShell`, lien d'évitement, menu d'accessibilité, toasts, `ConfirmActionDialog`, pages d'erreur / 404 / `global-error` | ~250 (C1 + part de C2) | Composants partout : tester FR inchangé | Standard + UI |
| 2 | Accueil | `app/page.tsx`, `components/cyber/landing`, `<EditableCopy>` par langue (+ éditeur admin), OG, JSON-LD de l'accueil | ~300 | Textes édités en base sans équivalent anglais | Standard + UI + sécurité (éditeur) |
| 3 | Règles | `/regles`, `/regles/[slug]`, `lib/shared/tournament-rules.ts`, `components/rules` | ~330 (**4 100 mots**, le plus long texte public) | Exactitude du vocabulaire de jeu → glossaire | Standard + relecture humaine du fond |
| 4 | Classement | `/classement`, `components/stats`, libellés de formats/états partagés, `dates.ts`/`plural.ts` → ICU | ~150 | Pluriels, formats de nombres | Standard + performance |
| 5 | Reste de la vitrine | Association, bénévoles, partenaires, recrutement, `/bot` + `/bot/docs` (branchement de `help.md`), documents du bot sous `/en` | ~250 | Contenu en base (piliers, stats, bureau) : même schéma que les textes éditables | Standard + UI |
| 6 | Connexion | `/connexion`, tables d'erreurs d'authentification, écran de suspension | ~80 | Parcours OAuth : `redirect`/`next` doivent garder le préfixe ; avis de suspension lisible et effacé sous `/en/connexion` (cookie `path`, comparaison de chemin du middleware) | **Critique** (auth) |
| 7 | Légal | Selon D1 | 0 à ~1 285 (jusqu'à 23 000 mots) | Valeur juridique ; parité FR/EN | Cycle **juridique** (+ deux propres si RGPD) |
| 8a | Tournois — consultation | Liste, cartes, fiche, arbre, phases, labels de format/état | ~500 | Volume ; SSE | Standard + UI + performance |
| 8b | Tournois — actions | Inscription, déclaration de score, litiges, lancement de match, création/édition | ~500 | Messages d'erreur nombreux (`error-map.ts`) | Standard + UI + sécurité |
| 9 | Équipes, joueurs, profil, signalements | + préférence de langue du compte et push par langue (si D5) | ~620 (U + S7) | RGPD si stockage de la langue | Critique si D5 (RGPD) |
| 10 | Admin | Selon D4 — recommandé : **reste en français** | 0 / ~90 + part de `lib/server` | — | Standard |

**Ordre** : 0 → 1 → 2 → 3 → 4 → 5 → 6 → (7 dès que D1 tranché, en parallèle possible) →
8a → 8b → 9 → (10). Les lots 2 à 5 sont indépendants une fois 0 et 1 livrés.

**Effort total** : **12 PR** telles que listées (lots 0 à 10, le 8 en deux) ; **11** si l'admin
reste en français (D4). Le lot 7 subsiste quelle que soit D1 (même l'option (b) demande une page
de synthèse anglaise) ; il passe à deux PR si D1 = (a) vu son volume (~23 000 mots), soit 13 au
plus. Lot 0 ≈ 2 à 3 fois un lot de pages ; lots 3, 8a, 8b les plus lourds en texte.

**Pages connectées — recommandation (décision requise, D3)** : migrer les **tournois** et
l'espace joueur (lots 8–9), car c'est là qu'un joueur anglophone passe son temps ; garder
l'**admin en français** (D4) : public restreint, équipe francophone, ~90 chaînes mais beaucoup
de libellés serveur à trier pour un gain nul. Ces pages restent **hors sitemap** et sans valeur
SEO (carte « Connexion requise ») : leur `/en` ne sert qu'au confort de lecture.

### Rédaction de l'anglais — **décision requise** (D2)

Proposition : brouillon rédigé par l'IA **dans la PR du lot**, à partir du glossaire ; relecture
par un membre anglophone de l'équipe avant fusion (PR en brouillon tant qu'elle n'est pas
relue) ; textes légaux relus par une personne compétente (D1). Ton : le français tutoie →
anglais direct et informel (« you »), pas de « Please kindly… ».

### Glossaire (à figer au lot 0 dans `docs/features/I18N.md`)

| Français | Anglais proposé | Note |
|---|---|---|
| Tournoi / Équipe / Joueur | Tournament / Team / Player | |
| Inscriptions (état `REGISTRATION`) | Registration open | |
| À venir / En cours / Terminé | Upcoming / In progress / Finished | « En cours » = état d'un tournoi (`LIVE_STREAMS.md`). |
| En direct / le live | Live | Seulement une vraie diffusion (`pill-live`). |
| À jour / Reconnexion… / Hors ligne | Up to date / Reconnecting… / Offline | Témoin de flux. |
| Simple / Double élimination | Single / Double elimination | |
| Ronde suisse | Swiss | |
| Survie par coupes | Survival (cuts) | |
| BlueGenji Survie | BlueGenji Survival | Nom de mode : **décision requise** (D7) — traduire ou garder la marque. |
| Multi-phases | Multi-stage | |
| Manche | Round | Unité d'un arbre / d'une ronde. |
| Map / carte | Map | Une manche d'un match (score par map). |
| BO5 / FT3 | Bo5 / FT3 (First to 3) | Notation gardée telle quelle. |
| Haut / bas de tableau, Grande finale | Upper / Lower bracket, Grand final | |
| Forfait, double forfait | Forfeit, double forfeit | |
| Arbitre | Referee | |
| Signalement | Report | |
| Capitaine / Propriétaire / Manager / Coach | Captain / Owner / Manager / Coach | |
| TANK / DPS / HEAL | Tank / DPS / Support | **Décision requise** (D8) : « Heal » est l'usage de la communauté, « Support » le terme officiel Overwatch (Marvel Rivals : Vanguard / Duelist / Strategist). |
| Équipe fantôme / Entrée solo | Ghost team / Solo entry | |
| Bénévoles / Partenaires / L'association | Volunteers / Partners / The association | |

### Conventions d'extraction

- Messages en JSON par **espace de noms = zone** (`common`, `nav`, `errors`, `landing`,
  `rules`, `ranking`, `tournament`, `team`, `profile`, `legal`, …), un fichier par langue :
  `messages/<langue>/<espace>.json`. Clés en `camelCase` sémantique (`ranking.emptyState`), pas
  la phrase française.
- Une phrase = une clé, interpolations ICU (`{count, plural, one {# team} other {# teams}}`) ;
  jamais de concaténation de fragments traduits. Mise en forme riche par `t.rich` (`<strong>`),
  pas de HTML dans les messages.
- Composant serveur : `getTranslations('ns')` ; client : `useTranslations('ns')` — le client
  ne reçoit **que** les espaces de noms qu'il utilise (`NextIntlClientProvider` avec `pick`
  au niveau du segment).
- Données de domaine (libellés de format, d'état, de rôle) : la table `lib/shared` renvoie une
  **clé**, l'écran traduit.
- Noms saisis par les utilisateurs (`visibleText`), noms d'équipe et pseudos : **jamais**
  traduits.

### Garde-fous contre les régressions

- **Test de parité** (Jest) : même ensemble de clés et mêmes arguments ICU en `fr` et `en`.
- **Règle ESLint** (règle locale ou `eslint-plugin-i18next` `no-literal-string`, à choisir au
  lot 0) : texte JSX et props `aria-label`/`title`/`placeholder`/`alt` littéraux **interdits
  dans les dossiers migrés**, liste de dossiers étendue à chaque lot.
- **Test de la liste blanche** : toute route au sitemap en `en` est migrée ; toute route migrée
  a ses métadonnées dans les deux langues.
- **Test e2e** (Playwright, déjà présent) : `/en/<route>` rend `lang="en"`, `hreflang`
  réciproques, canonical dans la langue, nonce présent.
- **Brouillon de règle transverse `CLAUDE.md`** (à ajouter **dans le lot 0**, quand l'infra
  existe) :
  > **Langues** : tout texte d'interface passe par une clé de traduction (`getTranslations` /
  > `useTranslations`), présente en `fr` **et** `en` ; un lien interne passe par `LocaleLink`
  > → `I18N.md`.
  Les règles transverses existantes (« Live / Direct », typographie, toasts) valent dans les
  deux langues.

### CI, SonarQube, performance

- **CI** : la parité et la règle ESLint tournent dans `npm test` / `npm run lint` ; pas de job
  nouveau. Le build ne change pas de nature (déjà dynamique).
- **SonarQube** : les JSON de messages ne sont pas analysés ; s'attendre à des signalements de
  duplication sur les paires `fr`/`en` si Sonar les indexe — les exclure (`sonar.exclusions`)
  au lot 0.
- **Performance** : les composants serveur n'envoient aucun dictionnaire ; seuls les espaces de
  noms des composants client sont sérialisés, par segment. Cible : < 10 Ko de messages par page
  publique. Pas de chargement de dictionnaire côté client au changement de langue (c'est une
  navigation, l'URL change).

## Décisions requises (récapitulatif)

| # | Décision | Recommandation | Bloque |
|---|---|---|---|
| D1 | Textes légaux : tout traduire / FR seul + synthèse anglaise / mixte | (c) CGU + RGPD traduits, « la version française fait foi » ; le reste en FR + résumé EN | Lot 7 |
| D2 | Qui rédige l'anglais | IA en brouillon + relecture humaine anglophone avant fusion | Lots 1+ |
| D3 | Pages connectées traduites ou non | Tournois et espace joueur oui (lots 8–9) | Lots 8–9 |
| D4 | Admin | Reste en français | Lot 10 |
| D5 | Langue des notifications push : stockée sur le compte ? | Oui, `bg_users.locale` mis à jour par le sélecteur une fois connecté ; déclaration `PRIVACY_CHANGES` + registre | Lot 9 |
| D6 | Messages Discord | Restent en français | — |
| D7 | Nom du mode « BlueGenji Survie » | À trancher (marque) | Lot 3 |
| D8 | Rôle `HEAL` en anglais | « Support » ou « Heal » | Lot 3 |
