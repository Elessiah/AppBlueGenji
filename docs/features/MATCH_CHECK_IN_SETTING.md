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
compris, jusqu'à `FINISHED` (`canToggleMatchCheckIn`), par le staff qui a la
permission `tournaments`. À l'édition elle part par sa route propre,
`PUT /api/admin/tournaments/[id]/match-check-in` (`{ enabled }`, limite
`MATCH_CHECK_IN_TOGGLE_RULE`, codes `INVALID_TOURNAMENT_ID`,
`INVALID_MATCH_CHECK_IN`, `TOURNAMENT_NOT_FOUND` 404, `TOURNAMENT_FINISHED`
409, `MATCH_CHECK_IN_UPDATE_FAILED` 500), envoyée à chaque enregistrement avec
les deux autres interrupteurs (`Promise.allSettled`, `settledRefusals`).
`setMatchCheckIn` verrouille la ligne du tournoi en première instruction,
publie l'événement de mise à jour et le journal staff
`MATCH_CHECK_IN_ON` / `MATCH_CHECK_IN_OFF` (anonyme sur Discord).

## Lu à l'envoi, sans rattrapage

Stockage : `bg_tournaments.match_check_in TINYINT(1) NOT NULL DEFAULT 1` et
`match_check_in_resumed_at DATETIME NULL` (dans le `CREATE TABLE` et dans
`RECENT_SCHEMA_CHANGES`). Rallumer l'option pose `match_check_in_resumed_at`
(heure du processus, comme `start_at`) ; l'éteindre ne touche que le drapeau.

Un message de check-in ne part que si l'option est allumée **et** que son
échéance n'est pas antérieure à la reprise (`checkInSendable`,
`lib/shared/match-check-in.ts`) :

- **check-in du match** : garde `CHECK_IN_ON_SQL` dans `BRIEF_DUE_SQL`, donc
  dans la lecture **et** dans la réservation ; échéance = le plus tôt de
  H-15 et de l'ouverture du salon ;
- **rappel 10 h** : échéance = ouverture du palier (H-10). Éteint, ou rallumé
  après cette ouverture, le palier est **réservé sans message** : la manche
  n'est plus relue, et rallumer l'option ne le fait pas partir après coup ;
- **annonces** : jugées à l'instant de l'envoi ; éteint, ni ligne de check-in
  ni palier 10 h promis (`promisedOffsets`).

Rallumer l'option n'envoie donc **aucune salve** : seuls les messages dont
l'échéance vient après la reprise partent.

## Données de test et RGPD

Seed : « Live Horaire (heure à venir) » a l'option éteinte. RGPD : rien de
nouveau n'est collecté ni lu, l'option ne fait que retirer des envois — ni
entrée `PRIVACY_CHANGES`, ni registre ; les descriptions des sujets push
`MATCH_LOBBY_BRIEF` et `MATCH_REMINDER` disent l'exception.

Tests : `match-check-in.test.ts` (partagé et serveur), `match-check-in-route.test.ts`,
`match-reminders.test.ts` (bloc « Check-in des matchs »), `lobby-brief.test.ts`
(`dueSql_checkInOff_notDueInReadNorClaim`), `tournaments-validation.test.ts`,
`tournament-forms-i18n.test.tsx`, `database-schema.test.ts`.
