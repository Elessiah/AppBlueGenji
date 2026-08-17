# Mode de tournoi « Ronde suisse »

Format à **classement, sans élimination** : toutes les équipes jouent le même
nombre de rondes, fixé à l'avance. À chaque ronde, on affronte une équipe ayant
un total de points proche du sien. Le classement final se lit aux points,
départagés par la difficulté du parcours.

Statut : **ouvert à la création** (`/regles/ronde-suisse`, `status: "AVAILABLE"`).

## Vue d'ensemble

| | |
|---|---|
| Format | `SWISS` |
| Équipes | 2 à 256 |
| Élimination | aucune |
| Rondes | fixées à la création (défaut : ⌈log₂(N)⌉ + 1) |
| Barème | réglable (défaut 3 / 1 / 0) |
| Seeding | classement du site (`lib/shared/ranking.ts`) |
| Abandon | oui (comme en Survie) |

## Où vit le code

| Fichier | Rôle |
|---|---|
| `lib/shared/swiss.ts` | Moteur pur : rejeu, points, départages, classement. |
| `lib/shared/swiss-pairing.ts` | Appariement pur : ronde 1 par seeding, rondes suivantes par retour sur trace. |
| `lib/server/tournaments/swiss.ts` | Orchestration : initialisation, génération des rondes, réconciliation, abandon, chargement de l'affichage. |
| `app/(secured)/tournois/[id]/_components/SwissView.tsx` | Classement + rondes en colonnes. |
| `lib/shared/tournament-rules.ts` | Règles publiques (`/regles/ronde-suisse`). |

Tables : `bg_tournaments` (colonnes `swiss_*`), `bg_swiss_standings`,
`bg_matches` (`round_number`, `is_bye`).

## Modèle d'état : rejeu, pas accumulation

Comme le mode Survie, **tout l'état est dérivé de l'historique des matchs** par
`replaySwiss` : points, victoires, nuls, défaites, victoires d'office,
adversaires rencontrés, rangs. Rien n'est incrémenté au fil de l'eau.

C'est ce qui rend une correction de score sûre : réécrire le vainqueur d'un match
**défait** l'ancien résultat au lieu de s'y ajouter, et le classement — donc les
appariements de la ronde suivante — se recalcule tout seul. L'implémentation
précédente accumulait (`points = points + ?`) et comptait deux fois toute
correction.

Deux entrées seulement échappent au rejeu, parce qu'elles ne se déduisent
d'aucun résultat :

- le **seed initial**, écrit à l'initialisation ;
- les **abandons**, qui sont des décisions humaines.

### Adversaires : programmés, pas joués

`replaySwiss` enregistre une rencontre dès que le match est **créé**, sans
attendre qu'il soit terminé. Sinon, la ronde en cours ne compterait pas dans
l'historique et le tirage pourrait réapparier deux équipes en train de
s'affronter.

En revanche, pour **apparier** la ronde R, l'état est rejoué sur les matchs des
rondes strictement antérieures (`SwissState.before(round)`). Apparier R à partir
de l'état courant serait circulaire : les paires déjà posées en R feraient partie
de l'historique, et le moteur refuserait de les reformer — il réappariait alors la
ronde à chaque réconciliation, indéfiniment.

## Appariement

### Ronde 1

Le seeding vient du classement du site, au même barème que le leaderboard de la
landing (victoire = 3, défaite = 1). La moitié haute affronte la moitié basse :
1 vs N/2+1, 2 vs N/2+2, … Les têtes de série ne s'éliminent donc pas entre elles
d'entrée.

### Rondes suivantes

Les équipes sont triées par points décroissants (puis seed, puis identifiant),
et appariées de proche en proche — les invaincues entre elles, etc.

L'appariement est résolu par **retour sur trace** et non gloutonnement. Un tirage
glouton (« je prends le premier adversaire libre ») échoue sur les dernières
équipes dès qu'un groupe de score s'est déjà entièrement rencontré : il produit
un rematch alors qu'une autre combinaison n'en produisait aucun. La recherche
explore les combinaisons dans l'ordre de préférence et retient la première
solution complète sans rematch ; faute de solution, elle relâche la contrainte
(un rematch vaut mieux qu'une ronde impossible à jouer). Un budget d'exploration
(`MAX_SEARCH_STEPS`) borne le coût sur les très gros effectifs bloqués.

### Effectif impair

Une équipe reçoit une **victoire d'office** valant exactement autant qu'une
victoire (`swiss_points_bye` est aligné sur `swiss_points_win` à la création,
pour que le bye ne soit ni un cadeau ni une punition). Elle va à l'équipe la plus
basse du classement n'en ayant pas encore reçu ; à défaut, à la dernière.

Contrairement au mode Survie, il n'y a **pas de barrage** : l'effectif ne décroît
pas, un bye par ronde est donc supportable et se répartit naturellement.

## Classement et départages

Le classement se fait aux points. À égalité, les départages s'appliquent dans
l'ordre stocké en `swiss_tiebreakers_json` (défaut :
`["buchholz", "sonneborn-berger", "opponent-mwp", "head-to-head"]`) :

