# Tests E2E (Playwright)

Tests bout-en-bout dans un vrai navigateur (Chromium), en complément des tests
Jest unitaires/API de `tests/`.

## Lancer

```bash
npm run test:e2e          # exécution headless
npm run test:e2e:ui       # mode interactif (debug)
npm run test:e2e:report   # ouvre le dernier rapport HTML
```

> Le binaire navigateur (Chromium) n'est pas versionné : il est téléchargé dans
> un cache utilisateur (`~/AppData/Local/ms-playwright`). Les scripts `test:e2e`
> et `test:e2e:ui` lancent automatiquement `playwright install chromium` au
> préalable (hook `pretest:e2e`) — no-op si déjà présent. Pour l'installer
> manuellement : `npm run e2e:install` (ou `npx playwright install chromium`).

Par défaut, Playwright démarre un serveur de test **neuf** sur un port dédié
(`3100`, surchargeable via `E2E_PORT`) — il ne réutilise volontairement PAS un
`npm run dev` déjà lancé, dont le `.env` (notamment `DEV_AUTH_USER_ID`)
fausserait les assertions. Pour cibler une instance externe que tu gères
toi-même :

```bash
E2E_BASE_URL=http://localhost:3000 npm run test:e2e
```

### Contrôle du bypass d'authentification
La config impose `DEV_AUTH_USER_ID` au serveur de test (et a priorité sur le
`.env`, que Next.js n'écrase pas) :
- sans `E2E_AUTH_USER` → `DEV_AUTH_USER_ID=""` → bypass **désactivé**, les routes
  `(secured)` redirigent vers `/connexion` ;
- avec `E2E_AUTH_USER=<id>` → bypass **activé** sur cet id.

Donc même si ton `.env` définit `DEV_AUTH_USER_ID` pour le dev local, les tests
restent déterministes.

### Fenêtres ouvertes d'elles-mêmes
Tout spec importe `test` et `expect` de `e2e/helpers/test.ts`, **jamais** de
`@playwright/test`. La fixture `page` y referme, avant chaque action et chaque
assertion, les fenêtres que le site ouvre sans qu'on les demande — leur voile
interceptait le premier clic de chaque parcours, panne locale seulement, la CI
n'ayant pas de base :
- l'annonce de recrutement prioritaire (présente sur une base seedée) et les
  conditions d'utilisation d'un compte qui gère une équipe sans les avoir
  acceptées se ferment par « Plus tard », qui n'enregistre rien ;
- les changements du traitement des données, pour un compte créé avant la
  dernière entrée de `PRIVACY_CHANGES`, n'ont pas de « plus tard » : ils sont
  **acceptés** au nom du compte de test.

Une page ouverte hors de la fixture (contexte créé à la main) appelle
`dismissSiteOverlays(page)` elle-même.

## Niveaux de tests

### 1. `auth.spec.ts` — sans prérequis
Ne dépend ni de la base ni d'une session (le serveur de test force
`DEV_AUTH_USER_ID=""`). Couvre :
- le rendu de `/connexion` (Google + flux Discord en 2 étapes) ;
- la carte « Connexion requise » servie par les routes `(secured)` à un visiteur
  non authentifié, et le `?redirect=` qu'elle repasse à `/connexion` (la garde
  court-circuite la DB quand il n'y a ni cookie ni `DEV_AUTH_USER_ID`).

Ces tests tournent partout, y compris en CI sans base de données.

### 2. `tournaments.spec.ts` — parcours authentifié (optionnel)
Ignoré tant que `E2E_AUTH_USER` n'est pas défini. Prérequis :

1. Une base MySQL accessible (`DB_HOST`, `DB_USER`, `DB_PASSWORD`, `DB_DATABASE`
   dans `.env`).
2. Des données de test : `npm run seed`.
3. Activer le fichier **et** le bypass en une seule variable :
   ```bash
   E2E_AUTH_USER=321 npm run test:e2e   # 321 = un id présent dans bg_users
   ```
   `E2E_AUTH_USER` débloque `tournaments.spec.ts` ET est injecté comme
   `DEV_AUTH_USER_ID` dans le serveur de test (inutile de le mettre dans `.env`).

Le bypass (`lib/server/auth.ts → getDevBypassUser`) authentifie alors toutes les
routes `(secured)` sans OAuth ni code Discord (inopérant si `NODE_ENV=production`).

### 3. `player-journey.spec.ts` — parcours joueur (base requise)
Deux joueurs **réels** s'affrontent dans un tournoi créé pour l'occasion :
inscription de leurs équipes, lancement du match, score proposé dans la modale
puis confirmé par l'adversaire, désaccord, forfait sur la manche.

Le bypass `DEV_AUTH_USER_ID` n'offrant qu'une identité par serveur, la fixture
(`e2e/helpers/player-journey-fixture.ts`) crée ses comptes en base et leur ouvre
de vraies sessions (ligne `bg_user_sessions` + cookie `bg_session`) ; tout le
reste passe par l'API, comme un utilisateur. Comptes, équipes et tournois sont
effacés à la fin.

Prérequis : une base MySQL configurée dans `.env`, et **pas** d'`E2E_AUTH_USER`
(le bypass masquerait les sessions). Ignoré sinon — donc en CI sans base.

```bash
npx playwright test e2e/player-journey.spec.ts
```

## CI

En CI, seul `auth.spec.ts` s'exécute par défaut (pas de DB requise). Pour activer
le parcours authentifié, provisionner un service MySQL + seed, puis exporter
`E2E_AUTH_USER`.
