# Plan de tests — BlueGenji Arena

> Ce document décrit la stratégie de couverture de tests pour la plateforme, et fournit des **prompts prêts à l'emploi** pour Claude Haiku 4.5 (`claude-haiku-4-5-20251001`) afin d'écrire chaque lot de tests de manière autonome.

---

## 1. État actuel

**Tests existants** (4 fichiers, couverture ~5 %) :
- `tests/app/api/auth/discord/request/route.test.ts`
- `tests/app/api/auth/google/start/route.test.ts`
- `tests/lib/server/bot-integration.test.ts`
- `tests/lib/server/google-oauth.test.ts`

**Conventions en place** (à reprendre partout) :
- `import { ... } from "@jest/globals"`
- `jest.spyOn(global, "fetch")` pour mocker HTTP
- `process.env = { ...originalEnv }` dans `beforeEach` + restore dans `afterEach`
- Alias `@/*` → racine projet
- `testEnvironment: 'node'`, `ts-jest` avec `tsconfig.jest.json`

---

## 2. Stratégie — 3 couches

| Couche | Cible | Dépendances mockées | Priorité |
|---|---|---|---|
| **Unit** | `lib/shared/*`, helpers purs, `lib/server/serialization.ts`, `lib/server/http.ts`, `lib/server/live.ts` | Aucune | P0 |
| **Service** | `lib/server/tournaments-service.ts`, `teams-service.ts`, `users-service.ts`, `auth.ts` | Pool MySQL mocké (ou DB in-memory sqlite-compatible via abstraction `getPool`) | P0/P1 |
| **Route** | `app/api/**/route.ts` | Services mockés + `cookies()` Next mocké | P1 |

**Cibles de couverture** :
- `lib/server/tournaments-service.ts` : **90 %** (cœur métier)
- `lib/server/auth.ts`, `lib/shared/*`, `lib/server/serialization.ts` : **95 %**
- Routes API : **80 %** (happy path + un échec par branche)
- Global : **75 % statements / 70 % branches**

---

## 3. Phases (ordonnées par dépendance)

### Phase 1 — Unit (helpers purs) — **P0**
Aucune dépendance, feedback ultra-rapide. Fondation pour les phases suivantes.

- `lib/server/serialization.ts` : `nextPowerOfTwo`, `generateSeedOrder`, `normalizePseudo`, `slugifyPseudo`, `toIso`, `clampInt`, `parseRoles`
- `lib/server/http.ts` : `ok`, `fail`, codes HTTP
- `lib/server/live.ts` : EventEmitter (souscription/émission `updated`, `score_reported`, `score_resolved`)
- `lib/shared/*` : constantes, helpers partagés

### Phase 2 — Service (auth) — **P0**
- Hashage SHA-256 des tokens (`hashToken`)
- TTL session 30 jours
- Cookie `bg_session` (httpOnly, sameSite=lax, secure prod)
- `ensureUniquePseudo` (suffixe incrémental)
- `requireCurrentUser` (401 si pas de session)

### Phase 3 — Service (tournaments) — **P0** (plus critique)
Le moteur de bracket. Risque de régression élevé.

- Génération bracket single elim (4, 6, 7, 8, 13, 16 participants)
- Génération bracket double elim + Lower Bracket (tailles pairs/impairs par round)
- Placement BYE (slots fantômes)
- Auto-résolution BYE quand un seul participant + pas de feeder
- Match fantôme (2 BYE) : statut COMPLETED sans winner
- Transitions `PENDING → READY → AWAITING_CONFIRMATION → COMPLETED`
- Score reports concordants → auto-finalisation
- Score reports en conflit → statut `AWAITING_CONFIRMATION` + flag admin
- Deadline 10 min (`SCORE_REPORT_TIMEOUT_MINUTES`)
- Ranking final (position bracket → wins → losses → récence)

### Phase 4 — Service (teams, users) — **P1**
- Création équipe + auto-OWNER
- Ajout/retrait membre (permissions OWNER/CAPITAINE)
- Rôles cumulatifs (JSON array)
- Historique équipe (tournois joués, W/L)
- Profil public vs privé (visibility)

