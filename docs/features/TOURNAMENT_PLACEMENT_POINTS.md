# Points de parcours — ce qu'un tournoi rapporte pour le rang qu'on y atteint

> Modules : `lib/shared/tournament-placement.ts` (pur) · `lib/shared/ranking.ts` (rejeu) ·
> `lib/server/ranking-service.ts` (collecte)
> Voir aussi : [`ELO_RANKING.md`](./ELO_RANKING.md), [`TEAM_RANKING_POINTS.md`](./TEAM_RANKING_POINTS.md)

## Le problème

Le classement du site est une cote de type Elo : chaque match **transfère** des
points du perdant au vainqueur, d'autant plus que le résultat était improbable.
C'est juste match par match, et c'est faux à l'échelle d'un tournoi.

Une équipe forte qui gagne un tournoi de 16 en battant quatre équipes plus
faibles qu'elle empoche une dizaine de points — chaque victoire était attendue,
donc chacune ne paie presque rien. Une équipe faible sortie au deuxième tour sur
une seule victoire surprise en encaisse près de trente.

Le classement disait donc, noir sur blanc, **qu'aller au bout coûte moins
qu'être éliminé tôt**. C'est cohérent avec l'espérance ; ce n'est pas un
classement d'esport, où la place finale *est* le résultat.

Un tournoi n'est pas la somme de ses matchs : il désigne un **classement final**,
et ce classement est exactement l'information qu'aucun transfert pris isolément
ne porte.

## La règle

À sa clôture, un tournoi met en jeu une **cagnotte** que toutes ses engagées
classées alimentent **à parts égales** et que le classement final
**redistribue** :

```
mise    = cagnotte / effectif        (la même pour tout le monde)
gain    = cagnotte × part(rang)      (décroissante avec le rang)
écart   = gain − mise                (ce qui s'ajoute à la cote, ou s'en retire)
```

Trois propriétés en découlent, et ce sont elles qu'il faut retenir.

### 1. Somme nulle

Ce que les mieux classées gagnent, les autres le perdent, **au point près**.
Le classement du site reste une hiérarchie et ne devient pas un compteur
d'assiduité : entrer dans un tournoi et y finir dernière **coûte**, exactement
comme perdre un match coûte.

L'arrondi lui-même est tenu. `placementDeltas` tronque, puis rend les points
d'arrondi restants aux plus fortes décimales (méthode du plus fort reste), ex
æquo départagés par l'identifiant d'équipe. Arrondir chaque équipe de son côté
laisserait dériver le total du site d'un tournoi à l'autre — le module le refuse
au même titre que `ratingTransfer` refuse deux arrondis pour une même rencontre.

Seule entorse : le **plancher** à `RANKING_FLOOR_POINTS`, le même que celui des
défaites, et pour la même raison — une cote négative n'est ni affichable ni
rattrapable.

### 2. Le rang paie, pas l'exploit

La part ne dépend **que** du rang final, jamais de la cote de l'équipe qui
l'atteint. C'est la différence revendiquée avec le transfert de match : gagner un
tournoi qu'on était censé gagner rapporte autant que le gagner en surprise.

L'espérance a déjà son mot à dire, match par match. Ici, seul le parcours compte
— c'est précisément ce qui manquait.

Le poids d'une place est l'**inverse de la place** (`1/1`, `1/2`, `1/3`…),
normalisé pour que la somme des parts fasse 1. La courbe est délibérément raide :
la finale n'est pas un tour de plus, c'est le tournoi. Une courbe plate rendrait
la mesure indolore et ne corrigerait rien.

Les **ex æquo** se partagent les places qu'ils occupent ensemble (deux équipes
troisièmes se partagent les poids des 3ᵉ et 4ᵉ places, la suivante prend la 5ᵉ) :
c'est la seule façon de garder la somme des parts à 1 quel que soit le classement
reçu — donc la somme nulle, dont tout le reste dépend.

### 3. La difficulté fixe l'enjeu

La cagnotte vaut :

```
cagnotte = 64 × √effectif × difficulté
difficulté = cote moyenne du plateau / 500, bornée à [0,5 ; 2]
```

**La moyenne du plateau**, et non la meilleure cote présente : ce qui rend un
tournoi difficile, c'est d'avoir à battre tout le monde, pas d'avoir une grosse
équipe quelque part dans le tableau. Une équipe encore sans match vaut la cote de
départ, donc un plateau de nouvelles est un plateau moyen — ni bonus ni malus
pour un tournoi d'inconnues.

Les bornes ne sont pas décoratives. Le plancher empêche qu'un tournoi de
remplissage ne vaille plus rien ; le plafond empêche l'inverse — la cote moyenne
n'a pas de maximum, et sans borne un tournoi entre les huit meilleures équipes
finirait par peser plus que toute une saison.

La **racine** de l'effectif, enfin, et non l'effectif : un plateau quatre fois
plus grand vaut deux fois plus. Une croissance linéaire ferait d'un tournoi à 128
équipes un évènement qui, à lui seul, réécrirait le classement — alors qu'il est
d'abord un tournoi de plus.

## Ce que ça donne

