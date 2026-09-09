# Règles fondamentales d'autorisation

Ce document est la **référence unique** de ce qu'un utilisateur peut et ne peut
pas faire sur BlueGenji Esport, selon son identité et ses rôles. Il sert de
grille de lecture à la passe de sécurité (tâche 21 de `TODO.md`) : **toute
divergence entre ce document et le code est un bug**. Là où la formulation du
TODO est plus large que le code, la règle retenue est écrite ici, avec son
motif, dans la section du domaine concerné.

Deux systèmes de rôles **indépendants** cohabitent, et rien ne les mélange :

- les **rôles de plateforme** (`PlatformRole`) — staff du site : `ADMIN`,
  `ARBITRE`, `CASTER`, `COMMUNITY_MANAGER`, `RECRUTEUR` ;
- les **rôles d'équipe** (`TeamRole`) — position dans un roster : `OWNER`,
  `CAPITAINE`, `MANAGER`, `COACH`, `TANK`, `DPS`, `HEAL`.

Un `ADMIN` n'a **aucun** pouvoir sur une équipe dont il n'est pas membre (seule
exception : les équipes fantômes, voir §5). Un `OWNER` d'équipe n'a **aucun**
pouvoir sur la plateforme.

---

## 1. Le socle

### 1.1 Authentification

- L'accès à tout l'espace `/(secured)/*` (`tournois`, `equipes`, `joueurs`,
  `profil`) et à quasiment toutes les routes `/api/*` exige une session.
- Sans session, la garde de `app/(secured)/layout.tsx` **ne redirige pas** :
  elle rend une carte « Connexion requise » en `200`, sans rendre ses enfants —
  aucun contenu protégé n'atteint la réponse.
- Une route API sans session répond `401 UNAUTHORIZED`, jamais 403 : le refus
  d'authentification et le refus de droits ne se confondent pas.
- La destination d'après connexion (`?redirect=`) n'accepte qu'un **chemin du
  site** (`lib/shared/safe-redirect.ts`) : pas de redirection ouverte vers un
  domaine tiers.
- `DEV_AUTH_USER_ID` court-circuite la session **uniquement** si
  `NODE_ENV === "development"`. Jamais en production, en test ni en staging.

### 1.2 Les six permissions

| Permission    | Domaine                                                          |
| ------------- | ---------------------------------------------------------------- |
| `tournaments` | Créer et gérer les tournois, arbitrer les matchs                  |
| `casting`     | **Lecture seule** de l'aperçu du plateau avant lancement          |
| `live`        | **Écriture** de l'état de diffusion d'un match (antenne, chaîne)  |
| `showcase`    | Site vitrine + association                                        |
| `recruitment` | Annonces de recrutement                                           |
| `roles`       | Attribution des rôles de plateforme                               |

### 1.3 Qui a quoi

| Rôle                | `tournaments` | `casting` | `live` | `showcase` | `recruitment` | `roles` |
| ------------------- | :-----------: | :-------: | :----: | :--------: | :-----------: | :-----: |
| `ADMIN`             | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `ARBITRE`           | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| `CASTER`            | ❌ | ✅ | ✅ | ❌ | ❌ | ❌ |
| `COMMUNITY_MANAGER` | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ |
| `RECRUTEUR`         | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ |
| *(aucun rôle)*      | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |

Les rôles sont **cumulables** : un compte `ARBITRE` + `RECRUTEUR` obtient
l'union des deux lignes. `ADMIN` est un super-rôle — `can()` lui rend `true` sur
toute permission, quel que soit le contenu de `roles`.

### 1.4 La règle d'écriture d'une garde

Un domaine scopé se protège **toujours** par `can(user, "<permission>")`, jamais
par un test direct de `user.isAdmin` — sinon l'arbitre, le caster ou le CM
perdent le droit qu'on vient de leur donner.

```ts
const user = await getCurrentUser();
if (!user) return fail("UNAUTHORIZED", 401);
if (!can(user, "tournaments")) return fail("FORBIDDEN", 403);
```

**Une seule exception dans tout le projet** : la suppression définitive d'un
tournoi teste `user.isAdmin === true` (§4.6).

---

## 2. Compte et profil

### 2.1 Ce qu'un utilisateur peut faire sur son propre compte

