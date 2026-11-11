# Cartes par tour du tournoi et règles de ban

Règles pures : `lib/shared/round-maps.ts`. Serveur : `lib/server/tournaments/round-maps.ts`.
Écrans : `RoundMapsDialog`, `MatchRoundMaps` (`app/(secured)/tournois/[id]/_components/`),
saisie pure `_lib/round-maps-editor.ts`. Liste des cartes : `lib/shared/overwatch-maps.ts`.
Tours à proposer : `lib/shared/round-plan.ts`.

**Vocabulaire** : l'écran dit « **tour du tournoi** » (« Tour 3 », EN « Tournament
round ») pour la clé `(phase, tableau, numéro)` — jamais « manche », qui se
confond avec une carte jouée. Le code garde `round`.

## Ce que le staff règle

**Cartes d'une manche** — une manche est `(phase, tableau, numéro)` (`phase_id = 0`
sans phases, comme l'autogestion par manche). Elle porte une liste ordonnée de
**créneaux** (carte 1, carte 2, …, 9 au plus) :

- un créneau à **une** carte l'**impose** à tous les matchs de la manche ;
- à **plusieurs** cartes (20 au plus), c'est un **pool** : l'arbitrage — ou, sur
  un match **en autogestion**, une équipe du match (rôle qui déclare « Prêt ») —
  choisit dans une liste.

Sans réglage, rien ne change : première carte libre posée par le staff
(`bg_matches.first_map`, `MATCH_REFEREE.md`).

**Choisir les cartes** — chaque créneau ouvre la **liste d'Overwatch** rangée par
mode (Contrôle, Escorte, Hybride, Offensive, Flashpoint, Affrontement), avec une
recherche sans casse ni accents (`filterOverwatchMaps`) et des cases à cocher
(groupe `data-tap-zone`) ; une carte absente se **saisit à la main** (64
caractères, `visibleText`). Les cartes retenues paraissent en pastilles qu'un ✕
retire. Un créneau vide **entre** deux cartes refuse l'enregistrement (`slotGap`) :
l'écarter décalerait les cartes suivantes. **Marvel Rivals : saisie libre seule.** Le stockage ne change pas : des
noms (anglais, ceux du jeu ; la graphie française n'a pas pu être vérifiée).

**Tous les tours, y compris à venir** — le sélecteur liste les tours générés,
ceux que le format annonce et ceux déjà réglés (`plannedRoundKeys`) :
élimination simple (+ petite finale), double (haut, bas, grande finale), ronde
suisse (rondes annoncées, sinon ⌈log₂(N)⌉ + 1 comme le moteur au coup d'envoi), BlueGenji Survie (manches qualificatives jusqu'au
plafond, puis play-offs à partir de `PLAYOFF_ROUND_OFFSET`), multi-phases (phase
par phase, effectif déduit des qualifiés). Avant le coup d'envoi, l'effectif
retenu est la capacité (au moins les inscrites) ; ensuite, les inscrites. Survie,
et Survie BlueGenji sans plafond, ne disent pas d'avance leur nombre de tours :
seul le **suivant** est proposé. Un réglage est une clé, pas une ligne de match :
posé sur un tour à venir, il s'applique dès que ses matchs sont créés. Chaque
tour affiche un résumé (« Tour 3 · 5 cartes · 2 pools »).

**Plafond de cartes** — l'indication « N cartes max » suit le format de match du
tour (`roundMaxMaps` : FT3 → 5, plafond abaissé compris, arbre final de
BlueGenji Survie selon le sien ; aucune en score libre) et borne l'ajout de
créneaux, sans dépasser `ROUND_MAP_SLOTS_MAX` (9).

**Copier** — « Copier » vers un tour choisi, ou « Appliquer à tous les tours » :
une seule écriture (`rounds`), une confirmation (`ConfirmActionDialog`) quand
un tour déjà réglé autrement serait remplacé (`overwrittenRounds`). Au-delà de
`ROUND_MAPS_BULK_MAX` (128) tours, l'écran envoie un lot par requête.

**Verrou d'échelle et réinitialisation** — dès qu'un tour a des cartes, elles
valent pour **tous** ses matchs : la carte 1 ne se saisit plus match par match
(la fenêtre « Arbitrage » montre les cartes du tour en lecture seule, la page du
match masque sa saisie) ; le choix dans un pool reste ouvert. « Réinitialiser le
tour » (fenêtre et page du match, confirmation, `InfoHint`) retire le réglage :
la saisie par match revient ; les choix déjà faits sur les matchs restent.

**Règles de ban du tournoi** (règlement §10), avec leurs défauts :

| Règle | Colonne | Défaut | Autre valeur |
|---|---|---|---|
| Premier ban de la carte 1 | `first_ban_rule` | `NON_HOST` (l'équipe qui n'héberge pas) | `HOST` |
| Premier ban des cartes suivantes | `next_ban_rule` | `LOSER` (perdant de la carte précédente) | `WINNER` |
| Carte suivante d'un pool | `next_pick_rule` | `LOSER` (choisie par le perdant de la carte précédente) | `FREE` (arbitrage) |

**« Choisie par le perdant » n'est ni proposée ni affichée** (décision du
2026-10-28) : les scores par carte n'existant pas, rien ne sait qui a perdu la
carte précédente et la règle ne serait pas appliquée — l'une ou l'autre équipe
en autogestion peut choisir. La fenêtre n'offre plus ce réglage (elle renvoie la
valeur stockée telle quelle) ; page du match, faits clés et brief n'en disent
rien. La colonne reste lue : la règle reviendra avec les scores par carte.

