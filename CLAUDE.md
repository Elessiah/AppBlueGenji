# CLAUDE.md

Guide pour Claude Code dans ce dépôt. **Ce fichier est chargé à chaque session : il ne garde que les règles transverses et un pointeur d'une ligne par fonctionnalité.** Le détail (règles, pièges, historique) vit dans `docs/features/*.md` — lire la doc pointée avant de toucher une fonctionnalité.

## Project Overview

BlueGenji Esport : plateforme française de tournois amateurs Marvel Rivals et Overwatch (tournois, équipes, joueurs), intégrée à un bot Discord.

## Commands

```bash
npm run dev          # Dev server (Turbopack)
npm run build        # Production build
npm run lint         # ESLint
npm run typecheck    # TypeScript 7 sur l'app et tests/ (tsconfig.typecheck.json) — joué par le CI
npm run typecheck:ts5 # même contrôle avec TypeScript 5 (celui de Next, ts-jest, ESLint)
npm test             # Jest
npm run test:coverage
npm run seed         # Matrice de données de test (docs/seed/SEED_RULES.md)
npm run seed:view
NODE_ENV=production npm run backfill:avatars      # rapatrie les photos restées chez leur hébergeur
NODE_ENV=production npm run replay:deletions      # après restauration d'une sauvegarde (--dry-run d'abord)
NODE_ENV=production npm run rotate:hidden-avatars # une fois après déploiement : renomme les avatars déjà masqués
npm run push:keys    # paire de clés VAPID, une fois pour toutes
npm run sonar        # SonarQube local de la branche (Docker, aucun jeton) — voir Pipeline Git
./update.sh          # Déploiement (docs/DEPLOYMENT.md — n'effacez jamais les journaux pm2 à la main)
npx jest tests/path/to/file.test.ts   # un seul fichier
```

## Architecture

### Stack
- **Next.js 15** (App Router), React 18, TypeScript strict.
- **MySQL 8+** via `mysql2` — **aucun ORM**, SQL brut, schéma joué à la première requête (`lib/server/database.ts`).
- **La production tourne sous MariaDB 11.8**, pas MySQL : une syntaxe propre à MySQL ne casse qu'en production. Deux l'ont fait — `FOR UPDATE OF m` et `FOR SHARE` : verrouiller une seule table par une requête **sans jointure**, et écrire `LOCK IN SHARE MODE`. `tests/lib/server/mariadb-sql-compat.test.ts` balaie les sources ; y ajouter tout nouveau motif découvert.
- **CSS Modules + `app/globals.css`** (aucun framework utilitaire), Radix UI Slot, Lucide.
- Types partagés : `lib/shared/types.ts` (à lire en premier). Alias `@/*` → racine.

### Routes
- `/` vitrine · `/connexion` connexion sans mot de passe · `/regles` + `/regles/[slug]` règles par mode (registre `lib/shared/tournament-rules.ts` → `docs/features/RULES_PAGE_LAYOUT.md`).
- `/(secured)/*` : `tournois`, `equipes`, `joueurs`, `profil`, `signalements` — sans session, carte « Connexion requise » en 200 (pas de redirection).
- `/api/*` : routes REST uniquement (ni tRPC ni server actions).

### Auth (`lib/server/auth.ts`) → `docs/features/AUTH_SYSTEM.md`
Sessions `bg_user_sessions` (SHA-256, 30 j, cookie `bg_session`), révocables (`SESSION_REVOCATION.md`). **Aucun mot de passe** : OAuth Google/Discord/Blizzard (`lib/server/oauth-flow.ts`, `OAUTH_PROVIDERS.md`), code Discord par message privé, Google One Tap. Aucun compte ne se revendique par e-mail ; on ne déplace jamais une porte, on ne mure jamais la dernière. Certifier son tag Discord est volontaire (`DISCORD_VERIFICATION.md`). Écritures `/api/` : provenance vérifiée (403 `CROSS_SITE_REQUEST`). Une réponse d'erreur ne porte **qu'un code** (`fail`) — jamais une phrase. CSP en application → `SECURITY_HEADERS_CSP.md` (page cassée : lire `/api/csp-report`). Un geste qui change la barre de navigation appelle `router.refresh()`.

