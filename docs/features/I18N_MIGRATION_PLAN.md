# Site bilingue FR/EN — plan de migration

> **Statut : lots 0 (infrastructure) et 1 (coquille partagée) livrés — aucune route traduite.** Ce qui existe est décrit dans
> `I18N.md` ; ce document garde la mesure, le choix technique et le découpage en lots. Décision du
> 2026-10-05 : le site devient bilingue avec des **adresses indexées distinctes** par langue.
> Les arbitrages sont rendus (§ Décisions prises, 2026-10-06).

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
| Notifications push | **Dans le périmètre, lot 9** : langue = préférence du compte (`bg_users.locale`) | Une push n'a pas d'URL d'où lire la langue. **Décidé** (D5). |
| Messages Discord (bot, annonces, journaux staff) | **Hors périmètre, restent en français** | Communauté Discord francophone ; le bot gère déjà sa propre langue (`help.md` / `helpfr.md`). **Décidé** (D6). |
| Journaux pm2 | Hors périmètre (français) | Lus par l'équipe seulement. |
| Courriels | Sans objet | Le site n'en envoie pas. |

### Textes légaux — **décidé** (D1, voir la décision sous le tableau)

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

**Décision (2026-10-06) — option (a), en réutilisant l'existant :**

- **Chercher d'abord une version anglaise existante.** Trouvé : les documents du bot
  (`/privacy-policy-bot`, `/terms-of-service-bot`, `components/legal/BotLegalDoc.tsx`,
  `BOT_LEGAL_PAGES.md`) sont déjà bilingues (`BilingualDoc { fr, en }` avec une bascule de langue
  **dans la page** ; sources dans le dépôt `blueGenjiBot`, `LegalTerms/PolicyPrivacy.md` et
  `TermsOfServices.md`). Le lot 7 les **réutilise** et remplace la bascule interne par les adresses
  `/en/privacy-policy-bot`, `/en/terms-of-service-bot` (une langue par URL, `hreflang`).
