# Matchs nuls et formats de qualification

Overwatch et Marvel Rivals connaissent la **map nulle**. Un BO5 peut donc
s'arrêter sur 2-2 sans que personne n'atteigne les trois manches — le cas est
rare, il dépend du map pool, mais il existe, et le moteur ne savait pas
l'écrire : toute saisie de score égal était refusée, partout, sans exception.

Cette page décrit ce qui a changé et pourquoi. Le format de match lui-même est
décrit dans [MATCH_FORMAT.md](./MATCH_FORMAT.md), le mode dans
[BG_SURVIE_MODE.md](./BG_SURVIE_MODE.md).

## Ce qui bloquait

`BO5` et `FT3` désignaient **le même objet** dans le code : le plafond de maps
valait toujours `objectif × 2 − 1`, et une saisie décisive exigeait toujours
qu'un des deux camps atteigne l'objectif. Il n'y avait donc aucune façon
d'exprimer « premier à trois, cinq maps au maximum, et tant pis si personne n'y
arrive » — ce que demande pourtant le règlement de la phase qualificative.

Trois refus, indépendants les uns des autres :

| Où | Refus |
|---|---|
| `reportMatchScore` | `DRAW_NOT_ALLOWED`, posé avant toute autre lecture |
| `POST /api/admin/matches/[matchId]/resolve` | `DRAW_NOT_ALLOWED`, dans la route |
| `checkMatchScores(…, { decisive: true })` | `SCORE_BELOW_MATCH_FORMAT` |

## Deux réglages, et une règle unique

`MatchFormat` porte deux champs facultatifs. Absents, **rien ne change** : c'est
l'état de tous les tournois antérieurs.

```ts
export interface MatchFormat {
  type: "BO" | "FT";
  value: number;
  /** Plafond de maps décisives. null = objectif × 2 − 1. */
  maxMaps?: number | null;
  /** Le match peut se clore sans vainqueur. */
  drawsAllowed?: boolean;
}
```

**Ce que plafonne `maxMaps` : la somme des deux scores**, c'est-à-dire les maps
qui ont désigné un vainqueur. Une map nulle ne figure dans aucun des deux
scores — les colonnes de `bg_matches` n'en gardent pas trace — elle allonge donc
la rencontre sans consommer le plafond. « 5 maps » veut dire ici « au plus 5
maps décisives », pas « exactement 5 maps jouées » : c'est la seule lecture que
les données permettent de tenir, et elle est écrite en toutes lettres dans le
module.

Avec `drawsAllowed`, **n'importe quel** score tenant dans le plafond est un
résultat final : 2-2, 2-1 (une map nulle a consommé la cinquième), et jusqu'à
0-0. `checkMatchScores` reste l'unique implémentation, partagée par l'interface
(qui borne les champs et active « Valider le résultat ») et le serveur (qui
refuse en 400).

Une subtilité de l'ordre des contrôles : sur un format **sans** égalité, il n'y
a pas de branche `DRAW_NOT_ALLOWED`, et ce n'est pas un oubli. Une égalité
*sous* l'objectif est d'abord un score incomplet — le refus renvoie au bon geste
(« le vainqueur doit atteindre 3 manches ») plutôt qu'à une règle abstraite — et
une égalité *à* l'objectif est impossible, 3-3 dépassant déjà le plafond.
`DRAW_NOT_ALLOWED` ne subsiste donc que pour la **saisie libre**, où il n'y a
aucun objectif à opposer.

## Un mode, deux formats

L'en-tête de la fiche le dit aussi : dès qu'un format de play-offs est réglé,
elle affiche **deux** cases et la première se renomme « Format des
qualifications ». Une case unique aurait affirmé du tournoi entier ce qui n'est
vrai que de sa première phase — une équipe préparant sa demi-finale y aurait lu
le plafond de maps de la qualification, et l'infobulle lui aurait promis une
égalité impossible.


« BlueGenji Survie » est le seul mode du projet à jouer deux formats de match :

