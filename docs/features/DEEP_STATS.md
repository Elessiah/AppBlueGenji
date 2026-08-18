# Statistiques approfondies — équipes et joueurs

Les fiches `/(secured)/equipes/[id]` et `/(secured)/joueurs/[id]` affichaient
quatre compteurs bruts (tournois joués, tournois gagnés, victoires, défaites).
Elles exposent désormais un **bloc de statistiques complet**, identique des deux
côtés : palmarès, bilan de maps, dynamique de forme, répartitions par jeu et par
format, adversaires marquants, activité mensuelle.

Le point important : **équipe et joueur partagent le même calcul**. Un seul
module pur agrège, un seul module serveur collecte. Deux barèmes ne peuvent plus
diverger comme ils l'avaient fait entre le leaderboard et le seeding
(cf. `lib/shared/ranking.ts`).

## Architecture

| Élément | Rôle |
| --- | --- |
| `lib/shared/stats.ts` | **Pur.** Types `StatsMatch` / `StatsTournament` en entrée, `DeepStats` en sortie. Aucune dépendance base. |
| `lib/server/stats-service.ts` | Collecte SQL (`getTeamStats`, `getPlayerStats`, `getTeamRankingPosition`) puis délègue à `computeDeepStats`. |
| `components/stats/StatsPanel.tsx` | Rendu partagé par les deux fiches, teinte d'accent au choix (bleu joueur / orange équipe). |
| `lib/shared/types.ts` | `ProfileStats` est un alias de `DeepStats` ; `TeamDetailResponse` gagne `stats` et `ranking`. |

Le calcul n'est pas persisté : il est refait à chaque consultation de fiche, à
partir de `bg_matches` et `bg_tournament_registrations`. Aucune table ni colonne
n'est ajoutée — une correction de score se répercute donc immédiatement, sans
tâche de reconstruction.

## Ce qui est mesuré

### Palmarès
`tournamentsPlayed`, `tournamentsWon` (rang 1), `podiums` (rang ≤ 3),
`bestRank`, `averageRank` (deux décimales).

Un tournoi n'est « joué » que s'il est `RUNNING` ou `FINISHED` : une simple
inscription à un tournoi `UPCOMING` / `REGISTRATION` est comptée à part dans
`tournamentsUpcoming` et affichée en légende de la tuile. Sans cette
distinction, s'inscrire suffisait à faire monter le palmarès.

Les tournois en cours comptent dans les participations mais, faute de
`final_rank`, ne pèsent ni sur le rang moyen ni sur les podiums.

### Bilan des matchs
`matchesPlayed` / `matchesWon` / `matchesLost` / `winRate`, plus le détail des
maps : `mapsWon`, `mapsLost`, `mapDiff`, `mapWinRate`. Les points de classement
(`rankingPoints`) réutilisent le barème partagé — 100 par victoire, −20 par
défaite.

### Dynamique
`currentStreak` (série en cours, victoire ou défaite), `bestWinStreak`,
`worstLossStreak`, et `form` : les cinq derniers résultats, **le plus récent en
tête**.

### Répartitions
`byGame` et `byFormat` : un `StatsSplit` par jeu (OW2 / Marvel Rivals) et par
format de tournoi rencontré, trié par volume décroissant, avec ratio de
victoires. Seules les clés effectivement jouées apparaissent.

### Adversaires
`favouriteOpponent` (le plus battu) et `nemesis` (celui qui inflige le plus de
défaites). Les deux valent `null` tant que le critère est à zéro : un adversaire
jamais battu n'est pas un « adversaire favori ». Départage : nombre de
confrontations, puis ordre alphabétique — le résultat est déterministe.

### Activité
`activity` couvre les **12 derniers mois glissants**, du plus ancien au plus
récent, avec matchs joués et gagnés par mois. Un match plus ancien reste compté
dans le bilan global mais sort de la fenêtre. `firstMatchAt` / `lastMatchAt`
bornent l'historique complet.

## Ce qui est exclu du décompte

Les **byes** (`bg_matches.is_bye = 1`) et les **matchs fantômes** (une équipe
manquante) sont écartés dès la requête SQL. Leur score (1-0, 0-0) est posé par
le moteur de tournoi, pas joué : les compter gonflerait bilans, séries et
différentiel de maps. C'est la même règle que celle appliquée par
`lib/shared/match-lock.ts`.

