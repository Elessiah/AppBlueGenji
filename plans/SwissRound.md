Un tournoi en système suisse (Swiss Round / Round Suisse) est un format de compétition où tous les participants jouent un nombre fixe de rondes sans élimination directe. Les joueurs ne rencontrent pas tous les autres participants, contrairement à un round-robin complet, mais les appariements sont recalculés à chaque ronde selon les résultats précédents.

Le but du système est de produire un classement fiable avec beaucoup moins de matchs qu’un championnat complet.

Principes fondamentaux :

1. Aucun joueur n’est éliminé

* Tous les participants jouent jusqu’à la dernière ronde.
* Le nombre de rondes est fixé à l’avance.

Exemple :

* 32 joueurs
* 5 rondes prévues
* chaque joueur joue exactement 5 matchs.

2. Première ronde
   La première ronde est généralement :

* aléatoire,
* ou basée sur un classement/seeding initial.

Exemple :

* Joueurs triés par Elo
* moitié haute contre moitié basse :

    * 1 vs 17
    * 2 vs 18
    * etc.

3. Appariements des rondes suivantes
   Après chaque ronde :

* les joueurs sont regroupés par score,
* puis appariés contre des adversaires ayant un score proche ou identique.

Exemple après ronde 1 :

* Groupe 1 point : gagnants
* Groupe 0 point : perdants

Les gagnants jouent contre gagnants.
Les perdants jouent contre perdants.

Après plusieurs rondes :

* 3 points joue contre 3 points,
* 2 points contre 2 points,
* etc.

Le système tente toujours de faire jouer des joueurs de niveau de performance similaire dans le tournoi.

4. Contraintes importantes des appariements
   Le moteur suisse doit respecter plusieurs règles :

a) Éviter les rematchs
Deux joueurs ne doivent normalement jamais se rencontrer deux fois.

b) Équilibrer les couleurs/côtés
Dans les jeux asymétriques (échecs, etc.) :

* éviter trop de parties d’affilée du même côté,
* équilibrer blanc/noir ou attaque/défense.

c) Gérer les BYE
Si nombre impair de joueurs :

* un joueur reçoit un BYE,
* considéré comme une victoire automatique ou score partiel selon les règles.

Un joueur ne doit généralement recevoir qu’un seul BYE.

d) Minimiser les écarts de score
Le système préfère :

* 3 points vs 3 points
  plutôt que :
* 3 points vs 1 point.

5. Nombre de rondes
   Le nombre de rondes dépend du nombre de participants.

Approximation classique :

* rondes ≈ log2(nombre de joueurs) + marge.

Exemples :

* 8 joueurs → 3 rondes
* 32 joueurs → 5 rondes
* 128 joueurs → 7 rondes

Plus il y a de rondes :

* plus le classement final est précis.

6. Système de points
   Typiquement :

* victoire = 1 point
* nul = 0.5
* défaite = 0

Ou dans certains jeux :

* victoire = 3
* nul = 1
* défaite = 0

7. Classement final
   À la fin des rondes :

* le joueur avec le plus de points gagne.

Comme plusieurs joueurs peuvent avoir le même score, on utilise des tie-breakers.

Tie-breakers courants :

* Buchholz :
  somme des scores des adversaires affrontés.
* Sonneborn-Berger
* Opponent Match Win %
* Résultats directs

Le but est de départager les joueurs ayant eu des parcours plus difficiles.

8. Avantages du système suisse

* Très scalable.
* Peu de rondes nécessaires.
* Tous les joueurs continuent à jouer.
* Les matchs deviennent progressivement équilibrés.
* Adapté aux grands tournois.

9. Inconvénients

* Le classement final n’est pas parfaitement exact.
* Les tie-breakers peuvent être controversés.
* Les appariements deviennent complexes.
* Impossible de garantir que les deux meilleurs joueurs se rencontrent.

10. Exemple complet

8 joueurs :
A B C D E F G H

Ronde 1 :

* A vs E
* B vs F
* C vs G
* D vs H

Supposons gagnants :
A B C D

Scores :

* A B C D → 1
* E F G H → 0

Ronde 2 :

* A vs B
* C vs D
* E vs F
* G vs H

Supposons :

* A gagne
* D gagne
* E gagne
* H gagne

Scores :

* A → 2
* D → 2
* B C E H → 1
* F G → 0

Ronde 3 :

* A vs D
* B vs C
* E vs H
* F vs G

Puis classement final.

En pratique, les logiciels de tournoi utilisent souvent des variantes officielles :

* système suisse accéléré,
* suisse hollandais,
* suisse monrad,
* suisse FIDE (échecs).

Le plus courant aujourd’hui est le système suisse hollandais.