Tournoi de difficulté moyenne (plateau à la cote de départ) :

| Effectif | Cagnotte | 1ʳᵉ  | 2ᵉ  | 3ᵉ  | Dernière | Dernier rang gagnant |
| -------: | -------: | ---: | --: | --: | -------: | -------------------: |
|        4 |      128 |  +29 |  −1 | −11 |      −17 |                  1ʳᵉ |
|        8 |      181 |  +44 | +11 |  −1 |      −14 |                   2ᵉ |
|       16 |      256 |  +60 | +22 |  +9 |      −11 |                   4ᵉ |
|       32 |      362 |  +78 | +33 | +18 |       −9 |                   7ᵉ |
|       64 |      512 | +100 | +46 | +28 |       −6 |                  12ᵉ |
|      128 |      724 | +128 | +61 | +39 |       −5 |                  21ᵉ |

Un plateau relevé double ces nombres, un plateau de fond de tableau les réduit
de moitié.

Ordre de grandeur voulu : gagner un tournoi rapporte **plus qu'un match gagné**
(au plus 32 points), jamais assez pour qu'une seule soirée réécrive le haut du
classement.

## Où ça vit

Rien n'est stocké — c'est la propriété que le projet tient partout. Les points de
parcours sont **rejoués**, exactement comme les transferts de match :

- `lib/shared/tournament-placement.ts` — le calcul, **pur** et sans le moindre
  lien avec le classement du site : il reçoit des cotes et une cote de référence,
  il rend des écarts entiers de somme nulle.
- `lib/shared/ranking.ts` — `replayRanking(matches, placements)` fond les deux
  sortes d'évènements dans **une seule** chronologie. `RankedTeamState` gagne un
  champ `placementPoints` : la part de la cote qui vient des classements finaux,
  **déjà comprise** dans `points`, gardée à part pour pouvoir dire à une équipe
  d'où vient sa cote.
- `lib/server/ranking-service.ts` — `loadRankedPlacements` collecte les
  classements finaux des tournois `FINISHED` (`final_rank IS NOT NULL`), groupés
  par tournoi.

Aucune migration : `bg_tournament_registrations.final_rank` et
`bg_tournaments.finished_at` existent depuis toujours, et c'est tout ce qu'il
faut. Le barème s'applique donc **rétroactivement** à l'historique du site, sans
une écriture.

### Deux points de chronologie

**Le classement final se joue après les matchs du tournoi.** Les deux sortes
d'évènements se trient par date, puis par nature — les matchs **avant** les
classements finaux à date égale. Ce n'est pas décoratif : la clôture d'un tournoi
est écrite dans la même transaction que son dernier score, donc à la même
seconde. La cagnotte doit se redistribuer sur les cotes que ce match vient
d'écrire, pas sur celles d'avant.

**Une correction de score défait la cagnotte.** Comme tout le reste du rejeu :
corriger le vainqueur d'une finale sur un tournoi clos réécrit `final_rank`
(`FINISHED_TOURNAMENT_RECONCILIATION.md`), et le rejeu suivant redistribue la
cagnotte au nouveau classement. Rien à rattraper à la main, puisque rien n'a été
accumulé.

## Ce qui reste dehors

- **Les tournois à moins de deux classées.** Une seule engagée ne peut ni gagner
  sur les autres ni leur payer quoi que ce soit. C'est le cas du tournoi clos
  faute d'adversaires (`UNDERFILLED_TOURNAMENTS.md`), qui déclare pourtant son
  unique inscrite première. Écarté à la collecte, pour que ce bruit ne traverse
  pas le module pur.
- **Les tournois en cours.** Seul un tournoi `FINISHED` a un classement final ;
  un tournoi en cours n'en a qu'un provisoire, qui ferait bouger le classement du
  site à chaque manche pour le défaire à la suivante.
- **Un classement final ne rend pas une équipe classée.** `isRankedTeam` reste
  posé sur le bilan des matchs : une équipe dont la cote a bougé sans qu'elle ait
  disputé une rencontre comptée n'apparaît toujours pas au leaderboard. Un rang
  ne remplace pas un bilan.
- **Rien de nouveau pour les entrées solo et les équipes fantômes.** Elles sont
  rejouées comme elles l'étaient déjà, et écartées de la **liste** comme elles
  l'étaient déjà — l'exclusion porte sur l'affichage, jamais sur le calcul.

## Affichage

La fiche d'équipe (`components/stats/StatsPanel.tsx`) ajoute une tuile **« Points
de parcours »** à côté de la cote, avec son signe explicite (`+60`, `−11`), et
**seulement si un tournoi clos l'a fait bouger** — une tuile à zéro sur la fiche
d'une équipe qui n'a encore fini aucun tournoi poserait une question que rien n'y
répond. Sa légende dit l'essentiel : *compris dans la cote*, jamais en plus.

Les légendes partagées suivent la règle depuis les constantes, sans être
réécrites à la main : `RANKING_POINTS_HINT` (annuaire, leaderboard, fiche) et
`RANKING_SEEDING_RULE` (pages `/regles` des modes qui seedent au classement)
annoncent désormais la redistribution de fin de tournoi.
