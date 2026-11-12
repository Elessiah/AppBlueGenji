# Lots du journal Discord

Une série de gestes (arbitres désignés pour toute une manche, cartes, casts,
inscriptions…) faisait une série de messages dans le journal du staff. Toute
ligne du journal (`sendBotLog` → `POST /internal/log`) rejoint désormais un
**lot**, envoyé en **un seul message**.

## Règle

- Une ligne demandée ne part pas : elle rejoint le lot de sa clé et (re)lance
  un silence de **5 minutes** (`BOT_LOG_BATCH_WINDOW_MS`). Chaque nouvelle ligne
  relance le silence à 5 minutes.
- À **5 lignes** (`BOT_LOG_BATCH_MAX_LINES`), le lot part tout de suite ; la
  ligne suivante ouvre un nouveau lot.
- **Âge maximal : 10 minutes** (`BOT_LOG_BATCH_MAX_AGE_MS`, option `maxAgeMs`). Un lot part au
  plus tard 10 minutes après sa **première** ligne, quoi que dise le silence :
  un filet de lignes espacées de 4 minutes ne le repousse pas. Ce délai ne
  repart qu'avec la première ligne du lot suivant. Une ligne attend donc au
  pire **10 minutes** ; un lot part plus tôt à 5 lignes ou après 5 minutes de
  silence.
- Une ligne d'**alerte** (`botLogKind(category) === "alert"` : relevé des
  arbitres, arbitre qui joue, retrait d'un arbitre ou d'un caster) part
  **aussitôt**, précédée des lignes de son tournoi en attente (qui
  l'expliquent) : l'appel à agir n'attend pas le silence d'une trace.
- Un lot = un message, une ligne par rangée, dans l'ordre d'arrivée, chaque
  ligne telle quelle, indentation comprise (les lignes vides sont ignorées ;
  rangées vides de tête et blancs de fin tombent). Il n'est
  découpé que si Discord l'impose : 1 900 caractères par message
  (`BOT_LOG_MESSAGE_MAX_CHARS` — 2 000 chez Discord, moins le préfixe
  `[AppBlueGenji] ` du bot) ; une ligne seule plus longue est coupée
  (`packBotLogLines`, `lib/shared/bot-log-batch.ts`) : entre ses rangées
  d'abord, puis au dernier blanc (un mot ou une adresse n'est pas tronqué),
  caractère par caractère seulement sans blanc, **jamais** entre une barre oblique
  inverse et le caractère qu'elle échappe (le morceau suivant ouvre un nouveau
  message : un `<@&rôle>` désamorcé par `discordInline` y redeviendrait actif) ;
  une rangée citée (`> `, `discordQuote`) garde sa marque dans chaque morceau.
  Un message qui poursuit une ligne coupée s'ouvre sur la rangée `(suite)`
  (`BOT_LOG_CONTINUATION_LEAD`) : le bot préfixe chaque message de
  `[AppBlueGenji] `, et sans elle un texte d'utilisateur ouvrirait le message
  comme une ligne du site (une citation y perdrait même sa marque). Elle suit
  l'en-tête de catégorie.

## Clé d'un lot

`botLogBatchKey(salon, tournoi, catégorie)` : **le salon de destination**, puis
**le tournoi** quand la ligne en relève (`sendBotLog(ligne, { tournamentId })`),
puis la **catégorie** du geste (`sendBotLog(ligne, { category })`, absente :
`general`) — `log:tournament:7:referees`, `log:global:admin`. Deux salons ne se
mêlent jamais, deux tournois non plus, **deux types de ligne non plus** : un
message du journal parle d'un seul tournoi et d'un seul type de geste. Plafond
de 5 lignes, silence de 5 minutes et âge maximal de 10 minutes s'appliquent
**par clé** : un lot d'arbitrage plein ne fait pas partir le lot des casts.
Un identifiant de tournoi reçu en chaîne (colonne relue de MySQL) est accepté
(`botLogTournamentId`) : la ligne reste dans le lot de son tournoi.