### Phase 5 — Routes API (auth) — **P1**
- `POST /api/auth/discord/request` (étendre)
- `POST /api/auth/discord/verify` (code valide, expiré, faux)
- `GET /api/auth/google/callback` (OAuth code → session)
- `POST /api/auth/logout` (cookie clear)
- `GET /api/auth/me` (200 avec session, 401 sinon)

### Phase 6 — Routes API (tournaments) — **P1**
- `GET /api/tournaments` (buckets UPCOMING/REGISTRATION/RUNNING/FINISHED)
- `POST /api/tournaments` (organizer requis)
- `GET /api/tournaments/[id]` (bracket rendu)
- `POST /api/tournaments/[id]/register` (quotas, équipe déjà inscrite)
- `POST /api/tournaments/[id]/matches/[matchId]/report` (score + reporter)
- `GET /api/tournaments/[id]/stream` (SSE — smoke test headers)

### Phase 7 — Routes API (teams, players, profile) — **P2**
- CRUD équipes, membres
- `GET /api/players/[id]` (privacy)
- `PUT /api/profile` (visibility)

### Phase 8 — Routes API (admin, landing, bot) — **P2**
- `POST /api/admin/matches/[matchId]/resolve` (admin guard)
- `GET /api/landing/{stats,live,leaderboard,calendar,ticker}`
- `GET /api/bot/stats`

### Phase 9 — Intégration end-to-end — **P2**
Scénario complet sur DB de test (seed) : création tournoi → inscription → bracket généré → matches joués → rapport scores → finalisation → classement.

---

## 4. Règles de qualité des tests

1. **AAA** : Arrange / Act / Assert — un cas = un test.
2. **Déterministe** : pas de `Date.now()` brut, utiliser `jest.useFakeTimers({ now: new Date('2026-01-01') })`.
3. **Pas de snapshot** pour la logique métier (trop fragile). Asserts explicites.
4. **Nom de test en anglais**, descriptif : `it("auto-resolves BYE when single participant and no pending feeder")`.
5. **Mock DB** : abstraire via une factory injectable ou mocker `mysql2/promise.createPool`. Chaque test fournit son propre jeu de lignes mockées.
6. **Pas de dépendance inter-tests** : chaque `it` est isolé (`beforeEach` réinitialise tout).
7. **Couvrir les branches d'erreur** : chaque `throw`/`return fail()` doit avoir son test.

---

## 5. Prompts pour Haiku 4.5

Chaque prompt est **auto-suffisant** : Haiku peut l'exécuter sans contexte de cette conversation. Modèle cible : `claude-haiku-4-5-20251001` (rapide, excellent ratio coût/qualité pour écriture de tests).

### Invocation type (via Claude Agent SDK ou API directe)

```bash
# Depuis la racine du repo
npx claude-agent --model claude-haiku-4-5-20251001 --prompt "$(cat prompts/phase1.md)"
```

Ou via le sous-agent `general-purpose` avec `model: "haiku"`.

---

### 📝 Prompt — Phase 1 : Helpers purs

```
Tu travailles sur le projet Next.js 15 + TypeScript à C:\work\BlueGenji\appbluegenji (BlueGenji Arena, plateforme esports).

OBJECTIF : écrire des tests unitaires exhaustifs pour les helpers purs du serveur. Aucune I/O.

FICHIERS À TESTER (lire d'abord chacun pour connaître les signatures exactes) :
1. lib/server/serialization.ts — fonctions : nextPowerOfTwo, generateSeedOrder, normalizePseudo, slugifyPseudo, toIso, clampInt, parseRoles
2. lib/server/http.ts — helpers de réponse (ok, fail, ...)
3. lib/server/live.ts — EventEmitter singleton (events: updated, score_reported, score_resolved)

CONVENTIONS JEST (obligatoires, reprendre tests/lib/server/bot-integration.test.ts comme modèle) :
- import { describe, it, expect, jest, beforeEach, afterEach } from "@jest/globals";
- Alias @/ pour la racine
- testEnvironment: "node"

CRÉER :
- tests/lib/server/serialization.test.ts
- tests/lib/server/http.test.ts
- tests/lib/server/live.test.ts

COUVERTURE ATTENDUE (PAR FICHIER) :
- serialization.test.ts : au moins 25 cas. Couvrir : nextPowerOfTwo(0,1,2,3,4,5,7,8,16,31,32), generateSeedOrder pour tailles 2/4/8/16 (propriété : somme des seeds par round = size+1), normalizePseudo (accents, espaces multiples, casse, vide → throw), slugifyPseudo (caractères spéciaux), toIso (Date/string ISO/null/invalid), clampInt (bornes, non-nombre), parseRoles (JSON valide/invalide/null/array).
- http.test.ts : codes de statut, contenu body pour chaque helper.
- live.test.ts : émission et réception d'event, isolation entre consommateurs, pas de leak.

RÈGLES :
- 1 cas = 1 it() avec nom descriptif anglais.
- Asserts explicites, pas de snapshot.
- Pas de mocks (ces modules sont purs).

À LA FIN : lancer `npm test tests/lib/server/serialization.test.ts tests/lib/server/http.test.ts tests/lib/server/live.test.ts` et s'assurer que tout passe. Rapporter le nombre de tests et la couverture si dispo.
```

