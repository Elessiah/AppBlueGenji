# Message du staff aux participants d'un tournoi

Le staff des tournois (permission `tournaments`) écrit aux participants d'un
tournoi, **depuis Discord** (commande `/message-tournoi`, EN `/tournament-message`)
ou **depuis la fiche du tournoi** (bouton « Message aux participants »). Les deux
portes appellent **le même service** : `lib/server/tournament-staff-message.ts`
(destinataires, plafond, envoi, journal). Règles pures partagées :
`lib/shared/tournament-staff-message.ts`.

## Ce qui part, à qui

- **États** : `REGISTRATION` et `RUNNING` (`STAFF_MESSAGE_STATES`) ; ailleurs,
  `409 TOURNAMENT_NOT_OPEN_FOR_MESSAGES`. Un tournoi à venir n'a pas encore
  d'inscrites ; un tournoi terminé n'a plus rien à organiser.
- **Engagés** : les inscrites du tournoi, sans équipe fantôme (`is_ghost`, aucun
  vrai joueur), sans équipe dissoute, sans engagé qui a abandonné (`FORFEIT`
  dans les classements suisse, survie et endurance) ; un engagé éliminé reste
  participant. Il n'existe pas de liste d'attente. Une entrée solo
  (`solo_user_id`) vaut un joueur.
- **Membres** : les membres **actuels** (`left_at IS NULL`) ; le site ne garde
  pas de roster par inscription.
- **Catégories** (union, un compte compté une fois) : `PLAYERS` = membres
  `TANK`/`DPS`/`HEAL` et joueur d'une entrée solo ; `MANAGERS` = `MANAGER` ;
  `CAPTAINS` = `CAPITAINE` ; `OWNERS` = `OWNER` ; `ALL` = tous les membres
  (coach compris). `ALL` l'emporte sur les autres.
- **Comptes exclus** : supprimés, suspendus (`loadNotificationRecipients`,
  `excludeSuspended`).
- **Canaux** : `notifyUsers` avec le sujet `TOURNAMENT_STAFF_MESSAGE`
  (« Messages du staff des tournois ») et `dmFollowsTopic` — couper le sujet
  dans « Mon profil » coupe **aussi** le message privé. Message privé à un
  Discord prouvé (`proven` : rattaché ou tag certifié), push sinon.
- **Texte** : signé « le staff du tournoi », jamais son auteur ; texte cité par
  `discordQuote`, nom du tournoi par `discordQuoted` (aucune mention, aucun lien
  masqué) ; FR ou EN selon le compte. 1 200 caractères au plus
  (`STAFF_MESSAGE_MAX_LENGTH`), et le message privé rendu doit tenir dans
  `DM_MAX_LENGTH` dans les deux langues (`STAFF_MESSAGE_TOO_LONG`) ; vide
  refusé (`STAFF_MESSAGE_EMPTY`).
- **Envoi par lots** : `notifyUsers` découpe les destinataires par 100
  (`BOT_DM_RECIPIENTS_PER_CALL`, plafond de `/internal/notify/dm`) et par 25 ici,
  délai 120 s par appel, sans le coupe-circuit (`DirectMessageDelivery`).

## Plafond

3 envois (`STAFF_MESSAGE_SENDS_PER_WINDOW`) par membre du staff et par tournoi
sur 60 minutes (`STAFF_MESSAGE_WINDOW_MINUTES`), table
`bg_tournament_staff_message_quota` (PK tournoi + compte, fenêtre, compte). La
place se **réserve en une instruction** : `INSERT … ON DUPLICATE KEY UPDATE`
idempotent, puis `UPDATE … SET sends = IF(fenêtre échue, 1, sends + 1) … WHERE
sends < ? OR fenêtre échue` et `affectedRows`. Un envoi dont rien n'est parti
(bot injoignable, aucun push) est rendu au plafond. Lignes purgées toutes les
heures une fois la fenêtre échue, et en cascade avec le tournoi ou le compte.
Table absente : `503 STAFF_MESSAGE_UNAVAILABLE`. En plus, appels limités en
mémoire : 60 / 10 min par Discord (bot), 120 / 10 min par compte (fiche).

