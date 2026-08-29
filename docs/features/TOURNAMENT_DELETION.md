# Suppression définitive d'un tournoi

Un administrateur peut effacer un tournoi **pour de bon** : il disparaît du site
et de toutes ses vues dérivées, sans corbeille ni restauration.

La demande d'origine est littérale — « cette suppression le fait disparaître à
jamais de partout » — mais elle s'arrête aux données du tournoi : **aucune
équipe, aucun joueur, aucun compte n'est supprimé**. Les statistiques des
participants ne perdent que ce tournoi.

## Permission

C'est le **seul** point du projet où le contrôle porte sur `user.isAdmin` plutôt
que sur une permission scopée (`PERMISSION_ROLES.md`). Ce n'est pas un oubli :

- `can(user, "tournaments")` couvre `ADMIN` **et** `ARBITRE` — c'est le droit de
  *gérer* un tournoi (créer, arbitrer, seeder, inscrire une fantôme) ;
- supprimer n'est pas un acte de gestion mais le cran au-dessus : irréversible,
  et sans trace sur le site une fois fait.

Le drapeau `TournamentDetail.isAdmin` porte donc mal son nom (il vaut en réalité
`can(user, "tournaments")`). Un champ distinct, `TournamentDetail.canDelete`,
transporte le droit de suppression et n'est vrai que pour un administrateur.

| Rôle | Voit la zone de danger | `DELETE` accepté |
| --- | --- | --- |
| `ADMIN` | oui | 200 |
| `ARBITRE` | non | 403 |
| `CASTER`, autres, joueur | non | 403 |
| Anonyme | — | 401 |

## Ce qui est supprimé

`purgeTournamentRows` (`lib/server/tournaments/deletion.ts`) efface, dans cet
ordre et en une transaction, **les seules tables portant un `tournament_id`** :

| Étape | Table | Raison de l'ordre |
| --- | --- | --- |
| 1 | `bg_matches` (UPDATE) | désarme `next_winner_match_id` / `next_loser_match_id`, les matchs se pointant entre eux |
| 2 | `bg_tournament_phase_teams` | sa clé étrangère passe par `phase_id`, pas par le tournoi |
| 3 | `bg_swiss_standings` | |
| 4 | `bg_survival_standings` | |
| 5 | `bg_endurance_standings` | |
| 6 | `bg_matches` (DELETE) | |
| 7 | `bg_tournament_phases` | après les matchs qui les référencent |
| 8 | `bg_tournament_registrations` | |
| 9 | `bg_tournaments` | la racine |

Les suppressions sont **écrites explicitement** plutôt que laissées aux cascades
`ON DELETE CASCADE` du schéma. Le schéma les couvrirait presque toutes, mais la
liste explicite est la spécification relisible de ce qui part, et elle ne dépend
pas de l'ordre dans lequel MySQL propage une cascade en chaîne.

## Ce qui n'est jamais supprimé

| Objet | Pourquoi il survit |
| --- | --- |
| Équipes et joueurs | hors périmètre : la demande porte sur le tournoi |
| Équipes fantômes (`is_ghost`) | entités gérées par le staff, réutilisées d'un tournoi à l'autre (`GHOST_TEAMS.md`) |
| Entrées solo (`solo_user_id`) | **une seule ligne par joueur**, partagée par tous ses tournois individuels (`SOLO_TOURNAMENTS.md`) — l'effacer casserait les autres |

## Disparition « de partout », sans code de propagation

Rien n'est à nettoyer ailleurs : palmarès, bilan de maps, séries, adversaire
favori, place au classement du site, leaderboard, calendrier, ticker et
`findBroadcastingTournament` se recalculent **tous** depuis `bg_matches` et
`bg_tournament_registrations` (`DEEP_STATS.md`, `LIVE_STREAMS.md`). Effacer ces
lignes efface le tournoi de chacune de ces vues.

## Confirmation

`window.confirm`, le motif employé partout ailleurs, se clique par réflexe. Ici
la confirmation exige de **recopier le nom du tournoi**, à la manière d'un dépôt
supprimé sur une forge.

La règle vit dans `lib/shared/tournament-deletion.ts` (module pur) :
`isDeletionConfirmed(nom, saisie)` rogne les bords et replie les suites
d'espaces — un nom recopié depuis le titre de la page a déjà subi ce repli au
rendu HTML — mais **conserve casse et accents**, qui font tout l'intérêt d'une
recopie. Un nom vide ne confirme jamais rien.

Aucune restriction d'état : `UPCOMING`, `REGISTRATION`, `RUNNING` et `FINISHED`
sont tous supprimables. La confirmation par recopie est le garde-fou.

## Parcours

```
/tournois/[id] ─ bas de page ─ « Zone de danger » (si canDelete)
      │
      └─ dialogue ─ recopie du nom ─ DELETE /api/admin/tournaments/[id]
                                          │
                                          ├─ purge transactionnelle
                                          ├─ événement SSE `deleted`
                                          └─ log bot (seule trace restante)
                                                    │
      redirection vers /tournois ◄──────────────────┘
```

La zone de danger est isolée en bas de page, sous la frise de progression, loin
des actions courantes.

## Événement `deleted`

`TournamentLiveEvent` gagne un type `deleted`, publié après le commit. Les
onglets restés ouverts sur la fiche ne doivent surtout **pas** recharger : l'API
répondrait 404 et n'afficherait qu'un toast d'erreur de chargement. Le hook
`useTournamentLive` coupe donc le flux et lève un drapeau `deleted`, que la page
traduit en avertissement puis en redirection vers `/tournois`.

L'administrateur qui supprime et l'événement SSE déclenchent la même sortie ;
une garde (`hasLeftRef`) fait que le premier des deux l'emporte, sans double
notification.

## Fichiers

| Rôle | Fichier |
| --- | --- |
| Logique pure (confirmation) | `lib/shared/tournament-deletion.ts` |
| Service (purge transactionnelle) | `lib/server/tournaments/deletion.ts` |
| Route | `app/api/admin/tournaments/[id]/route.ts` (`DELETE`) |
| Droit exposé au client | `TournamentDetail.canDelete` (`lib/shared/types.ts`) |
| Interface | `app/(secured)/tournois/[id]/_components/DeleteTournamentDialog.tsx` + zone de danger dans `page.tsx` |
| Flux temps réel | `lib/server/live.ts` (type `deleted`), `_hooks/useTournamentLive.ts` |

## Codes d'erreur

| Code | Statut | Cas |
| --- | --- | --- |
| `UNAUTHORIZED` | 401 | visiteur non connecté |
| `FORBIDDEN` | 403 | connecté mais pas administrateur (arbitre inclus) |
| `INVALID_TOURNAMENT_ID` | 400 | identifiant non entier ou ≤ 0 |
| `TOURNAMENT_NOT_FOUND` | 404 | aucun tournoi pour cet identifiant |
| `TOURNAMENT_DELETE_FAILED` | 500 | échec inattendu (transaction annulée) |