Seuls les matchs `COMPLETED` avec un vainqueur désigné entrent dans le calcul.

Ce filtre vit dans **une seule constante**, `PLAYED_MATCH_SQL`, partagée par le
bilan et par le classement. Il avait d'abord été écrit deux fois : le classement
comptait alors les byes et la fiche affichait une place calculée sur un total de
points différent de celui posé juste à côté.

Les **forfaits**, eux, comptent comme des matchs (ils décident réellement d'une
rencontre) mais sont isolés dans `forfeitsGiven` / `forfeitsReceived`, selon que
l'entité a déclaré forfait ou l'a subi.

## Le cas du joueur : fenêtres d'appartenance

Un joueur n'a pas d'historique propre — il hérite de celui de ses équipes. La
version précédente joignait `bg_team_members` sans condition de date : rejoindre
une équipe titrée suffisait à s'attribuer ses trophées, et la quitter n'arrêtait
rien.

`getPlayerStats` exige désormais que la période d'appartenance **chevauche le
déroulement du tournoi** :

```
créditer l'équipe T au joueur  ⟺  joined_at ≤ (finished_at ?? +∞)
                                  ET  (left_at ?? +∞) ≥ start_at
```

Le test porte sur un **intervalle**, pas sur un instant. C'est ce qui distingue
les deux cas qu'il faut savoir séparer :

- un tournoi entièrement terminé **avant** l'arrivée du joueur ne lui est pas
  attribué — c'est la correction visée ;
- un joueur arrivé **en cours** de tournoi est bien crédité, tout comme un
  membre actuel l'est d'un tournoi encore en cours (pas de `finished_at`, donc
  pas de borne haute).

Le crédit se décide **par tournoi**, pas match par match : un joueur reçoit une
campagne entière ou aucune de ses rencontres, jamais une moitié.

Trois conséquences voulues :

- plusieurs passages dans la même équipe créent plusieurs fenêtres — un tournoi
  joué **entre** les deux ne compte pas ;
- deux équipes du joueur ayant disputé le même tournoi n'en font qu'un, à la
  **meilleure** place obtenue (palmarès, pas addition) ;
- un match opposant deux de ses équipes n'est compté qu'une fois, sinon il
  ajouterait à la fois une victoire et une défaite.

## Classement du site

`getTeamRankingPosition` situe l'équipe dans le classement général, avec le
barème partagé (`lib/shared/ranking.ts`) appliqué à **la même assiette de matchs
que le bilan de la fiche**. Les équipes à égalité de points partagent le même
rang, et une équipe sans match n'est pas classée (`position: null`) — `total`
compte donc les équipes ayant réellement joué.

Le leaderboard de la landing part, lui, de **toutes** les équipes et de tous les
matchs terminés : une équipe sans match y figure à 0 point. Les deux vues n'ont
pas le même dénominateur, c'est assumé — ce qui compte est que la place affichée
sur la fiche découle du total de points affiché sur cette même fiche.

Le classement n'est calculé que pour la **consultation** de la fiche : il exige
une agrégation sur toutes les équipes, hors de propos pour un ajout de membre.
`getTeamDetail` ne le produit que si `includeRanking` est demandé, et
`TeamDetailResponse.ranking` vaut `null` sur les réponses des routes de
mutation — l'interface masque alors la tuile.

## Coût

Une fiche équipe déclenche deux requêtes bornées à l'équipe (matchs,
inscriptions), plus l'agrégation de classement **uniquement en consultation**.
Une fiche joueur en déclenche trois (appartenances, matchs, inscriptions), toutes
bornées à ses équipes. `getPlayerEntityStats` court-circuite tout dès qu'un
joueur n'a aucune équipe.

## Tests

- `tests/lib/shared/stats.test.ts` — agrégation pure : séries, forme,
  répartitions, adversaires, fenêtre d'activité, palmarès, formatage.
- `tests/lib/server/stats-service.test.ts` — collecte : filtres SQL, côté du
  tableau, forfaits, fenêtres d'appartenance, dédoublonnage.
