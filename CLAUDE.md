# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

BlueGenji Arena is a French esports platform for amateur Marvel Rivals and Overwatch 2 tournaments. It manages tournaments, team/player profiles, and integrates with a Discord bot.

## Commands

```bash
npm run dev          # Dev server with Turbopack
npm run build        # Production build
npm run lint         # ESLint
npm test             # Jest test suite
npm run test:coverage
npm run seed         # Populate MySQL with test data (matrice de cas, voir ci-dessous)
npm run seed:view    # Inspect seeded test data
```

Running a single test file:
```bash
npx jest tests/path/to/file.test.ts
```

## Architecture

### Stack
- **Next.js 15** (App Router), React 18, TypeScript strict mode
- **MySQL 8+** via `mysql2` — no ORM, raw queries with auto-migration on first API access (`lib/server/database.ts`)
- **Tailwind CSS 4**, Radix UI components, Lucide icons

### Route Layout
- `/` — Landing page
- `/connexion` — Passwordless login (Google OAuth + Discord 6-digit code via DM)
- `/regles` + `/regles/[slug]` — Règles publiques de chaque mode de tournoi (schémas SVG inline). Contenu et mapping format → page dans `lib/shared/tournament-rules.ts` ; ajouter un mode = ajouter une entrée au registre (les pages sont pré-générées via `generateStaticParams`). Le bouton flottant « ? » des pages de tournoi (`components/rules/RulesHelpFab.tsx`) résout sa cible depuis le format du tournoi.
- `/(secured)/*` — Auth-protected routes: `tournois`, `equipes`, `joueurs`, `profil`
- `/api/*` — REST API routes (no tRPC, no server actions)

### Auth System (`lib/server/auth.ts`)
Sessions are stored in `bg_user_sessions` with SHA-256 hashed tokens, 30-day TTL, cookie `bg_session` (httpOnly, sameSite=lax). Two login paths:
1. **Google OAuth** — redirect to Google, callback at `/api/auth/google/callback`
2. **Discord code** — bot sends 6-digit code via DM, user submits at `/api/auth/discord/verify`, expires in 10 min

Auth enforcement: `requireCurrentUser()` is called server-side in `app/(secured)/layout.tsx`.

### Database (`lib/server/database.ts`)
Direct MySQL2 pool. Schema migrations run automatically on first query. Tables: `bg_users`, `bg_teams`, `bg_team_members`, `bg_tournaments`, `bg_tournament_registrations`, `bg_matches`, `bg_user_sessions`.

### Tournament Engine (`lib/server/tournaments-service.ts`)
Supports single/double elimination, Swiss round and Survival formats. Key concepts:
- **Formats:** `SINGLE`, `DOUBLE`, `SWISS` (see `plans/SwissRound.md`), `SURVIVAL` (single group, seed by site ranking, adjacent pairing, periodic bottom-2 cuts until one champion ; odd field → round-1 barrage between the bottom two so no byes are ever handed out — see `docs/features/SURVIVAL_MODE.md`). Survival logic lives in `lib/shared/survival.ts` (pure) + `lib/server/tournaments/survival.ts` (orchestration, idempotent `reconcileSurvival`).
- **States:** `UPCOMING → REGISTRATION → RUNNING → FINISHED`
- **Bracket positions:** `UPPER`, `LOWER`, `GRAND` finals
- **Match status:** `PENDING → READY → AWAITING_CONFIRMATION → COMPLETED`
- **Verrouillage de l'édition d'un score** (`lib/shared/match-lock.ts`) : un score n'est plus modifiable — **y compris par un admin** — dès que la manche suivante porte la moindre saisie (un score même nul, un vainqueur, un forfait, ou un report en attente de confirmation). Les matchs dépendants suivent le format : liens `next_winner_match_id` / `next_loser_match_id` en élimination, tous les rounds ultérieurs en survie et en ronde suisse (leurs appariements sont recalculés depuis le classement). Le module est pur et partagé : le serveur l'applique dans `checkDownstreamMatchesHaveNoScores` (`lib/server/tournaments/admin.ts`, erreur `CANNOT_MODIFY_COMPLETED_DEPENDENT_MATCHES` → 409) et l'interface masque le bouton « Éditer le score » au profit d'un indicateur « 🔒 Score verrouillé ». Les byes et matchs fantômes sont ignorés : leur score (1-0, 0-0) est posé par le moteur, pas saisi.
- Bye slots for non-power-of-2 participant counts (`docs/features/BYE_FUNCTIONALITY.md`)
- Variable bracket sizing (`docs/features/VARIABLE_SIZE_TOURNAMENTS.md`)
- Swiss rounds: fixed number of rounds, pairing by points/standing, no elimination

