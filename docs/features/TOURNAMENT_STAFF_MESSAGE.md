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
  délai 120 s par appel, sans le coupe-circuit (`DirectMessageDelivery`) ; un
  lot sans bilan (issue incertaine) n'y compte pas non plus d'échec
  (`recordUndeliveredCall`) : un bot lent ne suspend pas les rappels de match.
  Un lot
  qui atteint le bot sans rendre de bilan (délai écoulé, connexion coupée en
  route, `200` illisible, panne `5xx` hors `503` : `onUncertain`) n'arrête pas
  les suivants (`uncertainIsNotLost`) ; ses comptes sont rendus à part
  (`discordUncertainUserIds`) et comptés `unconfirmed` (« sans bilan du bot,
  peut-être remis ») : ni « non remis », ni « bot injoignable », ni envoi rendu
  au plafond — le renvoyer doublerait le message de ceux qui l'ont reçu. Deux
  lots de suite sans bilan (`MAX_CONSECUTIVE_UNCERTAIN_CALLS`) : le bot est
  tenu pour figé, les lots restants ne partent pas.
- **Plafond rendu** quand rien n'est parti à coup sûr : aucun message privé
  remis, aucun push, aucun lot sans bilan (bot injoignable, messages privés
  tous refusés, personne d'atteignable).
- **Réponse sous 40 s** (`STAFF_MESSAGE_REPLY_DEADLINE_MS`) : nginx coupe une
  requête du navigateur à 60 s. Passé ce délai, la route répond
  `delivery.pending: true` (nombres d'envoi à zéro) et l'envoi continue en
  arrière-plan (`trackBackgroundPass`) ; son bilan final part au journal du
  staff. L'arrêt du serveur n'attend les passages de fond qu'un instant : s'il
  survient pendant l'envoi, `onBackgroundHalt` pose sur-le-champ au journal une
  ligne « le site s'arrête pendant l'envoi », avant son vidage. Les deux portes
  disent « ne le renvoie pas » pour `pending` comme pour `unconfirmed`.
- **Panne en plein envoi** (`notifyUsers` lève) : une ligne « panne pendant
  l'envoi — bilan inconnu » va au journal du staff avant que la panne remonte
  (500, fenêtre fermée sur « peut-être parti ») ; l'envoi n'est pas rendu au plafond.

## Plafond

3 envois (`STAFF_MESSAGE_SENDS_PER_WINDOW`) par membre du staff et par tournoi
sur 60 minutes (`STAFF_MESSAGE_WINDOW_MINUTES`), table
`bg_tournament_staff_message_quota` (PK tournoi + compte, fenêtre, compte). La
place se **réserve en une instruction** : `INSERT … ON DUPLICATE KEY UPDATE`
idempotent, puis `UPDATE … SET sends = IF(fenêtre échue, 1, sends + 1) … WHERE
sends < ? OR fenêtre échue` et `affectedRows` — deux passes au plus, la purge
pouvant effacer entre les deux une ligne dont la fenêtre vient d'échoir. Un
envoi dont rien n'est parti à coup sûr (bot injoignable, aucun push) est rendu
au plafond — dans **sa** fenêtre seulement (début relu après la réservation,
`AND window_started_at = ?`) : un envoi long dont la fenêtre a échu ne décompte
pas l'envoi qui en a ouvert une nouvelle. Lignes purgées une fois la fenêtre échue par une horloge de fond
(`startStaffMessageQuotaPurgeClock`, `instrumentation.ts`, toutes les 15
minutes), en cascade avec le tournoi, et à la suppression du compte
(`anonymizeAccount` : la ligne `bg_users` reste, la cascade ne joue pas).
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
SHA-256, `503 SITE_INTERNAL_TOKEN_NOT_CONFIGURED` sans jeton, avec un jeton de
moins de 32 caractères ou égal à `BOT_INTERNAL_TOKEN`, `401` sinon).
**Boucle locale seulement** : la route est joignable derrière nginx comme toute
route `/api/`, mais un appel qui y est passé est refusé avant le jeton
(`403 INTERNAL_ROUTE_LOOPBACK_ONLY`) — nginx ajoute en dernier à
`X-Forwarded-For` l'adresse de son client (une entrée forgée ne peut que la
précéder), Next pose l'adresse de la socket quand l'en-tête manque ; refusé
quand cette dernière entrée, ou un `X-Real-IP`, n'est pas en boucle locale
(`cameThroughPublicProxy`). Personne n'essaie donc le jeton depuis Internet.
Pas de contrôle de provenance : la route est de serveur à serveur, sans cookie
ni session — un navigateur n'a pas le jeton, et le bot n'envoie pas d'`Origin`.
Corps `{ mode: "preview" | "send", discordId, tournamentId, categories, message }` ;
le site retrouve le compte rattaché à ce Discord (`DISCORD_ACCOUNT_NOT_LINKED`
sinon) et vérifie `tournaments` (`FORBIDDEN`). Réponse : des **nombres**
(`total`, `reachable`, `withoutDiscord`, `optedOut` ; au bilan `sent`, `failed`,
`unconfirmed`, `skipped`, `pushed`, `botUnreachable`, `pending`), jamais un nom ni un identifiant.
L'aperçu rend en plus `quoted` (la citation neutralisée du message privé,
`discordQuote` : le bot l'affiche telle quelle, l'aperçu montre ce qui partira)
et `linkBase` (`APP_URL` ou `null` : le bot refuse un lien `tournoi` vers un
autre hôte, `www.` mis à part). Côté bot, **Envoyer** ne part pas tant que la
dernière sélection n'a pas été comptée (« clique de nouveau dans un instant ») ;
une valeur de menu inconnue ne change pas la sélection (jamais « tous » par défaut).

