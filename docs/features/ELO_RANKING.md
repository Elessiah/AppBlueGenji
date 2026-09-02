# Classement du site — cote de type Elo

Le classement des équipes n'est plus un **cumul** (100 par victoire, −20 par
défaite) mais une **notation de force** : chacune part de 500 points, et chaque
match **transfère** des points du perdant au vainqueur — beaucoup quand le
résultat était improbable, presque rien quand il était attendu.

## Ce que le barème additif ne pouvait pas dire

Le cumul comptait des rencontres sans jamais regarder **qui** était en face.
Battre la meilleure équipe du site et battre une équipe qui n'a jamais gagné
rapportaient exactement la même chose, et l'équipe la mieux classée était
simplement celle qui avait le plus joué : un classement d'assiduité, pas de
niveau. Le seeding, qui lit ce même classement, opposait donc au premier tour la
plus assidue à la moins assidue.

La cote répond à la question qu'on pose vraiment à un classement : **qui bat
qui**.

## La formule

| Constante | Valeur | Rôle |
| --- | --- | --- |
| `RANKING_BASE_POINTS` | 500 | cote de départ, commune à tout le monde |
| `RANKING_SCALE` | 400 | écart valant 10 chances contre 1 |
| `RANKING_K_FACTOR` | 32 | amplitude maximale d'un match |
| `RANKING_FLOOR_POINTS` | 100 | plancher |

```
probabilité de victoire = 1 / (1 + 10 ^ ((cote adverse − cote) / 400))
transfert               = arrondi(32 × (1 − probabilité du vainqueur))
```

Le vainqueur prend le transfert, le perdant le rend. L'exemple de la demande, à
l'unité près :

| Rencontre | Vainqueur | Transfert |
| --- | --- | --- |
| A (500) bat B (900) | l'outsider | **+29 / −29** |
| B (900) bat A (500) | la favorite | **+3 / −3** |
| cotes égales | — | +16 / −16 |

L'exploit paie dix fois ce que paie le résultat attendu — c'est exactement le
rapport que fixe `RANKING_SCALE`, et la base à 500 fait tomber l'exemple
canonique dessus.

## Les choix, et pourquoi

### K constant, et non décroissant avec l'expérience

Un facteur K par équipe — les nouvelles plus volatiles, comme le font beaucoup
de systèmes — **casse la symétrie** : une vétérane battue par une débutante
perdrait moins que la débutante ne gagne, et le total du site dériverait à
chaque rencontre déséquilibrée. Entre « les nouvelles trouvent leur niveau plus
vite » et « ce que l'un gagne, l'autre le perd », c'est la seconde propriété
qu'on garde : c'est elle qui rend un classement lisible, et la première n'est
pas un besoin de ce site — un plateau amateur voit assez peu de matchs pour que
la volatilité vienne naturellement du faible volume.

Conséquence de code : le transfert est calculé **une fois** (`ratingTransfer`)
puis appliqué avec les deux signes. Arrondir séparément le gain du vainqueur et
la perte du perdant produirait deux nombres différents dès que la valeur exacte
tombe sur une demie.

### Plancher à 100

La cote se stabilise d'elle-même — une équipe très basse ne perd presque plus
rien en s'inclinant — mais rien n'empêche une longue série de défaites de la
faire passer sous zéro. Un nombre négatif à côté d'un nom d'équipe est un
affichage qu'on n'a aucune raison de servir, et un gouffre qu'une équipe qui
reprend ne comblerait jamais.

Un cinquième de la base : assez bas pour que la hiérarchie s'exprime, assez haut
pour rester lisible. **C'est la seule entorse à la symétrie** : le vainqueur
prend ses points même quand le perdant n'a plus rien à donner. Elle est
documentée et couverte par son propre test.

### Une équipe sans match n'est pas classée

Tout le monde part de 500, y compris les ~140 équipes de remplissage du jeu de
test et toute équipe qui vient d'être créée. Les laisser se mêler aux classées
les placerait **au milieu du tableau sans avoir rien joué**, et le leaderboard
de l'accueil, qui n'affiche que huit lignes, s'en serait rempli devant des
équipes qui jouent.

