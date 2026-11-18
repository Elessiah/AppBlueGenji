# Documentation développeur (`/devdoc`)

Page réservée qui rassemble **toute** la documentation Markdown du site et du
bot, relue à chaud depuis les deux dépôts. Les dépôts et leur doc sont publics :
la porte ne protège que la page elle-même (rien n'y est masqué ni caviardé).

## Accès

- Permission **`dev`** (`lib/shared/permissions.ts`), accordée par le rôle de
  plateforme **`DEV`** (« Développeur » / « Developer ») et, comme toute
  permission, à `ADMIN`. Le rôle s'attribue comme les autres : fiche du joueur
  (« Rôles & permissions ») ou « Mes rôles » de `/profil` pour un
  administrateur — voir `PERMISSION_ROLES.md`. Stocké dans
  `bg_users.platform_roles_json` (JSON) : aucun changement de schéma.
- Sans session : carte « Connexion requise » de l'espace sécurisé. Connecté sans
  la permission : **404**, comme `/admin/signalements` (rien à révéler).
- Le contrôle est fait **deux fois** : `app/(secured)/devdoc/layout.tsx` et la
  page elle-même, avant toute lecture de fichier (les segments enfants sont
  rendus en parallèle de leur mise en page, qui n'est donc pas une frontière).
  Aucune route d'API : la liste des documents est servie par la page, la
  recherche filtre côté navigateur.
- Lien « Documentation dev » dans le menu du compte (`AccountMenu`, prop
  `devDocs`, posée par `SiteShell` selon `can(user, "dev")`).

## Documents lus (liste blanche)

`lib/server/dev-docs.ts` (`devDocSources`) :

| Dépôt | Racine | Dossiers parcourus | Fichiers de la racine |
| ----- | ------ | ------------------ | --------------------- |
| site | `process.cwd()` (`~/apps/AppBlueGenji` en production) | `docs/**` | `CLAUDE.md`, `README.md`, `ACCESSIBILITE.md` |
| bot | `BOT_PROJECT_DIR` (`../blueGenjiBot`, ou `BOT_DOCS_PATH`) — le même que `/bot/docs` | `doc/**`, `dev-notes/**` | `helpfr.md`, `help.md`, `README.md`, `CLAUDE.md` |

Les conditions du bot (`LegalTerms/`) restent sur leurs propres pages.

**Garde-fou anti-traversée.** L'adresse ne touche jamais le disque :

1. `parseDevDocParams` refuse tout segment vide, `.`, `..`, contenant `/`, `\`
   ou un caractère nul, ou mal encodé, et tout dépôt inconnu ;
2. le document est cherché **dans l'index** (`buildDevDocIndex`), qui ne retient
   que des fichiers `.md` ordinaires — ni lien symbolique, ni dossier caché,
   1 Mo au plus, 1 000 par dépôt, 6 niveaux de dossiers — dont le **chemin réel**
   reste sous le dossier autorisé ;
3. le fichier lu est celui de l'index, jamais un chemin bâti depuis l'adresse.

L'index est refait au plus une fois par minute (`loadDevDocIndex`, cache
commun) ; un document est relu et rendu à chaque vue (peu de lecteurs, et ~200
rendus par langue chasseraient du cache des entrées plus utiles).

## Adresses

- `/devdoc` : l'index des fonctionnalités du site (`docs/features/INDEX.md`).
- `/devdoc/site/<chemin sous docs/ sans .md>` — `/devdoc/site/features/BUSY_BUTTONS`,
  `/devdoc/site/DATABASE_SCHEMA` ; un fichier de la racine du dépôt garde son
  seul nom (`/devdoc/site/CLAUDE`).
- `/devdoc/bot/<chemin depuis la racine du bot sans .md>` — `/devdoc/bot/doc/main`,
  `/devdoc/bot/helpfr`.
- Sous `/en` aussi (`MIGRATED_ROUTES` : `/devdoc`, `/devdoc/[...path]`, motif
  attrape-tout ajouté à `matchesRoutePattern`) : l'interface est traduite
  (espace `devdoc`, FR + EN), les documents restent dans leur langue, annoncée
  par `lang` (`guessDocLanguage`, sur les mots courants) avec la mention « Ce
  document est rédigé en français. » sous `/en`.

## Rendu

Le Markdown passe par le rendu de `/bot/docs` (`renderMarkdown`,
`lib/server/bot-docs.ts`), étendu pour les deux pages (listes numérotées,
tableaux, citations, filets, langue des blocs de code, gras ou lien qui
contient du code, ligne repliée sous une puce qui prolonge son élément) et réglé ici par
`MarkdownRenderOptions` :

- **liens** (`resolveDevDocLink`) : ancre, `https://`, `mailto:` et chemin du
  site tels quels ; chemin relatif vers un document listé → sa page `/devdoc`
  (préfixe de langue compris), ancre gardée ; vers un autre fichier du dépôt
  (code, dossier) → ce fichier sur GitHub (`DEV_DOC_SOURCE_URLS`) ; chemin qui
  sort du dépôt, `//hôte` ou autre schéma → texte seul ;
- **code inline qui nomme un document** (`resolveDevDocCodeRef`) :
  `` `BUSY_BUTTONS.md` `` de l'index ou de `CLAUDE.md` devient un lien — cherché
  relatif au document, depuis la racine, puis dans `docs/features`, `docs`
  (site) ou `doc`, `dev-notes` (bot) ;
- **ancres** sur les titres, à la manière de GitHub (`headingAnchor`).

Le titre de l'onglet n'est posé que pour un lecteur autorisé : la 404 servie
aux autres comptes n'annonce pas la page.

## Écran

`app/(secured)/devdoc/[[...path]]/page.tsx` + `_components/DevDocNav.tsx` :
navigation (recherche par titre ou fichier — `filterDevDocs`, insensible à la
casse, aux accents et aux `_`, nombre de résultats annoncé —, puis arborescence
par dépôt et par dossier, `INDEX` en tête, dossier du document ouvert déplié
et amené dans la zone)
dans une `ScrollArea` verticale nommée ; le document à côté (une colonne sous
960 px), avec son chemin et le lien « Voir sur GitHub ». Corps stylé par
`.docs-content` (`app/bot/docs/docs.css`) ; tableaux en `table-layout: fixed`,
qui coupent leurs mots plutôt que de déborder.

## Tests

`tests/lib/shared/dev-docs.test.ts` (adresses, refus des traversées, liens,
regroupement, recherche, langue), `tests/lib/server/dev-docs.test.ts` (index
sur un faux dépôt : liste blanche, liens symboliques et sorties refusés, rendu
avec liens réécrits), `tests/app/devdoc-page.test.tsx` (porte : sans session,
sans permission, `DEV`, administrateur ; document inconnu),
`tests/lib/server/bot-docs.test.ts` (nouveaux blocs du rendu).
