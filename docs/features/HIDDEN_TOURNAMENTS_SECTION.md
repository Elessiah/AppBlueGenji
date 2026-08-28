# Section « Tournois invisibles »

La page `/tournois` ne montre que les tournois **déjà visibles** :
`listTournamentBuckets` filtre sur `bg_tournaments.start_visibility_at <= NOW()`.
Un tournoi programmé à l'avance n'apparaît donc nulle part — pas même pour le
staff qui doit le relire, en vérifier les dates ou corriger sa fiche avant
publication.

La section « Tournois invisibles » est ce chemin de retour. Elle est
**réservée au staff `tournaments`** (`ADMIN`, `ARBITRE` — voir
`PERMISSION_ROLES.md`) et contient **tous** les tournois pas encore visibles,
quel que soit leur organisateur.

## Portée

`listTournamentBuckets(searchTerm, scope)` prend une portée optionnelle :

| Portée | Filtre appliqué |
| --- | --- |
| `{}` (défaut) | `t.start_visibility_at <= NOW()` — la vue publique, inchangée |
| `{ hiddenOnly: true }` | `t.start_visibility_at > NOW()` |

Les deux portées sont **disjointes et complémentaires** : leur réunion est
l'ensemble des tournois, et aucun ne peut figurer dans les deux. Elles
partagent la même requête et le même `mapCard` — la section ne voit pas des
tournois « d'un autre genre », elle voit les mêmes cartes avec le filtre
inversé.

La fonction ne connaît aucune permission : c'est `GET /api/tournaments?scope=hidden`
qui garde la porte, en refusant `FORBIDDEN` (403) à qui n'a pas `can(user, "tournaments")`.
Le refus tombe **avant** la requête, donc rien n'est lu.

## Interface

`app/(secured)/tournois/page.tsx` charge la liste publique au montage, et la
liste invisible dans un **effet séparé**, conditionné à la permission :

- un joueur ne déclenche même pas la requête — elle lui serait refusée ;
- l'échec de la liste invisible n'emporte pas la liste publique, et
  réciproquement.

La section est rendue **en tête** et seulement s'il y a quelque chose à
montrer (`isAdmin && hiddenTournaments.length > 0`) : pas de tiroir vide quand
aucun tournoi n'est programmé. Les sections d'état se renumérotent alors de
`02` à `05`. La recherche et le filtre par jeu s'y appliquent comme partout
ailleurs, et les pastilles de jeu comptent les invisibles pour le staff — elles
décrivent ce que la page montre.

`flattenBuckets` (`app/(secured)/tournois/_lib/buckets.ts`) remet les quatre
paniers renvoyés par l'API à plat, dans l'ordre de lecture de la page. La
section rassemble en effet des tournois de **n'importe quel état** : `StateCard`
(`cards/StateCard.tsx`) aiguille chacun vers la carte de son état.

En pratique un tournoi invisible est toujours « à venir » — la création impose
`start_visibility_at <= registration_open_at`, et l'état reste `UPCOMING` tant
que les inscriptions ne sont pas ouvertes. Rien ne s'y fie pour autant : une
date reprise à la main sur un tournoi déjà lancé reste correctement rendue.

## Accès à la fiche

La section ne change rien aux droits : la fiche `/tournois/[id]` d'un tournoi
invisible était déjà accessible à tout utilisateur connecté qui en connaissait
l'identifiant. La visibilité gouverne le **listage**, pas la lecture.