### Live Updates (`lib/server/live.ts`)
Node.js `EventEmitter` singleton publishes tournament events (`updated`, `score_reported`, `score_resolved`). Consumed via SSE at `/api/tournaments/[id]/stream`.

### Bot Integration (`lib/server/bot-integration.ts`)
HTTP calls to an internal Discord bot (configurable host/port). Gracefully degrades if bot is unreachable. Used for: auth DM codes, score conflict logging, stats.

### Bot Documentation (`lib/server/bot-docs.ts`)
`/bot/docs/[[...slug]]` sert la doc Markdown du projet `blueGenjiBot`. Les fichiers ne sont **pas** copiés dans ce dépôt : ils sont lus sur disque à chaque revalidation (60 s) depuis le dossier voisin (`../blueGenjiBot`, surchargeable via `BOT_DOCS_PATH`), donc une mise à jour de la doc du bot apparaît sans rebuild. Les pages exposées sont listées dans `BOT_DOC_SECTIONS` — ce registre sert aussi de garde-fou anti-traversée de chemin : ajouter un doc = ajouter une entrée. Le rendu Markdown est un mini-parser maison (titres, listes, code, liens), sans dépendance externe. Si un fichier est introuvable, la page dégrade avec un message au lieu de planter.

### Shared Types (`lib/shared/types.ts`)
All TypeScript interfaces live here. Read this file first when working on any feature.

### Path Alias
`@/*` maps to project root (configured in `tsconfig.json`).

## Environment Variables

```env
DB_HOST=
DB_USER=
DB_PASSWORD=
DB_DATABASE=
APP_URL=http://localhost:3000
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URI=http://localhost:3000/api/auth/google/callback
BOT_INTERNAL_URL=http://127.0.0.1:4400   # optional
BOT_INTERNAL_TOKEN=                        # must match bot's INTERNAL_API_TOKEN
DEV_AUTH_USER_ID=                          # optional — bypass auth in dev (see below)
BOT_DOCS_PATH=                             # optional — chemin du projet blueGenjiBot (défaut: ../blueGenjiBot)
```

## Preview / dev auth bypass

Pour vérifier les pages protégées (`/tournois`, `/equipes`, `/joueurs`, `/profil`, etc.) sans passer par Google OAuth ni le code Discord, définir `DEV_AUTH_USER_ID=<id>` dans `.env` (par exemple `321` pour le user admin). La fonction `getCurrentUser()` dans `lib/server/auth.ts` retournera ce user tant que `NODE_ENV !== "production"`, en court-circuitant le cookie de session — toutes les routes API et le `app/(secured)/layout.tsx` s'authentifient automatiquement. **Redémarre le dev server après modification de `.env`** pour que Next.js prenne en compte la nouvelle valeur. Désactiver = supprimer/vider la var. La garde-fou est double (`NODE_ENV !== "production"` ET ID entier valide) ; ne JAMAIS définir cette var en prod.

## Jeu de test (`npm run seed`)

`npm run seed` **écrase** les données de test (tout ce qui est préfixé `Test_` / `Test - `, plus la table `bg_bureau_members`) puis régénère une matrice de cas destinée à couvrir un maximum de combinaisons en une exécution :

- **Comptes** (`lib/server/seed.ts` → `SPECIAL_USERS`) : admin, un compte par rôle de plateforme (`ARBITRE`, `COMMUNITY_MANAGER`, `RECRUTEUR`) + un cumul, profil tout privé / tout public, mineur, majorité inconnue, sans tags de jeu, sans équipe, compte anonymisé. L'id de l'admin est affiché en fin de seed : c'est la valeur à mettre dans `DEV_AUTH_USER_ID`.
- **Équipes** : rosters complets avec rôles cumulés (`OWNER`/`CAPITAINE`/`TANK`/`DPS`/`HEAL`/`COACH`/`MANAGER`), plus les cas limites (équipe à un seul membre, équipe sans joueur, avec/sans logo) et ~140 équipes de remplissage pour les gros brackets.
- **Tournois** (`lib/server/seed-cases.ts` → `TOURNAMENTS`) : la matrice **état × format × effectif × situation de match**. 4 états, 4 formats (`SINGLE` avec/sans petite finale, `DOUBLE`, `SWISS`, `SURVIVAL`), effectifs de 0 à 128 (puissances de 2 et effectifs à byes), survie impaire 3/5/7/9/11/15/21 (barrage) avec cadences 1/2/3 et forfaits, plus les états intermédiaires du cycle de report (report en attente, conflit de scores, délai dépassé).

