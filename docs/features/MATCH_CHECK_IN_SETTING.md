# Option « Check-in des matchs » (NO-CHECKIN)

Case du formulaire de tournoi, **cochée par défaut** (comportement historique),
FR « Check-in des matchs » / EN « Match check-in », avec son `<InfoHint>`
(`form.matchCheckIn.*`, `MatchCheckInField`). Décision D84 du 2026-11-13.

## Ce que la case coupe

Décochée, le site n'envoie plus rien qui parle du check-in :

- **pas de check-in du match** (`MATCH_LOBBY_BRIEF`, message privé et push
  15 min avant — `MATCH_LOBBY_BRIEF.md`) ;
- **pas de rappel 10 h** (palier `PT10H`, `DISCORD_NOTIFICATIONS.md`) ;
- **aucune ligne ni lien de check-in** : ni `checkInLine` dans une annonce
  d'horaire, ni « Prochain rappel : 10 heures avant ».

Restent inchangés : le rappel 24 h, les annonces d'horaire, `NEW_MATCH`,
`MATCH_START`, les pushs de score, et tout le côté Discord (salons de check-in
et vocaux : le bot n'est pas touché). Le programme d'arbitrage ne promet aucun
check-in aux joueurs : il ne change pas. La page du match n'affiche aucune
information de check-in : ni instantané ni REST à câbler.

## Modifiable à tout moment

Comme la planification et les salons vocaux, la case n'est **ni verrouillée ni
restreinte** : modifiable à la création et à l'édition, tournoi en cours
compris, jusqu'à `FINISHED` (`canToggleMatchCheckIn`, même règle que
`canToggleRefereeScheduling` dont le formulaire tire le verrou), par le staff qui a la
permission `tournaments`. À l'édition elle part par sa route propre,
`PUT /api/admin/tournaments/[id]/match-check-in` (déroulé commun avec les
salons vocaux : `putTournamentToggle`, `lib/server/tournament-toggle-route.ts` ;
carte commune `SettingToggleCard`) (`{ enabled }`, limite
`MATCH_CHECK_IN_TOGGLE_RULE`, codes `INVALID_TOURNAMENT_ID`,
`INVALID_MATCH_CHECK_IN`, `TOURNAMENT_NOT_FOUND` 404, `TOURNAMENT_FINISHED`
409, `MATCH_CHECK_IN_UPDATE_FAILED` 500), envoyée à chaque enregistrement avec
les deux autres interrupteurs, **l'un après l'autre** (même ligne verrouillée : en parallèle l'un perdrait le verrou ; `saveToggles`, `_lib/toggle-save.ts`, `settledRefusals`) ; une contention (409 `CONCURRENT_UPDATE_RETRY`) a son message (`edit.concurrentRetry`).
`setMatchCheckIn` verrouille la ligne du tournoi en première instruction,
publie l'événement de mise à jour et le journal staff
`MATCH_CHECK_IN_ON` / `MATCH_CHECK_IN_OFF` (anonyme sur Discord).

## Lu à l'envoi, sans rattrapage

Stockage : `bg_tournaments.match_check_in TINYINT(1) NOT NULL DEFAULT 1` et
`match_check_in_paused_at DATETIME NULL` (dans le `CREATE TABLE` et dans
`RECENT_SCHEMA_CHANGES`). Éteindre l'option pose `match_check_in_paused_at`
(heure du processus, comme `start_at`). Seul ce qui devient dû **pendant
l'arrêt** — depuis cet instant, ou depuis toujours faute d'arrêt daté (tournoi
créé sans check-in) — se tait ; ce qui était dû avant l'arrêt, et que le
balayage (lancé par les visites) n'avait pas encore pris, n'est ni envoyé ni
réservé pendant l'arrêt et part à la remise en marche. **Chaque arrêt est
soldé à sa remise en marche** : ce qui y est devenu dû est réservé sans message
dans la transaction même (rejouée sur un interblocage, l'instant présent repris
à chaque tentative) — un second arrêt ne rouvre pas le premier.

- **check-in du match** : éteinte, la garde `CHECK_IN_ON_SQL`
  (`t.match_check_in = 1`, dans la lecture **et** dans la réservation) ne laisse
  rien partir ni réserver. Rallumer tait, pour les deux côtés en une
  instruction (`silencePausedLobbyBriefs`), le check-in des matchs dus
  **maintenant** (`BRIEF_WINDOW_SQL`) qu'aucune branche active n'a rendu dû
  avant l'arrêt : ni l'horaire (H-15 avant l'arrêt, encore dans sa fenêtre) ni
  le salon (`LOBBY_ENTRY_SQL` : lancement pour un match lancé, ouverture faute
  d'horaire, sinon le plus tard de l'ouverture et de l'horaire). L'horaire se
  compare à l'arrêt (heure du processus) ; le salon, à l'arrêt ramené sur
  l'horloge de la base (`NOW()` moins le temps écoulé). La réservation muette
  (`LOBBY_BRIEF_MUTE`, clé `<engagée>@<horaire>`) ne vaut que pour l'horaire du
  moment : un match déplacé ensuite reçoit son check-in à la nouvelle heure ;
- **rappel 10 h** : éteinte, un palier dû pendant l'arrêt est **réservé sans
  message** ; un palier dû avant l'arrêt est laissé libre (`checkInReminderFate`
  : `send` / `silence` / `hold`), et rendu s'il était déjà réservé à l'envoi —
  y compris par une annonce de première observation (une manche découverte
  pendant l'arrêt ne consomme pas un palier dû avant l'arrêt, ni à la
  préparation ni à l'envoi).
  Rallumer réserve aussi sans message le palier des manches **déjà annoncées**
  (marque `SEEN`) dont le coup d'envoi tombe dans les 10 h **et** au moins 10 h
  après l'arrêt : leur fenêtre s'est ouverte pendant l'arrêt. Ni statut ni
  engagées n'y filtrent : une manche au score refusé, rendue jouable ensuite,
  reste tue. Une manche connue ou programmée après la reprise garde son
  rappel, même si sa fenêtre est déjà ouverte ;
- **annonces** : jugées à l'instant de l'envoi ; éteinte, ni ligne de check-in
  ni palier 10 h promis (`promisedOffsets`).

L'option est **relue juste avant chaque envoi qui en dépend** (rappel 10 h,
annonce d'horaire ; jamais un avis de retrait ni le rappel 24 h) : une ronde
suisse part par lots, et l'option a pu changer depuis la lecture du passage.
La relecture n'a pas de cache (`readCheckInState`, une ligne par clé primaire
et par envoi) : une bascule faite par un autre processus vaut aussi. La reprise des
messages privés non remis (deux minutes plus tard) la relit aussi : éteinte,
un rappel 10 h ne se reprend pas ; une annonce reprise dit la ligne de
check-in et promet le rappel 10 h selon ce que l'option vaut **à la reprise**,
et ne promet plus un palier déjà réservé entre-temps (parti, ou tu par la
remise en marche).

Rallumer l'option n'envoie donc **aucune salve** : rien de ce qui était dû
pendant l'arrêt ne part.

## Bascule commune

Les trois options basculables jusqu'à la clôture (planification par
l'arbitrage, salons vocaux d'équipe, check-in des matchs) partagent la règle
`canToggleLiveTournamentOption` (`lib/shared/tournament-state.ts`) et le
déroulé `putTournamentToggle` (`lib/server/tournament-toggle-route.ts` :
session, permission `tournaments`, débit par compte — `REFEREE_SCHEDULING_TOGGLE_RULE`,
`TEAM_VOICE_TOGGLE_RULE`, `MATCH_CHECK_IN_TOGGLE_RULE` —, identifiant, corps,
contention rendue en 409 `CONCURRENT_UPDATE_RETRY`) ; chaque route fournit son
journal (`announce`) et, pour la planification, `movedToPlanning` (`extra`).

## Textes qui en parlent

L'aide des messages privés de match (« Mon profil », `profile.json`) dit que le
check-in et le rappel 10 h manquent dans un tournoi sans check-in ; les rôles
d'équipe (`team.json`) disent « si le tournoi en a un ». FR et EN.

## Données de test et RGPD

Seed : « Live Horaire (heure à venir) » a l'option éteinte. RGPD : rien de
nouveau n'est collecté ni lu, l'option ne fait que retirer des envois — pas
d'entrée `PRIVACY_CHANGES` ; le registre (T04) et `/rgpd` (FR et EN) disent
que le check-in et le rappel 10 h ne partent pas dans un tournoi sans
check-in, comme les descriptions des sujets push `MATCH_LOBBY_BRIEF` et
`MATCH_REMINDER`.

Tests : `match-check-in.test.ts` (partagé et serveur), `match-check-in-route.test.ts`,
`match-reminders.test.ts` (bloc « Check-in des matchs » et reprises),
`lobby-brief.test.ts` (`dueSql_checkInOff_notDueInReadNorClaim`,
`dueSql_checkInResumed_ignoresLobbyOpenedForReplacedPairing`),
`setting-toggle-card.test.tsx`, `tournaments-validation.test.ts`,
`tournament-forms-i18n.test.tsx`, `database-schema.test.ts`.
