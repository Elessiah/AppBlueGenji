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
`can(user, "tournaments")`). Un champ distinct, `canDelete`, transporte le droit
de suppression et n'est vrai que pour un administrateur.

Il vit dans le **contexte du lecteur** (`TournamentViewerContext`) et non dans
l'instantané partagé : celui-ci est diffusé tel quel à toute la salle du flux,
un droit n'y a pas sa place (`REALTIME_REFRESH.md`). Il voyage donc par les
**deux portes** — la route du flux (`stream/route.ts`) et la lecture REST de
secours —, sans quoi la zone de danger n'apparaîtrait qu'après une coupure du
direct. Et parce que le flux ne transporte que l'instantané, `applyLiveMessage`
reporte `canDelete` d'une version à l'autre : sans ce report, la zone de danger
disparaîtrait au premier score rapporté.

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
                                          ├─ publishUpdatedEvent()
                                          └─ log bot (seule trace restante)
                                                    │
      redirection vers /tournois ◄──────────────────┘
```

La zone de danger est isolée en bas de page, sous la frise de progression, loin
des actions courantes. Elle est retirée quand le suivi est arrêté (`frozen`),
comme toutes les autres actions.

Le dialogue est rendu dans un **portail** sur `document.body`. La page vit dans
`.page-shell`, qui pose `position: relative; z-index: 1` : tout ce qu'elle
contient est enfermé sous la barre de navigation (`z-index: 50`), quelle que
soit la valeur déclarée sur la modale. Sans le portail, l'en-tête recouvrait le
titre du dialogue. Conséquence à retenir : `useDialogBehavior` reçoit
`open: mounted` et non `open: true` — déclenché avant le montage du portail, il
ne trouverait rien à focaliser.

## Ce que voient les autres lecteurs

**Aucun événement dédié n'a été ajouté.** La suppression passe par le point de
publication commun, `publishUpdatedEvent` (`tournaments/notifications.ts`), et
cela suffit :

1. il **vide les caches** — instantané, aperçu et listes. Sans cette étape, le
   tournoi supprimé resterait affiché dans `/tournois` jusqu'à cinq minutes ;
2. il **réveille la salle** du flux, qui ne retrouve plus d'instantané et
   **termine** les connexions plutôt que de laisser chacun devant un plateau
   figé estampillé « Direct » ;
3. la lecture REST de secours du client voit alors le 404 et le traduit en échec
   définitif : la boucle de reconnexion s'arrête et la page affiche « Tournoi
   introuvable » avec un retour vers `/tournois`.

C'est la règle du flux : il ne dit jamais *pourquoi* il tombe, c'est la lecture
de secours qui tranche (`REALTIME_REFRESH.md`). Un type d'événement `deleted`
aurait dupliqué un chemin déjà éprouvé.

L'administrateur qui supprime, lui, n'attend pas ce détour : le dialogue le
renvoie vers `/tournois` dès la réponse.

## Fichiers

| Rôle | Fichier |
| --- | --- |
| Logique pure (confirmation) | `lib/shared/tournament-deletion.ts` |
| Service (purge transactionnelle) | `lib/server/tournaments/deletion.ts` |
| Route | `app/api/admin/tournaments/[id]/route.ts` (`DELETE`) |
| Droit exposé au client | `TournamentDetail.canDelete` (`lib/shared/types.ts`) |
| Interface | `app/(secured)/tournois/[id]/_components/DeleteTournamentDialog.tsx` + zone de danger dans `page.tsx` |
| Report du droit dans le flux | `app/(secured)/tournois/[id]/_lib/live-state.ts` (`applyLiveMessage`) |

## Codes d'erreur

| Code | Statut | Cas |
| --- | --- | --- |
| `UNAUTHORIZED` | 401 | visiteur non connecté |
| `FORBIDDEN` | 403 | connecté mais pas administrateur (arbitre inclus) |
| `INVALID_TOURNAMENT_ID` | 400 | identifiant non entier ou ≤ 0 |
| `TOURNAMENT_NOT_FOUND` | 404 | aucun tournoi pour cet identifiant |
| `TOURNAMENT_DELETE_FAILED` | 500 | échec inattendu (transaction annulée) |