Ajouter un cas = ajouter une entrée à `TOURNAMENTS` ; `lib/server/seed-cases.ts` est volontairement sans accès base pour rester testable (`tests/lib/server/seed-cases.test.ts` garde la couverture de la matrice). Les résultats de matchs sont tirés par un LCG réamorcé par tournoi : **le seed est reproductible** d'une exécution à l'autre.

## Key Conventions

- All UI text is in **French**.
- **Error and success messages** must always appear as overlay notifications (bottom-left) via `useToast()` from `@/components/ui/toast`. Never render them inline in the page body. Use `showError(message)` for errors and `showSuccess(message)` for success feedback.
- `lib/server/*` is server-only code; never import from client components.
- `lib/shared/*` is safe to import anywhere.
- `normalizePseudo()` / `slugifyPseudo()` for username normalization, `toIso()` for dates, `parseRoles()` for JSON role arrays — always use these helpers, don't re-implement.
- User roles on teams are cumulative strings stored as JSON arrays (`OWNER`, `CAPITAINE`, `MANAGER`, `COACH`, `TANK`, `DPS`, `HEAL`).
- Admin users have `is_admin = true` in `bg_users`; admin-only routes live under `app/api/admin/`.
- **Rôles de permission de plateforme** (cumulables, distincts des rôles d'équipe) : `ADMIN`, `ARBITRE` (tournois), `COMMUNITY_MANAGER` (site vitrine + association), `RECRUTEUR` (recrutement). Toujours protéger une route avec `can(user, "<permission>")` de `@/lib/shared/permissions` (permissions : `tournaments`, `showcase`, `recruitment`, `roles`) — ne pas tester `user.isAdmin` directement pour un domaine scopé. `ADMIN` a tous les droits. Voir `docs/features/PERMISSION_ROLES.md`.

## Design System — « Cyber minimal » (Finalisé)

La refonte « Cyber minimal » est complète (Phases 1–7). Design final : noir profond teinté cool, bleu glacier `#5ac8ff`, typographie Inter / JetBrains Mono / Orbitron, glow paramétrable.

### Tokens CSS
- **Cyber tokens** : `--cyber-bg`, `--cyber-bg-1`, `--cyber-bg-2`, `--cyber-bg-3`, `--ink`, `--ink-mute`, `--ink-dim`, `--blue-100`–`--blue-700`, `--blue-glow`, `--amber`, `--red-live`, `--line-soft`, `--line-strong-cy`, `--r-cy-sm/md/lg`
- **Legacy tokens** conservés pour retrocompatibilité : `--bg-0`–`--bg-2`, `--text-0`–`--text-2`, `--accent-blue/orange/green`, `--radius`, `--shadow`

### Composants
Primitives dans `components/cyber/` :
- **CyberButton** — `variant="primary"|"ghost"`, support `asChild` (Radix Slot)
- **CyberCard** — `lift`, `ticks`, `as="div|section|article"`, style personnalisé
- **Pill** — badges inline, variantes `.pill-live`, `.pill-blue`
- **CyberButton, TeamSigil, CountdownStrip, Ticker, MiniBracket** — composants spécialisés
- **PublicHeader, PublicFooter** — layouts publics de landing

Classes utilitaires : `.eyebrow`, `.display`, `.mono`, `.logotype`, `.num`, `.fabric`, `.card-ticks`, `.section-head`

### Typographie
- **Sans-serif** : Inter (`var(--font-sans)`)
- **Monospace** : JetBrains Mono (`var(--font-mono)`)
- **Display** : Orbitron (animations logo hero)
- Legacy : Rajdhani, Exo_2 conservés mais dépréciés

### Notifications & Toasts
Règle universelle : via `useToast()` (`@/components/ui/toast`), bottom-left overlay, jamais inline. `showError(message)`, `showSuccess(message)`.

### Pages Refaites
- `/` (landing) — Hero, About, Leaderboard/Calendar, Sponsors, Tournament Board, Ticker
- `/association` — CyberCard grid, stats
- `/partenaires` — Sponsors grid
- `/bot` — Hero 2-col + stats card, Features (3 cards), Commands (1 card gris)
- `/connexion` — CyberCard centré, 2 étapes (Google OAuth + Discord code)
- `/(secured)/tournois`, `/equipes`, `/joueurs`, `/profil` — refonte complète avec CyberCard, layouts sécurisés

### Classes CSS Supprimées (Phase 7)
- `.ds-hero`, `.ds-chip` (toutes variantes)
- `.cta-float` (conservé `.cta-float-home`)
- `.shimmer`, `.glow-pulse-*`, `.float-subtle`, `.tournament-card`
- Réduction : 1549 → 1283 lignes dans `app/globals.css` (-266 lignes)

### Endpoints Landing
`/api/landing/{stats,live,leaderboard,calendar,ticker}` — coexistence avec endpoints existants (pas de suppression).

## Communication Style

- **Exécute sans détailler** : Ne décris pas ce que tu vas faire avant d'agir. Fais simplement le travail.
- **Court résumé à la fin** : Une fois le travail terminé, fais un court résumé des changements effectués et des problèmes rencontrés, le cas échéant.
- **Arrête les previews** : À la fin de chaque prompt, arrête tous les serveurs de prévisualisation (`npm run dev`, tests serveurs, etc.) pour éviter les accumulations de processus.

---

## Règles de travail

### Tests
- Chaque feature développée doit être accompagnée d'une couverture de tests complète et efficace (`npm test`).
- Les tests doivent couvrir les cas nominaux, les cas limites et les cas d'erreur.
- Aucune feature n'est considérée comme terminée sans ses tests associés.

### Branches
- Pour chaque demande de feature, créer une branche dédiée : `feature/<nom-de-la-feature>` (kebab-case, anglais de préférence).
- Exemple : `feature/swiss-pairing`, `feature/discord-login`.

### Pull Requests
- À l'achèvement d'une feature, ouvrir une Pull Request vers `main`.
- Si le CI de la PR échoue, tenter de corriger automatiquement dans cet ordre : lint → build → tests.
- Si une erreur ne peut pas être corrigée automatiquement, l'expliquer clairement et proposer une piste de résolution.

### CI / Qualité
- Le CI GitHub Actions (`.github/workflows/ci.yml`) vérifie à chaque PR : lint → build → tests (dans cet ordre, enchaînés via `needs:`).
- Ne pas merger si le CI est rouge.

### Gestion de la complexité
- Pour toute demande importante (≥ 2 features liées, refactoring architectural, intégration d'un nouveau service externe, ou tâche estimée > ~2h), utiliser le skill `/OpusLocalManager` pour planifier et orchestrer le travail.

---

## Pipeline Git (workflow de livraison)

Chaque tâche : quatre commits sur une branche de feature, puis une revue de PR.

**Règle Co-Authored-By :**
- **Tous** les commits (fonctionnel, docs, tests, polish) portent le trailer `Co-authored-by: Claude Opus 4.8 <noreply@anthropic.com>`.

Enchaîner la pipeline **sans s'arrêter** : ne pas attendre de validation de l'utilisateur après le commit fonctionnel — dérouler les commits, le push et la PR d'affilée.

Ajouter le trailer avec `git commit --trailer 'Co-authored-by: Claude Opus 4.8 <noreply@anthropic.com>'`.

1. **Branche de feature** : `git checkout -b feature/<short-name>`
2. **Commit fonctionnel** : ≤ 5 mots, impératif minuscule — `add swiss pairing` — *avec Co-Authored-By*
3. **Commit docs** : README / JSDoc limité à ce qui a été construit — *avec Co-Authored-By*
4. **Commit tests** : `jest` — *avec Co-Authored-By*
5. **Commit polish UI/UX** : espacements, états, accessibilité — aucun changement de logique — *avec Co-Authored-By*
6. **Push** : `git push -u origin feature/<short-name>`
7. **Revue de PR** : ouvrir la PR (`gh pr create`), puis lancer une revue du diff avec `/code-review --comment` pour poster les retours en **commentaires inline** sur la PR. Traiter les points bloquants, puis seulement rendre la main à l'utilisateur.