### Database (`lib/server/database.ts`) → `docs/DATABASE_SCHEMA.md`
Le fichier décrit le schéma tel qu'il est. **Un changement de schéma s'écrit à deux endroits** : dans le `CREATE TABLE` (bases neuves) **et** en `ALTER TABLE` tolérant dans la section « Migrations » (bases existantes, où `CREATE TABLE IF NOT EXISTS` ne fait rien) — la seconde entrée se retire une fois jouée partout.

### Tournament Engine (`lib/server/tournaments-service.ts`)
États `UPCOMING → REGISTRATION → RUNNING → FINISHED` ; matchs `PENDING → READY → AWAITING_CONFIRMATION → COMPLETED` ; positions `UPPER`/`LOWER`/`GRAND`. Les modes à classement **rejouent** tout depuis l'historique des matchs (rien n'est accumulé). Byes : `BYE_FUNCTIONALITY.md`, tailles variables : `VARIABLE_SIZE_TOURNAMENTS.md`.
- **Survie** (`SURVIVAL`) — coupes des 2 derniers, barrage si impair → `SURVIVAL_MODE.md`
- **Ronde suisse** — appariement par retour sur trace, départages → `SWISS_MODE.md`
- **Multi-phases** (`MULTI`) — 2 à 8 phases, qualification fixe ou en % → `MULTI_PHASE_TOURNAMENTS.md`
- **BlueGenji Survie** (`BG_SURVIE`) — capital d'endurance, arbre final 8 → `BG_SURVIE_MODE.md`
- **Aperçu de la manche suivante** (BG Survie, arbitrage) → `ENDURANCE_NEXT_ROUND_PREVIEW.md`
- **Pénalités d'endurance** — entrée du rejeu, se retirent, jamais compensées → `ENDURANCE_PENALTIES.md`
- **Volets de manche et arbre BG Survie** → `ENDURANCE_ROUND_PANELS.md`
- **Tournoi individuel** (`SOLO`, entrées solo) → `SOLO_TOURNAMENTS.md`
- **Format de match** (BO/FT, `checkMatchScores`) → `MATCH_FORMAT.md`
- **Matchs nuls et plafond de maps** (`isMatchPlayed`, `matchWinnerSide`) → `MATCH_DRAWS.md`
- **Conditions d'inscription** (effectif, Discord, Blizzard) → `REGISTRATION_FILTERS.md`
- **Tournoi sans adversaires** (0-1 engagée → clos) → `UNDERFILLED_TOURNAMENTS.md`
- **Lancement d'un match** (« Prêt », lobby, contacts) → `MATCH_LAUNCH.md`
- **Planification par l'arbitrage** (`TO_PLAN`) → `MATCH_PLANNING.md`
- **Verrouillage d'un score** (`match-lock`, y compris admin) → `SCORE_EDIT_LOCK.md`
- **Double forfait** et cascades → `DOUBLE_FORFEIT.md`
- **Correction d'un tournoi terminé** → `FINISHED_TOURNAMENT_RECONCILIATION.md`
- **Dialogue d'édition d'un score** (Enregistrer vs Valider) → `SCORE_EDIT_DIALOG.md`
- **Saisie du score par un joueur** → `PLAYER_SCORE_ENTRY.md`
- **Aperçu du plateau pendant les inscriptions** → `TOURNAMENT_PREVIEW.md`
- **Ordre de seeding** (glisser-déposer) → `SEEDING_ORDER.md`
- **Retrait d'un engagé** (avant le coup d'envoi) → `ENTRANT_REMOVAL.md`
- **Édition d'un tournoi** (`FULL`/`RESTRICTED`/`LOCKED`) → `TOURNAMENT_EDITING.md`
- **Avancer le tournoi** (jamais avancer une date, seulement la reculer) → `EARLY_TOURNAMENT_LAUNCH.md`
- **Retour en arrière** d'un stade → `ROUND_ROLLBACK.md`
- **Suppression d'un tournoi** (`user.isAdmin`) → `TOURNAMENT_DELETION.md`
- **Visibilité** : section des invisibles → `HIDDEN_TOURNAMENTS_SECTION.md` ; fiche non publiée = 404 hors `tournaments` → `TOURNAMENT_VISIBILITY_ACCESS.md`

