# Aperçu de la manche suivante (BlueGenji Survie)

Le moteur ne pose une manche qu'une fois la précédente **close** : jusque-là,
l'arbitrage ne sait pas officiellement qui jouera contre qui. Or la plupart des
couples sont souvent déjà écrits bien avant le dernier score — une équipe dont
le match est joué ne bouge plus, et celles qui jouent encore ne peuvent déplacer
leur capital que d'une amplitude bornée par le format de match. L'aperçu les
montre, pour que le staff prépare la manche (salons, horaires, cast) sans
attendre.

**Une rencontre annoncée est sûre**, jamais probable : le moteur la posera quel
que soit le score des matchs encore ouverts.

## Qui le voit, où, quand

- **Permission `tournaments`** — administrateurs et arbitres (`detail.isAdmin`).
  Le cast n'y a pas accès : c'est un outil d'organisation, pas de diffusion.
- Sur `/tournois/[id]`, dans la vue BG Survie, sous le tableau manche par manche
  et au-dessus du plateau : un volet « Aperçu · Manche N » (ou « Aperçu ·
  Quarts de finale »…), ouvert d'office et repliable.
- Tournoi **en cours** seulement, et seulement quand une manche est ouverte : une
  manche close est aussitôt suivie de la suivante, rien n'est alors à prévoir.

## Calculé côté interface, sur l'instantané

Le calcul (`lib/shared/endurance-next-round.ts`, pur) est joué **dans le
navigateur**, sur l'instantané que le flux SSE pousse déjà à chaque score
(`app/(secured)/tournois/[id]/_lib/endurance-next-round.ts` fait l'adaptation).
Deux raisons :

- le contexte du lecteur (`TournamentViewerContext`) n'arrive **qu'à la
  connexion** au flux, et n'est pas rejoué d'un instantané à l'autre : un aperçu
  qui y vivrait resterait figé sur la manche du chargement de la page ;
- tout ce qu'il lit est **public** (classement, scores, pénalités, abandons) —
  n'importe quel spectateur pourrait refaire le calcul. Le réserver à
  l'arbitrage est une affaire d'écran, pas de secret, et rien ne justifiait une
  requête ni un cache serveur de plus.

Rien n'est calculé pour qui ne voit pas le volet (`showNextRound`).

La lecture d'un match en résultat rejouable (nul, forfait, double forfait) est
**partagée** avec le moteur : `enduranceMatchOutcome` (`lib/shared/bg-survie.ts`)
sert à la fois `loadQualificationOutcomes` côté serveur et l'aperçu côté
interface. Deux lectures d'un même match auraient fini par ne pas compter la
même chose.

## La méthode

1. **Départ de la manche** — rejoué par `replayEnduranceDetailed`, le rejeu du
   moteur : capital, statut et **ordre précédent**, qui départage deux capitaux
   égaux (`compareEndurance`).
2. **Matchs déjà joués** de la manche — rejoués eux aussi, seuls : la manche
   n'étant pas close, aucune coupe n'y est appliquée.
3. **Matchs restants** — remplacés par la liste de *tous* leurs résultats
   enregistrables : `checkMatchScores`, la règle de saisie elle-même (nuls
   compris quand le format les ouvre), plus le forfait au score plein.
4. **Pénalités puis abandons de la manche** — appliqués *après* les matchs, sur
   le capital final, dans l'ordre du rejeu : une sanction qui viderait le
   capital avant une victoire ne le vide plus après.
5. **Place de chaque équipe** au classement de fin de manche, au mieux et au
   pire. Le calcul est **exact** et pourtant polynomial : une fois fixé le
   résultat du match de l'équipe, les autres matchs sont indépendants entre eux,
   et le nombre d'équipes classées devant elle se borne match par match.
6. **Couples** — ceux du moteur : places 1-2, 3-4… (`planEnduranceRound`). Un
   couple est acquis quand deux équipes, **présentes quoi qu'il arrive**, ne
   peuvent occuper **que** ses deux places. Si l'une ou l'autre peut encore
   prendre la meilleure des deux, le couple est annoncé « côtés à confirmer » :
   l'affiche est sûre, pas qui part à gauche (et accueille la partie).
7. **Exemption** (effectif impair) — annoncée quand l'effectif est acquis et
   que la dernière place l'est aussi.

### Coût

Le calcul tourne sur le fil principal à chaque score reçu. L'ordre de
classement devient une **clé** numérique unique par équipe
(`capital × échelle − ordre précédent`), chaque match une fonction en escalier
du seuil (au mieux, au pire, combien de ses équipes le dépassent), et ces
fonctions sont sommées une fois pour tout le plateau : une équipe se situe par
recherche dichotomique. Mesuré à 128 équipes et 64 matchs ouverts : ~5 ms en
FT3, ~25 ms en BO15 (une première version naïve prenait près d'une seconde). Un
test garde la borne.

## Ce qui suit la manche

- **Manche qualificative** — le cas courant. `stageCertain` est faux quand la
  phase **peut** encore s'achever sur la manche en cours (effectif susceptible
  de retomber à la cible) : les rencontres annoncées ne se joueront alors que si
  elle continue, et un bandeau le dit.
- **Premier tour de l'arbre** — quand la qualification s'achève sur cette manche
  quoi qu'il arrive (dernière manche d'un plafond, ou effectif retombé à la
  cible dans tous les déroulés). Le tableau dépend de l'effectif qualifié : tant
  qu'il n'est pas acquis, rien ne l'est. Sinon, le tirage du moteur
  (`planPlayoffFirstRound`) est appliqué **aux places**, et une rencontre est
  acquise quand ses deux places sont tenues chacune par une équipe certaine.
