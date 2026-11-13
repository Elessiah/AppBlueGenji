# Format Duel / Arcade : points par carte

Duels 1v1 en arcade (Widowmaker, « premier à 5 ») : chaque carte se gagne au
**premier à N points**. Le format de match (BO / FT) compte toujours des
**cartes** ; ce réglage ne dit que ce qu'est une carte valable.

## Règle

- Une carte est valable quand le vainqueur marque **exactement N** points et
  l'autre de **0 à N − 1** (jamais d'égalité, jamais plus de N) — sinon
  `MAP_POINTS_INVALID`, rattaché au champ fautif (`duelMapScoreFault` : celui qui
  dépasse N, sinon le second sur une égalité à N, sinon le plus bas).
- Le score du match se **dérive** comme toujours (une carte gagnée = un point,
  `deriveMatchScore`) : moteurs, classements et modes à classement ne voient
  rien de neuf (cartes gagnées = score du match).
- N va de 1 à 99 (`MAP_POINT_TARGET_MIN` / `_MAX`), 5 proposé par défaut.

## Réglage

- **Tournoi** : case « Format Duel / Arcade » (EN « Duel / Arcade format »),
  qui ouvre « Premier à X points par carte » (`<NumberInput>`, 1–99), avec
  `<InfoHint>`. Stocké dans `bg_tournaments.map_point_target` (`NULL` = éteint).
  Création, puis édition en fenêtre `FULL` **et** `RESTRICTED` (tournoi annoncé,
  inscriptions ouvertes, inscrites comprises) : `matchFormat` et `mapPointTarget`
  sont dans `RESTRICTED_FIELDS` (`lib/shared/tournament-edit.ts`) — passer un BO9
  en BO1 + premier à 5 pendant les inscriptions. Fermé au lancement (`LOCKED`).
- **Tour** : la fenêtre « Cartes par tour » (`RoundMapsDialog`, staff
  `tournaments`) règle des points propres à un tour, quand le format est allumé
  sur le tournoi. `bg_tournament_round_maps.map_point_target` (`NULL` = suit le
  tournoi) ; une ligne qui ne porte que ces points a `slots_json = '[]'` et
  n'est jamais effacée par un vidage de cartes ou de départage. Route
  `PUT /api/admin/tournaments/[id]/round-points` (`{ phaseId, bracket,
  roundNumber, target }`, `null` = suit le tournoi). Poser exige un tour que
  le tournoi peut jouer : phase du tournoi, et tableau de son format
  (`bracketFitsFormat` : `LOWER` / `GRAND` en double élimination seulement,
  `THIRD_PLACE` en élimination simple et BlueGenji Survie) — sinon
  `INVALID_ROUND`. Le changement part au journal du staff, regroupé avec les
  cartes de manche (« Manche 2 (points par carte) », `round-maps-notice.ts`).
- **Format éteint** sur le tournoi : les points propres aux tours sont
  effacés dans la même transaction (`updateTournament`) — ils ne resurgissent
  pas au rallumage, l'écran des cartes ne les montrant que format allumé.
- N effectif d'un match : `effectiveMapPointTarget` = celui du tour, sinon celui
  du tournoi, et rien si le format est éteint sur le tournoi.

### Verrou

Changer N (tournoi ou tour) est refusé (`MAP_POINTS_LOCKED`, 409) dès qu'un
match **jouable** concerné porte un score, une proposition ou des cartes
saisies, ou a ouvert son lancement (`lobby_opened_at` / `launched_at` : les
équipes jouent la règle que le brief leur a annoncée) —
`assertMapPointsUnlocked`, sous le verrou du tournoi puis des matchs, cartes
relues en `LOCK IN SHARE MODE`, requêtes sans jointure (MariaDB). Une exemption
(`is_bye`, place vide) ou un match fantôme, clos d'office par le moteur, ne fige
rien. L'écran grise le champ par la même règle (`roundPointsLocked`).

Poser les points d'un tour exige un tournoi pas encore terminé
(`MAP_POINTS_FINISHED`, 409) et, en élimination (simple ou double, phase MULTI
comprise) une fois l'arbre créé, un tour qui en fait partie (`INVALID_ROUND`) ;
avant la création de l'arbre, ou en ronde suisse / Survie, le numéro n'est borné
que par `parseRoundKey` (1–2000). Format éteint sur le tournoi, retirer un
réglage resté (sans effet) se fait sans condition de score. Un changement réel
part au journal Discord du staff, anonyme et regroupé avec les cartes
(`round-maps-notice`), et nomme son auteur dans pm2 seulement
(`auditStaffAction`, ligne `[staff-audit]`).

Les saisies lisent le réglage du tour en **lecture verrouillante**
(`loadMatchPointTarget`, `LOCK IN SHARE MODE`) : un report qui attendait le
verrou du match pendant qu'un arbitre changeait les points du tour juge le
score sur la valeur commitée, jamais sur l'image figée plus tôt dans sa
transaction. L'interblocage possible (match puis réglage, contre tournoi puis
matchs) est rejoué par `retryOnDeadlock`.