Côté bot (dépôt `blueGenjiBot`, `src/commandsHandlers/messageTournoi.ts`) :
réponse éphémère, menu à choix multiples (Joueurs, Managers, Capitaines,
Propriétaires, Tous ; EN Owners ; 1 à 5, Tous par défaut), boutons Envoyer /
Annuler réservés à l'auteur, panneau expiré après 5 minutes, site injoignable →
message éphémère sans plantage. Un aperçu en échec passager (site lent ou muet,
trop de demandes) garde le panneau sur la sélection précédente ; un envoi sans
réponse lisible (délai, connexion coupée, bilan illisible) dit « peut-être
parti, ne le relance pas ». Variables du bot : `SITE_INTERNAL_URL` (boucle locale seulement) et
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
- Décompte en échec : dit, avec un bouton « Recompter ».
- Compteur du texte (1 200), envoi retenu tant que le texte est vide ou trop
  long — y compris une fois rendu en message privé (`staffMessageRenderedTooLong`,
  même règle que le serveur, liens bâtis sur la racine que rend le décompte,
  `linkBase` = `APP_URL` ou `null`) —, le décompte
  absent ou personne à prévenir.
- Envoi confirmé par `ConfirmActionDialog` (sans retour possible) ; bilan et
  refus en notification (`useToast`) ; un refus du texte (`STAFF_MESSAGE_EMPTY`,
  `STAFF_MESSAGE_TOO_LONG`) est aussi rattaché au champ (`useFieldErrors`). Rien
  de remis, bot injoignable : une erreur, « réessaie plus tard » ; rien de remis,
  bot joint (personne d'atteignable) : une erreur sans invitation à renvoyer,
  la fenêtre se ferme ; bilan `pending` : « envoi en cours, ne le renvoie pas » ;
  `unconfirmed` : le bilan, avec « sans bilan du bot (peut-être remis), ne le
  renvoie pas » ; réponse illisible (`502`, `504`, réseau) : « peut-être parti »,
  la fenêtre se ferme. Les bilans qui disent « ne le renvoie pas » ou « incomplet »
  (`pending`, `unconfirmed`, bot injoignable avec push, « peut-être parti ») sont
  des notifications neutres (`showInfo`) ou d'erreur, gardées 15 s
  (`WARNING_TOAST`) : la fenêtre se ferme juste après. « Envoyer » retenu
  explique pourquoi quand on l'active (`onBlockedClick`, `staffMessage.blocked.*`) ;
  un décompte en échec ne s'empile qu'une fois (`once`) ; pendant l'envoi, les
  cases sont ternies (`data-busy`).

Côté bot, « Tous » (coché à l'ouverture du menu) est retiré dès qu'on coche une
autre catégorie (« seulement celles-ci ») ; un envoi qui n'a rien remis à coup sûr
n'a ni coche verte ni « envoyé » (comme la fenêtre du site).

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