- **qualification** — le format du tournoi, égalités éventuellement ouvertes ;
- **arbre final** — `endurance_playoff_format_*`, **jamais** d'égalité.

La raison n'est pas de goût. Une élimination directe doit savoir qui joue le
tour suivant : un match sans vainqueur y laisserait un demi-finaliste
indéterminé. Sans format de play-offs propre, l'arbre rejoue celui du tournoi
**égalités fermées** (`withoutDraws`) — le repli le moins surprenant, et le seul
qui ne casse rien.

La règle est écrite **une fois**, dans `lib/shared/bg-survie.ts` :

```ts
tournamentMatchFormat(tournamentFormat, qualification, playoff, round)
```

- hors `BG_SURVIE` → `withoutDraws(qualification)` ;
- `round` absent → le format de la qualification ;
- manche ≥ `PLAYOFF_ROUND_OFFSET` (1000) → `playoff ?? withoutDraws(qualification)`.

Elle est appelée des deux côtés : le serveur la relit à chaque saisie
(`loadTournamentMatchFormat`, `lib/server/tournaments/repository.ts`),
l'interface s'en sert par le contexte React (`useMatchFormat(match)`). Deux
copies auraient divergé au premier réglage, et la divergence se serait vue en
400 sur un formulaire qui s'annonçait valide.

`PLAYOFF_ROUND_OFFSET` a d'ailleurs quitté l'orchestration pour le module pur :
la frontière entre les deux phases sert désormais à trois endroits — le moteur,
la vue, la résolution du format.

## Ce qu'un match nul écrit en base

Rien de nouveau : `status = 'COMPLETED'`, `winner_team_id` et `loser_team_id` à
`NULL`, les deux scores renseignés et égaux. `finalizeMatch` accepte déjà des
identifiants nuls et ne propage alors rien — ce qui est exactement ce qu'un nul
veut dire : personne ne monte, personne ne tombe.

Un nul se **reconnaît** donc à trois traits conjoints : clos, sans vainqueur,
avec deux scores égaux non nuls. Un match clos sans vainqueur *ni* score n'est
pas un nul, c'est une ligne abîmée, et elle reste dehors partout.

`matchWinnerSide(format, t1, t2)` est l'unique dérivation du vainqueur, partagée
par les trois chemins qui tranchent un match — arbitrage, accord des deux
engagés, expiration du délai de report. Ils dérivaient chacun le leur, avec deux
règles différentes pour l'égalité (`>` d'un côté, `>=` de l'autre) : sans
conséquence tant qu'aucun score nul n'était enregistrable, faux dès le premier.

## Le capital d'endurance n'a besoin d'aucune règle nouvelle

C'est le mérite du barème map par map : un 2-2 rapporte deux points à chacune et
leur en retire deux — donc rien, au barème par défaut ±1, et deux points nets à
chacune sur un barème +2/−1. Le rejeu porte une branche dédiée
(`replayEnduranceDetailed`), placée **avant** la lecture vainqueur/perdant, qui
n'a rien à lire sur un nul :

```ts
if (match.winnerTeamId === null && match.drawTeamIds) { … }
```

