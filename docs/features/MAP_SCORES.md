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
2. Table `bg_match_maps` (son `CREATE TABLE IF NOT EXISTS` est sa migration :
   table neuve, rien à rejouer dans `RECENT_SCHEMA_CHANGES` ; la clé unique
   `(match_id, source, map_number)` sert aussi les lectures par match), stockage
   `lib/server/tournaments/match-maps.ts`.
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

**Décision de l'utilisateur (2026-10-06)** : la marge de deux maps nulles
rejouées sur un format qui exige un vainqueur est gardée comme marge de sécurité
(le cas ne devrait pas se produire) ; au-delà, l'arbitrage pose le score à la
main.

**Décision de l'utilisateur (2026-10-06)** : là où les égalités sont ouvertes,
une map nulle **consomme** une map du BO. Un match clos sans vainqueur doit donc
avoir joué toutes ses maps : un 2-2 en BO5 n'est accepté qu'avec une cinquième
map nulle, sinon `MAP_LIST_INCOMPLETE` (contrôle décisif seulement — un
enregistrement intermédiaire de l'arbitrage reste libre).

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
| `MAP_LIST_INCOMPLETE` | égalités ouvertes : match sans vainqueur clos avant d'avoir joué toutes ses maps |
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
  annulée (3 essais), comme les deux écritures d'arbitrage et le forfait déclaré
  par une engagée (`retryOnDeadlock`). Retirer une map rend le focus à la ligne
  suivante (ou à « Ajouter une map »).
  Les chemins qui ne rejouent pas leur transaction (clôture d'un match,
  abandons, retour en arrière, entretien des reports expirés) lisent **sans
  verrou** avant d'effacer (`clearMapSets`) ; l'entretien verrouille et relit
  d'abord le match (`stillSingleReport` : statut et reports relus sous verrou, scores du report relu), ce qui ferme la double
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
« déjà envoyé »). **Décision de l'utilisateur (2026-10-06)** : un désaccord sur
les maps à score égal est un conflit, tranché par l'arbitrage — on ne clôt pas
sur le seul score.

### « Confirmer » la proposition adverse (demande du 2026-10-06)

La seconde équipe ne ressaisit rien :

- **Pré-remplissage.** La modale s'ouvre sur la proposition adverse : chaque
  ligne reprend son code de replay et son score de map
  (`playerReportInitialMaps` sur le match complété par `withProposalMaps`).
- **« Confirmer »** (action principale, `confirmsAsIs`) : visible tant que les
  lignes sont celles de l'adversaire, à l'identique. Le corps porte
  `confirm: { reportedAt }` — l'instant de dépôt lu dans la modale — et passe
  par **le même chemin** que tout report (`reportMatchScore`, mêmes contrôles,
  même concordance, même `finalizeMatch`) : vainqueur, perdant et nul ne
  changent en rien.
- **Retouche = contre-proposition.** Dès qu'un champ change, le bouton redevient
  « Envoyer le score » et l'envoi suit le désaccord ordinaire (arbitrage alerté).
- **Péremption.** Le serveur relit le report adverse sous le verrou du match :
  autre instant de dépôt, report retiré ou expiré, ou maps qui ne sont plus
  celles envoyées → `409 PROPOSAL_STALE`, rien d'écrit. La modale relit alors le
  contexte du lecteur et se réaligne sur la version à jour.
- **Proposition sans détail** (antérieure aux maps, ou détail resté
  introuvable après trois relectures) : la modale s'ouvre vide et la phrase
  d'état dit de saisir les maps jouées et leurs codes pour confirmer, au lieu
  de « Confirme-le ». Tant que le détail est **en lecture** (proposition
  arrivée par le flux), la phrase le dit, pour que le joueur ne ressaisisse pas
  ce qui va pré-remplir le formulaire. Saisir les maps au **même score** qu'une
  proposition sans détail vaut confirmation (« Confirmer », contrôle de
  péremption compris) : le serveur la compare au seul score. Pas tant que le
  détail est en lecture : l'envoi reste alors une proposition ordinaire, sans
  faux `PROPOSAL_STALE`.
- **Code de replay** saisi brut (majuscules par la CSS, normalisé à la
  validation et au serveur) : le curseur reste en place pendant une correction.

**Lisibilité de la saisie.** Le compteur « Maps jouées (n/N) » annonce le format
(BO3 → 3) ; les maps nulles rejouables au-delà sont dites dans l'aide et ne
l'avancent que lorsqu'elles servent. La liste passe sur deux lignes selon **sa
propre largeur** (requête de conteneur, 560 px), pour que le code de replay
reste lisible dans la modale. Côté arbitrage, un bouton laissé actionnable sur
une map refusée affiche ce refus en infobulle (`mapsRefused` porte le motif).

**Qui voit le détail d'une proposition.** Jamais l'instantané diffusé : les
propositions y gardent `maps: []`. Le détail voyage dans
`TournamentViewerContext.matchProposals`, calculé par `loadViewerProposals`
dans `getTournamentViewerContext` — porte commune du **flux SSE** et de la
**lecture REST de secours** —, pour les seuls matchs de l'engagé du lecteur
**s'il mène le match** (`canCreateReportsForTeamIds` : capitaine, manager,
propriétaire, ou le joueur en individuel), et pour l'arbitrage (permission
`tournaments`, qui en a besoin pour trancher un désaccord). Une requête au plus,
aucune quand rien n'attend. Le contexte du lecteur n'arrivant qu'à la connexion
au flux, une proposition déposée depuis se repère à son `reportedAt` (porté par
l'instantané) et déclenche une relecture REST (`useProposalMaps`,
`proposalsNeedRefresh`).

Un forfait n'affiche jamais de détail, quel que soit le chemin qui l'a posé
(arbitrage, abandon en Survie / Ronde suisse / BG Survie) : `attachMatchMaps`
le tait.

### Affichage

- `attachMatchMaps` pose le détail **retenu ou noté par l'arbitrage** (une sauvegarde
  « Enregistrer » en cours de série est publique, comme son score) sur l'instantané commun : **une
  seule porte de données**, servie à l'identique par le flux SSE et par le REST
  de secours (le détail des propositions, lui, passe par le contexte du
  lecteur — voir ci-dessus).
  Un détail ne s'affiche que s'il **explique** le score qu'il accompagne
  (`mapsMatchStoredScore`) : un score corrigé à la main ne porte pas un détail
  qui le contredit.
- Carte de match : bouton « Détail des maps (N) » qui ouvre une **modale** (un volet déplié dans la carte grandissait chaque créneau de l'arbre), score de chaque map et code
  copiable. **Décision de l'utilisateur (2026-10-06)** : les codes retenus
  (`FINAL`) ou enregistrés par l'arbitrage sont visibles de tout membre connecté
  (les pages de tournoi exigent une session), pour qu'un match diffusé en direct
  et un match qui ne l'est pas offrent les mêmes informations ; les propositions
  en attente restent réservées aux deux équipes et à l'arbitrage.
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
  En désaccord (deux propositions), le dialogue montre le détail des deux,
  codes de replay compris (`MapResultList`). Tant que le détail de la
  proposition est en lecture (`proposalsNeedRefresh`, formulaire sans map ni
  forfait), « Enregistrer » et « Valider » attendent, avec une phrase visible :
  un score validé avant partirait avec `maps: []` et effacerait les codes de la
  proposition à la clôture. Une seule phrase sous les boutons, dans l'ordre de
  l'infobulle : détail en lecture, map refusée (une fois une map renseignée),
  puis blocage du score. Sous un forfait, la liste masquée ne refuse plus rien
  (ses maps ne partent pas).

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
