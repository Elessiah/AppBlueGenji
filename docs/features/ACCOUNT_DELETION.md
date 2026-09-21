# Suppression d'un compte

> **On efface ce qui ne laisse rien, on anonymise le reste.**
> `lib/shared/account-deletion.ts` (pur) + `deleteOwnAccount`
> (`lib/server/users-service.ts`).

## Le manque

La suppression n'avait qu'un seul geste : **anonymiser**. Le pseudo devient
`compte_supprime_<id>`, les identités (`google_sub`, `discord_id`,
`blizzard_sub`), les coordonnées de jeu et la certification partent, la ligne
reste avec `is_deleted = 1`.

C'est la bonne réponse pour un joueur qui a **joué**. Ses matchs, son palmarès
et le bilan de ses équipes se lisent sur des lignes qui le référencent : le
classement du site se rejoue depuis `bg_matches`, une équipe perdrait des
adversaires, une manche perdrait un engagé. L'effacer réécrirait l'histoire de
gens qui ne l'ont pas demandé.

Ce n'était pas la bonne réponse pour un compte **qui n'a rien laissé**. Un joueur
inscrit un soir, jamais engagé nulle part, repartait en laissant à l'annuaire une
ligne « compte_supprime_412 » pour toujours : rien à préserver, et une trace de
son passage qu'il venait précisément de demander d'effacer. Sur `/joueurs`, ces
lignes s'accumulaient en fin de liste — l'ordre est `is_deleted ASC, pseudo ASC` —
et comptaient dans « Profils référencés ».

## La règle

Un seul critère : **reste-t-il quelque chose qui référence ce compte et qui doit
survivre ?** Trois traces le disent, et aucune n'est décorative.

| Trace | Pourquoi elle retient la ligne |
| --- | --- |
| `tournaments` | Il a été **engagé** — par une équipe inscrite, ou par une entrée solo. C'est la trace qui porte des matchs, donc un classement, donc des points chez les autres. |
| `organizedTournaments` | Il a **créé** un tournoi. `bg_tournaments.organizer_user_id` est `NOT NULL` en `ON DELETE RESTRICT` : la base refuserait l'effacement, et un tournoi sans organisateur n'aurait plus de titulaire. |
| `ownedTeams` | Il est `OWNER` d'une équipe vivante. `bg_team_members` s'efface en cascade : l'effacer laisserait une équipe que personne ne peut plus renommer, dissoudre ni engager. |

Les deux dernières ne figuraient pas dans la demande et ne l'élargissent pas :
ce sont les cas où « effacer complètement » ne veut rien dire — la base refuse,
ou casse quelque chose d'autre.

La décision est **conservatrice** : dans le doute on anonymise, parce que les
deux erreurs ne se valent pas. Anonymiser à tort laisse une ligne de plus à
l'annuaire ; effacer à tort détruit ce que d'autres lisent, et rien ne le défait.

## L'effacement

Les cascades déjà déclarées font l'essentiel — sessions (`bg_user_sessions`),
appartenances (`bg_team_members`), invitations (`bg_team_invitations`, des deux
côtés) — et `bg_endurance_penalties.created_by` passe à `NULL`, la sanction
restant due.

Une seule table demande un geste : **`bg_site_visits`**, qui n'a
**aucune clé étrangère** (une cascade y effacerait l'historique de
fréquentation). Le lien est détaché plutôt que la ligne supprimée
(`SET user_id = NULL`) : ce qu'il faut retirer est le lien vers une personne, pas
le fait qu'une page ait été vue. Et **avant** l'effacement du compte, faute de
quoi la ligne ne serait plus retrouvable par `user_id`.

L'**entrée solo** compte comme un engagement *par elle-même* : `bg_teams
.solo_user_id` n'a volontairement pas de clé étrangère (une cascade effacerait
l'engagé, et avec lui l'historique des matchs), donc l'effacement du compte la
laisserait pendre sur un identifiant disparu.

Les trois questions sont posées en **une** requête, trois `EXISTS` indexés. Les
poser séparément laisserait un `await` entre elles : un tournoi créé entre la
deuxième et la troisième, et la ligne partirait quand même — sur une base qui la
refuse.

## Ce que le joueur lit

La confirmation **décrit ce qui va se passer**. Une phrase unique servait aux deux
cas et promettait la conservation des statistiques à des comptes qui n'en ont
aucune ; le joueur qui n'a jamais joué a droit à la vraie réponse — il ne restera
rien.

`GET /api/profile/deletion` rend le mode sans rien écrire, appelé **sur le chemin
de la suppression** et jamais au chargement du profil : la réponse ne change pas
quand la fiche change, et trois `EXISTS` à chaque visite pour une question que
presque personne ne pose seraient du gaspillage. Ce n'est pas une promesse :
`DELETE /api/profile` repose la question sur son propre instantané et **rend le
mode appliqué**, que le message de succès reprend. Un aperçu injoignable retombe
sur la phrase la plus prudente, celle qui promet le moins d'effacement.

## Les comptes anonymisés à l'annuaire

`/joueurs` les masque **par défaut**, derrière une case à cocher qui les compte
(`Comptes supprimés (3)`), rendue seulement s'il y en a. La case n'est pas un
filtre de plus : tout ce que la page montre ou compte descend de la même liste,
sans quoi elle changerait les cartes sans changer les compteurs qui les
surmontent.

Ils ne sont pas **retirés** de la réponse : c'est le seul moyen de retrouver un
adversaire d'un tournoi passé, et la ligne ne porte plus rien de personnel.
`listPlayers` rend donc `isDeleted`, et le filtre est côté client comme les
autres de cet écran.

## Voir aussi

- `docs/AUTHORIZATION_RULES.md` — qui peut supprimer quoi.
- `docs/features/SOLO_TOURNAMENTS.md` — pourquoi l'entrée solo survit à son joueur.
