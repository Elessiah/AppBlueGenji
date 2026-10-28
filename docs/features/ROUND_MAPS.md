# Cartes par manche et règles de ban

Règles pures : `lib/shared/round-maps.ts`. Serveur : `lib/server/tournaments/round-maps.ts`.
Écrans : `RoundMapsDialog`, `MatchRoundMaps` (`app/(secured)/tournois/[id]/_components/`).

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
« Paramétrer les cartes du round » de la page du match, ouvert sur sa manche.

## Préséance

- Une carte 1 **imposée** l'emporte sur `first_map` à l'affichage
  (`effectiveFirstMap`, appliquée à l'instantané par `applyMapRules`) ; la valeur
  stockée n'est pas réécrite : retirer le réglage la rend.
- Un pool montre le choix du match (`first_map` pour la carte 1, `map_picks`
  `{"2":"Ilios"}` ensuite) ; un choix sorti du pool depuis reste lisible.
- Dès qu'une carte 1 est réglée pour la manche, la saisie libre de la première
  carte disparaît de la page du match, et le serveur la tranche aussi
  (`setMatchFirstMap`, route `first-map`) : carte imposée refusée, saisie hors
  du pool refusée (`INVALID_MAP_PICK`), saisie du pool gardée dans sa graphie.
- Un choix verrouille le tournoi avant de relire le match et son pool, comme
  `setRoundMaps` : il ne se valide pas contre un pool remplacé au même instant.
- L'écran n'ouvre la liste d'un pool à une équipe que si le lecteur déclare son
  « Prêt » (`canDeclareReady` du lancement), comme le serveur.

## Routes (codes seuls, `fail`)

| Route | Droit | Refus |
|---|---|---|
| `PUT /api/admin/tournaments/[id]/round-maps` `{phaseId, bracket, roundNumber, slots}` (`slots: []` retire) | `can(user, "tournaments")` | 401, 403 `FORBIDDEN`, 400 `INVALID_ROUND` / `INVALID_ROUND_MAPS`, 404 `TOURNAMENT_NOT_FOUND` |
| `PUT /api/admin/tournaments/[id]/map-rules` `{firstBan, nextBan, nextPick}` | `can(user, "tournaments")` | 401, 403, 400 `INVALID_MAP_RULES`, 404 |
| `PUT /api/admin/matches/[matchId]/first-map` (existante) | `can(user, "tournaments")` | en plus : 400 `INVALID_MAP_PICK` quand la carte 1 de la manche est réglée |
| `PUT /api/matches/[matchId]/map-pick` `{slot, map \| null}` | staff, ou équipe du match en autogestion | 401, 400 `INVALID_MAP_PICK`, 403 `NOT_MAP_PICKER`, 404, 409 `MATCH_ALREADY_COMPLETED` |

Tout arbitre porte la permission `tournaments` : « l'arbitre d'une autre
manche » n'a pas de droit distinct, la porte est la permission elle-même.
Un membre du staff qui **joue** le match suit la règle des joueurs (comme
`REFEREE_IS_PLAYER`) : hors autogestion, il ne choisit pas pour son équipe.
`pickMatchMap` lit le tournoi du match **hors** transaction, puis prend son
verrou en première instruction : le pool est relu à jour, jamais figé avant le
verrou.

## Temps réel, journal, brief

- `TournamentSnapshot.mapRules` (règles + manches réglées) et
  `BracketMatch.mapPicks` : la même charge sert le flux SSE et le REST de
  secours ; chaque écriture appelle `publishMatchUpdatedEvent`.
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

`tests/lib/shared/round-maps.test.ts`, `tests/lib/server/round-maps.test.ts`,
`tests/app/api/round-maps-routes.test.ts`, `tests/tournois/round-maps-dialog.test.ts`,
`tests/tournois/match-page-render.test.tsx` (§ cartes du round et bans),
`tests/lib/shared/lobby-brief.test.ts`.
