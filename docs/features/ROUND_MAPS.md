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
Chaque formulaire dit « Modifications non enregistrées » (`role="status"`)
tant qu'il diffère du serveur. Un créneau vide entre deux cartes, ou un refus
`INVALID_ROUND_MAPS`, est **rattaché** au bouton de liste du créneau
(`useFieldErrors`, `aria-invalid`, focus) en plus de la notification.

**Un membre du staff qui joue** (décision du 2026-10-28) garde le réglage des
cartes du tour, des règles de ban **et** de la première carte de son propre
match (route `first-map`) : la permission `tournaments` suffit, comme pour tout
réglage du tournoi. Seul le **choix dans un pool** de son match suit la règle
des joueurs (ci-dessous).

## Préséance

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
  réglage est retiré.
- L'écran n'ouvre la liste d'un pool à une équipe que si le lecteur déclare son
  « Prêt » (`canDeclareReady` du lancement), comme le serveur.

## Routes (codes seuls, `fail`)

| Route | Droit | Refus |
|---|---|---|
| `PUT /api/admin/tournaments/[id]/round-maps` `{phaseId, bracket, roundNumber, slots}` ou `{rounds: [{phaseId, bracket, roundNumber}…], slots}` (1 à 128 tours, `ROUND_MAPS_BULK_MAX` ; `slots: []` retire ; numéro de 1 à `ROUND_NUMBER_MAX` = 2000 ; phase 0 sans phases, sinon une phase **de ce** tournoi, vérifiée sous verrou) | `can(user, "tournaments")` | 401, 403 `FORBIDDEN`, 400 `INVALID_ROUND` / `INVALID_ROUND_MAPS`, 404 `TOURNAMENT_NOT_FOUND` |
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
  (`formatRoundMapsSummaryLog`, 8 manches nommées, le reste compté) part ensuite.
  L'état est en base, donc survit à un redémarrage : le trafic l'envoie
  (`dispatchDueRoundMapsNotices`, appelé par la liste des tournois, étranglé à
  15 s), un minuteur de processus n'est qu'un accélérateur. La fermeture de
  l'écran appelle `POST /api/admin/tournaments/[id]/round-maps/flush` (permission
  `tournaments`) pour envoyer tout de suite — au plus un envoi anticipé par
  tournoi et par fenêtre de 60 s (au-delà, la fenêtre de silence enverra), et
  jamais le seul déclencheur : un onglet fermé n'y perd rien. Un multi-phases
  préfixe la phase (« Phase 2 · Manche 1 ») et prend le format suisse de la
  phase. La ligne est revendiquée par
  `DELETE … WHERE changes = ?` : pas de doublon, pas de changement perdu.
- Journal du staff anonyme (`formatRoundMapsSummaryLog`, `formatMapRulesLog`, choix
  `MAP_PICKED*` de `referee-notices`) : aucune personne nommée.
- Brief du salon (`MATCH_LOBBY_BRIEF.md`) : ligne « Cartes : » quand la manche
  est réglée, ordre des bans de la carte 1, règle des cartes suivantes. La ligne
  des cartes est coupée à un créneau entier au-delà de `MAPS_LINE_MAX` (700
  caractères) et renvoie à la page du match : neuf pools de vingt cartes
  dépasseraient les 2 000 caractères d'un message Discord.
- L'instantané lit les règles de ban avec la ligne du tournoi qu'il charge déjà
  (`loadMapRules(connection, id, tournamentRow)`) ; `applyMapRules` indexe les
  tours (`roundKeyId`) au lieu d'un parcours par match.

## Schéma

Tables `bg_round_maps_notices` (annonce en attente, une ligne par tournoi, `CASCADE`) et `bg_tournament_round_maps` (clé unique `(tournament_id, phase_id, bracket,
round_number)`, `CASCADE` avec le tournoi) ; colonnes `bg_tournaments.first_ban_rule`,
`next_ban_rule`, `next_pick_rule`, `bg_matches.map_picks` (`DATABASE_SCHEMA.md`).

## Seed

Deux premiers tournois à lancement (`SEED_ROUND_MAP_CASES`,
`lib/server/seed/match-states.ts`) : une manche à cinq cartes imposées (carte 1
qui l'emporte sur la première carte de l'arbitre), une manche à pools en
autogestion avec la carte 2 déjà choisie.

## Tests

`tests/lib/shared/round-maps.test.ts`, `tests/lib/shared/round-plan.test.ts`,
`tests/lib/shared/overwatch-maps.test.ts`, `tests/lib/server/round-maps.test.ts`,
`tests/app/api/round-maps-routes.test.ts`, `tests/tournois/round-maps-dialog.test.ts`
(saisie, copie, résumé), `tests/tournois/match-page-render.test.tsx` (§ cartes du
round et bans, réinitialisation), `tests/lib/server/match-launch.test.ts`
(`ROUND_MAPS_SET`, verrou en tête), `tests/lib/server/referee-panel.test.ts`
(`roundSlots`), `tests/lib/shared/lobby-brief.test.ts` (ligne coupée),
`tests/lib/server/tournament-transaction.test.ts` (rollback en échec),
`tests/tournois/round-maps-dialog.test.ts` (`resyncSlots`).