**Ordre au salon** (`bot-logs.ts`) : les lots ayant chacun leur minuteur,
- un « tournoi terminé » fait partir d'abord **tous** les lots du tournoi
  (résultats, lancement, forfait qui le clôt) ;
- un résultat fait partir d'abord le lot `tournament` (un lancement qui attend
  son silence ne paraît pas après les résultats) ;
- une alerte du canal arbitre fait partir d'abord les lots de son tournoi
  (attente bornée à `ALERT_FLUSH_WAIT_MS`, 2 s : un bot lent ne la retient pas) ;
- les lignes de deux transactions sortent dans l'**ordre des commits** (un tour
  pris au commit, sur `globalThis`, attendu au plus `BOT_LOG_ORDER_WAIT_MS`,
  1 s — sous le délai de l'arrêt propre). Les alertes n'attendent pas ce tour, et un passage
  qui ne porte que des alertes n'en prend pas. Plusieurs alertes d'un même tournoi dans un
  passage ne paient qu'une attente de vidage. L'arrêt propre attend (borné) le dernier tour,
  et `flushAll` boucle jusqu'au repos (5 tours au plus) pour les lignes tardives. Les alertes se résolvent à part des lignes ; le tour se rend de lui-même après `BOT_LOG_ORDER_WAIT_MS` si la lecture traîne ; une alerte sans tournoi ne fait partir que son propre lot. Un vidage sans lot en attente attend tout de même les envois déjà en route de sa portée (l'alerte ne double pas les lignes qu'elle explique). Les alertes d'un même geste (huit casters désinscrits) partent en un message : le vidage se fait à la fin du tour synchrone, par tournoi. Un second signal d'arrêt, une fois le premier vidage fini, vide de nouveau.

Plusieurs lots vidés ensemble (`flushBotLogBatch` sans catégorie, `flushKeys`)
partent dans l'ordre de leur **première ligne**. Les envois s'enchaînent **par
portée** (un tournoi, ou le salon hors tournoi) : un bot lent pour un tournoi
ne retarde pas les autres.