---

### 📝 Prompt — Phase 2 : Auth service

```
Projet : BlueGenji Arena — C:\work\BlueGenji\appbluegenji — Next.js 15 + MySQL2.

OBJECTIF : tester lib/server/auth.ts (sessions, cookies, hash tokens, pseudo uniqueness).

AVANT D'ÉCRIRE : lire intégralement lib/server/auth.ts + lib/server/database.ts pour repérer le point d'injection du pool MySQL.

FICHIER À CRÉER : tests/lib/server/auth.test.ts

STRATÉGIE DE MOCK :
- Mocker le module lib/server/database.ts via jest.mock() pour intercepter getPool() et retourner un objet { query: jest.fn() } configuré par test.
- Mocker next/headers (cookies()) via jest.mock() pour contrôler cookie.set/get/delete.

CAS À COUVRIR (minimum 20) :
1. hashToken : SHA-256 déterministe pour la même entrée, différent pour entrées différentes.
2. createSession : insère en DB avec token hashé (jamais token brut), TTL 30 jours, set cookie bg_session httpOnly sameSite=lax, secure=true en prod (NODE_ENV=production), secure=false en dev.
3. getCurrentUser : renvoie null si cookie absent, null si session expirée, user si session valide.
4. requireCurrentUser : throw/redirect si pas d'user (vérifier le comportement exact du code source).
5. destroySession : supprime ligne DB + clear cookie.
6. ensureUniquePseudo : retourne pseudo tel quel si libre, pseudo + suffixe si déjà pris (tester 2, 3, 4 collisions).
7. Edge : token vide, cookie malformé, row DB avec expired_at < now.

CONVENTIONS : cf. tests/lib/server/bot-integration.test.ts. Restore process.env et jest.restoreAllMocks() dans afterEach.

FIN : `npm test tests/lib/server/auth.test.ts` — tous verts.
```

---

### 📝 Prompt — Phase 3 : Tournament engine (le plus critique)