- **Textes propres au site** (CGU, `/rgpd`, mentions légales, registre, déclaration
  d'accessibilité) : aucun anglais n'existe ; ils sont **traduits par l'agent de traduction Opus**
  (D2). CGU et politique de confidentialité portent en tête « the French version prevails ».
  Mentions légales, registre et déclaration d'accessibilité sont **traduits aussi**, sauf si le
  lot 7 trouve une raison juridique de ne pas le faire — il la **signale** alors au lieu de
  trancher seul.
- Relecture par un anglophone natif : **facultative**, conseillée pour les seuls textes légaux.
- `TERMS_VERSION` ne bouge pas pour la traduction ; parité FR/EN de toute modification de fond
  ultérieure, dans la même PR.

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
   liste blanche d'ici là. **Fait au lot 0** (demande du 2026-10-06) : `path: "/"`, comparaison
   sans préfixe ; le lot 6 n'a plus qu'à vérifier l'écran.
2. **Arborescence inchangée** : `app/regles/page.tsx` sert `/regles` et `/en/regles`.
3. **`next-intl` « sans routage »** : `lib/server/i18n-request.ts` → `getRequestConfig` lit
   `x-bg-locale` dans `headers()` (déjà lu par le layout : aucun coût de rendu) et charge les
   messages de la langue.
4. **Liste blanche des routes migrées** (`lib/shared/i18n-routes.ts`) : `/en/<x>` pour une route
   pas encore traduite → **307 vers `/<x>`** (pas un contenu français dupliqué sous `/en`, qui
   serait un doublon pour les moteurs). Ce n'est pas une redirection sur `Accept-Language`.

Points à **prouver dans le lot 0** (spike + tests) : `usePathname()` côté client après réécriture
(doit rendre le chemin du navigateur, préfixe compris — sinon helper `useLocalePathname`) ;
navigation client **et préchargement** RSC de `/en/...` (cf. exclusion des préchargements
ci-dessus) ; `/en/api/x` → 404 ; nonce présent sur `/` **et** `/en/` (test e2e qui lit
l'attribut `nonce` des scripts) ; `npm run typecheck` (TS 7) et `typecheck:ts5` acceptent
l'augmentation `AppConfig` et l'import JSON (`resolveJsonModule`).

### Ce que le lot 0 a établi (2026-10-06) — écarts au plan

- **`usePathname()`** rend le chemin du navigateur (`/en/regles`) côté client ; le rendu serveur
  voit la route réécrite. Aucun écart d'hydratation constaté (sélecteur rendu identique), parce que
  tout passe par `splitLocalePrefix` (`useLocalePathname`) et que la langue vient d'un contexte,
  jamais du chemin.
- **Préchargements** : le middleware **ne peut pas** les reconnaître — Next retire
  `next-router-prefetch` et `rsc` de la requête qu'il lui remet ; seul le `matcher` les voit. Un
  préchargement de `/en/…` suit donc le chemin commun (réécrit, `x-bg-locale: en`) et tire un nonce
  inutile, sans effet. Le « sans tirer de nonce » du plan est abandonné.
- **Pas de `createNextIntlPlugin`** : son module charge à l'import le binaire natif de
  `@swc/core` (extracteur de messages, inutilisé), qui échouait localement et alourdit chaque
  build. `next.config.ts` pose lui-même les deux alias `next-intl/config` (Turbopack et webpack)
  que le greffon aurait posés. Fichiers déplacés en conséquence : `lib/server/i18n-request.ts`
  (et non `i18n/request.ts`, hors du périmètre de `npm run lint`).
- **Une navigation qui change de langue est complète** (`<a>` nu, `location.assign`) : la mise en
  page racine (`<html lang>`, messages du client) n'est pas rendue de nouveau par une navigation
  client. `LocaleLink`/`useLocaleRouter` le font seuls ; un `next/link` nu dans un dossier traduit
  est refusé par ESLint.
- **Contexte de langue propre** (`useAppLocale`, `fr` par défaut) en plus de celui de
  `next-intl` : un lien d'entité se rend sans fournisseur (tests, écrans non migrés).
- **`/fr/api/…` → 404** (et non 308) : comme `/en/api/…`, aucune adresse préfixée ne mène à
  l'API.
- **Formateurs** : seul le fuseau commun (`Europe/Paris`) est posé ; la migration de
  `lib/shared/dates.ts` / `plural.ts` reste au lot 4. **Image OG** par langue : au lot 2.
- **Test e2e** : `e2e/i18n.spec.ts` (307, 404 `/en/api`, `Accept-Language`, `lang`, nonce) ; les
  contrôles `lang="en"`/`hreflang` d'une page anglaise s'y ajoutent avec la première route
  traduite.

### Ce que le lot 1 a établi (2026-10-06) — écarts au plan

- **Aucune route ajoutée** à la liste blanche : la coquille se rend en anglais sur les seules routes
  traduites. Elle est donc **prête** pour le lot 2 et reste française partout aujourd'hui.
- **Pas de `next-intl` côté client pour la coquille** : rendue sur toutes les pages, elle aurait
  chargé le formateur partout. Formateur ICU réduit (`lib/shared/message-format.ts`, `{arg}`,
  `plural`, balises), garanti équivalent à `next-intl` message par message par un test ; français
  inclus dans le paquet, anglais sérialisé par la mise en page racine **seulement** sous `/en`.
  Détail : `I18N.md` § Coquille partagée.
- **Reporté** : fenêtre d'édition du contact (staff → lot 5), `ProtectedContact` (pages légales →
  lot 7b), formulaire « Signaler un problème » (→ lot 9, seul le bouton est traduit), place du
  sélecteur de langue sur mobile (→ lot 2, avec une vraie page anglaise).
- `SiteFooterBar` devient composant client (sans état) : un composant serveur asynchrone ne se rend
  pas dans les tests de `ArenaShell`, et ses textes n'ont besoin d'aucune donnée serveur.

### Ce que le lot 2 a établi (2026-10-06) — écarts au plan

- **`/` ouvert sous `/en`** (`MIGRATED_ROUTES = ["/"]`), espace `landing`, toujours sans
  `next-intl` côté client (formateur commun `lib/shared/scoped-text.ts`). Détail : `I18N.md`
  § Accueil.
- **Rattrapage des `copy_*` sans migration de données** (écart à D9, qui prévoyait une
  migration ou un script rejoué une fois) : le code ne connaît pas les textes de production et
  n'écrit pas à leur place. Règle `resolveSiteCopy` : un français d'origine sert son anglais
  d'origine ; un français **édité** sans anglais sert aussi l'anglais d'origine (jamais le
  français) et entre dans la liste de rattrapage, que l'éditeur marque « EN » jusqu'à saisie.
  **Action requise en production** : `EDITABLE_SITE_COPY.md` § Rattrapage.
