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
npm run seed         # Populate MySQL with test data (16 users, 8 teams, 4 tournaments)
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
Supports single and double elimination brackets. Key concepts:
- **States:** `UPCOMING → REGISTRATION → RUNNING → FINISHED`
- **Bracket positions:** `UPPER`, `LOWER`, `GRAND` finals
- **Match status:** `PENDING → READY → AWAITING_CONFIRMATION → COMPLETED`
- Bye slots for non-power-of-2 participant counts (`BYE_FUNCTIONALITY.md`)
- Variable bracket sizing (`VARIABLE_SIZE_TOURNAMENTS.md`)

### Live Updates (`lib/server/live.ts`)
Node.js `EventEmitter` singleton publishes tournament events (`updated`, `score_reported`, `score_resolved`). Consumed via SSE at `/api/tournaments/[id]/stream`.

### Bot Integration (`lib/server/bot-integration.ts`)
HTTP calls to an internal Discord bot (configurable host/port). Gracefully degrades if bot is unreachable. Used for: auth DM codes, score conflict logging, stats.

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
```

## Key Conventions

- All UI text is in **French**.
- **Error and success messages** must always appear as overlay notifications (bottom-left) via `useToast()` from `@/components/ui/toast`. Never render them inline in the page body. Use `showError(message)` for errors and `showSuccess(message)` for success feedback.
- `lib/server/*` is server-only code; never import from client components.
- `lib/shared/*` is safe to import anywhere.
- `normalizePseudo()` / `slugifyPseudo()` for username normalization, `toIso()` for dates, `parseRoles()` for JSON role arrays — always use these helpers, don't re-implement.
- User roles on teams are cumulative strings stored as JSON arrays (`OWNER`, `CAPITAINE`, `MANAGER`, `COACH`, `TANK`, `DPS`, `HEAL`).
- Admin users have `is_admin = true` in `bg_users`; admin-only routes live under `app/api/admin/`.

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
