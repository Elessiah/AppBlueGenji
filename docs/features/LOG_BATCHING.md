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
- Un lot = un message, une ligne par rangée, dans l'ordre d'arrivée. Il n'est
  découpé que si Discord l'impose : 1 900 caractères par message
  (`BOT_LOG_MESSAGE_MAX_CHARS` — 2 000 chez Discord, moins le préfixe
  `[AppBlueGenji] ` du bot) ; une ligne seule plus longue est coupée
  (`packBotLogLines`, `lib/shared/bot-log-batch.ts`) : entre ses rangées
  d'abord, puis caractère par caractère, **jamais** entre une barre oblique
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
Les lots ayant chacun leur minuteur, un « tournoi terminé » fait partir d'abord le lot `results` du tournoi (`bot-logs.ts`) : le résultat de la finale précède toujours la fin.
Une ligne sans tournoi (inscription d'un joueur au site, gestes de modération
par `publishStaffAction`) rejoint le lot commun de sa catégorie.

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
| `staff-removal` | Retrait d'arbitre ou de caster | un arbitre ou un caster retiré d'un match : retrait volontaire ou par le staff, remplacement, retrait d'office, autogestion qui écarte l'arbitre, opposition retenue (`referee-notices.ts`, `cast-notices.ts`, `match-launch.ts`, route d'opposition). Les désignations et inscriptions restent en `referees` / `casts` | `alert` |
| `casts` | Casts | `cast-notices.ts` | `log` |
| `results` | Résultats | résultat d'un match, pénalités d'endurance (`bot-logs.ts`) | `log` |
| `tournament` | Tournoi | création, lancement, fin, tournoi sous-rempli (`bot-logs.ts`) | `log` |
| `registrations` | Inscriptions | inscription, abandon (`bot-logs.ts`), retrait d'engagée, abandon annulé (routes admin) | `log` |
| `schedule` | Programme | horaires posés, changés, retirés (`schedule-notices.ts`) | `log` |
| `maps` | Cartes | règles de ban, résumé de cartes de manche (`round-maps.ts`, `round-maps-notice.ts`) | `log` |
| `admin` | Administration | gestes du staff sur un match ou un tournoi (`staff-action-logs.ts`), suppression d'un tournoi, retour en arrière d'une manche, rôles de plateforme — défaut de `publishStaffAction` | `log` |
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
  copies ; l'arrêt doit voir les lots des routes). Minuteurs `unref()`.
- **Arrêt propre** : `instrumentation.ts` → `installBotLogShutdownFlush`
  (`lib/server/bot-log-shutdown.ts`) envoie les lots sur `SIGINT` / `SIGTERM`,
  borné à 1,2 s (pm2 tue après `kill_timeout`, 1,6 s par défaut). Next ferme
  le serveur sur le même signal et appelle `process.exit(0)` sans attendre :
  `holdExitUntil` retient cet appel jusqu'à la fin de l'envoi ; un appel
  suivant ne relance rien, mais un code d'échec (argument ou `process.exitCode`)
  l'emporte sur le `0` retenu
  (un crash pendant l'envoi reste un crash pour pm2). Si personne
  d'autre n'écoute le signal, le module termine lui-même le processus.
- **Arrêt brutal** : perd les lots en attente (au plus 4 lignes par clé, jusqu'à
  10 minutes de journal dans le pire cas). Rien n'est persisté : le journal n'est pas une
  donnée de référence (pm2 garde la trace d'audit).

## Cartes de manche

L'annonce des cartes (`ROUND_MAPS.md`) garde sa fusion en base (une ligne par
tournoi, les manches modifiées réunies, 60 s de silence) : elle seule sait
fusionner deux réglages de la même manche et survivre à un redémarrage. Sa
ligne résumée entre ensuite dans le lot `maps` du tournoi (catégorie `maps`), comme toute autre. La
fermeture de l'écran (`POST …/round-maps/flush`) envoie le résumé **et** le lot
`maps` du tournoi tout de suite (`flushBotLogBatch({ tournamentId, category })` ;
sans catégorie, tous les lots du tournoi partent).

## Tests

`tests/lib/shared/bot-log-batch.test.ts`, `tests/lib/server/bot-log-batcher.test.ts`
(silence relancé, âge maximal, plafond 5, isolation des clés, découpage, erreurs),
`tests/lib/server/bot-log-sending.test.ts` (`sendBotLog` → `/internal/log`, `kind`, en-têtes, catégories jamais mêlées),
`tests/lib/shared/bot-log-category.test.ts`, `tests/lib/server/bot-log-categories-wiring.test.ts` (chaque appelant dans sa catégorie),
`tests/lib/server/bot-log-shutdown.test.ts`, `tests/lib/server/round-maps-notice.test.ts`.
