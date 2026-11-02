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
- Délai : 5 minutes après la dernière ligne. Comme chaque ligne relance le
  silence, une ligne attend **au pire environ 20 minutes** (quatre lignes
  espacées de 4 min 59 s) : c'est la règle demandée, sans âge maximal.
- Un lot = un message, une ligne par rangée, dans l'ordre d'arrivée. Il n'est
  découpé que si Discord l'impose : 1 900 caractères par message
  (`BOT_LOG_MESSAGE_MAX_CHARS` — 2 000 chez Discord, moins le préfixe
  `[AppBlueGenji] ` du bot) ; une ligne seule plus longue est coupée
  (`packBotLogLines`, `lib/shared/bot-log-batch.ts`) : entre ses rangées
  d'abord, puis caractère par caractère, **jamais** entre une barre oblique
  inverse et le caractère qu'elle échappe (le morceau suivant ouvre un nouveau
  message : un `<@&rôle>` désamorcé par `discordInline` y redeviendrait actif) ;
  une rangée citée (`> `, `discordQuote`) garde sa marque dans chaque morceau.

## Clé d'un lot

`botLogBatchKey(salon, tournoi)` : **le salon de destination**, puis **le
tournoi** quand la ligne en relève (`sendBotLog(ligne, { tournamentId })`). Deux
salons ne se mêlent jamais ; deux tournois non plus, pour qu'un message du
journal parle d'un seul tournoi. Une ligne sans tournoi (inscription d'un
joueur au site, programme d'arbitrage, gestes de modération par
`publishStaffAction`) rejoint le lot commun du salon (`log:global`).

Rattachées à leur tournoi : désignations et retraits d'arbitre
(`referee-notices.ts`), casts (`cast-notices.ts`), autogestion d'une manche
(`match-launch.ts`), gestes du staff (`staff-action-logs.ts`), cartes et règles
de ban (`round-maps.ts`, `round-maps-notice.ts`), évènements d'un tournoi
(`bot-logs.ts` : création, inscription, abandon, lancement, fin, pénalités, et
résultat d'un match, rattaché au tournoi relu avec le match — un « tournoi
terminé » ne passe donc pas devant le résultat de sa finale).

## Ce qui ne change pas

- **Le canal arbitre** (`pushRefereeAlert`, `POST /internal/notify/referees`)
  reste immédiat : il appelle une intervention humaine (conflit de score, match
  sans arbitre) et n'est pas un journal.
- **pm2** : `publishStaffAction` écrit la ligne nominative **avant** et sans
  attendre ; seule la moitié Discord, anonyme, attend dans le lot.
- **Vie privée** : le lot transmet les lignes telles que rédigées, sans rien y
  ajouter (`RGPD_LOGS_AND_VISITS.md`, `UNTRUSTED_NAMES.md`) — ni pseudo, ni
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
  suivant ne relance rien, mais un code d'échec l'emporte sur le `0` retenu
  (un crash pendant l'envoi reste un crash pour pm2). Si personne
  d'autre n'écoute le signal, le module termine lui-même le processus.
- **Arrêt brutal** : perd les lots en attente (au plus 4 lignes par clé, jusqu'à
  une vingtaine de minutes de journal dans le pire cas). Rien n'est persisté : le journal n'est pas une
  donnée de référence (pm2 garde la trace d'audit).

## Cartes de manche

L'annonce des cartes (`ROUND_MAPS.md`) garde sa fusion en base (une ligne par
tournoi, les manches modifiées réunies, 60 s de silence) : elle seule sait
fusionner deux réglages de la même manche et survivre à un redémarrage. Sa
ligne résumée entre ensuite dans le lot du tournoi, comme toute autre. La
fermeture de l'écran (`POST …/round-maps/flush`) envoie le résumé **et** le lot
du tournoi tout de suite (`flushBotLogBatch`).

## Tests

`tests/lib/shared/bot-log-batch.test.ts`, `tests/lib/server/bot-log-batcher.test.ts`
(silence relancé, plafond 5, isolation des clés, découpage, erreurs),
`tests/lib/server/bot-log-sending.test.ts` (`sendBotLog` → `/internal/log`),
`tests/lib/server/bot-log-shutdown.test.ts`, `tests/lib/server/round-maps-notice.test.ts`.