- Modifier son pseudo, ses tags de jeu, son pseudo Discord, sa majorité, ses
  réglages de visibilité, son ouverture au recrutement (`PATCH /api/profile`).
- Téléverser ou retirer son avatar (`POST` / `DELETE /api/profile/avatar`).
- Exporter toutes ses données personnelles (`GET /api/profile/export`, RGPD
  art. 20).
- Anonymiser son compte (`DELETE /api/profile`) — la session est détruite dans
  la foulée.

Toutes ces routes agissent sur `user.id` **pris de la session**, jamais sur un
identifiant fourni par le corps de la requête : il n'existe aucun chemin pour
modifier le profil d'autrui.

### 2.2 Ce qu'il ne peut pas faire

- ❌ Modifier le profil, l'avatar ou les réglages d'un autre compte — aucune
  route ne l'expose, **pas même pour un `ADMIN`**.
- ❌ Se donner des rôles : `POST /api/admin/users/[id]/roles` refuse en
  `400 CANNOT_MODIFY_SELF` quand la cible est l'appelant. Un compte sans `ADMIN`
  est de toute façon refusé en `403` avant d'y arriver.
- ❌ Lire les champs qu'un autre a masqués (§2.3).

### 2.3 Informations privées d'un profil

`applyVisibility` masque, pour tout viewer qui n'est pas le propriétaire :

| Champ                       | Masquable | Réglage                      |
| --------------------------- | :-------: | ---------------------------- |
| Avatar                      | ✅        | `visible_avatar`             |
| Battletag Overwatch         | ✅        | `visible_overwatch`          |
| Tag Marvel Rivals           | ✅        | `visible_marvel`             |
| Majorité (`isAdult`)        | ✅        | `visible_major`              |
| Pseudo Discord              | —         | **jamais exposé** à un tiers |
| Pseudo                      | ❌        | jamais masqué — il identifie le joueur en bracket, roster et feuille de match |

Le masquage est appliqué **côté serveur, à la source** (`getFullProfile`,
`listUsers`) : le champ masqué vaut `null` dans la réponse, il n'est pas
seulement caché à l'affichage.

Deux points volontaires, à ne pas prendre pour des fuites :

- Les **badges de jeu** (OW / MR) restent affichés même quand le tag exact est
  masqué. « Joue à Overwatch » est une information d'appariement ; le battletag
  exact, qui permet de contacter le joueur hors du site, est une donnée de
  contact. Le réglage protège le second, pas le premier.