- **Tour suivant d'un arbre en cours** — ne dépend plus d'aucun capital. Le
  tirage du moteur (`planNextPlayoffRound`) est joué sur les rencontres
  tranchées, un vainqueur **fictif** (identifiant négatif) tenant la place de
  chaque rencontre ouverte : toute rencontre planifiée sans équipe fictive est
  acquise. Même mécanique pour la petite finale et pour l'exemption née d'un
  double forfait.

## Les limites — toutes du côté de la prudence

Une rencontre peut être acquise sans être annoncée, **jamais l'inverse** :

- **Décisions d'arbitrage** — abandon, pénalité et double forfait ne se
  prévoient pas. Ils restent hors du calcul, et la note de bas de volet le dit.
  (Ceux déjà prononcés dans la manche, eux, sont pris en compte.)
- **Plafond de manches** — la coupe mathématique de fin de manche
  (`enduranceEliminationCut`) regarde tout le plateau à la fois et ne se découpe
  pas match par match. Elle est approchée par le haut : toute équipe qu'un
  déroulé *pourrait* écarter est tenue pour possiblement absente.
- **Glissement en bloc** — un couple que les résultats feraient passer d'une
  paire de places à une autre (1-2 dans un déroulé, 3-4 dans un autre) n'est pas
  reconnu : il faudrait qu'un nombre pair d'équipes passe toujours ensemble
  au-dessus de lui, ce que le barème à somme nulle rend exceptionnel.
- **Saisie libre** — sans format de match, un match restant peut déplacer un
  capital sans limite : rien n'est acquis avant la fin de la manche, et le volet
  le dit au lieu d'annoncer un tirage.

## Tests

- `tests/lib/shared/endurance-next-round.test.ts` — dont une **vérification par
  force brute** : des tournois sont joués par les fonctions du moteur jusqu'à
  une manche partiellement ouverte, puis *tous* les résultats possibles des
  matchs restants sont énumérés et rejoués. Chaque rencontre annoncée doit
  figurer dans chaque déroulé (côtés compris s'ils sont annoncés), et — hors
  plafond de manches — les places calculées doivent être **exactement** les
  bornes observées. Formats FT2, FT3, BO3 et FT2 à nuls, pénalités de la manche
  comprises ; sous plafond, seule la sûreté est exigée.
- `tests/tournois/endurance-next-round-view.test.ts` — adaptation de
  l'instantané, libellés, et câblage (réservé à l'arbitrage d'un tournoi en
  cours, rien de calculé pour les autres).
