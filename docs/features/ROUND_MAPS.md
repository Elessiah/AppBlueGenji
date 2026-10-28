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
retire. **Marvel Rivals : saisie libre seule.** Le stockage ne change pas : des
noms (anglais, ceux du jeu ; la graphie française n'a pas pu être vérifiée).

**Tous les tours, y compris à venir** — le sélecteur liste les tours générés,
ceux que le format annonce et ceux déjà réglés (`plannedRoundKeys`) :
élimination simple (+ petite finale), double (haut, bas, grande finale), ronde
suisse (rondes annoncées), BlueGenji Survie (manches qualificatives jusqu'au
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
un tour déjà réglé autrement serait remplacé (`overwrittenRounds`).

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

Les deux équipes bannissent : l'écran dit l'**ordre** (« X d'abord, puis Y »).
Sur un match nul, l'ordre est celui de la carte précédente. Les scores par carte
n'existant qu'au résultat retenu, les bans des cartes suivantes sont dits en
règle, pas en nom d'équipe.

Tout se règle **à tout moment** (avant, pendant, après la manche) : bloc
« Cartes et bans » de la fiche (staff `tournaments`, hors suivi gelé) et bouton
« Paramétrer les cartes du tour » de la page du match, ouvert sur son tour. Le
bloc de la fiche paraît dès la création : les tours à venir se règlent avant tout match.

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
- L'écran n'ouvre la liste d'un pool à une équipe que si le lecteur déclare son
  « Prêt » (`canDeclareReady` du lancement), comme le serveur.

## Routes (codes seuls, `fail`)

| Route | Droit | Refus |
|---|---|---|
| `PUT /api/admin/tournaments/[id]/round-maps` `{phaseId, bracket, roundNumber, slots}` ou `{rounds: [{phaseId, bracket, roundNumber}…], slots}` (1 à 128 tours, `ROUND_MAPS_BULK_MAX` ; `slots: []` retire) | `can(user, "tournaments")` | 401, 403 `FORBIDDEN`, 400 `INVALID_ROUND` / `INVALID_ROUND_MAPS`, 404 `TOURNAMENT_NOT_FOUND` |
| `PUT /api/admin/tournaments/[id]/map-rules` `{firstBan, nextBan, nextPick}` | `can(user, "tournaments")` | 401, 403, 400 `INVALID_MAP_RULES`, 404 |
| `PUT /api/admin/matches/[matchId]/first-map` (existante) | `can(user, "tournaments")` | en plus : 409 `ROUND_MAPS_SET` quand le tour a des cartes |
| `PUT /api/matches/[matchId]/map-pick` `{slot, map \| null}` | staff, ou équipe du match en autogestion | 401, 400 `INVALID_MAP_PICK`, 403 `NOT_MAP_PICKER`, 404, 409 `MATCH_ALREADY_COMPLETED` |

Tout arbitre porte la permission `tournaments` : « l'arbitre d'une autre
manche » n'a pas de droit distinct, la porte est la permission elle-même.
Un membre du staff qui **joue** le match suit la règle des joueurs (comme
`REFEREE_IS_PLAYER`) : hors autogestion, il ne choisit pas pour son équipe.
`pickMatchMap` lit le match **avant** la transaction (droit de choisir et match
joué vérifiés là : un refus ne prend aucun verrou), puis prend le verrou du
tournoi en première instruction et revérifie tout : le pool est relu à jour,
jamais figé avant le verrou. Rejoué sur interblocage (`retryOnDeadlock`).

## Temps réel, journal, brief

- `TournamentSnapshot.mapRules` (règles + manches réglées) et
  `BracketMatch.mapPicks` : la même charge sert le flux SSE et le REST de
  secours ; chaque écriture appelle `publishMatchUpdatedEvent` (une seule pour
  une copie sur plusieurs tours, `setRoundsMaps` : une transaction, verrou du
  tournoi en tête, une ligne de journal « N tours »).
- Journal du staff anonyme (`formatRoundMapsLog`, `formatMapRulesLog`, choix
  `MAP_PICKED*` de `referee-notices`) : aucune personne nommée.
- Brief du salon (`MATCH_LOBBY_BRIEF.md`) : ligne « Cartes : » quand la manche
  est réglée, ordre des bans de la carte 1, règle des cartes suivantes.

## Schéma

Table `bg_tournament_round_maps` (clé unique `(tournament_id, phase_id, bracket,
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
(`roundSlots`), `tests/lib/shared/lobby-brief.test.ts`.
