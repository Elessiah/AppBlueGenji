# Points d'équipe — une seule source

Une équipe affichait ses « points » à trois endroits, et les trois donnaient
trois nombres différents pour la même équipe :

| Vue | Barème | Assiette de matchs |
| --- | --- | --- |
| Carte d'annuaire `/equipes` | 3 par victoire, **+1 par défaite** | tous les matchs, byes compris, **multipliés par l'effectif** |
| Fiche d'équipe (`DeepStats`) | 100 par victoire, −20 par défaite | `playedMatchSql` (byes et matchs fantômes exclus) |
| Leaderboard de la landing | 100 par victoire, −20 par défaite | matchs `COMPLETED`, défaites lues sur `loser_team_id` |

Les trois se croisaient sous les yeux du même visiteur : la carte d'une équipe,
puis sa fiche au clic suivant.

## La cause

Trois défauts empilés, du plus grave au plus discret.

**1. Un produit cartésien.** `listTeams` agrégeait le bilan dans la requête qui
joint déjà les membres :

```sql
FROM bg_teams t
LEFT JOIN bg_team_members tm ON tm.team_id = t.id AND tm.left_at IS NULL
LEFT JOIN bg_matches m ON (m.team1_id = t.id OR m.team2_id = t.id)
```

Six membres × quatre matchs font vingt-quatre lignes : `SUM(...)` comptait donc
chaque victoire **une fois par membre**. `COUNT(DISTINCT tm.id)` protégeait
l'effectif, rien ne protégeait le bilan. Une équipe de six joueurs affichait six
fois ses victoires — un nombre qui n'avait plus de sens du tout, et qui grimpait
au recrutement d'un joueur.

**2. Un autre barème.** `points = wins * 3 + losses * 1` : non seulement une
autre échelle, mais une **défaite qui rapporte des points**. Le même signe
inversé que celui déjà corrigé entre le leaderboard et le seeding.

**3. Une autre assiette.** Les victoires n'étaient même pas filtrées sur
`status = 'COMPLETED'`, et personne n'écartait les byes ni les matchs fantômes —
que la fiche, elle, écarte depuis `PLAYED_MATCH_SQL`.

Le leaderboard de la landing, lui, avait le bon barème mais pas la bonne
assiette : il comptait les byes et lisait les défaites sur `loser_team_id`, que
le moteur ne renseigne pas toujours.

## La correction

Deux choses doivent être partagées pour que deux vues ne puissent pas diverger,
et un barème partagé ne suffit pas : posé sur deux assiettes différentes, il
rend encore deux nombres différents. `lib/shared/ranking.ts` porte donc les
deux.

| Fonction | Rôle |
| --- | --- |
| `rankingPoints` / `rankingPointsSql` | le **barème** — 100 par victoire, −20 par défaite |
| `playedMatchSql` / `PLAYED_MATCH_SQL` | l'**assiette** — terminé, non-bye, deux équipes réelles, un vainqueur |
| `rankingMatchJoinSql` | la jointure équipe ↔ matchs comptés |
| `rankingWinsSql` / `rankingLossesSql` | les agrégats — une défaite est « avoir joué sans gagner » |
| `rankingPointsForTeamSql` | les deux composés, pour un `ORDER BY` |
| `compareRankedTeams` | l'**ordre** — points, victoires, nom |

Le module reste pur : il ne produit que des chaînes SQL, dont les seules valeurs
interpolées sont ses propres constantes et les expressions passées par
l'appelant.

Au-dessus, un seul chargeur serveur : `loadTeamRanking`
(`lib/server/stats-service.ts`) rend une ligne par équipe — victoires, défaites,
points — déjà triée. Toutes les vues en descendent :

- l'annuaire `/equipes` (`listTeams`) y lit le bilan et les points de chaque
  carte, et n'agrège plus rien lui-même ;
- la fiche (`getTeamRankingPosition`) y lit la place, sur la même assiette que
  le bilan affiché juste au-dessus ;
- le leaderboard de la landing y lit ses lignes, et sa **tendance** : deux
  appels au même chargeur, dont l'un borné à une semaine en arrière
  (`completedMoreThanDaysAgo`) — la flèche compare deux photos du même calcul.
  La borne est exprimée en **jours** et posée par MySQL (`DATE_SUB(NOW(), …)`),
  jamais en date calculée côté application : les dates de match sont écrites par
  la base, une seconde horloge décalerait la fenêtre du seul écart de fuseau.

Les points sont posés en TypeScript par `rankingPoints`, jamais relus d'une
colonne SQL : la refonte du barème n'aura qu'un point de calcul à remplacer.

L'ordre, lui, se décide **en mémoire** (`compareRankedTeams`) : la collation
MySQL et `localeCompare("fr")` ne départagent pas les noms de la même façon, et
deux vues triées chacune de son côté finiraient par afficher deux ordres.

## Ce que la correction entraîne aussi

**Le seeding.** Survie, Suisse, Multi et l'aperçu du plateau réécrivaient chacun
les mêmes deux expressions `WINS` / `LOSSES` — avec `loser_team_id` et sans
écarter les byes. Ils passent par les fonctions partagées : un tournoi seede
désormais sur le classement que le site affiche.

**La barre de forme des cartes.** Elle se lisait sur les 1000 derniers matchs du
site, byes compris — au-delà, les équipes les moins actives n'avaient plus de
forme du tout. Elle sort maintenant de la même assiette et de la même
chronologie que la forme des fiches, découpée par équipe en SQL : la barre de la
carte est le début de celle de la fiche, pas une autre lecture des mêmes matchs.

## Ce qui reste volontairement différent

Le **rang** n'est pas le même nombre selon la vue, et c'est assumé :

- l'annuaire numérote **toutes** les équipes, y compris celles sans match ;
- la fiche ne classe que les équipes ayant joué (`total` les compte) ;
- le leaderboard ne montre que les premières.

Ce sont trois dénominateurs pour trois questions différentes. Ce qui ne doit pas
diverger, et ne le peut plus, c'est le **nombre de points d'une équipe**.

## Tests

- `tests/lib/shared/ranking.test.ts` — barème, assiette, agrégats, ordre.
- `tests/lib/server/team-points-consistency.test.ts` — l'ancre : un jeu de
  matchs, et le même nombre lu sur la carte d'annuaire, sur la fiche et au
  classement. Le fichier échoue dès qu'une vue se remet à calculer de son côté.
- `tests/lib/server/landing-leaderboard.test.ts` — barème, équipes sans match,
  fenêtre de tendance, dégradation si la base tombe.
- `tests/lib/server/stats-service.test.ts` — `loadTeamRanking` : tri, bornage,
  agrégats absents.