- **Contenu de staff des lots 5** (chiffres, cartes « À propos », description d'un partenaire)
  **non rendu** sous `/en` en attendant leur éditeur bilingue ; titres d'actualité exclus du
  bandeau anglais ; places vides du mini-arbre en « TBD ».
- **Image OG par langue** reportée (refonte de `app/opengraph-image.tsx` en cours, PR #411).
- **Sélecteur sur mobile** : code « EN » / « FR » sous 720 px (`I18N.md` § Sélecteur).
- Restent français sous `/en` : mise en avant du recrutement (lot 5), fenêtres globales de
  confidentialité et de conditions (lots 7b / 9).

### Ce que le lot 3 a établi (2026-10-06) — écarts au plan

- **Première route ouverte** : `/regles`, `/regles/[slug]` dans `MIGRATED_ROUTES` — réécriture,
  `hreflang`, sitemap et sélecteur s'activent seuls (lot 0). ~370 messages, ~4 100 mots anglais.
- **Pas de `getTranslations` pour les règles** : leurs textes sont des listes (sections, puces), que
  `t()` ne parcourt pas. Rendu serveur par `messagesFor(locale).rules` + le formateur réduit du
  lot 1 (`RuleText`), équivalence avec `next-intl` testée message par message. Gras `<b>`.
- **Registre** : `tournament-rules.ts` ne garde que la structure ; `TOURNAMENT_RULE_MODES` reste le
  registre français (bouton d'aide des pages de tournoi, client) et n'importe que le français.
  `shortLabel`, jamais lu, est retiré. `RANKING_SEEDING_RULE` devient le message
  `rules.seedingRule` (`{basePoints}`), cité par `{seedingRule}`.
- **Ancres** : les mêmes dans les deux langues (titres français).
- **Restent français sous `/en`**, annoncés `lang="fr"` : réglages d'un tournoi (`?tournoi=`, lot
  8a) ; banderole et modale de recrutement (contenu saisi, lot 5). Le bouton d'aide des tournois
  (`RulesHelpFab`) attend le lot 8a.
- **Build** : aucune page des règles n'est prérendue (la mise en page racine lit les en-têtes) ;
  `APP_URL` est lue au rendu, pour chaque langue — rien n'est figé à la compilation.
- **Vocabulaire** au-delà du glossaire : « capital d'endurance » → *endurance pool*, « barrage » →
  *play-in*, « petite finale » → *third-place match*, « victoire d'office » → *walkover* / *bye*,
  « belle » → *bracket reset*, « side gauche / droite » → *left / right side*, « hors course » →
  *out of contention*.

### Ce que le lot 4 a établi (2026-10-06) — écarts au plan

- **`/classement` ouvert sous `/en`** ; ~140 messages en trois espaces : `ranking` (page),
  `stats` (bloc de statistiques), `labels` (format, jeu, état par code). Détail : `I18N.md`
  § Classement et § Dates, nombres, pluriels.
- **Toujours pas de `next-intl` côté client** : page et tableau serveur ; « Afficher plus » reçoit
  l'espace `ranking.more` en prop. Le bloc de statistiques (client) inclut son français, comme
  avant (chaînes déplacées, pas ajoutées) ; son anglais attend la prop `i18n` du lot 9.
- **`dates.ts` / `plural.ts`** : écart au plan — pas de remplacement global par `useFormatter()`.
  Les fonctions de date prennent une langue **facultative** (français par défaut, rendu inchangé
  sur les écrans non traduits) ; `plural.ts` reste l'outil français des écrans non traduits, les
  écrans traduits écrivent leurs pluriels en ICU. Les ~90 appels `fr-FR`/`toLocale*` migrent
  toujours avec leur lot.
- **Libellés partagés** : les tables françaises restent (écrans non traduits, Discord D6) ; leur
  traduction vit dans `labels`, égalité FR testée. Les états reprennent ceux de l'en-tête de fiche
  (`STATE_META` : « Prochainement »…) ; l'anglais suit le glossaire (*Upcoming*, *Registration
  open*, *In progress*, *Finished*).
- **Ajout** : fil d'Ariane JSON-LD sur `/classement` (les deux langues), comme les règles.
- **Français inchangé** : rendu de la page, du tableau et du bloc comparé avant/après — seuls
  diffèrent les séparateurs `<!-- -->` du rendu serveur (un nœud texte au lieu de deux) et le
  JSON-LD ajouté.

### Ce que le lot 6 a établi (2026-10-06) — écarts au plan

- **`/connexion` ouvert sous `/en`**, toujours `noindex` et hors sitemap ; espace `login` (~85
  messages : page, boutons OAuth, refus, exposé de suspension, modale d'entrée). Détail : `I18N.md`
  § Connexion. Toujours pas de `next-intl` côté client (`LoginTextProvider`, anglais sérialisé sous
  `/en` seulement).
- **Langue à travers OAuth sans toucher aux fournisseurs** : `lang=en` sur la route de départ, langue
  scellée **dans la destination** du cookie d'état (`/en/…`) plutôt que dans un champ nouveau — le
  cookie `bg_oauth` garde son contenu déclaré sur `/rgpd`, aucune entrée `PRIVACY_CHANGES`. Adresses
  de rappel inchangées : aucune action en production chez Google, Discord ou Blizzard.
- **Garde des redirections durcie** : `//`, contre-barre et `%2F` / `%5C` refusés **n'importe où**
  dans le chemin (le préfixe de langue, retiré puis reposé, ne doit rien démasquer).
- **« Google One Tap »** du plan : retiré du site avant ce lot, aucun texte à traduire.
- **Modale d'entrée traduite** alors que les documents qu'elle cite (politique, conditions) restent
  français jusqu'au lot 7b : l'anglais le dit et leurs liens portent `hrefLang="fr"`.
- **Écart de rendu français** : gras de « L'identifiant » (ICU, `'<`) et heure d'expiration du code
  (24 h, langue de la page). Le reste est identique, testé.
- **Reporté** : la carte « Connexion requise » (`AuthGate`) reste française — elle ne se rend que sur
  des pages pas encore traduites (lots 8–9) ; seul son lien suit déjà la langue.

### Ce que le lot 5a a établi (2026-10-06) — écarts au plan

- **Lot 5 coupé en deux** : 5a (`/bot`, `/bot/docs`) puis 5b (association, bénévoles, recrutement,
  partenaires, mise en avant du recrutement, éditeurs bilingues et schéma). Écart au découpage
  proposé (« pages » / « éditeurs ») : le contenu de `/association`, `/benevoles` et
  `/recrutement` est presque entièrement saisi par le staff ; ouvrir ces pages avant leurs
  éditeurs aurait publié — et mis au sitemap — des pages anglaises vides, tout leur contenu restant
  masqué faute d'anglais. Chaque PR ouvre donc des pages complètes.
- **`/bot` ouvert sous `/en`**, espace `bot` (~190 messages), toujours sans `next-intl` côté client
  (`BotTextProvider`, trois espaces sérialisés sous `/en`). Détail : `I18N.md` § Bot.
- **Documentation** : `help.md` / `helpfr.md` branchés par langue **sans toucher au dépôt du bot** ;
  l'entrée `user-guide-en` devient une redirection 308 vers `/en/bot/docs/guide`. Pages du staff
  françaises seulement, annoncées `lang="fr"` sous `/en` (D4).
- **Données du bot restées françaises** : résumés du flux temps réel (`lang="fr"` sous `/en`) — les
  traduire demanderait au bot d'émettre des événements structurés (hors périmètre).

### Ce que le lot 5b a établi (2026-10-06) — écarts au plan

- **`/association`, `/benevoles`, `/recrutement` (et la redirection `/partenaires`) ouverts sous
  `/en`**, espaces `association`, `volunteers`, `recruitment` ; mise en avant du recrutement
  traduite. Détail : `I18N.md` § Association, bénévoles, recrutement.
- **Schéma tranché** (D9 le laissait au lot 5) : une **colonne `_en`** à côté du français
  (`role_en`, `label_en`, `title_en` / `text_en`, `description_en`, `category_en`, `title_en` /
  `roles_en` / `body_en`), aux deux endroits (`CREATE TABLE` et `RECENT_SCHEMA_CHANGES`), `NULL` =
  pas encore traduit. Pas de table de traductions : un contenu a deux langues, pas N.
- **Rattrapage sans migration de données** (écart à D9, comme au lot 2) : le code ne connaît pas le
  contenu de production. Un contenu sans anglais **n'est pas rendu** sous `/en` (décision du
  2026-10-06) et son éditeur porte la marque **EN**. **Action requise en production** :
  `EDITABLE_SITE_COPY.md` § Rattrapage. Les pages anglaises ouvrent donc **avant** la fin du
  rattrapage, plus courtes mais sans français — écart assumé à « une page anglaise n'ouvre qu'une
  fois tout son contenu traduit ».
- **Catégories de bénévoles traduites en bloc** (une catégorie = un intitulé anglais, recopié sur
  ses bénévoles) ; un partenaire sans description anglaise reste affiché, sans description.
- **Hors lot** : titres d'actualité (`bg_news`, sans table ni éditeur ici) ; éditeur du contact du
  pied de page (staff, D4).

### Ce que le lot 7a a établi (2026-10-07) — écarts au plan

- **`/privacy-policy-bot` et `/terms-of-service-bot` ouverts sous `/en`**, texte de `BilingualDoc`
  repris **tel quel** (aucune phrase réécrite, `TERMS_VERSION` inchangé) ; bascule interne
  retirée. Détail : `I18N.md` § Documents légaux du bot.
- **Pas d'espace de messages propre** : les six textes d'interface (titre et description de chaque page,
  « SECTION », « (in French) ») vont dans `bot.legalPages` — le contenu légal, lui, reste dans
  `bot-legal-content.ts`. Titres français sans leur moitié anglaise (« … / Privacy Policy » retiré : habillage, pas texte légal).
- **Aucune redirection** : la bascule était un état client, sans adresse publique.
- **Hors lot** : les copies anglaises du dépôt `blueGenjiBot` (`LegalTerms/PolicyPrivacy.md`,
  `TermsOfServices.md`, générées par `scripts/generate-legal-terms.py`) citent l'adresse française ;
  les faire pointer vers `/en/…` se fait au dépôt du bot, à la prochaine régénération.

### Ce que le lot 7b-1 a établi (2026-10-07) — écarts au plan

- **Lot 7b coupé en deux** (~23 000 mots, pour une relecture juridique tenable) : **7b-1**
  conditions d'utilisation, mentions légales, déclaration d'accessibilité, fenêtre d'acceptation des
  conditions, `ProtectedContact` ; **7b-2** `/rgpd` (et l'historique `PRIVACY_CHANGES`), le registre
  `/rgpd/registre`, la fenêtre des changements de confidentialité. Branches indépendantes depuis
  `main`. Détail : `I18N.md` § Textes légaux du site.
- **Un document par langue** plutôt que des clés (comme 7a) : le français reste dans ses modules et
  ses pages, **inchangé au caractère près** (testé contre une référence relevée avant le lot) ;
  l'anglais vit dans des modules et composants frères.
- **« The French version prevails »** sur les **trois** pages anglaises (le plan : CGU et
  confidentialité au moins), anglais seulement ; sous la case des conditions des deux fenêtres
  d'acceptation aussi.
- **Aucune raison juridique de ne pas traduire** trouvée : noms de lois, d'autorités et adresses
  gardés en français (`lang="fr"`) avec une glose. À signaler au cycle juridique : la mention RGAA
  « non conforme » est rendue « non-compliant » (libellé du pied de page anglais depuis le lot 1).
- `TERMS_VERSION`, `PRIVACY_CHANGES`, `REGISTER_UPDATED_AT`, `ACCESSIBILITY_STATEMENT_DATE`
  **inchangés** : une traduction n'est pas un changement de fond.
- Motif de suspension « Comportement » : *Conduct* (titre de l'article anglais) au lieu de
  *Behavior* (lot 6), pour que l'exposé cite l'article tel qu'il s'intitule.

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
| Textes éditables | Clé de base `copy_<clé>` (français, inchangée — aucune migration de données) + `copy_<clé>__en`. **Anglais obligatoire à la saisie** (D9) : l'éditeur montre FR et EN côte à côte et refuse d'enregistrer sans l'anglais. Le contenu déjà en base reçoit son anglais **au lot qui migre l'écran** (rattrapage, § Textes saisis par l'administration) — aucun repli FR sous `/en`. Changement de schéma : aucun (`bg_settings` clé/valeur) — vérifier la longueur de colonne de la clé. |
| Préférence de langue | **URL = source de vérité.** Pas de cookie au lot 0 (rien à déclarer). Langue **du compte** (`bg_users.locale`) au lot 9, pour choisir la langue d'une notification — **décidé** (D5), avec entrée `PRIVACY_CHANGES`, mise à jour de `/rgpd` et du registre des traitements. |
| Discord | Inchangé (français), voir D6. |
| CSP | Inchangée ; le nonce suit la requête réécrite (à tester). |

## 3. Plan par lots

Chaque lot = une PR, mêmes règles de pipeline que d'habitude (`docs/WORKFLOW.md`,
`docs/REVIEW_CYCLES.md`). Un lot de pages **inclut** : extraction des chaînes en clés, rédaction
anglaise, ajout des routes à la liste blanche, `hreflang`/sitemap automatiques, tests.

| # | Lot | Contenu | Chaînes ~ | Risques | Revue |
|---|---|---|---:|---|---|
| 0 | **Infrastructure** | `next-intl`, `i18n/request.ts`, `messages/fr/*.json` + `messages/en/*.json` par espace de noms, réécriture `/en` dans `middleware.ts`, en-tête `x-bg-locale`, liste blanche, `<html lang>`, `LocaleLink`/`localeHref`/`useLocaleRouter`, sélecteur, `pageMetadata` + sitemap + JSON-LD multilingues, formateurs, test de parité des clés, règle ESLint, glossaire, doc `I18N.md`, règle `CLAUDE.md`. **Aucune page migrée** (liste blanche vide → `/en/*` redirige). | ~0 | Middleware (CSP, provenance API, suspension) ; `usePathname` après réécriture ; double TypeScript | **Critique** : deux cycles propres consécutifs + sécurité + performance |
| 1 ✅ | Coquille partagée | Nav, pied de page, `PublicPageShell`, lien d'évitement, menu d'accessibilité, toasts, `ConfirmActionDialog`, pages d'erreur / 404 / `global-error` | ~250 (C1 + part de C2) | Composants partout : tester FR inchangé | Standard + UI |
| 2 ✅ | Accueil | `app/page.tsx`, `components/cyber/landing`, `<EditableCopy>` par langue + éditeur admin FR/EN **anglais obligatoire** (D9), rattrapage de l'anglais des `copy_*` déjà saisis, OG, JSON-LD de l'accueil | ~300 | Textes édités en base sans équivalent anglais → rattrapage avant d'ouvrir `/en` | Standard + UI + sécurité (éditeur) |
| 3 ✅ | Règles | `/regles`, `/regles/[slug]`, `lib/shared/tournament-rules.ts`, `components/rules` | ~330 (**4 100 mots**, le plus long texte public) | Exactitude du vocabulaire de jeu → glossaire | Standard (relecture du fond contre le glossaire, D2) |
| 4 ✅ | Classement | `/classement`, `components/stats`, libellés de formats/états partagés, `dates.ts`/`plural.ts` → ICU | ~150 | Pluriels, formats de nombres | Standard + performance |
| 5 ✅ (5a, 5b) | Reste de la vitrine | Association, bénévoles, partenaires, recrutement, `/bot` + `/bot/docs` (branchement de `help.md`) ; éditeurs de la page association (bureau, bénévoles, cartes « À propos », chiffres, partenaires, annonces de recrutement) en FR/EN **anglais obligatoire** (D9) + rattrapage de l'existant | ~250 | Contenu en base (piliers, stats, bureau) : même schéma que les textes éditables | Standard + UI + sécurité (éditeurs) |
| 6 ✅ | Connexion | `/connexion`, tables d'erreurs d'authentification, écran de suspension | ~80 | Parcours OAuth : `redirect`/`next` doivent garder le préfixe ; avis de suspension sous `/en/connexion` (cookie et middleware déjà prêts au lot 0 : vérifier l'écran) | **Critique** (auth) |
| 7a ✅ | Légal — documents du bot | `/privacy-policy-bot`, `/terms-of-service-bot` : la bascule interne de `BotLegalDoc` cède la place aux adresses `/en/…` (D1) | ~0 (contenu existant) | Une langue par URL, `hreflang` | Cycle **juridique** |
| 7b (7b-1 ✅, 7b-2) | Légal — textes du site | CGU, `/rgpd`, mentions légales, registre, déclaration d'accessibilité traduits (D1, « the French version prevails » sur CGU et confidentialité) | ~1 285 (~23 000 mots) | Valeur juridique ; parité FR/EN ; raison juridique de ne pas traduire un texte → **la signaler** | Cycle **juridique** + deux propres (RGPD) |
| 8a | Tournois — consultation | Liste, cartes, fiche, arbre, phases, labels de format/état | ~500 | Volume ; SSE | Standard + UI + performance |
| 8b | Tournois — actions | Inscription, déclaration de score, litiges, lancement de match, création/édition | ~500 | Messages d'erreur nombreux (`error-map.ts`) | Standard + UI + sécurité |
| 9 | Équipes, joueurs, profil, signalements | + langue du compte (`bg_users.locale`, D5) et push par langue | ~620 (U + S7) | RGPD : stockage de la langue → `PRIVACY_CHANGES` + `/rgpd` + registre | **Critique** (RGPD) |
| ~~10~~ | ~~Admin~~ | **Abandonné** : l'admin reste en français (D4) | — | — | — |

**Ordre** : 0 → 1 → 2 → 3 → 4 → 5 → 6 → 7a/7b (en parallèle possible) → 8a → 8b → 9. Les lots
2 à 5 sont indépendants une fois 0 et 1 livrés.

**Effort total** : **12 PR** (lots 0 à 9, le 7 et le 8 en deux ; pas de lot admin). Lot 0 ≈ 2 à
3 fois un lot de pages ; lots 3, 7b, 8a, 8b les plus lourds en texte.

**Pages connectées — décidé (D3, D4)** : les **tournois** et l'espace joueur sont traduits
(lots 8–9) ; l'**admin reste en français**. Ces pages restent **hors sitemap** et sans valeur SEO
(carte « Connexion requise ») : leur `/en` ne sert qu'au confort de lecture.

### Rédaction de l'anglais — **décidé** (D2)

L'anglais est rédigé **par un agent de traduction Opus dédié**, dans la PR du lot, à partir du
glossaire (`I18N.md`) — sans étape de relecture humaine imposée. Une relecture par un anglophone
natif reste **facultative**, conseillée pour les seuls textes légaux (lot 7b). Ton : le français
tutoie → anglais direct et informel (« you »), pas de « Please kindly… ».

### Textes saisis par l'administration — **décidé** (D9)

Quand un administrateur saisit ou modifie un texte de l'accueil (`<EditableCopy>`, clés `copy_*`
de `lib/shared/site-copy.ts`) ou de la page association (bureau, bénévoles, cartes « À propos »,
chiffres, partenaires, annonces de recrutement), l'éditeur demande **aussi sa traduction
anglaise** :

- champs **FR et EN côte à côte** ; l'anglais est **obligatoire** : l'enregistrement est refusé
  sans lui, par un code d'erreur rattaché au champ EN (`CodedError`, `useFieldErrors`,
  `ACCESSIBILITY_FORM_ERRORS_STATEMENT.md`) ;
- stockage **par langue** (`copy_<clé>__en` pour les textes éditables ; colonne ou ligne `en` à
  côté du français pour les contenus de la page association, schéma tranché au lot 5) ;
- **aucun repli FR** n'est nécessaire pour un contenu saisi après la migration de son éditeur ;
- **rattrapage** : le contenu déjà en base sans anglais reçoit le sien **dans le lot qui migre
  l'écran** (2 pour l'accueil, 5 pour l'association), traduit par l'agent de traduction Opus et
  écrit par une migration de données (ou un script d'exploitation rejoué une fois), **avant**
  d'ajouter la route à la liste blanche — une page anglaise n'ouvre qu'une fois tout son contenu
  traduit.
- **Clés ajoutées avant le lot 2** (français seul, à bilingualiser et rattraper au lot 2 avec
  les autres `copy_*`, l'éditeur étant commun) : `ranking.hero.title` et `ranking.hero.lede`
  (titre et sous-titre de `/classement`, 2026-10-06 — `RANKING_PAGE.md`). Leur anglais doit
  exister avant que le lot 4 ouvre `/en/classement`.

### Glossaire (figé au lot 0 dans `docs/features/I18N.md`, D7 et D8 appliqués)

La référence est désormais `I18N.md` ; cette table en garde l'historique.

| Français | Anglais | Note |
|---|---|---|
| Tournoi / Équipe / Joueur | Tournament / Team / Player | |
| Inscriptions (état `REGISTRATION`) | Registration open | |
| À venir / En cours / Terminé | Upcoming / In progress / Finished | « En cours » = état d'un tournoi (`LIVE_STREAMS.md`). |
| En direct / le live | Live | Seulement une vraie diffusion (`pill-live`). |
| À jour / Reconnexion… / Hors ligne | Up to date / Reconnecting… / Offline | Témoin de flux. |
| Simple / Double élimination | Single / Double elimination | |
| Ronde suisse | Swiss | |
| Survie par coupes | Survival (cuts) | |
| BlueGenji Survie | BlueGenji's Survival | Nom de mode traduit (D7). |
| Multi-phases | Multi-stage | |
| Manche | Round | Unité d'un arbre / d'une ronde. |
| Map / carte | Map | Une manche d'un match (score par map). |
| BO5 / FT3 | Bo5 / FT3 (First to 3) | Notation gardée telle quelle. |
| Haut / bas de tableau, Grande finale | Upper / Lower bracket, Grand final | |
| Forfait, double forfait | Forfeit, double forfeit | |
| Arbitre | Referee | |
| Signalement | Report | |
| Capitaine / Propriétaire / Manager / Coach | Captain / Owner / Manager / Coach | |
| TANK / DPS / HEAL | Tank / DPS / Support | « Support », terme officiel Overwatch (D8) ; le code `HEAL` ne change pas. |
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

## Décisions prises (2026-10-06)

| # | Question | Décision | Lot |
|---|---|---|---|
| D1 | Textes légaux | Chercher d'abord l'anglais existant : les documents du bot sont déjà bilingues (`BilingualDoc`) — réutilisés, bascule interne remplacée par les adresses `/en`. Textes du site traduits par l'agent Opus, « the French version prevails » sur CGU et confidentialité ; mentions légales, registre et déclaration d'accessibilité traduits aussi, sauf raison juridique trouvée au lot 7 (alors **signalée**). | 7a, 7b |
| D2 | Qui rédige l'anglais | Un agent de traduction Opus dédié ; pas de relecture humaine imposée. Relecture native **facultative**, conseillée pour les textes légaux seulement. | 1+ |
| D3 | Pages connectées | Tournois et espace joueur traduits. | 8–9 |
| D4 | Admin | Reste en français (lot 10 abandonné). | — |
| D5 | Langue des push | Oui : `bg_users.locale`, avec entrée `PRIVACY_CHANGES`, `/rgpd` et registre des traitements à jour. | 9 |
| D6 | Messages Discord | Restent en français. | — |
| D7 | Mode « BlueGenji Survie » | Traduit : « BlueGenji's Survival ». | 3 |
| D8 | Rôle `HEAL` | « Support ». | 3 |
| D9 | Textes saisis dans les éditeurs de l'accueil et de la page association | Anglais **obligatoire** à la saisie (FR + EN côte à côte, enregistrement refusé sans EN, code d'erreur rattaché au champ EN) ; stockage par langue ; pas de repli FR ; rattrapage de l'existant par l'agent Opus dans le lot qui migre l'écran, avant d'ouvrir la route. | 2, 5 |
