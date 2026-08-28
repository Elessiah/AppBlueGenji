# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

BlueGenji Esport is a French esports platform for amateur Marvel Rivals and Overwatch tournaments. It manages tournaments, team/player profiles, and integrates with a Discord bot.

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
- **Formats:** `SINGLE`, `DOUBLE`, `SWISS`, `SURVIVAL` (single group, seed by site ranking, adjacent pairing, coupes des 2 derniers — `survivalRoundsBeforeFirstCut` manches avant la première, puis toutes les `survivalRoundsPerCut` — jusqu'à une championne ; odd field → round-1 barrage between the bottom two so no byes are ever handed out — see `docs/features/SURVIVAL_MODE.md`). Survival logic lives in `lib/shared/survival.ts` (pure) + `lib/server/tournaments/survival.ts` (orchestration). `reconcileSurvival` **rejoue** tout le tournoi depuis l'historique des matchs (`replaySurvival`) : victoires, défaites, éliminations et rangs sont dérivés, jamais accumulés — une correction de score défait donc la coupe qu'elle avait provoquée, et le round suivant est réapparié tant qu'il n'est pas entamé. Seuls les abandons sont conservés en entrée. Le seeding utilise le barème partagé de `lib/shared/ranking.ts`, commun au leaderboard de la landing.
- **Format `MULTI` (multi-phases)** : suite ordonnée de 2 à 8 phases, chacune dans son propre format (`SWISS`/`SURVIVAL`/`SINGLE`/`DOUBLE`), ne transmettant que ses qualifiées à la suivante — la dernière désigne la championne. La qualification se règle par phase, **en nombre fixe** (l'effectif réel étant déjà sous la cible, la phase est **sautée** : c'est le cas du tournoi sous-rempli) ou **en pourcentage** (la cible s'adapte à l'effectif). Une phase `SINGLE` intermédiaire arrondit sa cible à la puissance de deux inférieure et joue un bracket tronqué ; `DOUBLE` n'est autorisé qu'en phase finale. Le plan restant est **re-résolu à chaque fin de phase** avec le nombre réel de qualifiées, si bien qu'un abandon peut faire sauter une phase ultérieure. Logique pure dans `lib/shared/tournament-phases.ts`, orchestration dans `lib/server/tournaments/phases.ts` (`initializeMultiTournament` → `startPhase` → `reconcilePhases` → `finalizeMultiTournament`). Les matchs portent un `phase_id` (**0** = tournoi sans phases, ce qui laisse tous les formats existants inchangés). Voir `docs/features/MULTI_PHASE_TOURNAMENTS.md`.
- **Mode `BG_SURVIE` (« BlueGenji Survie »)** : capital d'**endurance** (9 par défaut, réglable) — +1 par map gagnée, −1 par map perdue, **élimination immédiate à 0**. Classement relu avant chaque manche (endurance puis **ordre du classement précédent**, pas le seed), appariement par couples adjacents, la mieux classée à gauche ; effectif impair → la dernière ne joue pas (aucune victoire d'office). La phase qualificative s'arrête à 8 équipes, puis arbre imposé **8v4 / 6v2 / 1v5 / 3v7** + petite finale (manches numérotées à partir de 1000). Classement de départ = **ordre de seeding fixé à la main**. Logique pure `lib/shared/bg-survie.ts`, orchestration `lib/server/tournaments/bg-survie.ts`, table `bg_endurance_standings`, rejeu complet comme la Survie. Distinct de `SURVIVAL`, qui reste inchangé. Voir `docs/features/BG_SURVIE_MODE.md`.
- **Tournoi individuel** (`bg_tournaments.participant_type = 'SOLO'`) : les joueurs s'inscrivent eux-mêmes, sans équipe. Le moteur ne connaît que des **engagés** identifiés par un `team_id` ; un joueur reçoit donc une **entrée solo** (ligne `bg_teams` avec `solo_user_id`, sans membre, comme une fantôme), créée à sa première inscription. Tous les formats fonctionnent inchangés. L'entrée solo n'est pas une équipe : exclue de `/equipes`, du classement du site et du compteur d'équipes ; sa fiche renvoie vers `/joueurs/[id]`. Résolution unique de l'engagé : `resolveUserEntrantTeamId` (`lib/server/tournaments/registration.ts`), à utiliser pour l'inscription, le report de score et l'abandon. Vocabulaire pur dans `lib/shared/participants.ts`, service dans `lib/server/solo-entries-service.ts`. Voir `docs/features/SOLO_TOURNAMENTS.md`.
- **Format de match** (`lib/shared/match-format.ts`, pur) : chaque tournoi peut fixer un **BO** (best of, nombre impair de manches jouées) ou un **FT** (first to, manches à gagner) — BO5 et FT3 décrivent la même course : 3 manches à gagner, 5 au maximum. Deux colonnes `bg_tournaments.match_format_type` / `match_format_value` (NULL = score libre, comportement des tournois antérieurs). `checkMatchScores` est l'unique implémentation, partagée : l'interface borne les champs et désactive « Gagnant », le serveur refuse en 400 (`SCORE_EXCEEDS_MATCH_FORMAT`, `SCORE_BELOW_MATCH_FORMAT`) dans `reportMatchScore` et dans l'arbitrage. Une sauvegarde intermédiaire ne contrôle que le plafond ; une saisie qui désigne un vainqueur exige l'objectif. Le réglage vaut pour **tout** le tournoi, phases comprises. Voir `docs/features/MATCH_FORMAT.md`.
- **States:** `UPCOMING → REGISTRATION → RUNNING → FINISHED`
- **Bracket positions:** `UPPER`, `LOWER`, `GRAND` finals
- **Match status:** `PENDING → READY → AWAITING_CONFIRMATION → COMPLETED`
- **Verrouillage de l'édition d'un score** (`lib/shared/match-lock.ts`, phase-aware : en `MULTI`, la règle interne est celle du format **de la phase**, et toute phase ultérieure verrouille les précédentes) : un score n'est plus modifiable — **y compris par un admin** — dès que la manche suivante porte la moindre saisie (un score même nul, un vainqueur, un forfait, ou un report en attente de confirmation). Les matchs dépendants suivent le format : liens `next_winner_match_id` / `next_loser_match_id` en élimination, tous les rounds ultérieurs en survie et en ronde suisse (leurs appariements sont recalculés depuis le classement). Le module est pur et partagé : le serveur l'applique dans `checkDownstreamMatchesHaveNoScores` (`lib/server/tournaments/admin.ts`, erreur `CANNOT_MODIFY_COMPLETED_DEPENDENT_MATCHES` → 409) et l'interface masque le bouton « Éditer le score » au profit d'un indicateur « 🔒 Score verrouillé ». Les byes et matchs fantômes sont ignorés : leur score (1-0, 0-0) est posé par le moteur, pas saisi.
- **Ordre de seeding réordonnable** (`lib/shared/seeding.ts` pur + `lib/server/tournaments/seeding.ts`) : le staff `tournaments` ordonne les inscrites avec des flèches, **jusqu'à la première saisie de score** (même règle que `match-lock`). `bg_tournaments.manual_seeding` bascule Survie / Suisse / Multi du seeding par classement de site vers l'ordre saisi ; l'élimination lisait déjà `registrations.seed`. Un plateau déjà généré mais vierge est détruit puis régénéré. Voir `docs/features/SEEDING_ORDER.md`.
- Bye slots for non-power-of-2 participant counts (`docs/features/BYE_FUNCTIONALITY.md`)
- Variable bracket sizing (`docs/features/VARIABLE_SIZE_TOURNAMENTS.md`)
- **Ronde suisse** (`SWISS`, ouvert à la création — `docs/features/SWISS_MODE.md`) : nombre de rondes fixe, aucune élimination, appariement par groupe de points. Même modèle que la Survie : logique pure dans `lib/shared/swiss.ts` (rejeu, points, départages) + `lib/shared/swiss-pairing.ts` (appariement par **retour sur trace**, qui trouve les combinaisons sans rematch qu'un tirage glouton manque), orchestration dans `lib/server/tournaments/swiss.ts`. `reconcileSwiss` **rejoue** tout depuis l'historique des matchs (`replaySwiss`) — une correction de score se répercute d'elle-même sur le classement et réapparie la ronde suivante tant qu'elle n'est pas entamée ; seuls seed initial et abandons sont stockés en entrée. Piège à connaître : apparier la ronde R se fait sur l'état rejoué **avant** R (`SwissState.before`), sinon les paires déjà posées bloquent leur propre reformation. Départages : Buchholz, Sonneborn-Berger, % de victoires adverses, confrontation directe, puis seed. Seeding par `lib/shared/ranking.ts`, comme la Survie et le leaderboard.

### Live Updates (`lib/server/live.ts`)
Node.js `EventEmitter` singleton publishes tournament events (`updated`, `score_reported`, `score_resolved`). Consumed via SSE at `/api/tournaments/[id]/stream`.

### Bot Integration (`lib/server/bot-integration.ts`)
HTTP calls to an internal Discord bot (configurable host/port). Gracefully degrades if bot is unreachable. Used for: auth DM codes, score conflict logging, stats, **fréquentation du site**. Le sens des appels est toujours app → bot : pour exposer une donnée du site dans une commande Discord, l'app **pousse** un instantané sur `/internal/*` — le bot n'appelle jamais le site en retour.

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
VISIT_HASH_SALT=                           # recommandé — sel des empreintes de visiteur (défaut: BOT_INTERNAL_TOKEN)
TRUSTED_PROXY_HOPS=1                       # optional — proxys de confiance devant l'app (X-Forwarded-For)
```

## Preview / dev auth bypass

Pour vérifier les pages protégées (`/tournois`, `/equipes`, `/joueurs`, `/profil`, etc.) sans passer par Google OAuth ni le code Discord, définir `DEV_AUTH_USER_ID=<id>` dans `.env` (par exemple `321` pour le user admin). La fonction `getCurrentUser()` dans `lib/server/auth.ts` retournera ce user **uniquement si `NODE_ENV === "development"`** (c.-à-d. `next dev`), en court-circuitant le cookie de session — toutes les routes API et le `app/(secured)/layout.tsx` s'authentifient automatiquement. **Redémarre le dev server après modification de `.env`** pour que Next.js prenne en compte la nouvelle valeur. Désactiver = supprimer/vider la var. La garde-fou est double et en **liste blanche** (`NODE_ENV === "development"` ET ID entier valide) : le bypass est donc inactif en prod, en `test`, en `staging`, ou si `NODE_ENV` n'est pas défini. Ne JAMAIS définir cette var en prod.

## Jeu de test (`npm run seed`)

`npm run seed` **écrase** les données de test (tout ce qui est préfixé `Test_` / `Test - `, plus la table `bg_bureau_members`) puis régénère une matrice de cas destinée à couvrir un maximum de combinaisons en une exécution :

- **Comptes** (`lib/server/seed.ts` → `SPECIAL_USERS`) : admin, un compte par rôle de plateforme (`ARBITRE`, `COMMUNITY_MANAGER`, `RECRUTEUR`) + un cumul, profil tout privé / tout public, mineur, majorité inconnue, sans tags de jeu, sans équipe, compte anonymisé. L'id de l'admin est affiché en fin de seed : c'est la valeur à mettre dans `DEV_AUTH_USER_ID`.
- **Équipes** : rosters complets avec rôles cumulés (`OWNER`/`CAPITAINE`/`TANK`/`DPS`/`HEAL`/`COACH`/`MANAGER`), plus les cas limites (équipe à un seul membre, équipe sans joueur, avec/sans logo) et ~140 équipes de remplissage pour les gros brackets.
- **Tournois** (`lib/server/seed-cases.ts` → `TOURNAMENTS`) : la matrice **état × format × effectif × situation de match**. 4 états, 5 formats (`SINGLE` avec/sans petite finale, `DOUBLE`, `SWISS`, `SURVIVAL`, `MULTI` — dont un cas sous-rempli où la première phase est sautée), effectifs de 0 à 128 (puissances de 2 et effectifs à byes), survie impaire 3/5/7/9/11/15/21 (barrage) avec cadences 1/2/3 et forfaits, plus les états intermédiaires du cycle de report (report en attente, conflit de scores, délai dépassé).

Ajouter un cas = ajouter une entrée à `TOURNAMENTS` ; `lib/server/seed-cases.ts` est volontairement sans accès base pour rester testable (`tests/lib/server/seed-cases.test.ts` garde la couverture de la matrice). Les résultats de matchs sont tirés par un LCG réamorcé par tournoi : **le seed est reproductible** d'une exécution à l'autre.

## Key Conventions

- All UI text is in **French**.
- **Error and success messages** must always appear as overlay notifications (bottom-left) via `useToast()` from `@/components/ui/toast`. Never render them inline in the page body. Use `showError(message)` for errors and `showSuccess(message)` for success feedback.
- `lib/server/*` is server-only code; never import from client components.
- `lib/shared/*` is safe to import anywhere.
- `normalizePseudo()` / `slugifyPseudo()` for username normalization, `toIso()` for dates, `parseRoles()` for JSON role arrays — always use these helpers, don't re-implement.
- User roles on teams are cumulative strings stored as JSON arrays (`OWNER`, `CAPITAINE`, `MANAGER`, `COACH`, `TANK`, `DPS`, `HEAL`).
- Admin users have `is_admin = true` in `bg_users`; admin-only routes live under `app/api/admin/`.
- **Équipes fantômes** (`bg_teams.is_ghost`) : équipes sans joueur, créées et administrées par le staff `tournaments` pour les tournois (remplissage de bracket, équipe invitée). La dérogation d'administration passe par le paramètre `viewerManagesGhostTeams` des fonctions de `teams-service`, et ne s'applique **jamais** à une équipe réelle. Logique dédiée dans `lib/server/ghost-teams-service.ts`. Voir `docs/features/GHOST_TEAMS.md`.
- **Entrées solo** (`bg_teams.solo_user_id`) : ligne d'équipe représentant **un joueur** engagé dans un tournoi individuel — sans membre, jamais listée comme équipe. Ne jamais compter `bg_teams` sans filtrer `solo_user_id IS NULL`.
- **Onglet « Mes tournois »** (`/tournois`) : la liste publique ne montre que les tournois déjà visibles (`start_visibility_at <= NOW()`), ce qui rendait un tournoi programmé introuvable même pour son auteur. `listTournamentBuckets(search, scope)` accepte une portée `{ organizerUserId }` qui filtre sur `organizer_user_id` **et lève le filtre de visibilité** — exposée par `GET /api/tournaments?scope=mine`, l'id venant toujours de la session. L'onglet n'apparaît que si l'utilisateur a créé au moins un tournoi ; les masqués y sont sortis des paniers d'état par `splitHiddenTournaments` (`lib/shared/tournament-visibility.ts`, pur) et regroupés dans une section de tête. Voir `docs/features/MY_TOURNAMENTS_TAB.md`.
- **Frise de progression d'un tournoi** (`lib/shared/tournament-progress.ts` pur) : le bas de `/tournois/[id]` situe le tournoi sur son cycle de vie, de **masqué** à **terminé**. Six étapes là où `TournamentState` n'en connaît que quatre — l'état stocké ignore la visibilité, et `UPCOMING` recouvre aussi bien l'avant-ouverture des inscriptions que l'attente du coup d'envoi. L'étape courante croise les deux sources : les dates départagent les visages d'`UPCOMING`, l'état stocké impose un plancher pour `REGISTRATION`/`RUNNING`/`FINISHED` (un tournoi peut être clos à la main avant l'heure). Le remplissage est **indexé sur les étapes, pas sur le temps** (un sixième chacune), sans quoi une visibilité ouverte trois mois à l'avance écraserait tout le tournoi sur un centimètre. `computeRunningRatio` situe l'intérieur d'un tournoi en cours avec une mesure **par famille de formats** — matchs joués en élimination, rondes en suisse, éliminations en survie, phases en multi : compter les matchs partout afficherait une survie à 100 % dès sa première manche. Voir `docs/features/TOURNAMENT_PROGRESS.md`.
- **Zones défilantes** : toute zone qui défile passe par `<ScrollArea>` (`@/components/cyber`) — jamais un `overflowX/Y: "auto"` posé à la main. Le style des barres est global (`app/globals.css`) : plus aucune barre blanche par défaut, ni sur la page, ni dans un conteneur. `ScrollArea` y ajoute la variante discrète (barre révélée au survol), le dégradé de bord optionnel (`fade`) et l'accessibilité clavier (`tabIndex`, `role="region"` dès qu'un `ariaLabel` est fourni — à renseigner systématiquement). Les couleurs se règlent par les tokens `--scrollbar-size`, `--scrollbar-thumb`, `--scrollbar-thumb-hover`, `--scrollbar-track`, surchargeables localement.
- **Fréquentation du site** (`lib/shared/site-visits.ts` pur + `lib/server/site-visits-service.ts`) : `<VisitTracker />` (layout racine) signale une visite par chargement de page à `/api/visits` ; une ligne `bg_site_visits` par visite, les chargements d'un même visiteur sur 30 min ne comptant que pour une. **Visiteurs uniques** = empreintes distinctes (compte connecté si connecté, sinon IP + user-agent), `identifiedVisitors` isolant les comptes. Seule une empreinte **SHA-256 salée** est stockée (`VISIT_HASH_SALT`) — jamais l'IP. L'identité venant d'en-têtes clients, deux garde-fous : l'IP retenue est celle **ajoutée par le proxy** (`X-Forwarded-For` lu depuis la droite sur `TRUSTED_PROXY_HOPS` relais, défaut 1), et un plafond de 30 **insertions** par IP et par minute borne la croissance de la table (un chargement absorbé par la fenêtre ne consomme pas de quota, pour ne pas sous-compter les sorties NAT partagées). L'app **pousse** l'instantané au bot par le canal interne existant (au plus toutes les 5 min, et seulement si une visite a été créée) ; le bot le sert à sa commande `/stats-site`. Voir `docs/features/SITE_VISIT_STATS.md`.
- **Statistiques approfondies** (`lib/shared/stats.ts` pur + `lib/server/stats-service.ts`) : les fiches équipe et joueur exposent le même bloc `DeepStats` (palmarès, bilan de maps, séries et forme, répartitions par jeu/format, adversaire favori et bête noire, activité sur 12 mois glissants), rendu par `components/stats/StatsPanel.tsx`. Rien n'est persisté : tout se recalcule depuis `bg_matches` et `bg_tournament_registrations`, donc une correction de score se répercute seule. Byes et matchs fantômes sont exclus via la constante partagée `PLAYED_MATCH_SQL`, qui sert aussi bien au bilan qu'à la place au classement du site (sinon les deux nombres d'une même fiche divergent) ; les forfaits comptent mais sont isolés. Une inscription à un tournoi pas encore lancé n'est pas un « tournoi joué ». Côté joueur, un tournoi n'est crédité que si son **déroulement chevauche une période d'appartenance** — rejoindre une équipe titrée ne donne plus son palmarès, mais arriver en cours de tournoi compte bien. Voir `docs/features/DEEP_STATS.md`.
- **Textes éditables de la vitrine** : titres, slogans et descriptions de `/` et `/association` sortent du JSX via le registre `lib/shared/site-copy.ts` (clé → libellé + valeur d'origine), sont stockés dans `bg_settings` (préfixe `copy_`) et s'éditent en place avec `<EditableCopy>` pour la permission `showcase`. Une clé absente ou vide retombe sur la valeur d'origine. Voir `docs/features/EDITABLE_SITE_COPY.md`.
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
- **ScrollArea** — `orientation="x"|"y"|"both"`, `subtle`, `fade`, `ariaLabel`
- **PublicHeader, PublicFooter** — layouts publics de landing

Classes utilitaires : `.eyebrow`, `.display`, `.mono`, `.logotype`, `.num`, `.fabric`, `.card-ticks`, `.section-head`, `.scroll-subtle`

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
7. **Revue de PR — en boucle jusqu'à zéro finding** : ouvrir la PR (`gh pr create`), puis lancer une revue du diff avec `/code-review --comment` pour poster les retours en **commentaires inline** sur la PR.

   **Cycler la revue** : corriger les points remontés, commiter, pousser, puis **relancer une revue complète**. Répéter jusqu'à ce qu'un cycle ne remonte plus aucun finding. Une seule passe ne suffit pas : les corrections d'un cycle en révèlent d'autres, et les zones non couvertes par le premier passage doivent l'être par les suivants.

   Ne rendre la main à l'utilisateur qu'une fois un cycle terminé **sans finding**, avec `npm test`, `npm run lint` et `npx tsc --noEmit` verts.

   **Valider aussi en conditions réelles** : les tests simulent MySQL et ne peuvent pas détecter une colonne manquante ou une requête invalide. Lancer `npm run seed` avant de conclure — c'est le seul contrôle qui exerce réellement les migrations et le SQL. (Le worktree a besoin d'une copie du `.env` du dépôt parent ; il est déjà couvert par `.gitignore`.)
