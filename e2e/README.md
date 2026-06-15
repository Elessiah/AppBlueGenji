# Tests E2E (Playwright)

Tests bout-en-bout dans un vrai navigateur (Chromium), en complément des tests
Jest unitaires/API de `tests/`.

## Lancer

```bash
npm run test:e2e          # exécution headless
npm run test:e2e:ui       # mode interactif (debug)
npm run test:e2e:report   # ouvre le dernier rapport HTML
```

Par défaut, Playwright démarre lui-même `npm run dev` sur `http://localhost:3000`
(voir `playwright.config.ts`). Pour cibler une instance déjà lancée :

```bash
E2E_BASE_URL=http://localhost:3000 npm run test:e2e
```

## Niveaux de tests

### 1. `auth.spec.ts` — sans prérequis
Ne dépend ni de la base ni d'une session. Couvre :
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
3. Le bypass d'auth dev activé sur un user existant :
   ```env
   DEV_AUTH_USER_ID=321   # un id présent dans bg_users
   ```
   (rappel : inopérant si `NODE_ENV=production`).
4. Exporter le même id pour activer le fichier :
   ```bash
   E2E_AUTH_USER=321 npm run test:e2e
   ```

Le bypass (`lib/server/auth.ts → getDevBypassUser`) authentifie alors toutes les
routes `(secured)` sans OAuth ni code Discord.

## CI

En CI, seul `auth.spec.ts` s'exécute par défaut (pas de DB requise). Pour activer
le parcours authentifié, provisionner un service MySQL + seed, puis exporter
`DEV_AUTH_USER_ID` et `E2E_AUTH_USER`.
