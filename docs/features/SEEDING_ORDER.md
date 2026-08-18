# Ordre de seeding réordonnable

Le **seeding** est l'ordre des équipes inscrites à un tournoi. Il décide des
appariements de la première manche dans tous les formats : haut de tableau
contre bas de tableau en élimination et en ronde suisse, couples adjacents en
survie, plateau initial en multi-phases.

Le staff (`can(user, "tournaments")`) peut le réordonner avec des flèches ↑ / ↓
depuis la page du tournoi.

## Fenêtre d'édition

L'ordre reste modifiable **jusqu'à la première saisie de score**, ce qui couvre
la demande « ordonner avant que le tournoi soit visible pour les joueurs » : dès
la création, avant l'ouverture des inscriptions, pendant celles-ci, et même
après le lancement tant que personne n'a reporté de score.

Le verrou réutilise `hasScoreInput` de `lib/shared/match-lock.ts` : compte comme
saisie un score (même 0), un vainqueur, un forfait ou un report en attente. Les
byes et matchs fantômes sont ignorés — leur score est posé par le moteur.

Deux raisons de verrouillage, exposées à l'interface :

| `lockReason` | Sens |
| --- | --- |
| `null` | encore modifiable |
| `SCORES_ENTERED` | au moins un match porte une saisie |
| `FINISHED` | tournoi terminé |

## Qui lit l'ordre

`bg_tournament_registrations.seed` est la source de vérité. Le drapeau
`bg_tournaments.manual_seeding` arbitre le comportement par défaut :

| Format | `manual_seeding = 0` (défaut) | `manual_seeding = 1` |
| --- | --- | --- |
| `SINGLE` / `DOUBLE` | ordre des seeds (déjà le cas avant) | idem |
| `SWISS` | classement du site (`lib/shared/ranking.ts`) | ordre des seeds |
| `SURVIVAL` | classement du site | ordre des seeds |
| `BG_SURVIE` | ordre des seeds (toujours) | ordre des seeds |
| `MULTI` (phase 1) | classement du site | ordre des seeds |

Tant que personne n'a réordonné, chaque format garde donc exactement le
comportement qu'il avait.

## Reconstruction du plateau

Si des matchs ont déjà été générés (tournoi lancé mais vierge de scores), ils
décrivent l'ancien ordre : `reorderSeeding` les supprime, remet les rangs à zéro
et réamorce le format.

- `SINGLE` / `DOUBLE` : `bracket_size` repasse à `NULL`, et l'entretien de
  `syncTournamentState` régénère le plateau.
- `SWISS` / `SURVIVAL` / `BG_SURVIE` / `MULTI` : réinitialisation explicite
  (leur amorçage n'a lieu qu'à la transition REGISTRATION → RUNNING, déjà
  passée). Pour `MULTI`, l'état des phases est d'abord purgé — équipes de phase,
  états, compteurs et `current_phase_id` — sans quoi `startPhase` serait rejoué
  sur une phase déjà marquée RUNNING avec un plateau mélangé.

## Surfaces

| Élément | Emplacement |
| --- | --- |
| Logique pure | `lib/shared/seeding.ts` |
| Orchestration | `lib/server/tournaments/seeding.ts` |
| API | `GET` / `PATCH /api/admin/tournaments/[id]/seeding` |
| Interface | `app/(secured)/tournois/[id]/_components/SeedingEditor.tsx` |

`PATCH` attend `{ teamIds: number[] }` — la liste **complète** des inscrites dans
le nouvel ordre. Toute liste qui n'est pas une permutation exacte est refusée
(`INVALID_SEED_ORDER`, 400) : sans ce contrôle, un réordonnancement pourrait
faire disparaître une équipe du tournoi. Ordre figé → `SEEDING_LOCKED` (409).

## Tests

- `tests/lib/shared/seeding.test.ts` — verrou, déplacement, validation d'ordre.
- `tests/tournois/seeding-service.test.ts` — écriture des seeds, reconstruction
  du plateau, refus (verrou, permutation invalide, tournoi inconnu).
- `tests/app/api/admin/seeding.test.ts` — permissions et codes d'erreur.