## Journal

`publishStaffAction` : sur Discord, « 📣 Message du staff aux participants du
tournoi « X » (catégories) : N visé(s), … — par le staff » (anonyme, nombres
seuls) ; dans pm2, l'auteur nommé, le numéro du tournoi et la **longueur** du
texte. Le texte n'est enregistré nulle part (registre T04, T08).

## Depuis Discord — `/message-tournoi`

Seule exception au sens app → bot (`BOT_INTEGRATION.md`) : le bot **appelle le
site**, `POST /api/internal/tournament-message`, jeton `SITE_INTERNAL_TOKEN`
(en-tête `x-internal-token`, comparaison à temps constant sur empreintes
SHA-256, `503 SITE_INTERNAL_TOKEN_NOT_CONFIGURED` sans jeton, `401` sinon).
Pas de contrôle de provenance : la route est de serveur à serveur, sans cookie
ni session — un navigateur n'a pas le jeton, et le bot n'envoie pas d'`Origin`.
Corps `{ mode: "preview" | "send", discordId, tournamentId, categories, message }` ;
le site retrouve le compte rattaché à ce Discord (`DISCORD_ACCOUNT_NOT_LINKED`
sinon) et vérifie `tournaments` (`FORBIDDEN`). Réponse : des **nombres**
(`total`, `reachable`, `withoutDiscord`, `optedOut` ; au bilan `sent`, `failed`,
`skipped`, `pushed`, `botUnreachable`), jamais un nom ni un identifiant.

Côté bot (dépôt `blueGenjiBot`, `src/commandsHandlers/messageTournoi.ts`) :
réponse éphémère, menu à choix multiples (Joueurs, Managers, Capitaines, Owners,
Tous ; 1 à 5, Tous par défaut), boutons Envoyer / Annuler réservés à l'auteur,
panneau expiré après 5 minutes, site injoignable → message éphémère sans
plantage. Variables du bot : `SITE_INTERNAL_URL` (boucle locale seulement) et
`SITE_INTERNAL_TOKEN`.

## Depuis le site — « Message aux participants »

Bouton de l'en-tête de la fiche (`TournamentHeader`), pour `detail.isAdmin`
(permission `tournaments`) dans les états admis ; fenêtre `StaffMessageDialog`
(cadre commun, portail, `useDialogBehavior`, `useBackdropDismiss`), chargée à
la demande avec ses textes (`tournamentDialogs.json` § `staffMessage`).

- Cases des catégories : « Tous » coche ou décoche tout, décocher une catégorie
  décoche « Tous », cocher la dernière qui manquait le recoche
  (`_lib/staff-message-dialog.ts`) ; au moins une case.
- Décompte en direct : `{ mode: "count", categories }` à chaque changement de
  cases (300 ms de calme), en nombres seuls ; un décompte ne vaut que pour les
  cases qui l'ont demandé.
- Compteur du texte (1 200), envoi retenu tant que le texte est vide ou trop
  long, le décompte absent ou personne à prévenir.
- Envoi confirmé par `ConfirmActionDialog` (sans retour possible) ; bilan et
  refus en notification (`useToast`).

Route : `POST /api/tournaments/[id]/staff-message` — session, provenance
vérifiée par le middleware, `can(user, "tournaments")`, corps
`{ mode: "count" | "preview" | "send", categories, message? }`, même service
(auteur `{ userId }`, relu en base : suspension et permission comprises).

## Tests

`tests/lib/shared/tournament-staff-message.test.ts`,
`tests/lib/server/tournament-staff-message.test.ts`,
`tests/lib/server/internal-token.test.ts`,
`tests/app/api/internal/tournament-message-route.test.ts`,
`tests/app/api/tournaments/staff-message-route.test.ts`,
`tests/tournois/staff-message-dialog.test.ts`,
`tests/tournois/staff-message-dialog-render.test.tsx` ; côté bot,
`src/tests/tournament/*` et `src/tests/commandsHandlers/messageTournoi.test.ts`.