- Les **titres staff** (`displayRoles`) sont publics : un arbitre ou un caster
  doit être reconnaissable, c'est ce qui rend l'arbitrage opposable. En revanche
  `isAdmin` et le champ `roles` (celui qui sert à l'édition) ne sont renseignés
  **que pour un viewer administrateur**.

Ni l'e-mail, ni le `google_sub`, ni le `discord_id` ne sortent jamais d'un profil
consulté par un tiers ; ils n'apparaissent que dans l'export RGPD du
propriétaire.

---

## 3. Équipes

### 3.1 Rôles d'équipe et pouvoirs

| Action                                | `OWNER` | `MANAGER` | Autre membre | Non-membre |
| ------------------------------------- | :-----: | :-------: | :----------: | :--------: |
| Modifier nom / description / sigle    | ✅ | ❌   | ❌ | ❌ |
| Modifier / retirer le logo            | ✅ | ✅   | ❌ | ❌ |
| Inviter un joueur                     | ✅ | ✅   | ❌ | ❌ |
| Répondre à une demande d'adhésion     | ✅ | ✅   | ❌ | ❌ |
| Ajouter un membre directement         | ✅ | ✅   | ❌ | ❌ |
| Changer les rôles d'un membre         | ✅ | ✅ \* | ❌ | ❌ |
| Exclure un membre                     | ✅ | ✅   | ❌ | ❌ |
| **Inscrire l'équipe à un tournoi**    | ✅ | ✅   | ❌ | ❌ |
| Transférer la propriété               | ✅ | ❌   | ❌ | ❌ |
| Dissoudre l'équipe                    | ✅ | ❌   | ❌ | ❌ |
| Quitter l'équipe                      | ❌ \*\* | ✅ | ✅ | — |
| Demander à rejoindre                  | — | —     | —  | ✅ |

\* Un `MANAGER` ne peut pas toucher aux rôles de l'`OWNER`
(`targetIsOwner && !requesterIsOwner` → `FORBIDDEN`).
\*\* L'`OWNER` doit d'abord transférer la propriété (`OWNER_MUST_TRANSFER`) ; il
ne peut pas non plus être exclu (`CANNOT_KICK_OWNER`).

La gestion d'une équipe n'est pas monolithique. La ligne de partage n'est pas
« propriétaire ou pas » mais **identité, propriété et existence d'un côté,
conduite de l'équipe de l'autre** : ce qui touche au nom, au sigle, à la
propriété ou à l'existence de l'équipe est `OWNER` seul ; ce qui relève de sa
conduite au quotidien — logo, membres, rôles, invitations, **et l'engagement en
tournoi** (§4.2) — est ouvert au `MANAGER`, c'est précisément le métier du rôle.
La règle se lit donc « **pas de gestion sans rôle de gestion** », et non
« `OWNER` seul partout ».

Règles structurelles qui tiennent quel que soit le rôle :

- Le rôle `OWNER` ne s'attribue **jamais** par la route des rôles : il est filtré
  de toute liste soumise (`filter(role => role !== "OWNER")`). Il ne se déplace
  que par `POST /api/teams/[id]/transfer-ownership`, appelé par l'`OWNER`
  lui-même, vers un membre existant, et jamais vers soi-même.
- Un membre doit garder au moins un rôle (`MISSING_ROLE`).
- Un utilisateur n'appartient qu'à **une** équipe active à la fois
  (`USER_ALREADY_IN_TEAM`) — contrôlé à la création, à l'invitation, à la
  demande d'adhésion et à l'acceptation.
- Une équipe dissoute (`deleted_at`) n'est plus gérable : son nom et son sigle
  sont libérés, ses membres détachés, mais son historique de matchs demeure.

### 3.2 Ce qu'un joueur ne peut pas faire

- ❌ Modifier une équipe dont il n'est pas membre — `getMemberRoles` rend `null`,
  toutes les fonctions de gestion lèvent `FORBIDDEN`.
- ❌ Modifier une autre équipe que la sienne, même s'il est `OWNER` de la sienne :
  les droits se lisent **sur la ligne d'appartenance à l'équipe visée**, jamais
  sur un statut global.
- ❌ Se hisser `OWNER` d'une équipe où il est `MANAGER`.
- ❌ Toucher à quoi que ce soit en tant qu'`ADMIN` du site : les rôles de
  plateforme n'ouvrent aucun droit sur une équipe **réelle**. La seule
  dérogation vise les équipes fantômes (§5).

---

## 4. Tournois et matchs

### 4.1 Lire un tournoi

| Situation                                     | Sans rôle | `casting` | `tournaments` |
| --------------------------------------------- | :-------: | :-------: | :-----------: |
| Tournoi publié (`start_visibility_at` passé)   | ✅ | ✅ | ✅ |
| Tournoi **non publié**                         | ❌ 404 | ❌ 404 | ✅ |
| Liste `?scope=hidden`                          | ❌ 403 | ❌ 403 | ✅ |
| Aperçu du plateau avant lancement (`preview`)  | ❌ `null` | ✅ | ✅ |

Un tournoi non publié se refuse en **404, jamais 403** : sur un identifiant
consécutif et devinable, un « interdit » confirmerait l'existence qu'on protège.
La règle est posée à un seul endroit, `getVisibleTournamentSnapshot`, et
s'applique aux **deux** portes de lecture — le flux SSE (chemin nominal) et la
lecture REST de secours — ainsi qu'à la route d'image d'aperçu, servie hors des
mises en page.

Aucune route d'écriture n'a à contrôler la visibilité : `validateDateOrder`
garantit `startVisibilityAt <= registrationOpenAt`, donc un tournoi caché est
toujours `UPCOMING`.

### 4.2 S'engager

- Un joueur inscrit **son engagé** — son équipe active, ou lui-même en tournoi
  individuel (`resolveUserEntrantTeamId`). Il ne peut désigner personne d'autre :
  la route `POST /api/tournaments/[id]/register` ne prend aucun corps.
- **Engager une équipe demande d'en avoir la charge** : `OWNER` ou `MANAGER`
  (`hasTeamManagementRole`, `lib/shared/team-roles.ts`). Un joueur du roster est
  refusé en `403 NOT_TEAM_MANAGER`. Une inscription vaut promesse de se
  présenter : elle expose l'équipe entière à un forfait et occupe une place que
  d'autres attendent — c'est un acte qui engage l'équipe, au même titre
  qu'inviter ou exclure. Les rôles sont relus **dans la transaction**, sur la
  ligne d'appartenance : le droit se juge à l'instant de l'écriture, pas à celui
  où la page a été rendue.
- En **tournoi individuel**, la question ne se pose pas : le joueur n'engage que
  lui-même, par une entrée solo qui n'a ni membre ni rôle.
- Côté interface, la règle voyage dans le contexte du lecteur
  (`TournamentViewerContext.canRegisterEntrant`) : le bouton ne s'affiche pas là
  où le serveur refuserait, et une phrase prend sa place plutôt qu'un vide
  (`_lib/register-entry.ts`).
- Le staff `tournaments` inscrit des **équipes fantômes** en lot
  (`POST /api/admin/tournaments/[id]/ghost-registrations`), et rien d'autre : une
  équipe réelle ou une entrée solo se fait refuser par `NOT_A_GHOST_TEAM`.
- Signaler un problème (`POST .../report-issue`) est réservé aux **engagés** du
  tournoi (`NOT_REGISTERED` → 403), revérifié côté serveur.

### 4.3 Reporter un score (côté joueur)

`POST /api/tournaments/[id]/matches/[matchId]/report` n'accepte que ceci :

- ✅ le tournoi est `RUNNING` (`TOURNAMENT_NOT_RUNNING` sinon) ;
- ✅ l'appelant a un engagé dans ce tournoi (`NO_ACTIVE_TEAM` sinon) ;
- ✅ **cet engagé est l'une des deux équipes du match** — sinon `NOT_IN_MATCH`.
  Le score est écrit dans la colonne de *son* camp (`team1_report_*` ou
  `team2_report_*`), déduite du match, jamais du corps de la requête ;
- ✅ le match n'est pas déjà tranché (`MATCH_ALREADY_COMPLETED`) et a bien deux
  engagées (`MATCH_NOT_READY`) ;
- ✅ le score constitue un **résultat final** au format de la manche
  (`checkMatchScores`).

Un report d'équipe ne tranche rien seul : deux reports concordants closent la
rencontre, deux reports contradictoires ouvrent un **conflit** qui part au canal
arbitre. Un joueur ne peut donc en aucun cas :

- ❌ saisir le score d'un match où son équipe ne joue pas ;
- ❌ saisir un score pour l'équipe adverse ;
- ❌ écraser un résultat déjà validé.

### 4.4 Arbitrer (permission `tournaments`)

Réservé à `ADMIN` et `ARBITRE` :

- créer un tournoi (`POST /api/tournaments`) ;
- l'éditer (`PATCH /api/tournaments/[id]/edit`) — dans la fenêtre autorisée :
  tout tant qu'il est caché, cinq champs une fois annoncé, **rien** une fois
  lancé ou terminé ;
- le lancer par anticipation (`POST /api/admin/tournaments/[id]/launch`) ;
- réordonner le seeding (`PATCH .../seeding`), jusqu'à la première saisie de
  score ;
- enregistrer un score en cours de rencontre
  (`PATCH /api/admin/matches/[id]/scores`) et **valider un résultat**
  (`POST /api/admin/matches/[id]/resolve`), forfait d'une manche compris ;
- programmer l'heure d'un match (`PUT /api/admin/matches/[id]/schedule`) ;
- poser et retirer une pénalité d'endurance (`POST` / `DELETE .../penalties`) ;
- forcer le forfait de n'importe quel engagé (`POST .../forfeit` avec `teamId`) ;
- reculer d'un stade (`POST /api/admin/tournaments/[id]/rollback`) ;
- fixer la chaîne officielle du tournoi (`PUT /api/admin/tournaments/[id]/live`) ;
- inscrire et gérer les équipes fantômes (§5).

Un `CASTER` n'a **aucun** de ces droits.

### 4.5 Diffuser (permission `live`)

`ADMIN`, `ARBITRE` et `CASTER` — et eux seuls — écrivent l'état de diffusion d'un
**match** : `PUT` / `POST /api/admin/matches/[matchId]/live` (chaîne,
déclencheur `AUTO` / `MANUAL` / `START_TIME`, ouverture de l'antenne).

La **chaîne officielle du tournoi** est un autre droit : elle passe par
`PUT /api/admin/tournaments/[id]/live`, protégé par `tournaments`. Un `CASTER`
ouvre l'antenne d'un match, il ne décide pas de la chaîne du tournoi.

`live` n'ouvre **rien d'autre** : ni score, ni horaire, ni seeding, ni édition.

### 4.6 Supprimer un tournoi

`DELETE /api/admin/tournaments/[id]` teste `user.isAdmin === true`. C'est le
**seul** point du projet où le contrôle n'est pas une permission scopée : un
arbitre gère un tournoi, il ne l'efface pas. Le champ
`TournamentDetail.canDelete` transporte ce droit, distinct de `canManage`, par
les deux portes (flux + REST).

Aucune équipe ni aucun joueur n'est supprimé au passage — seules les lignes
portant un `tournament_id`, plus les rappels de match.

### 4.7 Abandonner

`POST /api/tournaments/[id]/forfeit` :

- un joueur ne peut forfaiter **que son propre engagé** — passer un `teamId`
  différent du sien est refusé en `403 FORBIDDEN` ;
- le staff `tournaments` peut forfaiter n'importe quel engagé ;
- dans tous les cas, refusé hors `RUNNING`, et dès les play-offs d'endurance
  lancés.

---

## 5. Équipes fantômes et entrées solo

Une **équipe fantôme** (`bg_teams.is_ghost`) est une équipe sans joueur, créée
par le staff `tournaments` pour remplir un plateau ou inviter une structure.
C'est la seule dérogation d'administration sur une équipe, portée par le
paramètre `viewerManagesGhostTeams` des fonctions de `teams-service` :

- ✅ le staff `tournaments` crée, renomme, logote, inscrit en lot et dissout une
  équipe **fantôme** sans en être membre ;
- ✅ il peut l'**attribuer** à un joueur réel (`POST /api/teams/[id]/claim`), qui
  en devient `OWNER` — l'équipe cesse alors d'être fantôme, et la dérogation
  s'éteint avec elle ;
- ❌ la dérogation ne s'applique **jamais** à une équipe réelle : le même staff
  n'a aucun droit sur une équipe qui a des membres.

Une **entrée solo** (`bg_teams.solo_user_id`) représente un joueur dans un
tournoi individuel. Ce n'est pas une équipe : elle naît avec `is_ghost = 0`, se
fait refuser par `NOT_A_GHOST_TEAM` comme une équipe réelle, et reste exclue de
`/equipes`, du classement du site et du compteur d'équipes.

---

## 6. Vitrine, association, recrutement

| Domaine                                                         | Permission    | Rôles                        |
| --------------------------------------------------------------- | ------------- | ---------------------------- |
| Sponsors (`/api/landing/sponsors/*`)                             | `showcase`    | `ADMIN`, `COMMUNITY_MANAGER` |
| Association : bureau, piliers, stats, contact                    | `showcase`    | idem                         |
| Bénévoles (`/api/benevoles/*`)                                   | `showcase`    | idem                         |
| Textes éditables de la vitrine (`PATCH` / `DELETE /api/site-copy`) | `showcase`  | idem                         |
| Annonces de recrutement (`/api/recruitment/*`)                   | `recruitment` | `ADMIN`, `RECRUTEUR`         |

En **lecture**, ces contenus sont publics (`GET` sans garde) — c'est leur raison
d'être. Une seule nuance : `GET /api/recruitment` ne renvoie les annonces
masquées qu'à un porteur de `recruitment`.

Un `ARBITRE` ou un `CASTER` **ne peut pas** modifier le site vitrine, et un
`COMMUNITY_MANAGER` ne peut pas toucher aux tournois.

---

## 7. Attribution des rôles

`POST /api/admin/users/[id]/roles` — **`ADMIN` strict** :

- ❌ un non-admin est refusé en `403`, quel que soit son cumul de rôles : aucun
  chemin ne permet de s'accorder ou d'accorder un privilège qu'on n'a pas ;
- ❌ un administrateur ne peut pas modifier **ses propres** rôles
  (`CANNOT_MODIFY_SELF`, 400) — garde anti-auto-verrouillage ;
- ✅ le corps est validé rôle par rôle (`isPlatformRole`) puis normalisé
  (`sanitizePlatformRoles`) : une valeur inconnue est écartée, jamais persistée ;
- l'appel **remplace** l'ensemble des rôles de la cible ; `ADMIN` est stocké dans
  `bg_users.is_admin`, les autres dans `platform_roles_json`.

Un administrateur **peut** promouvoir un autre compte `ADMIN` : c'est le seul
chemin de promotion, et il exige déjà `ADMIN`. Il n'existe donc aucune élévation
depuis un rang inférieur, et donc aucune escalade de privilège — `ADMIN` est le
sommet, la confiance qu'on lui accorde est totale par construction. La seule
garde utile à ce niveau est l'interdiction de se modifier soi-même, qui protège
de l'auto-verrouillage, pas de l'abus.

---

## 8. Ce qui n'est protégé par aucun rôle

Volontairement ouvert, à connaître pour ne pas le confondre avec un trou :

- `GET /api/landing/*` (stats, live, leaderboard, calendrier, ticker),
  `GET /api/association/*`, `GET /api/benevoles`, `GET /api/site-copy`,
  `GET /api/recruitment/highlight`, `GET /api/bot/*` — la vitrine publique.
- `POST /api/visits` — la mesure de fréquentation : anonyme par construction,
  seule une empreinte SHA-256 salée est stockée, jamais l'IP. Bornée par un
  plafond de 30 insertions par IP et par minute.
- `GET /api/uploads/[...path]` — sert `public/uploads/`, avec refus de toute
  remontée de dossier et liste blanche d'extensions.
- Les routes d'authentification (`/api/auth/*`), par nature.

En revanche, l'annuaire des joueurs (`/api/players`) et celui des équipes
(`/api/teams`) **exigent une session** : ce sont des données de membres.

---

## 9. Les gardes qui ne sont pas des rôles

Des refus légitimes ne relèvent pas des permissions, et ne doivent pas être
« corrigés » en ajoutant un rôle :

- **Verrou de score** (`lib/shared/match-lock.ts`) — un score n'est plus
  modifiable, **y compris par un administrateur**, dès que la manche suivante
  porte la moindre saisie. La sortie est le retour en arrière (§4.4), pas un
  privilège.
- **Fenêtres d'édition d'un tournoi** — `FULL` / `RESTRICTED` / `LOCKED` : aucun
  rôle n'ouvre `LOCKED`.
- **États du tournoi** — abandon et pénalités sont refusés hors `RUNNING` ; la
  correction d'un score, elle, reste permise sur un tournoi terminé (le
  classement se rejoue, le tournoi ne se rouvre pas).
- **Plafonds de débit** (`lib/server/rate-limit.ts`) — indépendants des rôles.

---

## Voir aussi

- [`docs/features/PERMISSION_ROLES.md`](features/PERMISSION_ROLES.md) — le système de rôles
- [`docs/features/TOURNAMENT_VISIBILITY_ACCESS.md`](features/TOURNAMENT_VISIBILITY_ACCESS.md) — accès à un tournoi non publié
- [`docs/features/GHOST_TEAMS.md`](features/GHOST_TEAMS.md) — équipes fantômes
- [`docs/features/SOLO_TOURNAMENTS.md`](features/SOLO_TOURNAMENTS.md) — entrées solo
- [`docs/features/LIVE_STREAMS.md`](features/LIVE_STREAMS.md) — `live` vs `casting`
- [`docs/features/TOURNAMENT_DELETION.md`](features/TOURNAMENT_DELETION.md) — le seul `isAdmin` du projet
- [`docs/features/SAFE_LOGIN_REDIRECT.md`](features/SAFE_LOGIN_REDIRECT.md) — redirection d'après connexion
- [`docs/features/RGPD_DATA_RIGHTS.md`](features/RGPD_DATA_RIGHTS.md) — export et anonymisation
