# Tests E2E (Playwright)

Tests bout-en-bout dans un vrai navigateur (Chromium), en complément des tests
Jest unitaires/API de `tests/`.

## Lancer

```bash
npm run test:e2e          # exécution headless
npm run test:e2e:ui       # mode interactif (debug)
npm run test:e2e:report   # ouvre le dernier rapport HTML
```

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

## Niveaux de tests

### 1. `auth.spec.ts` — sans prérequis
Ne dépend ni de la base ni d'une session (le serveur de test force
`DEV_AUTH_USER_ID=""`). Couvre :
- le rendu de `/connexion` (Google + flux Discord en 2 étapes) ;
- la redirection des routes `(secured)` vers `/connexion` pour un visiteur non
  authentifié (la garde `requireCurrentUser` court-circuite la DB quand il n'y a
  ni cookie ni `DEV_AUTH_USER_ID`).

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

## CI

En CI, seul `auth.spec.ts` s'exécute par défaut (pas de DB requise). Pour activer
le parcours authentifié, provisionner un service MySQL + seed, puis exporter
`E2E_AUTH_USER`.