Une ligne sans tournoi (inscription d'un joueur au site, gestes de modération)
rejoint le lot commun de sa catégorie. `publishStaffAction(ligne, auteur, {
category, tournamentId?, auditLine? })` : la catégorie est obligatoire, et un
geste sur un tournoi (retrait, forfait annulé, retour en arrière, suppression,
horaires, arbitrage) rejoint le lot de ce tournoi. « Valider le résultat »
n'écrit plus de ligne 🛠️ à part : la ligne « Match terminé » du moteur porte
« — résultat validé par le staff » (`markResultValidatedByStaff`).

Chaque message du lot s'ouvre sur l'**en-tête français** de sa catégorie
(`BOT_LOG_CATEGORY_HEADERS`, `lib/shared/bot-log-category.ts`) — un libellé
fixe, jamais un nom ni un `#id` de joueur ; il compte dans la limite de
1 900 caractères.

### Catégories

| Catégorie | En-tête | Lignes | `kind` |
|---|---|---|---|
| `referees` | Arbitrage | désignations et retraits (`referee-notices.ts`), autogestion d'une manche (`match-launch.ts`), objection, planification par l'arbitrage | `log` |
| `referee-digest` | Matchs à arbitrer | relevé des matchs à venir sans arbitre (`referee-digest.ts`) | `alert` |
| `referee-self-action` | Arbitrage à vérifier | un membre du staff a tranché (ou mis en pause, forfait…) un match qu'il joue (`dispute-self-resolution.ts`) : les autres vérifient | `alert` |
| `staff-removal` | Retrait d'arbitre ou de caster | un arbitre ou un caster retiré d'un match qui reste sans lui : retrait volontaire ou par le staff, retrait d'office, autogestion qui écarte l'arbitre, opposition retenue (`referee-notices.ts`, `cast-notices.ts`, `match-launch.ts`, route d'opposition). Les désignations et inscriptions restent en `referees` / `casts`, même quand elles remplacent un titulaire (créneau repourvu dans la même transaction) — sauf la reprise d'un match par l'arbitre qui en écarte un titulaire devenu inéligible (`TAKEN` + `afterRemoval`) : sa ligne suit celle du retrait dans le même lot, l'alerte dit d'emblée que le créneau est repourvu | `alert` |
| `casts` | Casts | `cast-notices.ts` | `log` |
| `results` | Résultats | résultat d'un match, pénalités d'endurance (`bot-logs.ts`) | `log` |
| `tournament` | Tournoi | création, lancement, fin, tournoi sous-rempli (`bot-logs.ts`) | `log` |
| `registrations` | Inscriptions | inscription, abandon (`bot-logs.ts`), retrait d'engagée, abandon annulé (routes admin) | `log` |
| `schedule` | Programme | horaires posés, changés, retirés (`schedule-notices.ts`) | `log` |
| `maps` | Cartes | règles de ban, résumé de cartes de manche (`round-maps.ts`, `round-maps-notice.ts`) | `log` |
| `admin` | Administration | gestes du staff sur un match ou un tournoi (`staff-action-logs.ts`), suppression d'un tournoi, retour en arrière d'une manche, rôles de plateforme | `log` |
| `moderation` | Modération | logos, avatars, suspensions, signalements (`logo-quarantine.ts`, `account-suspensions.ts`, `content-reports.ts`) | `log` |
| `signups` | Nouveaux comptes | inscription d'un joueur au site (`sign-in.ts`) | `log` |
| `general` | Journal | repli d'une ligne sans catégorie | `log` |

Ajouter une catégorie : l'ajouter à `BOT_LOG_CATEGORIES`, à ses tables de
nature et d'en-tête (`Record` exhaustifs : cela ne compile pas sinon), puis à
ce tableau. Les évènements de `bot-logs.ts` se rangent par
`BOT_EVENT_LOG_CATEGORIES` (`lib/shared/referee-alerts.ts`, exhaustive).

## Nature de l'appel (`kind`)

Tout `POST /internal/log` porte `kind: "log" | "alert"`, **déduit de la
catégorie** (`botLogKind`) — jamais choisi par l'appelant, pour qu'une
catégorie ne soit pas tantôt trace, tantôt alerte. Le bot poste `log` en
`@silent` ; `alert` notifie ; un `kind` absent vaut `alert` (un site plus
ancien reste notifiant). Trois catégories sont des alertes : `staff-removal` appelle le staff à repourvoir le créneau d'un arbitre ou d'un caster retiré (la suppression d'un compte n'écrit aucune ligne Discord), `referee-digest`
appelle un arbitre à se positionner, `referee-self-action` appelle le staff à
vérifier le geste d'un arbitre qui joue le match. Tout le reste est une trace. **Déployer le bot
avant le site.** Le canal arbitre (`/internal/notify/referees`) n'est pas
concerné : le bot y gère lui-même la trace.

## Ce qui ne change pas

- **Le canal arbitre** (`pushRefereeAlert`, `POST /internal/notify/referees`)
  reste immédiat : il appelle une intervention humaine (conflit de score, match
  sans arbitre) et n'est pas un journal.
- **pm2** : `publishStaffAction` écrit la ligne nominative **avant** et sans
  attendre ; seule la moitié Discord, anonyme, attend dans le lot.
- **Vie privée** : le lot transmet les lignes telles que rédigées, sans rien y
  ajouter (hormis l'en-tête de catégorie, libellé fixe) (`RGPD_LOGS_AND_VISITS.md`, `UNTRUSTED_NAMES.md`) — ni pseudo, ni
  `#id` de joueur, staff anonyme. Ni nouvelle donnée, ni nouveau lecteur, ni
  durée de garde nouvelle : pas d'entrée `PRIVACY_CHANGES`.
- **Bot injoignable** : même dégradation qu'avant (`postBotLog`, coupe-circuit
  compris) — le lot est perdu comme la ligne l'était.

## Robustesse

- Lots en mémoire, sur `globalThis` (Next peut charger le module en plusieurs
  copies ; l'arrêt doit voir les lots des routes). Le transport y est relu à
  chaque envoi (`__bgBotLogTransport`) : un rechargement à chaud ne garde pas
  l'ancien. Les accès de test (`pendingBotLogBatches`, `resetBotLogBatches`)
  vivent dans `tests/helpers/bot-log-batches.ts`, jamais dans le module de
  production.
- **Un minuteur par lot**, posé à l'échéance la plus proche (silence ou âge),
  réarmé à son réveil ; `unref()`. Les options sont bornées (`windowMs`,
  `maxAgeMs` dans [1 ms, 2³¹ − 1], valeur non finie : défaut) ; un en-tête qui ne
  laisserait pas 16 caractères aux lignes est omis. Une ligne d'une autre
  catégorie sur une clé envoie d'abord le lot en cours.
- `sendBotLog` est **synchrone** (`void`) : il range la ligne, ne lève jamais ;
  aucun appelant ne l'attend.
- **Arrêt propre** : `instrumentation.ts` → `installBotLogShutdownFlush`
  (`lib/server/bot-log-shutdown.ts`) envoie les lots sur `SIGINT` / `SIGTERM`,
  borné à 1,2 s (pm2 tue après `kill_timeout`, 1,6 s par défaut). Next ferme
  le serveur sur le même signal et appelle `process.exit(0)` sans attendre :
  `holdExitUntil` retient cet appel jusqu'à la fin de l'envoi ; un appel
  suivant ne relance rien, mais un code d'échec (argument ou `process.exitCode`)
  sort **aussitôt**, avant ou après le `0` retenu
  (un crash pendant l'envoi reste un crash pour pm2). Si personne
  d'autre n'écoute le signal, le module **relance le signal** une fois l'envoi
  fini (`process.kill`) : sortie 128 + n, jamais un succès. Un seul vidage par
  processus, partagé par `SIGINT` et `SIGTERM` ; son état vit sur `globalThis`.
  Après `flushAll`, une ligne demandée part aussitôt, pendant
  `CLOSING_GRACE_MS` (10 s) : un processus qui survit à l'arrêt retrouve ses lots.
- **Arrêt brutal** : perd les lots en attente (au plus 4 lignes par clé, jusqu'à
  10 minutes de journal dans le pire cas). Rien n'est persisté : le journal n'est pas une
  donnée de référence (pm2 garde la trace d'audit).

## Cartes de manche

L'annonce des cartes (`ROUND_MAPS.md`) garde sa fusion en base (une ligne par
tournoi, les manches modifiées réunies, 60 s de silence) : elle seule sait
fusionner deux réglages de la même manche et survivre à un redémarrage. Sa
ligne résumée est déjà le regroupement : `sendClaimed` vide le lot `maps` du
tournoi aussitôt après l'avoir posée, sans attendre 5 minutes de plus. La
fermeture de l'écran (`POST …/round-maps/flush`) vide en plus le lot
`referees` du tournoi (`flushBotLogBatch({ tournamentId, category })` ; sans
catégorie, tous les lots du tournoi partent).

## Tests

`tests/lib/shared/bot-log-batch.test.ts`, `tests/lib/server/bot-log-batcher.test.ts`
(silence relancé, âge maximal, plafond 5, isolation des clés, portées, bornes, découpage, erreurs),
`tests/lib/server/bot-log-sending.test.ts` (`sendBotLog` → `/internal/log`, `kind`, alertes immédiates, en-têtes, catégories jamais mêlées),
`tests/lib/shared/bot-log-category.test.ts`, `tests/lib/server/bot-logs.test.ts` (ordre des commits, vidages avant une fin ou un résultat),
les tests de chaque appelant (catégorie et tournoi de sa ligne : routes admin, `round-maps.test.ts`, `round-self-management-log.test.ts`…),
`tests/lib/server/bot-log-shutdown.test.ts`, `tests/lib/server/round-maps-notice.test.ts`.