`compareRankedTeams` range donc toute équipe sans match comptée après les
classées, quelle que soit sa cote — puis trie à la cote, aux victoires, au nom.
C'est la **règle de tri unique** : annuaire, fiche, leaderboard et seeding
l'appliquent tous.

### Fantômes et entrées solo

- Les **équipes fantômes** (`bg_teams.is_ghost`) sont des équipes du site,
  administrées par le staff, et elles jouent contre les autres : elles sont
  classées comme les autres. C'était déjà le cas.
- Les **entrées solo** (`bg_teams.solo_user_id`) restent hors de la **liste** :
  ce sont des engagés de tournoi individuel, pas des équipes — les laisser
  décalerait le rang de toutes les autres.

Elles sont en revanche **rejouées** : leur cote est celle de l'adversaire dans
les matchs des autres, on ne peut donc pas la sauter sans fausser le calcul de
ceux qui les affrontent. Le rejeu porte sur toutes les rencontres comptées ; ce
qui se filtre, c'est l'affichage.

Une fiche **joueur** n'affiche plus de total de points. Le classement note ce
qui dispute les matchs, c'est-à-dire l'engagé : l'ancien nombre, somme des
matchs de ses équipes successives, ne correspondait à aucune cote.

### Forfaits

Inchangé depuis les PR #82/#84 : un forfait est une victoire pleine, et compte
donc comme telle dans le transfert.

## L'ordre chronologique — le point délicat

Contrairement à une somme, **une cote dépend de l'ordre des rencontres** : les
points qu'un match transfère se lisent sur les cotes des deux équipes *à cet
instant-là*. Deux mêmes résultats dans deux ordres différents ne donnent pas la
même cote.

Le projet ne stocke rien et recalcule tout depuis `bg_matches` — « une
correction de score se répercute seule ». Cette propriété est tenue : le
classement se **rejoue**, comme `replaySurvival` / `replaySwiss` / `replayEndurance`
rejouent leurs tournois.

`replayRanking` (`lib/shared/ranking.ts`, pur) impose lui-même la chronologie :
date du résultat, puis identifiant du match. Le second critère n'est pas
décoratif — deux scores saisis dans la même seconde doivent se rejouer dans un
ordre **stable**, sinon deux calculs du même classement rendraient deux nombres
différents. L'`ORDER BY` SQL n'est qu'une commodité : la règle appartient au
module pur, qui retrie ce qu'il reçoit.

### La date d'un match est celle de sa dernière écriture

La chronologie lue est celle des fiches et des barres de forme —
`COALESCE(m.updated_at, t.finished_at, t.start_at)` — une seule lecture de
« quand ce match a-t-il eu lieu », donc pas deux histoires du site. C'est un
choix, et il a une conséquence qu'il vaut mieux énoncer que découvrir :

**corriger un vieux score le redate.** `updated_at` passe à l'instant de la
correction : le match quitte sa place dans l'histoire et se rejoue **en
dernier**, aux cotes d'aujourd'hui. Les rencontres qu'il précédait ne sont donc
pas re-dérivées depuis ses cotes corrigées — elles se rejouent inchangées, avant
lui. Corollaire : rétablir le score d'origine ne rétablit pas forcément le
classement d'origine, puisque la date, elle, ne revient pas en arrière.

Ce que le rejeu garantit, et qui est la propriété recherchée, est plus étroit et
plus solide : **le classement est une fonction pure des matchs comptés, de leurs
vainqueurs et de leurs dates**. Rien n'est accumulé, donc rien ne se désynchronise
— un score corrigé, un match rouvert, un tournoi supprimé disparaissent
entièrement du calcul, sans laisser de points derrière eux. C'est ce qu'une somme
stockée ne savait pas faire.

Retenir une date immuable (le début du tournoi, par exemple) ferait diverger
l'ordre du classement de celui des barres de forme et des fiches — la divergence
même que la PR #88 venait de supprimer. Une seule chronologie pour tout le site,
et ses limites écrites.

## Ce que le rejeu entraîne

### Le SQL ne peut plus rendre les points