### Live Updates → `docs/features/REALTIME_REFRESH.md`
SSE `/api/tournaments/[id]/stream` : `TournamentSnapshot` (commun) + `TournamentViewerContext` (lecteur). **Tout droit du lecteur se câble sur les deux portes** (flux et REST de secours). Caches invalidés dans `tournaments/notifications.ts` ; entretien → `TOURNAMENT_SYNC_SCOPE.md`. Régime de charge du navigateur → `CLIENT_POWER_MODES.md` : **toute animation infinie lit `var(--deco-anim-state)`**, toute boucle JS lit `useClientPower()`/`useClock()`.

### Bot
Appels toujours app → bot (`lib/server/bot-integration.ts`, dégradation si injoignable) → `BOT_INTEGRATION.md`. Page `/bot` et `/bot/docs` (doc du bot relue à chaud, registre `BOT_DOC_SECTIONS`) → `BOT_PAGE.md`.

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
DISCORD_AUTH_CLIENT_ID=                    # app Discord de connexion — défaut: DISCORD_BOT_CLIENT_ID (même app en pratique)
DISCORD_CLIENT_SECRET=                     # connexion OAuth Discord
DISCORD_REDIRECT_URI=                      # optional — défaut: <APP_URL>/api/auth/discord/callback
BLIZZARD_CLIENT_ID=                        # connexion OAuth Blizzard (develop.battle.net)
BLIZZARD_CLIENT_SECRET=
BLIZZARD_REDIRECT_URI=                     # optional — défaut: <APP_URL>/api/auth/blizzard/callback
BLIZZARD_REGION=                           # optional — « cn » seulement, sinon origine mondiale
BOT_INTERNAL_URL=http://127.0.0.1:4400   # optional
BOT_INTERNAL_TOKEN=                        # must match bot's INTERNAL_API_TOKEN
DEV_AUTH_USER_ID=                          # optional — bypass auth in dev (see below)
BOT_DOCS_PATH=                             # optional — chemin du projet blueGenjiBot (défaut: ../blueGenjiBot)
VISIT_HASH_SALT=                           # recommandé — sel des empreintes de visiteur (défaut: BOT_INTERNAL_TOKEN)
TRUSTED_PROXY_HOPS=1                       # optional — proxys de confiance devant l'app (X-Forwarded-For)
TRUSTED_PROXY_REAL_IP=false                # optional — n'accepter `X-Real-IP` que si le proxy le pose seul
VAPID_PUBLIC_KEY=                          # optional — notifications push (`npm run push:keys`) ; absent = push éteint
VAPID_PRIVATE_KEY=                         # à ne jamais changer une fois en production (clé gravée dans chaque abonnement)
VAPID_SUBJECT=                             # optional — `mailto:` ou `https:` ; défaut : APP_URL si elle est en https
```

## Dev auth bypass → `docs/features/DEV_AUTH_BYPASS.md`
`DEV_AUTH_USER_ID=<id>` dans `.env` (ex. l'admin du seed) : `getCurrentUser()` renvoie ce compte **seulement si `NODE_ENV === "development"`** et l'ID est un entier valide. Redémarrer le dev server après modification. **Ne JAMAIS définir cette variable en prod.**

## Jeu de test (`npm run seed`) → `docs/seed/SEED_RULES.md`
Refuse `NODE_ENV=production` ; verrou nommé `bg_seed` (les worktrees partagent la base). Écrase les données `Test_` / `Test - ` puis régénère une matrice reproductible. Ajouter un cas = une entrée à `TOURNAMENTS` (`lib/server/seed-cases.ts`). L'id admin s'affiche à la fin.

## Key Conventions (règles transverses)

- Toute l'interface est en **français**. Licence AGPL : lien « Code source » dans les pieds de page → `LICENSE_SOURCE_CODE.md`.
- **Messages d'erreur et de succès** : toujours en notification (bas-gauche) via `useToast()` de `@/components/ui/toast` (`showError`, `showSuccess`), jamais en ligne dans la page.
- `lib/server/*` : serveur seulement, jamais importé d'un composant client. `lib/shared/*` : importable partout (logique pure, testable).
- Helpers obligatoires : `normalizePseudo()` / `slugifyPseudo()`, `toIso()`, `parseRoles()`. Noms saisis via `visibleText` → `UNTRUSTED_NAMES.md`.
- **Permissions de plateforme** : protéger une route par `can(user, "<permission>")` / `canAny` (`@/lib/shared/permissions` : `tournaments`, `casting`, `live`, `showcase`, `recruitment`, `roles`, `moderation`), jamais `user.isAdmin` pour un domaine scopé (seule exception : suppression d'un tournoi) → `PERMISSION_ROLES.md`. Routes admin sous `app/api/admin/`.
- **Rôles d'équipe** (JSON cumulatif `OWNER`, `CAPITAINE`, `MANAGER`, `COACH`, `TANK`, `DPS`, `HEAL`) : seuls `OWNER` et `MANAGER` gèrent (inscription, abandon compris) via `hasTeamManagementRole` → `docs/AUTHORIZATION_RULES.md`.
- **Entrées solo** (`bg_teams.solo_user_id`) : ne jamais compter `bg_teams` sans filtrer `solo_user_id IS NULL`. Équipes fantômes (`is_ghost`) → `GHOST_TEAMS.md`.
- **Modales** : portées dans `document.body`, `useDialogBehavior`, `useBackdropDismiss` → `MODAL_DIALOGS.md`. Gestes sans retour par `ConfirmActionDialog`, jamais `window.confirm`.
- **Champs numériques** : `<NumberInput>`, jamais `Number(e.target.value)` → `NUMBER_INPUT.md`.
- **Zones défilantes** : toujours `<ScrollArea>` avec `ariaLabel`, jamais `overflow: auto` à la main → `ACCESSIBILITY_SCROLL_AREA_FOCUS.md`.
- **Cases à cocher / radios** : style posé sur l'élément dans `globals.css` ; une règle sur un `input` nu exclut `[type="checkbox"]`/`[type="radio"]`, pas de style en ligne, état désactivé par couleurs (jamais `opacity`) → `CHECKBOX_STYLES.md`.
- **Sélection au toucher** : contrôles non sélectionnables ; groupes tapés en rafale portent `data-tap-zone` → `TAP_SELECTION.md`.
- **Typographie** : police par défaut Inter, **plancher 11 px** (12 px texte courant), polices hébergées dans le dépôt, jamais `next/font/google` → `TYPOGRAPHY.md`. Tableaux `.table-row` : cellules libellées par `data-label` → `RESPONSIVE_TABLES.md`.
- **Accessibilité** : tout réglage qui change l'apparence est désactivé par défaut et vit dans le menu d'accessibilité (`data-a11y`) → `ACCESSIBILITY_MENU.md`. Nom accessible d'un lien = contient son texte visible. Pages vitrine par `<PublicPageShell>` → `ACCESSIBILITY_LANDMARKS_FOCUS.md`. Erreurs de champ et déclaration (`KNOWN_ISSUES` : retirer la limite réglée, avancer `ACCESSIBILITY_STATEMENT_DATE`) → `ACCESSIBILITY_FORM_ERRORS_STATEMENT.md`. Couleur de texte par jeton.
- **Images** : tout import passe par la modale de recadrage (`useImageCropper`, `appendCroppedImage`, `parseImageCropField`) → `IMAGE_CROP.md`. Une image servie vient du site : `localUploadUrl` **à la sortie**, jamais `unoptimized` → `LOCAL_UPLOAD_URLS.md`. Avatar : repli à initiale, `visibleAvatarUrl` partout où l'image est lue → `USER_AVATAR_DISPLAY.md`.
- **RGPD — à déclarer, toujours** : toute PR qui change ce qui est collecté, qui le lit, combien de temps il est gardé ou ce qu'une suppression emporte **ajoute une entrée à la fin de `PRIVACY_CHANGES`** et met `/rgpd` à jour → `PRIVACY_CHANGES_CONSENT.md`. Tout nouveau traitement s'ajoute au **registre** (`lib/shared/processing-register.ts`, avancer `REGISTER_UPDATED_AT`) dans la même PR → `PROCESSING_REGISTER.md`.
- **Discord — vie privée** : aucun pseudo ni `#id` de joueur dans un message Discord (« un joueur » ; noms d'équipe permis ; staff anonymisé sur Discord, nommé dans pm2 via `publishStaffAction`) → `RGPD_LOGS_AND_VISITS.md`. Tout texte utilisateur vers Discord passe par `discordInline` / `discordQuote` → `UNTRUSTED_NAMES.md`.
- **Notifications** : toute notification future = un sujet de `PUSH_TOPICS` + un rédacteur dans `push-messages.ts` + `notifyUsers` / `notifyStaff` (`lib/server/notify.ts`) → `PUSH_NOTIFICATIONS.md`.
- **Conditions d'utilisation** : avancer `TERMS_VERSION` redemande l'acceptation → `TERMS_OF_USE.md`.
- **« Live » / « Direct »** : « En cours » = état d'un tournoi ; « En direct » / « le live » = vraie diffusion ; « À jour » / « Reconnexion… » / « Hors ligne » = témoin de flux. Le rouge (`pill-live`) ne sert qu'à ce qui est réellement à l'antenne → `LIVE_STREAMS.md`.
- Coordonnées de l'association jamais en clair → `LEGAL_PAGE.md` ; aucune adresse e-mail de contact publiée (`tests/lib/shared/legal-contact.test.ts`).

### Pointeurs par domaine (`docs/features/`)
- **Équipes** : gestion `TEAM_MANAGEMENT_PAGE.md` · sigle `TEAM_TAG.md` · logos d'annuaire `TEAM_DIRECTORY_LOGOS.md` · demande d'adhésion `TEAM_JOIN_REQUEST_NOTIFICATION.md` · liens cliquables `ENTITY_LINKS.md`
- **Pages tournoi** : en-tête `TOURNAMENT_HEADER.md` · frise `TOURNAMENT_PROGRESS.md` · cartes de liste `TOURNAMENT_LIST_CARDS.md` · barre d'outils `TOURNAMENT_LIST_TOOLBAR.md` · « Mes tournois » `MY_TOURNAMENTS_SECTION.md` · logos d'engagés `TOURNAMENT_ENTRANT_LOGOS.md` · image `TOURNAMENT_IMAGE.md` · lien profond vers un match `FEATURED_MATCH_LINK.md`
- **Comptes** : profil `PROFILE_SCREEN.md` · suppression `ACCOUNT_DELETION.md` · suspension `ACCOUNT_SUSPENSION.md` · statut d'appartenance `PLAYER_ROSTER_STATUS.md` · menu du compte `ACCOUNT_MENU.md` · import d'avatar `USER_AVATAR_IMPORT.md` · redirection sûre `SAFE_LOGIN_REDIRECT.md`
- **Données et conformité** : journal de connexion `CONNECTION_LOGS.md` · sauvegardes `BACKUP_DATA_PROTECTION.md` · visites `SITE_VISIT_STATS.md` · signalements `CONTENT_REPORTS.md` / `LOGO_QUARANTINE.md`
- **Classements et stats** : stats approfondies `DEEP_STATS.md` · points d'équipe `TEAM_RANKING_POINTS.md` · cote Elo `ELO_RANKING.md` · points de parcours `TOURNAMENT_PLACEMENT_POINTS.md`
- **Vitrine** : textes éditables `EDITABLE_SITE_COPY.md` · partenaires `SPONSOR_LOGO_PROXY.md` / `SPONSOR_CARDS.md` · Discord `DISCORD_COMMUNITY.md` · SEO `SEO.md` · manifeste `WEB_APP_MANIFEST.md` · aperçus de liens `SHARE_METADATA.md` · recrutement `RECRUITMENT.md` · pages d'erreur `ERROR_PAGES_AND_ANCHORS.md` · lien d'évitement `ACCESSIBILITY_QUICK_WINS.md`
- **Discord et diffusion** : messages automatisés `DISCORD_NOTIFICATIONS.md` · journal `BOT_ACTIVITY_LOG.md` · alertes arbitre `REFEREE_ALERTS.md` · dates des matchs `MATCH_START_DATES.md` · diffusion `LIVE_STREAMS.md` · rediffs `MATCH_REPLAYS.md`

## Design System — « Cyber minimal » → `docs/features/DESIGN_SYSTEM.md`
Noir profond, bleu glacier `#5ac8ff`. Jetons `--cyber-bg*`, `--ink*`, `--blue-100`–`700`, `--red-live`, `--line-*`, `--r-cy-*`. Primitives `components/cyber/` (`CyberButton`, `CyberCard`, `Pill`, `ScrollArea`…). Autres docs : `ls docs/features/`.

## Communication Style

- **Exécute sans détailler** : ne décris pas ce que tu vas faire avant d'agir.
- **Court résumé à la fin** des changements et des problèmes rencontrés.
- **Arrête les previews** : à la fin de chaque prompt, arrête tous les serveurs lancés.

## Règles de travail → détail dans `docs/WORKFLOW.md`

- **Documentation** : le détail d'une fonctionnalité va dans `docs/features/<NOM>.md` (créé ou complété dans la PR). `CLAUDE.md` ne reçoit qu'**un pointeur d'une ligne** (`- **<Fonctionnalité>** — <quoi/où> → docs/features/<X>.md`) et les règles transverses, et **doit rester sous ~20 Ko**.
- **Tests** : toute feature est livrée avec ses tests (nominal, limites, erreurs) ; rien n'est terminé sans eux.
- **Deux TypeScript** : `typescript` 5.x (Next, ts-jest, ESLint) et `typescript-native` (7, pour `npm run typecheck`) — les scripts désignent leur `tsc` **par chemin**, jamais `npx tsc`.
- **Les tests sont type-vérifiés** : fabriques complètes de `tests/helpers/`, `jest.mocked(fn)`, doubles SQL `jest.fn<SqlQuery>()` ; jamais `x as never` sur une valeur simulée ni `it.each([...] as const)`.
- **Branches** : `feature/<nom-kebab>`. **PR** vers `main` ; CI (lint + typecheck → build → tests) : corriger dans cet ordre, ne jamais merger rouge.
- **`ERREUR.txt`** : toute erreur **préexistante** rencontrée et non réglée s'y consigne (une entrée, à la fin : `- [AAAA-MM-JJ] <zone> — <symptôme> — <piste> — (rencontré sur : <branche>)`), sans élargir la tâche ; vérifier les doublons ; retirer l'entrée dans le commit qui la règle.
- **`ACCESSIBILITE.md`** : tout problème d'accessibilité non réglé s'y consigne (titre, Critère, Constat, À faire). **Choisir ou ajouter une tâche se pousse sur `main` sur-le-champ**, par un commit qui ne touche que ce fichier, **avant** tout code (sélection = retirer la section ; ajout = numéro suivant le « dernier numéro attribué », avancé dans le même commit ; push refusé → relire et rejouer).
- **Complexité** : demande importante → plan écrit puis exécution dans la session ; ne pas déléguer à `/OpusLocalManager` ni `/opus-haiku-pipeline`.
- **Dépôt voisin `blueGenjiBot`** : sa doc Markdown (`doc/*.md`, `help.md`, `helpfr.md`) est servie à chaud sur `/bot/docs` — la corriger avec toute commande touchée ; la référence JSDoc (`docs/`) se régénère (vider puis `npm run docs`) dans la même PR que le code, commitée à part.

## Pipeline Git (workflow de livraison) → détail dans `docs/WORKFLOW.md`

**Co-Authored-By** : **tous** les commits portent `Co-authored-by: <modèle> <noreply@anthropic.com>`, où `<modèle>` est **le modèle qui écrit réellement le commit** (jamais une valeur recopiée) — à vérifier dès le premier commit de la session. `git commit --trailer 'Co-authored-by: <modèle> <noreply@anthropic.com>'`.

Enchaîner sans s'arrêter :
1. `git checkout -b feature/<short-name>`
2. Commit fonctionnel (≤ 5 mots, impératif minuscule)
3. Commit docs (README / JSDoc / `docs/features/`)
4. Commit tests (`jest`)
5. Commit polish UI/UX (aucune logique) — les problèmes d'accessibilité non réglés vont dans `ACCESSIBILITE.md` par un commit direct sur `main`
6. `git push -u origin feature/<short-name>`
7. `gh pr create`, puis revue `/code-review --comment` **en boucle** jusqu'à un cycle sans finding (corriger, commiter, pousser, relancer une revue complète). **SonarQube** (`npm run sonar`, instance locale, aucun jeton à demander) avant le premier cycle et après le dernier ; sur le **nouveau code** : Quality Gate vert, notes A (fiabilité, sécurité, maintenabilité), zéro problème ouvert, 100 % des hotspots examinés, couverture ≥ 80 %, duplication ≤ 3 %, aucun « Faux positif » sans justification écrite. Ne rendre la main qu'avec `npm test`, `npm run lint`, `npm run typecheck` verts **et** `npm run seed` exécuté (seul contrôle réel des migrations et du SQL ; copier le `.env` du dépôt parent dans le worktree).