```
Projet : BlueGenji Arena — C:\work\BlueGenji\appbluegenji.

OBJECTIF : tests exhaustifs du moteur de brackets (lib/server/tournaments-service.ts, ~1774 lignes). C'est le cœur métier — couverture >= 90%.

AVANT D'ÉCRIRE, lire dans l'ordre :
1. lib/shared/types.ts (TournamentState, MatchStatus, BracketPosition)
2. lib/server/tournaments-service.ts
3. BYE_FUNCTIONALITY.md et VARIABLE_SIZE_TOURNAMENTS.md à la racine du projet (documentation métier)
4. lib/server/serialization.ts (generateSeedOrder — utilisé pour ordonner les seeds)

FICHIERS À CRÉER :
- tests/lib/server/tournaments-service.bracket.test.ts (génération bracket)
- tests/lib/server/tournaments-service.matches.test.ts (transitions matches + scores)
- tests/lib/server/tournaments-service.ranking.test.ts (finalisation tournoi + classement)

STRATÉGIE DE MOCK :
- Mocker lib/server/database.ts pour exposer un pool fake avec query() scriptée par test.
- Pour les gros scénarios, créer un helper tests/helpers/fake-db.ts qui simule une table en mémoire (Map par table) et répond aux requêtes SELECT/INSERT/UPDATE avec une logique minimale. Plus maintenable que scripter chaque query.
- Mocker lib/server/live.ts pour vérifier les events émis sans side effect.

CAS MINIMUM (objectif 50+ tests) :

A. Génération bracket single elim :
- 2, 4, 8, 16 participants : vérifie nombre de matches = size-1.
- 3 participants : 1 BYE round 1, finale = winner R1 vs seed 1.
- 5, 6, 7 participants : BYE placés correctement selon seed order.
- 13 participants : 3 BYE, bracket de 16.
- 1 participant : cas dégénéré (ou erreur, selon code).

B. Génération bracket double elim :
- 4, 8, 16 participants : Upper Bracket + Lower Bracket, Grand Final.
- LB round 1 = 2:1 pairing (sortants UB R1 → 2 matches LB).
- LB round impair → pair : 1:1 (pas de nouveaux entrants).
- LB round pair → impair : 2:1 (entrants UB du round suivant).
- Nombre total de matches = 2*size - 2 (ou 2*size - 1 avec reset Grand Final — vérifier le code source).

C. BYE handling :
- Slot unique + aucun feeder en attente → auto-resolve (winner = slot occupé).
- Match fantôme (2 BYE) → COMPLETED sans winner, propagation vers match suivant avec BYE.
- Slot unique + feeder en attente → PENDING (on attend la résolution du feeder).

D. Match state machine :
- PENDING → READY quand les 2 slots sont remplis.
- READY → AWAITING_CONFIRMATION quand un score est reporté.
- AWAITING_CONFIRMATION → COMPLETED quand les 2 reports concordent.
- AWAITING_CONFIRMATION + conflit → reste en AWAITING_CONFIRMATION + flag admin.
- COMPLETED : winner poussé vers match UB suivant, loser poussé vers LB (double elim) ou éliminé (single).

E. Score reports :
- 2 reports concordants → finalisation auto.
- 2 reports en conflit (scores différents) → pas de finalisation, flag conflict_admin_required=true.
- 1 seul report + deadline dépassée → vérifier le comportement (timeout).
- Reporter un score après match COMPLETED → erreur.

F. Ranking final :
- Tri : position bracket finale (1er > 2e > demi-finalistes > ...) puis wins desc, losses asc, date recent desc.
- Cas ex-aequo en demi-finale : tie-breaker par wins.

CONVENTIONS : cf. tests/lib/server/bot-integration.test.ts.

FIN :
1. `npm test tests/lib/server/tournaments-service.*.test.ts`
2. `npx jest --coverage --collectCoverageFrom="lib/server/tournaments-service.ts"`
3. Rapporter couverture statements/branches. Si < 85%, identifier les branches non couvertes (avec numéros de lignes) et ajouter les tests manquants.
```

---

### 📝 Prompt — Phase 4 : Teams & Users services

```
Projet : BlueGenji Arena — C:\work\BlueGenji\appbluegenji.

OBJECTIF : tester lib/server/teams-service.ts et lib/server/users-service.ts.

FICHIERS À CRÉER :
- tests/lib/server/teams-service.test.ts
- tests/lib/server/users-service.test.ts

LIRE D'ABORD : les deux fichiers source + lib/shared/types.ts (User, Team, TeamMember, TeamRole).

STRATÉGIE DE MOCK : fake-db en mémoire (réutiliser tests/helpers/fake-db.ts créé en phase 3). Mock de lib/server/database.ts.

CAS — teams-service :
1. Création équipe : OWNER ajouté automatiquement au membres.
2. Ajout membre : autorisé si OWNER ou CAPITAINE, refusé sinon.
3. Retrait membre : OWNER ne peut pas être retiré ; tout retrait par non-OWNER sauf self-leave refusé.
4. Rôles cumulatifs : un joueur peut avoir ["TANK", "DPS"] ; parseRoles + update.
5. Historique équipe : liste tournois joués + W/L calculés à partir des matches.
6. Edge : équipe inexistante (404), pseudo équipe dupliqué.

CAS — users-service :
1. Création user depuis Google OAuth (normalisation pseudo).
2. Création user depuis Discord (ID Discord unique).
3. Update visibility (public/privé).
4. getPublicProfile respecte visibility (privé → retour limité).
5. Liste joueurs paginée + filtres.

RÈGLES : cf. phases précédentes (AAA, déterministe, AfterEach restore).

FIN : `npm test tests/lib/server/teams-service.test.ts tests/lib/server/users-service.test.ts`.
```

