# Scores map par map (codes de replay)

Demande du 2026-10-05 : « pour chaque point, exiger un code de map et un score
de map », en liste verticale bornée par la limite de la manche (BO5 → 5 maps).
« Code de map » = **code de replay** de la partie, texte libre vérifiable par
l'arbitrage.

**Correction de l'utilisateur (même jour), qui borne tout le reste** : le
système de matchs nuls et la mécanique vainqueur / perdant **ne changent pas**
— moteurs, classements, cote, plateaux, sections de manche, notifications.
Seule la **saisie** devient plus précise : des lignes de maps, dont le score du
match se **dérive** et part dans le circuit existant, inchangé. Une map nulle ne
rapporte de point à personne. Aucun état « nul » nouveau, aucun libellé
« Match nul / Non terminé » de plus que ceux qui existent
([MATCH_DRAWS.md](./MATCH_DRAWS.md)).

## Plan (écrit avant l'exécution, tenu à jour)

1. Module pur `lib/shared/match-maps.ts` : dérivation du score, plafond de
   lignes, contrôle d'une liste (`checkMapList`), lecture du corps de route.
   Le score dérivé passe par `checkMatchScores` **tel quel**.
2. Table `bg_match_maps` (CREATE TABLE + entrée tolérante dans
   `RECENT_SCHEMA_CHANGES`), stockage `lib/server/tournaments/match-maps.ts`.
3. Report d'équipe : `POST …/report` prend `{ maps }` ; arbitrage : `maps`
   facultatif sur `PATCH …/scores` et `POST …/resolve`.
4. Instantané commun (flux SSE **et** REST de secours) : `BracketMatch.maps`,
   `MatchScoreReport.maps`.