Les deux équipes bannissent : l'écran dit l'**ordre** (« X d'abord, puis Y »).
Sur un match nul, l'ordre est celui de la carte précédente. Les scores par carte
n'existant qu'au résultat retenu, les bans des cartes suivantes sont dits en
règle, pas en nom d'équipe — et pas du tout sur un match en une seule carte
(`roundMaxMaps` = 1).

Tout se règle **à tout moment** (avant, pendant, après la manche) : bloc
« Cartes et bans » de la fiche (staff `tournaments`, hors suivi gelé) et bouton
« Paramétrer les cartes du tour » de la page du match, ouvert sur son tour. Le
bloc de la fiche paraît dès la création : les tours à venir se règlent avant tout match.

**Fenêtre ouverte pendant qu'un autre règle** — règles de ban et cartes du tour
suivent l'instantané tant qu'elles n'ont pas été modifiées dans la fenêtre
(`resyncSlots`) ; une saisie en cours n'est jamais écrasée, et son propre
enregistrement est relu tel que le serveur l'a rangé (créneaux vides écartés).
Chaque formulaire dit « Modifications non enregistrées » (`<output>`)
tant qu'il diffère du serveur. Un créneau vide entre deux cartes, ou un refus
`INVALID_ROUND_MAPS`, est **rattaché** au bouton de liste du créneau
(`useFieldErrors`, `aria-invalid`, focus) en plus de la notification.

**Un membre du staff qui joue** (décision du 2026-10-28) garde le réglage des
cartes du tour, des règles de ban **et** de la première carte de son propre
match (route `first-map`) : la permission `tournaments` suffit, comme pour tout
réglage du tournoi. Seul le **choix dans un pool** de son match suit la règle
des joueurs (ci-dessous).

## Map de départage (play-offs, tout format)

Un tour de **play-offs** à **format de match défini**, quelle que soit sa taille
(BO 1 à BO 15, FT ; `formatAllowsTiebreak` : ni score libre, ni égalités
ouvertes) peut porter **une** map de départage (« Map de départage », EN
« Tiebreak map ») : jouée en **map N + 1** (N = `matchMaxMaps`) **seulement** si
la série est à égalité après les N maps régulières (maps nulles comprises),
sinon inutilisée. Décision du 2026-11-09 (lot TIEBREAK-ALL) : d'abord réservée au
vrai Bo3 (#533), elle s'ouvre à tous les formats — cas du tournoi BG Survie en
BO 5 à égalités ouvertes sans format de play-offs propre (« 6ᵉ map »).

- **Tours éligibles** (`roundAllowsTiebreak`, `lib/shared/round-plan.ts`, règle
  pure commune à l'écran, au serveur et au brief) : `SINGLE` / `DOUBLE` (phase 0,
  tous tableaux, petite finale comprise), une phase `SINGLE` / `DOUBLE` d'un
  `MULTI`, les play-offs de BG Survie (`roundNumber ≥ PLAYOFF_ROUND_OFFSET`, format
  des play-offs). Jamais en suisse, en qualification, en `SURVIVAL`, en score
  libre. Le format est celui du tour (`tournamentMatchFormat`) : un tour de
  play-offs ferme **toujours** les égalités (`withoutDraws` au repli de BG Survie,
  format de play-offs sans égalité), si bien qu'un tournoi à qualification en
  BO 5 avec égalités joue ses play-offs en BO 5 égalités fermées et admet la map
  de départage. La conversion ligne SQL → tournoi est unique
  (`tiebreakTournamentFromRow`, pose et brief).
- **Stockage** : colonne `bg_tournament_round_maps.tiebreak_map` (64 caractères,
  `visibleText`) ; une ligne qui ne porte que la map de départage a
  `slots_json = '[]'`. Retirer les cartes d'un tour garde la ligne si elle porte
  une map de départage (`DELETE … AND tiebreak_map IS NULL`, sinon `slots_json`
  remis à `'[]'`) ; retirer la map de départage efface une ligne restée vide.
- **Instantané** : `mapRules.tiebreaks` (liste séparée de `mapRules.rounds`, dont
  le sens ne change pas), filtrée par l'éligibilité courante
  (`applicableTiebreaks`) : un format changé depuis masque le réglage sans
  l'effacer (l'ouverture à tous les formats, TIEBREAK-ALL, réactive d'elle-même un
  réglage resté d'un ancien Bo3 sur un tour de play-offs passé en BO 5 / FT 3). Ces réglages inactifs restent portés par l'instantané
  (`mapRules.staleTiebreaks`, champ omis quand il n'y en a pas) : `RoundMapsDialog` les liste (« Maps de départage
  inactives ») avec un bouton « Retirer » (retirer est permis sur toute clé).
- **Écran** : section « Map de départage » de `RoundMapsDialog` (formulaire à
  part, liste d'Overwatch suggérée, saisie libre, « Enregistrer » / « Retirer »),
  visible seulement sur un tour éligible ; le sélecteur de tours la signale. La
  page du match (`MatchRoundMaps`) l'affiche avec une bulle « i ». Elle figure aussi dans les **faits clés** de la page (`tiebreakFacts`),
  lisibles de tous (public, joueurs), pas seulement du staff ou de qui choisit.
  Sur un match **terminé** qui ne l'a pas jouée (série acquise, forfait), elle est masquée (`shownTiebreakMap`). Le formulaire reste monté, grisé et annoncé, si un flux retire l'éligibilité du tour pendant la saisie, et reprend la forme enregistrée après un enregistrement. Le compteur de `MapScoreList` compte la ligne de départage (une reprise de moins annoncée).
- **Saisie du score** (`MapScoreList`, `tiebreakRowIndex`, joueurs, arbitrage,
  admin) : la première ligne jouée au-delà des N maps régulières alors que la
  série est à égalité **à une map de l'objectif** (1-1 en BO 3, 2-2 en BO 5, 3-3
  en BO 7 / FT 4) est libellée « Map de départage : {nom} » (jamais sur une
  égalité plus basse — 0-0 après trois maps nulles en BO 3 : elle ne déciderait
  rien, la map nulle se rejoue comme avant). **Aucune règle de score ne change**
  (`MAP_SCORES.md`) : en play-offs (égalités fermées) la ligne N + 1 existait déjà
  (`DRAWN_MAP_REPLAY_ALLOWANCE`), le vainqueur doit atteindre l'objectif — la map
  de départage l'y porte — et le match a toujours un vainqueur
  (`checkMatchScores`) ; elle compte comme toute map gagnée, les rejeux des
  classements sont intacts.
  Cas limites assumés : en BO 5 une map de départage nulle puis sa reprise nulle
  épuisent la liste, et en BO 7 trois maps nulles laissent la série à 3-3 sans ligne
  pour la map de départage — l'arbitrage tranche (règle existante, pas de ligne de plus).
- **Check-in du match** : ligne « Map de départage (jouée seulement si la série est à
  égalité après les maps régulières) : « … » » (FR / EN, `briefTiebreakMap`), sans pseudo.
- **Bans** (choix documenté, règlement §10 inchangé) : la map de départage suit
  la règle des cartes suivantes du tournoi (`next_ban_rule`, par défaut le
  perdant de la map précédente bannit en premier ; sur une map nulle, même ordre
  que la map précédente). Elle est **imposée** : aucun choix de carte du perdant
  ne s'y applique.
- **Non repris, volontairement** : « Appliquer à tous » et la copie d'un tour ne
  recopient pas la map de départage (réglage par tour, explicite) ; la fenêtre
  « Arbitrage » ne l'affiche pas (la page du match et la saisie du score le font).
- Marvel Rivals : le minimum (champ libre, sans liste de cartes).

## Préséance

Match avec arbitre désigné : l'ordre du premier ban ne suit pas
`first_ban_rule` — la non-tête de série bannit la première
(`MATCH_REFEREE.md` § Hôte et premier ban).

- Une carte 1 **imposée** l'emporte sur `first_map` à l'affichage
  (`effectiveFirstMap`, appliquée à l'instantané par `applyMapRules`) ; la valeur
  stockée n'est pas réécrite : retirer le réglage la rend.
- Un pool montre le choix du match (`first_map` pour la carte 1, `map_picks`
  `{"2":"Ilios"}` ensuite) ; un choix sorti du pool depuis reste lisible.
- Dès qu'un tour a des cartes, la saisie libre de la première carte disparaît
  (page du match, fenêtre « Arbitrage ») et le serveur la refuse aussi
  (`setMatchFirstMap`, route `first-map` : 409 `ROUND_MAPS_SET`), retrait
  compris. Il lit le match hors transaction (match absent ou joué : refus sans
  verrou), puis prend `lockTournamentRow` en **première** instruction, relit le
  match `FOR UPDATE` et le réglage du tour : jamais un réglage figé avant le
  verrou. Le choix dans un pool passe par `map-pick`.
- Un choix verrouille le tournoi avant de relire le match et son pool, comme
  `setRoundMaps` : il ne se valide pas contre un pool remplacé au même instant.
  Verrou **partagé** (`LOCK IN SHARE MODE`) : il attend une écriture des cartes
  du tour, mais les choix de deux matchs ne s'attendent pas entre eux.
- **Effacer** un choix (`map: null`) est permis sur tout créneau existant, même
  devenu imposé : un ancien choix ne reste pas coincé pour revenir quand le
  réglage est retiré. **À l'arbitrage seulement** sur un créneau imposé : une
  équipe en autogestion n'y efface rien (`validateMapPick(…, byTeam)`,
  `INVALID_MAP_PICK`) — elle effacerait la première carte fixée par le staff,
  qui manquerait une fois l'imposition retirée.
- L'écran n'ouvre la liste d'un pool à une équipe que si le lecteur déclare son
  « Prêt » (`canDeclareReady` du lancement), comme le serveur.

## Routes (codes seuls, `fail`)

| Route | Droit | Refus |
|---|---|---|
| `PUT /api/admin/tournaments/[id]/round-maps` `{phaseId, bracket, roundNumber, slots}` ou `{rounds: [{phaseId, bracket, roundNumber}…], slots}` (1 à 128 tours, `ROUND_MAPS_BULK_MAX` ; `slots: []` retire ; numéro de 1 à `ROUND_NUMBER_MAX` = 2000 ; cartes posées seulement sur un tour **de ce** tournoi — phase 0 sans phases, sinon une de ses phases, vérifiée sous verrou ; les autres clés d'une copie sont écartées et **comptées** dans `skipped` de la réponse `{ slots, skipped }` (l'écran affiche alors une notification neutre « sauf sur N tours qui n'existent plus » au lieu du succès entier), `INVALID_ROUND` si aucune ne reste ; une ancienne ligne au-delà de la borne (permise avant #514) est purgée au démarrage (`RECENT_SCHEMA_CHANGES`) ; retirer est permis sur toute clé, pour qu'une ligne restée d'une phase supprimée puisse partir) | `can(user, "tournaments")` | 401, 403 `FORBIDDEN`, 400 `INVALID_ROUND` / `INVALID_ROUND_MAPS`, 404 `TOURNAMENT_NOT_FOUND` |
| `PUT /api/admin/tournaments/[id]/round-tiebreak` `{phaseId, bracket, roundNumber, map}` (`map: null` ou vide retire ; poser exige un tour **de ce** tournoi et éligible, format relu sous `lockTournamentRow` en première instruction ; retirer est permis sur toute clé) | `can(user, "tournaments")` | 401, 403 `FORBIDDEN`, 400 `INVALID_TOURNAMENT_ID` / `INVALID_ROUND` / `INVALID_TIEBREAK_MAP` / `TIEBREAK_NOT_ALLOWED`, 404 `TOURNAMENT_NOT_FOUND`, 500 `ROUND_TIEBREAK_FAILED` |
| `PUT /api/admin/tournaments/[id]/map-rules` `{firstBan, nextBan, nextPick}` | `can(user, "tournaments")` | 401, 403, 400 `INVALID_MAP_RULES`, 404 |
| `PUT /api/admin/matches/[matchId]/first-map` (existante) | `can(user, "tournaments")` | en plus : 409 `ROUND_MAPS_SET` quand le tour a des cartes |
| `PUT /api/matches/[matchId]/map-pick` `{slot, map \| null}` | staff, ou équipe du match en autogestion | 401, 400 `INVALID_MAP_PICK`, 403 `NOT_MAP_PICKER`, 404, 409 `MATCH_ALREADY_COMPLETED` / `CONCURRENT_UPDATE_RETRY`, 429 `TOO_MANY_REQUESTS` (`MAP_PICK_WRITE_RULE` : 120 par compte en 5 min) |

Tout arbitre porte la permission `tournaments` : « l'arbitre d'une autre
manche » n'a pas de droit distinct, la porte est la permission elle-même.
Un membre du staff qui **joue** le match suit la règle des joueurs (comme
`REFEREE_IS_PLAYER`) : hors autogestion, il ne choisit pas pour son équipe.
`pickMatchMap` lit le match **avant** la transaction (droit de choisir et match
joué vérifiés là : un refus ne prend aucun verrou), puis prend le verrou du
tournoi en première instruction et revérifie tout — le droit d'abord, l'état
du match ensuite : le pool est relu à jour, jamais figé avant le verrou. Rejoué
sur interblocage ou conflit d'instantané MariaDB (`retryOnDeadlock`) ; un
conflit qui persiste rend 409 `CONCURRENT_UPDATE_RETRY` (`launchFailure`), pas
une panne. Un 404 (match absent) se distingue d'un 403 (match d'autrui) :
l'identifiant d'un match n'est pas un secret, l'instantané public le porte.
Transactions : `lib/server/tournaments/transaction.ts` (commun avec le
lancement) — un `rollback()` en échec détruit la connexion au lieu de la rendre
au pool.

## Temps réel, journal, brief

- `TournamentSnapshot.mapRules` (règles + manches réglées) et
  `BracketMatch.mapPicks` : la même charge sert le flux SSE et le REST de
  secours ; chaque écriture appelle `publishMatchUpdatedEvent` (une seule pour
  une copie sur plusieurs tours, `setRoundsMaps` : une transaction, verrou du
  tournoi en tête).
- **Une seule annonce par série d'enregistrements** (`round-maps-notice.ts`) :
  régler cinq manches à la suite ne fait plus cinq lignes Discord. L'écriture met
  les manches modifiées (une remise à zéro en est une) en attente dans
  `bg_round_maps_notices` (une ligne par tournoi, écrite dans la transaction) et
  repousse l'envoi de 60 s après le dernier changement
  (`ROUND_MAPS_NOTICE_WINDOW_SECONDS`) ; une seule ligne
  (`formatRoundMapsSummaryLog`, 8 manches nommées, le reste compté) rejoint
  ensuite le lot du journal du tournoi (`LOG_BATCHING.md`).
  L'état est en base, donc survit à un redémarrage : le trafic l'envoie
  (`dispatchDueRoundMapsNotices`, appelé par la liste des tournois, étranglé à
  15 s), un minuteur de processus n'est qu'un accélérateur. La fermeture de
  l'écran appelle `POST /api/admin/tournaments/[id]/round-maps/flush` (permission
  `tournaments`, corps `{ rounds: ["phase:tableau:numéro", …] }` = les tours écrits
  par cet écran, au plus `ROUND_MAPS_FLUSH_ROUNDS_MAX`) pour envoyer tout de suite, lot du journal du tournoi compris
  (`flushBotLogBatch`) — au plus un envoi anticipé par
  tournoi et par fenêtre de 60 s (au-delà, la fenêtre de silence enverra), et
  jamais le seul déclencheur : un onglet fermé n'y perd rien. L'annonce en
  attente ne part que si **tous** ses tours sont de la liste : une série qu'un
  autre membre du staff règle encore reste à la fenêtre de silence (sans liste,
  tout part). Un tour n'entre dans la liste qu'une fois tous les lots d'une écriture
  passés. Un multi-phases
  préfixe la phase (« Phase 2 · Manche 1 ») et prend le format suisse de la
  phase. La ligne est revendiquée par
  `DELETE … WHERE changes = ?` : pas de doublon, pas de changement perdu.
  La mise en attente **prend la ligne avant de la lire** (l'écriture qui avance
  `changes` d'abord, la lecture ensuite, puis `rounds_json`) : un balayage, qui
  ne prend pas le verrou du tournoi, ne peut plus la revendiquer entre la
  lecture et l'écriture (ses manches reparaissaient dans le résumé suivant) ;
  pas de `SELECT … FOR UPDATE`, qui poserait un verrou d'intervalle sur une
  ligne absente. `setRoundsMaps` et `setRoundTiebreak` sont rejouées
  (`retryOnDeadlock`) si MariaDB refuse l'écriture d'une ligne qu'un balayage
  vient de supprimer (`ER_CHECKREAD`). Le minuteur de fin de fenêtre qui tombe sur un balayage en
  vol en relance un à sa suite. `rounds_json` retient au plus
  `ROUND_MAPS_NOTICE_KEYS_MAX` (200) manches ; les suivantes sont **comptées**
  (`{ more: n }`, reprises dans « et N autres »), jamais « Data too long ».
  Les manches sont listées tableau principal, perdants, grande finale, petite
  finale ; un changement de la seule **map de départage** est noté à part
  (`tiebreak`) et dit « Manche 2 (map de départage) » — sauf si les cartes de
  la même manche ont changé aussi : elle n'est dite et comptée qu'une fois. Le
  compte des manches au-delà du plafond est approché (une manche réglée deux
  fois y compte deux fois), et le signal de fermeture ne fait rien partir tant
  qu'il en reste : elles peuvent être celles d'un autre membre du staff.
- Journal du staff anonyme (`formatRoundMapsSummaryLog`, `formatMapRulesLog`, choix
  `MAP_PICKED*` de `referee-notices`) : aucune personne nommée.
- Check-in du match (`MATCH_LOBBY_BRIEF.md`) : bloc « Déroulé des maps » quand la manche
  est réglée, ordre des bans de la carte 1, règle des cartes suivantes. Le bloc
  des cartes est coupé à un créneau entier au-delà de `MAPS_LINE_MAX` (420
  caractères, abaissé avec la fusion du check-in, plus long qu'un brief) et
  renvoie à la page du match : neuf pools de vingt cartes dépasseraient les
  2 000 caractères d'un message Discord.
- L'instantané lit les règles de ban avec la ligne du tournoi qu'il charge déjà
  (`loadMapRules(connection, id, tournamentRow)`) ; `applyMapRules` indexe les
  tours (`roundKeyId`) au lieu d'un parcours par match.

## Schéma

Tables `bg_round_maps_notices` (annonce en attente, une ligne par tournoi, `CASCADE`) et `bg_tournament_round_maps` (clé unique `(tournament_id, phase_id, bracket,
round_number)`, `CASCADE` avec le tournoi) ; colonnes `bg_tournaments.first_ban_rule`,
`next_ban_rule`, `next_pick_rule`, `bg_matches.map_picks`,
`bg_tournament_round_maps.tiebreak_map` (`VARCHAR(64) NULL`, dans le `CREATE TABLE`
et dans `RECENT_SCHEMA_CHANGES`) (`DATABASE_SCHEMA.md`).

## Seed

Deux premiers tournois à lancement (`SEED_ROUND_MAP_CASES`,
`lib/server/seed/match-states.ts`) : une manche à cinq cartes imposées (carte 1
qui l'emporte sur la première carte de l'arbitre), une manche à pools en
autogestion avec la carte 2 déjà choisie.
Maps de départage (`SEED_TIEBREAK_CASES`, `applyTiebreakCases`, échec si un cas ne
trouve aucun tour), posées sur le premier tour de play-offs qui a encore un match
ouvert : « Test - BO3 Élimination » (vrai Bo3 en arbre), « Busan » ; « Test - BG
Survie BO5 Égalités Départage » (qualification BO 5 à égalités ouvertes, sans format
de play-offs propre), « Ilios ».

## Tests

`tests/lib/shared/round-maps.test.ts`, `tests/lib/shared/round-plan.test.ts`,
`tests/lib/shared/overwatch-maps.test.ts`, `tests/lib/server/round-maps.test.ts`,
`tests/app/api/round-maps-routes.test.ts`, `tests/tournois/round-maps-dialog.test.ts`
(saisie, copie, résumé), `tests/tournois/match-page-render.test.tsx` (§ cartes du
round et bans, réinitialisation), `tests/lib/server/match-launch.test.ts`
(`ROUND_MAPS_SET`, verrou en tête), `tests/lib/server/referee-panel.test.ts`
(`roundSlots`), `tests/lib/shared/lobby-brief.test.ts` (ligne coupée),
`tests/lib/server/tournament-transaction.test.ts` (rollback en échec),
`tests/tournois/round-maps-dialog.test.ts` (`resyncSlots`). Map de départage :
`tests/lib/shared/round-tiebreak.test.ts` (éligibilité, ligne de saisie, brief),
`tests/lib/server/round-maps.test.ts` (`setRoundTiebreak`, `loadMapRules`,
`briefTiebreakMap`), `tests/app/api/round-tiebreak-route.test.ts`. Garde-fous de la fenêtre :
`tests/tournois/round-maps-editor-guards.test.ts` (carte de trop, focus rendu, tour
disparu), `tests/tournois/round-maps-ui-render.test.tsx` (page du match, libellés de
score, câblage), `tests/lib/shared/round-maps-tiebreak-plan.test.ts`,
`tests/lib/server/round-maps-notice-own-rounds.test.ts`,
`tests/app/api/round-maps-flush-body.test.ts`.

## Comportements de la fenêtre (accessibilité, pertes de saisie)

- Fermer (Échap, voile, « Fermer ») avec des cartes ou des règles non enregistrées
  demande confirmation, comme le changement de tour ; « Enregistrer » est inactif
  (`aria-disabled`) et sans effet quand rien n'a changé ; plus de cartes que le
  format n'en joue est refusé avant l'envoi (rattaché à la première carte de trop).
- Un refus `INVALID_ROUND_MAPS` du serveur vise la liste entière (le serveur ne dit
  pas quelle carte), pas le premier créneau. Un tour qui quitte la liste pendant
  la fenêtre ramène au premier tour et annule la confirmation en cours.
- Retirer une pastille ou un créneau rend le focus au voisin ; ouvrir la liste de
  cartes place le focus sur son premier champ ; un ajout libre refusé garde la saisie.
- « Réinitialiser le tour » ne touche pas la map de départage : le toast le dit
  (`roundClearedTiebreakKept`) quand elle reste.
- Choix de carte optimiste (`MapPickSelect`) : relâché quand la carte enregistrée
  change (un instantané sur un autre match ne la touche pas) ; sans changement,
  relecture REST 6 s après la fin de l'envoi, relâche à 30 s. En vol, un instantané ne
  retire pas la valeur locale.
- Fermer ou changer de tour avec une map de départage saisie et non enregistrée
  demande aussi confirmation (le formulaire remonte son état, `onDirtyChange`).
- « Copier » et « Appliquer à tous » refusent un tour cible qui joue moins de cartes
  que la sélection (`firstTargetOverMax`, plafond effectif du tour cible, message
  `overMaxTarget`, rattaché à la cible de la copie ou au bouton) ; l'avertissement rouge et le refus partagent le même seuil.
- « Enregistrer les règles » est inactif et sans effet quand rien n'a changé.
- Les boutons qui se vident eux-mêmes (« Réinitialiser le tour », « Retirer la map de
  départage », la rangée de copie) restent montés en `aria-disabled` ; le retrait d'une
  map de départage inactive rend le focus à la ligne voisine, ou à « Fermer ».
- Deux fermetures d'écran simultanées sont chaînées côté serveur (`flushRoundMapsNotice`)
  : la seconde attend le verdict de la première au lieu d'être écartée par le plafond.