---

### 📝 Prompt — Phase 5 : Routes API Auth

```
Projet : BlueGenji Arena — C:\work\BlueGenji\appbluegenji — Next.js 15 App Router.

OBJECTIF : tester les routes API d'authentification.

ROUTES À COUVRIR (vérifier les chemins exacts dans app/api/auth/) :
- POST /api/auth/discord/request (tests/app/api/auth/discord/request/route.test.ts existe déjà — l'ÉTENDRE, ne pas écraser)
- POST /api/auth/discord/verify → tests/app/api/auth/discord/verify/route.test.ts
- GET /api/auth/google/callback → tests/app/api/auth/google/callback/route.test.ts
- POST /api/auth/logout → tests/app/api/auth/logout/route.test.ts
- GET /api/auth/me → tests/app/api/auth/me/route.test.ts

LIRE D'ABORD : tests/app/api/auth/discord/request/route.test.ts et tests/app/api/auth/google/start/route.test.ts pour reprendre le pattern exact (invocation de handler exporté, construction NextRequest, assertion sur Response).

STRATÉGIE DE MOCK :
- jest.mock("@/lib/server/auth")
- jest.mock("@/lib/server/bot-integration")
- jest.mock("@/lib/server/google-oauth")
- jest.mock("@/lib/server/users-service")
- jest.mock("next/headers") pour cookies()

CAS PAR ROUTE (minimum 4 chacune) :
- Happy path (200/302 selon la route).
- Payload invalide (400).
- Auth manquante / cookie absent (401).
- Dépendance externe en erreur (502 ou 500 selon convention du projet — vérifier lib/server/http.ts).
- Pour verify : code valide, code expiré, code inconnu.
- Pour google/callback : code valide → session créée + cookie set, state invalide → 400.
- Pour /me : avec session → user JSON ; sans → 401.

FIN : `npm test tests/app/api/auth/`. Tous verts.
```

---

### 📝 Prompt — Phase 6 : Routes API Tournois

```
Projet : BlueGenji Arena — C:\work\BlueGenji\appbluegenji.

OBJECTIF : tester les routes API des tournois.

ROUTES (chemins réels à vérifier dans app/api/tournaments/) :
- GET  /api/tournaments → tests/app/api/tournaments/list.test.ts
- POST /api/tournaments → tests/app/api/tournaments/create.test.ts
- GET  /api/tournaments/[id] → tests/app/api/tournaments/[id]/get.test.ts
- POST /api/tournaments/[id]/register → tests/app/api/tournaments/[id]/register.test.ts
- POST /api/tournaments/[id]/matches/[matchId]/report → tests/app/api/tournaments/[id]/matches/[matchId]/report.test.ts
- GET  /api/tournaments/[id]/stream (SSE) → tests/app/api/tournaments/[id]/stream.test.ts

STRATÉGIE : jest.mock pour lib/server/auth + lib/server/tournaments-service + lib/server/teams-service.

CAS MINIMUM (3-5 par route) :
- GET list : buckets retournés (UPCOMING / REGISTRATION / RUNNING / FINISHED).
- POST create : refus non-authentifié (401), refus sans rôle organizer (403), validation payload (400), succès (201).
- GET [id] : inexistant (404), bracket rendu complet.
- register : équipe déjà inscrite (409), quotas atteints (409), réussite (200).
- report : not participant (403), match déjà complété (409), score invalide (400), succès (200).
- stream : headers text/event-stream, content-type correct (smoke only).

CONVENTIONS : pattern de tests/app/api/auth/google/start/route.test.ts.

FIN : `npm test tests/app/api/tournaments/`.
```

---

### 📝 Prompt — Phase 7 : Routes API Teams, Players, Profile