5. Interface : `MapScoreList` (modale joueur, dialogue d'arbitrage),
   `MatchMapDetails` (carte de match).
6. RGPD (codes de replay), seed, tests.

## Règles

### Score dérivé

Une map gagnée vaut **un point** au camp qui l'emporte (score de map plus haut),
une map nulle (scores égaux) n'en vaut à personne. Le couple obtenu est écrit
dans `bg_matches.team1_score` / `team2_score` exactement comme un score saisi
d'un bloc avant cette fonctionnalité : `checkMatchScores`, `matchWinnerSide`,
`finalizeMatch`, les rejeux de classement et la cote ne voient aucune
différence. Si le score dérivé est refusé ou traité d'une certaine façon par les
règles actuelles (2-2 en BO5 sans égalités → `SCORE_BELOW_MATCH_FORMAT`, 1-1 en
score libre → `DRAW_NOT_ALLOWED`, 2-2 en qualification BG Survie → nul existant),
c'est ce comportement qui s'applique.

### Combien de lignes (BO / FT → maps)

`matchMaxMaps(format)` (`MATCH_FORMAT.md`) borne les maps **décisives** :
`2 × objectif − 1`, soit 5 pour BO5 comme pour FT3. Le plafond de **lignes**
(`mapListLimit`) en découle :

| Format | Lignes au plus |
|---|---|
| Égalités ouvertes (sans tiebreaker) | `matchMaxMaps` — la map nulle consomme une map du BO |
| Vainqueur exigé | `matchMaxMaps + 2` — la map nulle se rejoue (`DRAWN_MAP_REPLAY_ALLOWANCE`) |
| Score libre | 9 (`FREE_FORMAT_MAP_LIMIT`) |

**Décision requise** : la marge de deux maps nulles rejouées sur un format qui
exige un vainqueur est un choix par défaut ; au-delà, l'arbitrage pose le score
à la main.

Une ligne après la fin acquise (un camp a atteint l'objectif, ou toutes les maps
d'un BO sans tiebreaker sont jouées) est refusée (`MAP_AFTER_DECISION`) : elle
n'a pas eu lieu. Le bouton « Ajouter une map » se désactive au même moment.

### Codes de replay

Normalisés (espaces retirés, majuscules), uniques dans un match.

| Jeu | Motif |
|---|---|
| Overwatch (`OW`) | 6 caractères alphanumériques (`^[A-Z0-9]{6}$`) |
| Marvel Rivals (`MR`), jeu inconnu | permissif : `^[A-Z0-9-]{4,32}$` — aucun format public documenté |

Le jeu se lit avec le format, dans la même requête
(`loadTournamentMatchRules`, `lib/server/tournaments/repository.ts`).

### Refus (400, code seul)

| Code | Cause |
|---|---|
| `MAP_LIST_EMPTY` | report sans map (y compris l'ancien corps `myScore` / `opponentScore`) |
| `INVALID_MAPS` | corps mal formé |
| `MAP_COUNT_EXCEEDED` | plus de lignes que le plafond |
| `MAP_REPLAY_CODE_REQUIRED` / `_INVALID` / `_DUPLICATE` | code manquant, hors motif, en double |
| `MAP_SCORE_INVALID` | score de map non entier, négatif ou > 99 |
| `MAP_AFTER_DECISION` | map après la fin acquise |
| `SCORE_EXCEEDS_MATCH_FORMAT`, `SCORE_BELOW_MATCH_FORMAT`, `DRAW_NOT_ALLOWED` | score dérivé refusé par les règles existantes |

L'interface rejoue le même contrôle avant l'envoi et rattache le refus à son
champ (`useFieldErrors`, `FieldErrorText`), en plus de la notification ; un
refus du serveur, qui ne rend qu'un code, retrouve son champ par le même calcul.

## Données

```sql
bg_match_maps (
  match_id, source ENUM('TEAM1','TEAM2','FINAL'), map_number,
  replay_code VARCHAR(32), team1_score, team2_score,
  submitted_by_user_id NULL (ON DELETE SET NULL), submitted_at
)
```

- `TEAM1` / `TEAM2` : la proposition de chaque engagée, à côté de ses colonnes
  `teamN_report_*` — et effacée **avec** elles (`clearMapSets`) : clôture
  (`finalizeMatch`, après promotion de celle qui fait foi) ; un abandon en Survie /
  Ronde suisse / BG Survie et un retour en arrière emportent aussi `FINAL`. Un code n'est
  gardé qu'avec le résultat qu'il documente.
- Lectures **verrouillantes** (`FOR UPDATE`, table seule) avant d'effacer et
  pour comparer deux propositions : une lecture cohérente verrait l'instantané
  pris avant le verrou du match et manquerait la proposition qu'un report
  concurrent vient de valider (clé unique heurtée, ou désaccord pris pour un
  report d'avant les maps). Sur un intervalle vide, elles posent un verrou
  d'intervalle : deux reports simultanés sur des matchs voisins peuvent
  s'interbloquer, et `reportMatchScorePublic` rejoue alors la transaction
  annulée (3 essais), comme les deux écritures d'arbitrage (`retryOnDeadlock`).
  Les chemins qui ne rejouent pas leur transaction (clôture d'un match,
  abandons, retour en arrière, entretien des reports expirés) lisent **sans
  verrou** avant d'effacer (`clearMapSets`) ; l'entretien verrouille et relit
  d'abord le match (`stillAwaitingConfirmation`), ce qui ferme la double
  clôture d'un même report expiré.
- Dialogue d'arbitrage : un score posé à la main avant la première map est
  rendu aux champs quand la dernière map est retirée.
- `FINAL` : le détail retenu. Promu depuis la proposition qui fait foi (accord
  des deux engagées — celle qui confirme —, ou report seul à l'échéance), ou
  écrit par l'arbitrage. Un forfait l'efface toujours (arbitrage ou engagée :
  son score plein pourrait sinon coïncider avec un détail noté plus tôt) ; un
  score posé à la main l'efface quand le corps porte `maps: []` — ce que le
  dialogue d'arbitrage envoie toujours sans map. `maps` absent : détail
  inchangé (appelants hors interface).
- Le dialogue d'arbitrage compte les maps dans « saisie en cours » : corriger
  un code ou ajouter une map nulle, qui ne changent pas le score, n'est pas
  écrasé par une proposition arrivée par le flux.
- Scores toujours dans l'orientation du plateau. Un match sans ligne — tous ceux
  d'avant — se lit comme avant ; les rejeux ne lisent jamais cette table.

### Circuit inchangé

Deux reports concordent quand le score dérivé **et** le détail concordent
(codes normalisés, scores de map) : deux 2-1 aux codes différents ne décrivent
pas la même série, et les codes sont ce que l'arbitrage vérifie. Un désaccord
sur les maps suit le chemin de tout désaccord (arbitrage alerté) — la mécanique
vainqueur / perdant ne change pas. Une proposition d'avant les maps ne se
compare que sur le score. La modale de l'adversaire s'ouvre sur la proposition
(maps comprises) : confirmer d'un clic renvoie le même détail. Corriger un code
à score égal reste une nouvelle proposition (le bouton ne se bloque pas sur
« déjà envoyé »). **Décision requise** : faut-il plutôt clore sur le seul score
et retenir le détail de l'une des deux ?

Un forfait n'affiche jamais de détail, quel que soit le chemin qui l'a posé
(arbitrage, abandon en Survie / Ronde suisse / BG Survie) : `attachMatchMaps`
le tait.

### Affichage

- `attachMatchMaps` pose le détail sur l'instantané commun : **une seule porte
  de données**, servie à l'identique par le flux SSE et par le REST de secours.
  Un détail ne s'affiche que s'il **explique** le score qu'il accompagne
  (`mapsMatchStoredScore`) : un score corrigé à la main ne porte pas un détail
  qui le contredit.
- Carte de match : « Détail des maps (N) » replié, score de chaque map et code
  copiable. **Décision requise** : visible de tout membre connecté (les pages de
  tournoi exigent une session) — les codes de replay sont des données de jeu
  publiques, mais un replay montre les identifiants de jeu des joueurs. Les
  réserver aux engagés et à l'arbitrage demanderait de les sortir de
  l'instantané diffusé vers `TournamentViewerContext`.
- Discord : aucun code n'y part. Si un jour un code y est cité, il passe par
  `discordInline` (`UNTRUSTED_NAMES.md`).

## Saisie

- **Engagé** (`PlayerScoreDialog`) : la liste remplace les deux steppers ; une
  ligne par map (« Map N », code, score de chaque équipe en `<NumberInput>`,
  retrait), « Ajouter une map » jusqu'au plafond, score du match dérivé en
  direct.
- **Arbitrage** (`AdminScoreDialog`) : la même liste sous les steppers. Dès
  qu'une map est saisie, les steppers suivent le score dérivé (désactivés) ;
  sans map, l'arbitre pose le score à la main comme avant (replay perdu). La
  confirmation de correction d'un résultat validé (#381) est inchangée.

## RGPD

Un code de replay mène aux identifiants de jeu des joueurs présents : traité
comme donnée personnelle. Entrée `2026-10-scores-map-par-map` en fin de
`PRIVACY_CHANGES`, paragraphe sur `/rgpd` (section 03), catégorie et durée
ajoutées à la fiche T03 du registre (`REGISTER_UPDATED_AT` avancé).

## Seed

`mapDetails: true` (`lib/server/seed/cases.ts`) sur « Live Auto » (OW) et
« BG Survie Égalités » : détail retenu sur les matchs joués, une map nulle
rejouée un match sur trois (`applyMatchMapDetails`).

## Fichiers

| Rôle | Fichier |
|---|---|
| Règles pures | `lib/shared/match-maps.ts` |
| Stockage | `lib/server/tournaments/match-maps.ts`, `lib/server/database/schema/tournaments.ts` |
| Report / expiration | `lib/server/tournaments/scoring.ts`, `finalization.ts` |
| Arbitrage | `lib/server/tournaments/admin.ts`, `lib/shared/admin-score-body.ts` |
| Instantané | `lib/server/tournaments/_internal.ts` (`attachMatchMaps`), `snapshot.ts` |
| Interface | `_components/MapScoreList.tsx`, `MatchMapDetails.tsx`, `PlayerScoreDialog.tsx`, `AdminScoreDialog.tsx`, `_hooks/useScoreForm.ts` |

## Tests

`tests/lib/shared/match-maps.test.ts`, `tests/lib/server/match-maps.test.ts`,
`tests/app/api/admin/map-scores-routes.test.ts`,
`tests/app/api/tournaments/report-score.test.ts`,
`tests/lib/server/match-format-report.test.ts`, `score-report-stalled.test.ts`,
`tournaments-service.matches.test.ts`.
