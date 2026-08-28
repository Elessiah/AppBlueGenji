# Aperçu du plateau pendant les inscriptions

Le staff a besoin de **voir le tournoi avant qu'il existe** : pour ordonner le
seeding en connaissance de cause, et pour que le cast puisse se placer sur les
matchs à diffuser.

Deux façons de le permettre étaient possibles : ouvrir une **phase de
préparation** entre la clôture des inscriptions et le lancement, ou afficher un
**aperçu vivant** pendant les inscriptions. C'est le second qui est retenu :
une phase de préparation ne se paierait qu'en rognant la fenêtre d'inscription,
et elle figerait une image qui vieillirait à la première désinscription.
L'aperçu, lui, ne coûte rien au calendrier et se recalcule à chaque inscription.

**Il n'écrit rien.** Aucun match, aucun classement, aucune colonne : il lit les
inscriptions à l'instant où on l'affiche. Le tournoi reste exactement dans
l'état où il était.

## Qui le voit

| Permission | Rôles | Aperçu | Réordonner le seeding |
| --- | --- | --- | --- |
| `tournaments` | `ADMIN`, `ARBITRE` | oui | oui |
| `casting` | `ADMIN`, `ARBITRE`, `CASTER` | oui | non |
| — | joueurs, autres rôles | non | non |

`casting` est une **permission de lecture seule**, introduite pour le cast : le
rôle `CASTER` n'ouvre rien d'autre. L'arbitre l'obtient par construction — qui
gère le tournoi voit forcément son plateau.

Le champ est calculé côté serveur : `TournamentDetail.preview` vaut `null` pour
qui n'y a pas droit. Rien n'est filtré côté client, un joueur ne peut donc pas
lire le tirage d'avance en inspectant la réponse.

## Quand il existe

`preview` n'est rempli que pour un tournoi **pas encore lancé** (`UPCOMING` ou
`REGISTRATION`). Dès `RUNNING`, le vrai plateau est la seule vérité : afficher
en plus ce qu'il « aurait été » n'apporterait que de la confusion.

## Fidélité au moteur

L'aperçu ne serait pas seulement inutile mais **nuisible** s'il montrait autre
chose que le tirage réel. Il réutilise donc les fonctions pures du moteur, sans
en réimplémenter aucune :

| Format | Appariement prévisualisé | Source |
| --- | --- | --- |
| `SINGLE` / `DOUBLE` | 1er tour, têtes de série placées, byes visibles | `bracket-seeds.ts` |
| `SWISS` | ronde 1, moitié haute contre moitié basse | `planFirstRound` |
| `SURVIVAL` | round 1, couples adjacents, barrage si effectif impair | `planSurvivalRound` |
| `BG_SURVIE` | manche 1, couples adjacents, dernière au repos si impair | `planEnduranceRound` |
| `MULTI` | plan des phases résolu + 1re phase **non sautée** | `resolvePhasePlan` |

`nextPowerOfTwo` / `generateSeedOrder` vivaient dans `lib/server/serialization.ts`,
inaccessible depuis le navigateur. Ils sont déplacés dans
[`lib/shared/bracket-seeds.ts`](../../lib/shared/bracket-seeds.ts) et
**réexportés** par `serialization` : les appelants serveur n'ont pas bougé, et
les deux chemins partagent désormais une seule implémentation — c'est ce que
vérifie `tests/lib/shared/bracket-seeds.test.ts`.

## Ordre de seeding affiché

L'aperçu applique la règle du moteur, pas la sienne (cf.
[`SEEDING_ORDER.md`](SEEDING_ORDER.md)) :

| `seedingSource` | Quand | Ordre |
| --- | --- | --- |
| `MANUAL` | `manual_seeding = 1` | colonne `seed`, fixée par le staff |
| `REGISTRATION` | `SINGLE` / `DOUBLE` / `BG_SURVIE` sans réordonnancement | colonne `seed` = ordre d'arrivée |
| `RANKING` | `SWISS` / `SURVIVAL` / `MULTI` sans réordonnancement | classement du site (`lib/shared/ranking.ts`) |

La requête de classement est **la même** que celle de
`initializeSwissTournament`, `initializeSurvivalTournament` et
`initializeMultiTournament` — barème, départages et tri compris.

Conséquence à connaître : sur un format à classement, le bloc « Seeding »
affiche l'ordre d'inscription alors que l'aperçu affiche le classement du site.
Ce n'est pas une incohérence — l'ordre saisi ne prend effet qu'au **premier**
réordonnancement, qui bascule `manual_seeding` à 1. L'aperçu le dit
explicitement quand le cas se présente.

## Mise à jour en direct

Aucun mécanisme nouveau : `registerCurrentUserTeam` et `registerGhostTeam`
publiaient déjà l'événement `updated`, que la page consomme par SSE
(`useTournamentLive`) pour recharger le détail. Comme l'aperçu voyage **dans**
`TournamentDetail`, il se rafraîchit avec lui — une inscription, et les
appariements bougent à l'écran sans rechargement.

## Ce qui est signalé

Le module pur renvoie des `notes` en français, adaptées à l'effectif courant :
plateau incomplet et nombre d'exemptions, victoire d'office sur effectif impair,
barrage d'ouverture en survie, équipe au repos en BlueGenji Survie, cadence des
coupes, nombre de rondes, phases qui seraient sautées. En dessous de deux
engagés, il n'y a pas d'appariement à montrer et l'aperçu le dit — c'est
exactement le seuil auquel le moteur lui-même refuse de générer un plateau.

## Surfaces

| Élément | Emplacement |
| --- | --- |
| Logique pure | [`lib/shared/tournament-preview.ts`](../../lib/shared/tournament-preview.ts) |
| Placement des seeds | [`lib/shared/bracket-seeds.ts`](../../lib/shared/bracket-seeds.ts) |
| Orchestration | [`lib/server/tournaments/preview.ts`](../../lib/server/tournaments/preview.ts) |
| Exposition | `TournamentDetail.preview` (`GET /api/tournaments/[id]`) |
| Interface | `app/(secured)/tournois/[id]/_components/BracketPreview.tsx` |
| Permission | `casting` / rôle `CASTER` ([`PERMISSION_ROLES.md`](PERMISSION_ROLES.md)) |

## Tests

- `tests/lib/shared/tournament-preview.test.ts` — appariements des cinq formats,
  byes, barrage, repos, plan multi-phases, effectifs dégénérés.
- `tests/lib/shared/bracket-seeds.test.ts` — placement des seeds et unicité de
  l'implémentation partagée avec le moteur.
- `tests/tournois/preview-service.test.ts` — ordre lu selon le format et
  `manual_seeding`, réglages repris, phases chargées, états sans aperçu.
- `tests/app/api/tournaments/detail-preview.test.ts` — qui a droit à l'aperçu.
- `tests/lib/shared/permissions.test.ts` — périmètre du rôle `CASTER`.