```
Projet : BlueGenji Arena — C:\work\BlueGenji\appbluegenji.

OBJECTIF : tester routes équipes, joueurs publics, profil utilisateur.

ROUTES (vérifier chemins) :
- GET/POST /api/teams
- GET/PUT  /api/teams/[id]
- POST/DELETE /api/teams/[id]/members
- GET /api/players, /api/players/[id]
- GET/PUT /api/profile

PATTERN : jest.mock des services + auth. 3-4 cas par route (happy + auth + validation + erreur métier).

POINTS D'ATTENTION :
- Privacy : GET /api/players/[id] avec profil privé → champs sensibles masqués.
- Permissions équipe : seuls OWNER/CAPITAINE peuvent POST members.
- PUT /api/profile : seul le user lui-même peut modifier.

FIN : `npm test tests/app/api/teams/ tests/app/api/players/ tests/app/api/profile/`.
```

---

### 📝 Prompt — Phase 8 : Admin, Landing, Bot

```
Projet : BlueGenji Arena — C:\work\BlueGenji\appbluegenji.

OBJECTIF : tester routes admin, landing publiques, bot stats.

ROUTES :
- POST /api/admin/matches/[matchId]/scores
- POST /api/admin/matches/[matchId]/resolve
- GET  /api/landing/{stats,live,leaderboard,calendar,ticker,sponsors}
- GET  /api/bot/stats

CAS :
- Admin routes : 403 si is_admin=false, 200 si admin ; 404 si match inconnu.
- Landing : format de réponse conforme (structure JSON stable — tester clés présentes, pas les valeurs exactes). Fallback quand DB/bot indispo.
- bot/stats : mock bot-integration, tester cas succès et bot unreachable (retour gracieux).

FIN : `npm test tests/app/api/admin/ tests/app/api/landing/ tests/app/api/bot/`.
```

---

### 📝 Prompt — Phase 9 : Intégration E2E

```
Projet : BlueGenji Arena — C:\work\BlueGenji\appbluegenji.

OBJECTIF : un test d'intégration couvrant un tournoi complet, de la création à la finalisation, avec DB réelle (ou fake-db en mémoire suffisamment fidèle).

FICHIER : tests/integration/tournament-flow.test.ts

SCÉNARIO (1 describe, plusieurs it ordonnés) :
1. Créer 8 utilisateurs + 4 équipes (via services, pas via API).
2. Créer un tournoi single-elim 4 équipes.
3. Passer état UPCOMING → REGISTRATION, inscrire les 4 équipes.
4. Passer REGISTRATION → RUNNING → bracket généré (vérifier : 3 matches, seed order correct).
5. Pour chaque match R1 : reporter scores concordants des 2 camps → finalisation → winner propagé.
6. Finale : reports concordants → winner.
7. Tournoi passe à FINISHED. Vérifier le ranking : champion = équipe qui a gagné la finale, runner-up, 2 demi-finalistes.

ÉGALEMENT (second describe, plus court) :
- Scénario 8 équipes double-elim : vérifier que le loser de la finale UB descend en LB Final.

POINTS DE CONTRÔLE :
- Après chaque action, vérifier que l'EventEmitter live.ts a émis l'event attendu.
- Pas de race condition (tests séquentiels strictement).

FIN : `npm test tests/integration/ -- --runInBand`. Rapporter couverture globale du projet : `npx jest --coverage`.
```

---

## 6. Commandes utiles

```bash
# Un seul fichier
npx jest tests/lib/server/serialization.test.ts

# Tout un dossier
npx jest tests/app/api/tournaments/

# Couverture ciblée
npx jest --coverage --collectCoverageFrom="lib/server/tournaments-service.ts"

# Mode watch pendant l'écriture
npx jest --watch tests/lib/server/

# Full suite
npm test && npm run test:coverage
```

---

## 7. Checklist finale

- [ ] Phase 1 (helpers purs) verte
- [ ] Phase 2 (auth) verte — couverture auth.ts ≥ 95 %
- [ ] Phase 3 (tournaments) verte — couverture tournaments-service.ts ≥ 90 %
- [ ] Phase 4 (teams/users) verte
- [ ] Phase 5 (auth routes) verte
- [ ] Phase 6 (tournament routes) verte
- [ ] Phase 7 (team/player/profile routes) verte
- [ ] Phase 8 (admin/landing/bot routes) verte
- [ ] Phase 9 (intégration E2E) verte
- [ ] Couverture globale ≥ 75 % statements / 70 % branches
- [ ] `npm test` sans skip ni `.only`
- [ ] CI green (si pipeline existante)
