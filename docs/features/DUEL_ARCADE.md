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
- **Carte par carte** (DUEL-MAP-POINTS) : sous le nombre du tour, la même
  fenêtre montre « Carte par carte » (EN « Map by map »), un `<NumberInput>`
  (1–99) par carte que le format du tour joue (`roundMaxMaps`, 9 au plus ; score
  libre : 9 ; rien sur un tour à une seule carte), avec
  `<InfoHint>` sur l'ordre des valeurs par défaut. Chaque champ est prérempli
  du N **effectif** de la carte ; une carte jamais réglée, ou **ramenée à la
  main** au nombre du tour, le **suit** (« suit le tour », rien n'est stocké
  pour elle) ; une carte réglée garde son N même si le tour vient à valoir le
  même nombre. Un refus `INVALID_MAP_POINT_TARGET` est rattaché au champ de la
  carte fautive (`invalidPointField`), sinon à celui du tour. Stocké dans
  `bg_tournament_round_maps.map_point_targets` (`VARCHAR(128) NULL`, JSON
  `[null,3,7]` : carte 1 en tête, `null` = suit le tour, `null` de fin retirés,
  `NULL` = aucun réglage) — une colonne plutôt que `slots_json`, pour régler les
  points d'un tour sans cartes imposées et ne rien changer aux lecteurs des
  cartes. Même route, corps `{ …, target, mapTargets }` (`mapTargets` absent =
  inchangé, `[]` = tout retirer ; `normalizeMapPointTargets`, 9 entrées au
  plus et pas plus que les cartes du format du tour, sinon
  `INVALID_MAP_POINT_TARGET`). Une édition qui raccourcit le format de match
  (BO3 → BO1) coupe les réglages des cartes qu'il ne joue plus
  (`pruneRoundPointTargets`, annoncé au journal) ; instantané et check-in
  ignorent de toute façon une carte au-delà du format (`clipMapPointTargets`). « Revenir aux points du tournoi »
  retire le nombre du tour et ceux des cartes. Même verrou, même journal
  (l'empreinte `roundPointsFingerprint` couvre tour et cartes), audit pm2 avec
  les deux listes.
- **Format éteint** sur le tournoi : les points propres aux tours sont
  effacés dans la même transaction (`updateTournament`) — ils ne resurgissent
  pas au rallumage, l'écran des cartes ne les montrant que format allumé.
- N effectif d'un match : `effectiveMapPointTarget` = celui du tour, sinon celui
  du tournoi, et rien si le format est éteint sur le tournoi. N de la carte k :
  la carte, sinon le match (`effectiveMapPointTargets`, `mapPointTargetAt`) —
  ordre **carte → tour → tournoi**.

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

Les saisies lisent le réglage du tour (nombre et cartes) en **lecture verrouillante**
(`loadMatchPointRules`, `LOCK IN SHARE MODE`) : un report qui attendait le
verrou du match pendant qu'un arbitre changeait les points du tour juge le
score sur la valeur commitée, jamais sur l'image figée plus tôt dans sa
transaction. L'interblocage possible (match puis réglage, contre tournoi puis
matchs) est rejoué par `retryOnDeadlock`.

### Refus (code seul)

| Code | Statut | Cause |
|---|---|---|
| `INVALID_MAP_POINT_TARGET` | 400 | N hors 1–99, corps sans `target`, ou `mapTargets` invalide (pas une liste, plus de 9 cartes, N hors bornes) |
| `MAP_POINTS_DISABLED` | 400 | points de tour alors que le format est éteint sur le tournoi |
| `MAP_POINTS_LOCKED` | 409 | un match jouable concerné porte déjà un score ou a ouvert son lancement |
| `MAP_POINTS_FINISHED` | 409 | points de tour posés sur un tournoi terminé |
| `INVALID_ROUND` | 400 | tour hors du tournoi (phase, tableau, ou tour absent d'un arbre créé) |
| `MAP_POINTS_INVALID` | 400 | carte qui ne respecte pas « premier à N » |

## Contrôle des scores

Toutes les portes passent par `checkMapList(…, { pointTarget, pointTargets })`
avec le N de la manche et celui de chaque carte (`loadTournamentMatchRules(…,
roundKey)`) : la carte k est jugée sur **son** N (`mapPointTargetAt`), une
carte au-delà de la liste sur celui du match : report et confirmation
d'un engagé (`scoring.ts`), « Enregistrer » et « Valider le résultat » de
l'arbitrage, résolution d'un litige (`admin.ts`). Les modales rejouent le même
contrôle (`useScoreForm`, `PlayerScoreDialog`, `MapScoreList`) : une ligne n'est
complète qu'une fois le N de sa carte atteint (`isMapComplete` sur `mapRulesAt`) ;
un refus cite le N de la carte qu'il désigne (`refusalPointTarget`). La concordance des deux
propositions (`sameMapLists`, `mapListDifferences`) compare déjà les points de
chaque carte : 5–3 contre 5–2 est un écart.

## Affichage

- `TournamentCard.mapPointTarget` et `BracketMatch.mapPointTarget` (N effectif)
  passent par l'instantané commun : flux SSE et REST de secours identiques.
  `BracketMatch.mapPointTargets` (N effectif carte par carte, carte 1 en tête)
  n'y figure que si une carte du tour a son propre N (`attachPointTargets`).
- Carte par carte : chaque ligne de la saisie (« Map 2 · premier à 3 »), chaque
  carte de la modale de détail et des propositions (« 3–1 · 3 ») et le fait
  « Points par carte » de la page du match (« Map 1 : premier à 5 · Map 2 :
  premier à 3 », détail « Maps suivantes : premier à 5. ») montrent le N de la
  carte.
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
  tournoi ; FR et EN), sous les cartes ; carte par carte : « carte 1 au premier
  à 5, carte 2 au premier à 3, puis premier à 5 pour les suivantes. »
  (`briefPointTargets`) — sans « puis … pour les suivantes » quand toutes les
  cartes du format sont réglées, et une seule ligne quand elles valent toutes
  le N du match (`hasPerMapTargets`, comme la page du match).
- Discord (journal « Match terminé ») : « (points : 5–3) » après le score, des
  chiffres seulement, aucun pseudo ; rien sur un forfait.

## Seed

« Duel Arcade Widow (premier à 5) » (`lib/server/seed/cases.ts`) : OW, individuel,
4 joueurs, BO1, premier à 5, en cours. « Duel Arcade BO3 (points par carte) » :
OW, individuel, 4 joueurs, BO3, premier à 5, en cours ; son premier tour règle
carte 2 au premier à 3 et carte 3 au premier à 7, carte 1 suivant le tournoi
(`lib/server/seed/point-targets.ts`, échec si le tournoi manque).

## Fichiers

| Rôle | Fichier |
|---|---|
| Règles pures | `lib/shared/map-points.ts`, `lib/shared/match-maps.ts`, `_lib/round-points-editor.ts` (saisie carte par carte) |
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
`tests/tournois/map-scores-wiring.test.ts` (refus rattaché à la case),
`tests/lib/shared/map-points-per-map.test.ts` (carte par carte : règles, saisie),
`tests/lib/server/seed-map-point-target-cases.test.ts`, `tests/lib/server/tournament-snapshot.test.ts`
(`attachPointTargets`), `tests/lib/shared/lobby-brief.test.ts` (ligne carte par carte),
`tests/tournois/match-page-render.test.tsx` (`pointTargetFacts`).