| Départage | Calcul |
|---|---|
| Buchholz | somme des points des adversaires rencontrés |
| Sonneborn-Berger | somme des points des adversaires battus, moitié pour un nul |
| `opponent-mwp` | pourcentage de victoires moyen des adversaires (nul = demi-victoire) |
| `head-to-head` | résultat de la confrontation directe entre les équipes à départager |

En dernier ressort, le **seed initial** tranche : le classement est toujours
déterministe, jamais tiré au sort.

Les équipes ayant abandonné sont reléguées derrière toutes les équipes encore en
lice, quels que soient leurs points : elles n'ont pas joué le tournoi jusqu'au
bout. Elles conservent en revanche les points déjà acquis, qui continuent de
compter dans le Buchholz de leurs anciennes adversaires.

## Cycle de vie

1. **REGISTRATION → RUNNING** (`syncTournamentState`) : `initializeSwissTournament`
   pose les seeds et le nombre de rondes, `generateSwissRound` crée la ronde 1,
   `reconcileSwiss` clôt immédiatement un tournoi démarré à ≤ 1 équipe.
2. **Après chaque score** (report d'équipe, arbitrage, forfait, bye) :
   `reconcileSwiss` rejoue tout, persiste le classement, puis
   - si la ronde courante est incomplète : la réapparie si le classement a bougé
     et qu'aucun score n'y a été saisi ;
   - si elle est complète et que des rondes restent : crée la suivante ;
   - si toutes les rondes prévues sont jouées : écrit `final_rank` sur les
     inscriptions et passe le tournoi en `FINISHED`.

`reconcileSwiss` est **idempotent** et prend un verrou de ligne sur le tournoi
(`SELECT … FOR UPDATE`), ce qui sérialise deux reports simultanés clôturant la
même ronde — sans quoi la ronde suivante serait générée deux fois.

`finalizeTournamentIfDone` ignore le format `SWISS` (comme `SURVIVAL`) : le
classement générique par victoires écraserait le classement aux points, et une
ronde terminée ne clôt rien tant que le compte de rondes n'est pas atteint.

## Verrouillage des scores

Règle commune (`lib/shared/match-lock.ts`) : un score n'est plus modifiable — y
compris par un admin — dès que la ronde suivante porte la moindre saisie. En
suisse comme en survie, il n'y a pas de liens de bracket : **toutes** les rondes
ultérieures dépendent du résultat, puisque leurs appariements sont recalculés
depuis le classement.

## Abandon

`forfeitSwissTeam` résout le match en cours en faveur de l'adversaire, marque
l'équipe `FORFEIT` avec sa ronde de sortie, puis réconcilie. L'équipe n'est plus
appariée. La route `POST /api/tournaments/[id]/forfeit` est partagée avec la
Survie et aiguille sur le format ; côté client, `canForfeitTeam` autorise les
deux formats.

## Création d'un tournoi

Formulaire `/tournois/creer` :

- **Nombre de rondes** — pré-rempli avec ⌈log₂(capacité)⌉ + 1 et suivi
  automatiquement tant que l'organisateur n'a rien saisi ; une valeur saisie n'est
  plus écrasée par un changement d'effectif. Laissé vide côté API, le calcul est
  refait au démarrage sur l'effectif **réellement inscrit**.
- **Barème** victoire / nul / défaite. L'API refuse un barème où la victoire ne
  rapporte pas plus que la défaite (`INVALID_SWISS_POINTS`) : le classement — et
  donc les appariements — n'aurait plus de sens.

## Tests

| Fichier | Couverture |
|---|---|
| `tests/swiss/replay.test.ts` | Rejeu, barèmes, byes, nuls, abandons, départages, classement, tournoi complet à 8. |
| `tests/swiss/pairing.test.ts` | Seeding ronde 1, groupes de score, retour sur trace, byes, déterminisme, gros effectif impair. |
| `tests/swiss/orchestration.test.ts` | Cycle de vie sur base factice : génération, enchaînement, réappariement, idempotence, clôture, abandon. |
| `tests/tournois/forfeit-eligibility.test.ts` | Formats autorisant l'abandon. |
| `tests/lib/shared/match-lock.test.ts` | Verrouillage des scores en suisse. |
