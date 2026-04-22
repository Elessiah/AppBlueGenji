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

## Communication Style

- **Exécute sans détailler** : Ne décris pas ce que tu vas faire avant d'agir. Fais simplement le travail.
- **Court résumé à la fin** : Une fois le travail terminé, fais un court résumé des changements effectués et des problèmes rencontrés, le cas échéant.