`rankingPointsForTeamSql`, `rankingWinsSql`, `rankingLossesSql` et
`rankingPointsSql` ont disparu : une cote rejouée ne s'écrit pas en SQL. Ce qui
reste du module côté SQL est l'**assiette** — `playedMatchSql` /
`PLAYED_MATCH_SQL` / `rankingMatchJoinSql` — inchangée depuis la PR #88 : matchs
terminés, non-bye, deux équipes réelles, un vainqueur.

Les **quatre requêtes de seeding** qui triaient sur une expression SQL (Survie,
Ronde suisse, Multi-phases, aperçu du plateau) passent par une seule fonction,
`loadEntrantsBySiteRanking` : elle rejoue le classement puis ordonne les
inscrites avec `compareRankedTeams`. Un aperçu ne peut donc pas diverger du
tirage réel, ni deux formats se seeder différemment.

Tout s'y lit sur **la connexion de l'appelant**. Ce que règle son option
`transactional`, c'est seulement le droit de resservir une photo déjà prise :
le **seeding** le refuse (il s'exécute dans la transaction qui lance le tournoi
et doit voir ce qu'elle voit), l'**aperçu du plateau** l'accepte — c'est une
lecture seule, hors transaction, qui n'a aucune raison de rejouer tout
`bg_matches` par consultation et affiche d'ailleurs le classement que l'annuaire
montre au même moment.

### Le coût, et le cache

Le rejeu lit tous les matchs terminés du site : une lecture séquentielle bornée,
une multiplication par match. Ce n'est pas la requête qui coûte, c'est de la
relancer pour chaque lecteur — l'annuaire, le leaderboard (deux fois, la
tendance comparant deux photos), chaque fiche d'équipe.

`lib/server/ranking-cache.ts` la mutualise par le cache **à vol unique** du
projet (`lib/server/cache.ts`) : cent lecteurs simultanés coûtent un rejeu. TTL
de 60 s, et surtout invalidation à l'écriture depuis
`tournaments/notifications.ts` — **les trois** publications, mise à jour comprise
(un tournoi supprimé emporte ses rencontres) mais aussi les deux événements de
score, ce qui est nouveau : c'est le seul cache global qu'un score doive vider,
puisque la cote en dépend directement.

## Ce que voit l'utilisateur

- La tuile « Points de classement » de la fiche d'équipe vient désormais du
  **même objet** que la place affichée à côté (`TeamRankingPosition`) : un seul
  nombre, aucune divergence possible. Elle a rejoint le groupe « Palmarès », où
  vit déjà le classement.
- `DeepStats` ne porte plus de `rankingPoints` — un bilan de matchs ne suffit
  pas à déduire une cote.
- L'infobulle annonce la nouvelle règle, **dérivée des constantes** : « Base 500
  · une victoire prend à l'adversaire d'autant plus de points qu'elle était
  improbable (plancher 100) ». Une équipe non classée lit « Aucun match joué :
  cote de départ ».

## Tests

- `tests/lib/shared/ranking.test.ts` — la formule (dont le scénario de la
  demande, 500 contre 900, dans les deux sens), la **symétrie** (somme des
  points conservée), le **plancher** et son entorse assumée, le **rejeu**
  (indépendance à l'ordre reçu, dépendance à l'ordre réel, stabilité à
  l'identifiant), l'assiette, l'ordre de tri.
- `tests/lib/server/ranking-service.test.ts` couvre aussi le **redatage** : une
  correction qui repousse `updated_at` rejoue le match en dernier, et le
  classement reste une fonction pure de ce que la base contient.
- `tests/lib/server/ranking-service.test.ts` — la collecte (assiette,
  chronologie, fenêtre de tendance, fenêtres refusées), la mutualisation et son
  invalidation, le découpage solo / non classées, `loadEntrantsBySiteRanking`, et
  le rejeu après correction de score.
- `tests/lib/server/team-points-consistency.test.ts` — l'ancre : un jeu de
  matchs, et la même cote lue sur la carte d'annuaire, sur la fiche, au
  classement et sur le leaderboard.
- `tests/lib/server/landing-leaderboard.test.ts` — égalité avec le chargeur
  partagé, équipes sans match, tendance, dégradation si la base tombe.