`EnduranceMatchOutcome` porte pour cela `drawTeamIds` (les deux camps, dans
l'ordre des sides) et `drawMaps` (une seule valeur : les deux scores sont égaux
par définition, c'est ce qui fait le nul).

Le classement gagne une colonne `draws` (`bg_endurance_standings`) : ni une
demi-victoire ni une demi-défaite, mais un match joué, et « matchs joués » serait
faux sans elle. La colonne ne s'affiche que si le tournoi en a produit un —
« V / N / D » sur un plateau qui n'en connaît aucun ferait porter au classement
une colonne de zéros.

La coupe mathématique sous plafond de manches (`enduranceEliminationCut`) est
inchangée : le meilleur cas d'une équipe reste de gagner `matchWinsRequired`
maps, son pire cas d'en perdre autant. Un nul tombe strictement entre les deux.

## « Jouée » ne se lit plus sur le vainqueur

Un match nul est **terminé**. Cinq écrans en jugeaient pourtant par
`winnerTeamId !== null`, ce qui en faisait une rencontre à venir :

- une manche complète annonçait « 5/6 jouées », et ne se refermait jamais ;
- le volet ouvert d'office s'ouvrait sur une manche close ;
- le formulaire de report se rouvrait sur une rencontre finie ;
- l'arbre à élimination proposait « ton prochain match » sur un match joué ;
- `isScoreEditLocked` déclarait le match « pas encore joué » et en rouvrait
  l'édition, alors que le serveur la refusait ensuite en 409 — le bouton menait
  à un mur.

`lib/shared/match-outcome.ts` porte les deux prédicats, `isMatchPlayed` (le
**statut** fait foi) et `isMatchDrawn` (terminé, sans vainqueur, pas par
forfait, deux équipes réelles). `MatchScoreState` gagne pour la même raison un
champ `decided` : ni « a un vainqueur » (un nul en est un sans), ni « porte un
score » (l'arbitrage peut noter un 1-1 en cours de rencontre).

Deux gardes suivent la même règle, et pour la même raison :

- `adminSaveMatchScores` refuse d'écrire par-dessus un match **terminé**, statut
  à l'appui. Sur `winner_team_id`, un nul y échappait : un 2-2 se réécrivait en
  3-0 en gardant `status = COMPLETED` et `winner_team_id = NULL`, la carte
  annonçait « 3 – 0 » sous la mention « Match nul », et le rejeu en tirait trois
  maps **de chaque côté** — zéro point net au lieu de +3 / −3.
- `useScoreForm` en fait autant côté interface, sans quoi le bouton
  « Enregistrer » restait actif sur une rencontre finie et menait à un 409.

Et le nul du rejeu (`loadQualificationOutcomes`) exige **exactement** ce
qu'exige `playedMatchSql` — deux scores non nuls et égaux en plus des trois
autres traits. Sans eux, une ligne close sans vainqueur *ni* score comptait pour
un nul 0-0 côté tournoi et n'existait pas côté fiches.

## Le classement du site

Un nul **compte**. `playedMatchSql` — l'assiette partagée par le classement et le
bilan des fiches — l'admet désormais explicitement :

```sql
AND ( m.winner_team_id IS NOT NULL
      OR (m.team1_score IS NOT NULL AND m.team2_score IS NOT NULL
          AND m.team1_score = m.team2_score) )
```

Le distinguer coûte une condition ; ne pas le faire ferait disparaître des fiches
une rencontre pourtant jouée.

Côté cote, `ratingDrawTransfer` transfère des points **du favori vers
l'outsider** :

```
transfer = round(K × (expectedScore(a, b) − 0.5))
```

Positif quand `a` est le mieux coté : il en perd autant que `b` en gagne. Un nul
dit que les deux équipes se valent, ce que les cotes annonçaient peut-être
autrement — la favorite paie donc, d'autant plus que l'écart était grand. Deux
cotes égales ne déplacent rien.

Toujours plus doux qu'une victoire, et par construction : l'écart à l'espérance
vaut au plus ½ sur un nul contre 1 sur une surprise totale. Une équipe à 500 qui
tient tête à une équipe à 900 lui prend **13** points, là où la battre lui en
aurait pris **29**.

`isRankedTeam` compte le nul lui aussi : une équipe dont l'unique rencontre
comptée s'est close sur 2-2 a bien joué, et sa cote a bougé.

## Les fiches

`StatsMatch.won: boolean` est devenu `outcome: "WIN" | "LOSS" | "DRAW"`. Le
booléen aurait rangé le nul parmi les défaites — une équipe qui n'a jamais perdu
aurait affiché des défaites, et ses séries auraient été brisées par des matchs
qu'elle n'a pas perdus.

Conséquences, toutes tenues par des tests :

- `DeepStats.matchesDrawn`, affiché **seulement s'il est non nul** ;
- `winRate` garde les nuls au **dénominateur** — ce sont des matchs joués, et les
  retirer ferait remonter le ratio d'une équipe qui n'a pourtant pas gagné ;
- un nul **rompt les deux séries** (`StreakKind` gagne `"DRAW"`, la série en cours
  vaut alors 1) : le laisser passer ferait annoncer « 4 victoires d'affilée » à
  une équipe qui vient de concéder un 2-2 ;
- la forme porte « N » et non « D » — cette lettre désigne déjà la **défaite** sur
  ces pastilles ;
- répartitions par jeu/format et adversaires comptent le nul dans `played` sans
  l'ajouter à `won` ni à `lost`.

## Stockage

Quatre colonnes ajoutées sur `bg_tournaments`, une sur
`bg_endurance_standings` :

```sql
match_format_max_maps           INT NULL
match_format_draws              TINYINT(1) NOT NULL DEFAULT 0
endurance_playoff_format_type   ENUM('BO', 'FT') NULL
endurance_playoff_format_value  INT NULL

bg_endurance_standings.draws    INT NOT NULL DEFAULT 0
```

Les deux dernières colonnes du tournoi vont **par paire**, comme celles du
format principal : tant que l'une est `NULL`, `parseMatchFormat` renvoie `null`
et l'arbre reprend le format du tournoi.

## Refus à la création et à l'édition

| Cas | Code |
|---|---|
| Plafond de maps hors de `[objectif, objectif × 2 − 1]` | `INVALID_MATCH_FORMAT_MAX_MAPS` (400) |
| Égalités demandées hors `BG_SURVIE` | *neutralisées* (voir ci-dessous) |
| Égalités demandées en saisie libre | `INVALID_MATCH_FORMAT` (400) |
| Format de play-offs à moitié renseigné | `INVALID_ENDURANCE_PLAYOFF_FORMAT` (400) |

Hors `BG_SURVIE`, les égalités et le format de play-offs sont **neutralisés**,
pas refusés — même choix que `hasThirdPlaceMatch` hors `SINGLE`, et pour la même
raison : `updateTournament` fusionne un `PATCH` partiel sur les valeurs
courantes, si bien qu'un `{ "format": "SINGLE" }` seul sur un tournoi BG Survie
aurait échoué sur un réglage que le nouveau format ne relit même pas, avec un
message ne désignant aucun champ à corriger. Le formulaire ne propose de toute
façon ces réglages que sur ce format.

La **paire incomplète** reste, elle, une vraie erreur de client : elle décrit un
format à moitié défini, quel que soit le mode.

## Fichiers

| Rôle | Fichier |
|---|---|
| Format, plafond, égalités, dérivation du vainqueur | `lib/shared/match-format.ts` |
| Règle « quel format pour cette manche » | `lib/shared/bg-survie.ts` (`tournamentMatchFormat`) |
| Lecture serveur du format d'une manche | `lib/server/tournaments/repository.ts` |
| Rejeu d'endurance (branche du nul) | `lib/shared/bg-survie.ts` |
| Barre de forme de l'annuaire (lettre `d`) | `lib/server/teams-service.ts` |
| « Jouée » / « nulle », partagés par les écrans | `lib/shared/match-outcome.ts` |
| Verrou d'édition d'un score | `lib/shared/match-lock.ts` (`decided`) |
| Cote de type Elo | `lib/shared/ranking.ts` (`ratingDrawTransfer`) |
| Bilan des fiches | `lib/shared/stats.ts`, `lib/server/stats-service.ts` |
| Validation création / édition | `lib/server/tournaments/validation.ts` |
| Contexte React (format par manche) | `app/(secured)/tournois/[id]/_lib/match-format-context.tsx` |
| Réglages du formulaire | `app/(secured)/tournois/_components/{TournamentForm,FormatSettings}.tsx` |
| Règlement public | `lib/shared/tournament-rules.ts` |
