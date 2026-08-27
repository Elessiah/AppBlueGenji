# Onglet « Mes tournois »

La page `/tournois` ne montre que les tournois **déjà visibles** :
`listTournamentBuckets` filtre sur `bg_tournaments.start_visibility_at <= NOW()`.
Un tournoi programmé à l'avance n'apparaît donc nulle part — pas même pour
celui qui vient de le créer, qui n'avait aucun moyen de le relire ou d'en
vérifier les dates sans connaître son identifiant.

L'onglet « Mes tournois » est ce chemin de retour : il liste les tournois dont
l'utilisateur est l'organisateur (`bg_tournaments.organizer_user_id`),
**visibles ou non**.

## Portée

`listTournamentBuckets(searchTerm, scope)` prend une portée optionnelle :

| Portée | Filtre appliqué |
| --- | --- |
| `{}` (défaut) | `t.start_visibility_at <= NOW()` — la vue publique, inchangée |
| `{ organizerUserId }` | `t.organizer_user_id = ?` — **sans** filtre de visibilité |

Les deux portées partagent la même requête, le même `mapCard` et le même
`syncVisibleTournaments()` : l'onglet ne voit pas des tournois « d'un autre
genre », il voit les mêmes cartes avec un filtre différent.

L'identifiant d'organisateur vient **de la session**, jamais d'un paramètre du
client : `GET /api/tournaments?scope=mine` ne peut retourner que les tournois de
l'appelant. Il n'existe pas de portée « les tournois d'un autre ».

## Interface

`app/(secured)/tournois/page.tsx` charge les deux listes en parallèle au
montage. La seconde décide de tout :

- **l'onglet n'existe que si elle n'est pas vide** — un joueur qui n'a jamais
  créé de tournoi ne voit aucun changement sur la page ;
- l'onglet actif pilote les sections, les compteurs de la barre de métriques et
  les pastilles de filtre par jeu. Le bandeau défilant reste sur la vue globale :
  c'est une actualité de plateau, pas une vue personnelle.

Dans l'onglet « Mes tournois », `splitHiddenTournaments`
(`lib/shared/tournament-visibility.ts`, pur) sort les tournois masqués des
paniers d'état et les regroupe dans une section « PAS ENCORE VISIBLES » placée
en tête — la raison d'être de l'onglet est de les trouver, pas de les chercher.
Ils ne sont donc **pas** répétés dans leur section d'état, et les sections
suivantes se renumérotent (`02` à `05`).

Un tournoi masqué est en pratique toujours « à venir » — la création impose
`start_visibility_at <= registration_open_at`, et l'état reste `UPCOMING` tant
que les inscriptions ne sont pas ouvertes. La séparation ne s'y fie pas pour
autant : `StateCard` (`cards/StateCard.tsx`) aiguille vers la carte de l'état
réel, de sorte qu'une date reprise à la main sur un tournoi déjà lancé reste
correctement rendue.

Une date de visibilité illisible compte comme visible : mieux vaut afficher le
tournoi dans sa section d'état que le faire disparaître dans un tiroir.

## Accès à la fiche

L'onglet ne change rien aux droits : la fiche `/tournois/[id]` d'un tournoi non
visible était déjà accessible à tout utilisateur connecté qui en connaissait
l'identifiant. La visibilité gouverne le **listage**, pas la lecture.