### Refus (code seul)

| Code | Statut | Cause |
|---|---|---|
| `INVALID_MAP_POINT_TARGET` | 400 | N hors 1–99 ou corps sans `target` |
| `MAP_POINTS_DISABLED` | 400 | points de tour alors que le format est éteint sur le tournoi |
| `MAP_POINTS_LOCKED` | 409 | un match jouable concerné porte déjà un score ou a ouvert son lancement |
| `MAP_POINTS_FINISHED` | 409 | points de tour posés sur un tournoi terminé |
| `INVALID_ROUND` | 400 | tour hors du tournoi (phase, tableau, ou tour absent d'un arbre créé) |
| `MAP_POINTS_INVALID` | 400 | carte qui ne respecte pas « premier à N » |

## Contrôle des scores

Toutes les portes passent par `checkMapList(…, { pointTarget })` avec le N de
la manche (`loadTournamentMatchRules(…, roundKey)`) : report et confirmation
d'un engagé (`scoring.ts`), « Enregistrer » et « Valider le résultat » de
l'arbitrage, résolution d'un litige (`admin.ts`). Les modales rejouent le même
contrôle (`useScoreForm`, `PlayerScoreDialog`, `MapScoreList`) : une ligne n'est
complète qu'une fois N atteint (`isMapComplete`). La concordance des deux
propositions (`sameMapLists`, `mapListDifferences`) compare déjà les points de
chaque carte : 5–3 contre 5–2 est un écart.

## Affichage

- `TournamentCard.mapPointTarget` et `BracketMatch.mapPointTarget` (N effectif)
  passent par l'instantané commun : flux SSE et REST de secours identiques.
- Carte de match (arbre, `/suivre`, panneau d'arbitrage) : le bouton de détail
  montre « Points : 5–3 · 2–5 » ; la modale de détail rappelle « Premier à N
  points ». Page du match : fait « Points par carte ». Réglages du tournoi :
  ligne « Points par carte (Duel / Arcade) », montrée allumée seulement.
- Match en BO1 / FT1 : l'arbre et la carte du match montrent les points de
  la carte (5–3), pas 1–0 (`displayScore`, `MAP_SCORES.md` § Affichage) ;
  classements et départages comptent toujours 1–0.
- Modale de score d'un engagé : sur un match à une carte, l'attente, la
  déclaration adverse et le litige citent les points (« toi : 5 – 3, eux :
  5 – 4 », `scoreText`). La ligne « score enregistré » de l'arbitrage et le
  retour en arrière d'un tour lisent le même score affiché (`shownMatchScore`).
- Check-in du match (message privé, `MATCH_LOBBY_BRIEF.md`) : « Format Duel /
  Arcade : chaque carte se gagne au premier à N points. » (N du tour, sinon du
  tournoi ; FR et EN), sous les cartes.
- Discord (journal « Match terminé ») : « (points : 5–3) » après le score, des
  chiffres seulement, aucun pseudo ; rien sur un forfait.

## Seed

« Duel Arcade Widow (premier à 5) » (`lib/server/seed/cases.ts`) : OW, individuel,
4 joueurs, BO1, premier à 5, en cours.

## Fichiers

| Rôle | Fichier |
|---|---|
| Règles pures | `lib/shared/map-points.ts`, `lib/shared/match-maps.ts` |
| Serveur | `lib/server/tournaments/map-points.ts`, `round-maps.ts` (`setRoundPointTarget`), `repository.ts`, `scoring.ts`, `admin.ts`, `edit.ts`, `validation.ts`, `snapshot.ts`, `bot-logs.ts` |
| Route | `app/api/admin/tournaments/[id]/round-points/route.ts` |
| Interface | `_components/DuelArcadeField.tsx`, `RoundMapsDialog.tsx`, `MatchMapDetails.tsx`, `MapResultList.tsx`, `MatchPage.tsx` |

## Tests

`tests/lib/shared/map-points.test.ts`, `tests/lib/server/map-points.test.ts`,
`tests/lib/server/round-maps.test.ts` (`setRoundPointTarget`),
`tests/app/api/round-points-route.test.ts`, `tests/lib/shared/match-maps.test.ts`,
`tests/lib/server/match-format-report.test.ts`, `admin-score-guards.test.ts`,
`tournaments-edit.test.ts`, `tournaments-validation.test.ts`,
`tests/lib/server/bot-logs-map-points.test.ts`, `tests/lib/shared/bot-logs.test.ts`,
`tests/lib/shared/tournament-settings.test.ts`, `tests/tournois/tournament-form.test.ts`,
`tests/lib/server/round-maps-notice.test.ts` (annonce des points),
`tests/lib/shared/round-tiebreak.test.ts` (ligne du check-in),
`tests/tournois/score-arrival-announcement.test.ts` (points cités par la modale),
`tests/tournois/map-scores-wiring.test.ts` (refus rattaché à la case).
