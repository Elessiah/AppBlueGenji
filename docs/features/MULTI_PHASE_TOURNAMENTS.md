# Tournoi multi-phases (format `MULTI`)

Format composite : un tournoi est une **suite ordonnée de phases**, chacune jouée
dans son propre format, chacune ne transmettant que ses **qualifiées** à la
suivante. La dernière phase désigne la championne.

Exemple de référence — 128 équipes : ronde suisse qui réduit à 64, survie qui
réduit à 16, double élimination finale.

## Règles

1. **Phases** — de 2 à 8 (`MIN_PHASES` / `MAX_PHASES`). Chaque phase a un format
   parmi `SWISS`, `SURVIVAL`, `SINGLE`, `DOUBLE`, ses propres réglages (cadence de
   survie, nombre de manches suisses, petite finale) et sa cible de qualification.
2. **Seeding** — la phase 1 est seedée par le **classement du site**, au barème
   partagé de `lib/shared/ranking.ts` (le même que la survie et le leaderboard de
   la landing). Chaque phase suivante est seedée par le **rang obtenu dans la
   phase précédente** : seed 1 = meilleure qualifiée, et non plus le classement
   de site initial.
3. **Qualification** — deux modes, qui répondent à deux besoins différents :
   - **Nombre fixe (`COUNT`)** — la cible est un seuil. Si l'effectif réel est
     déjà inférieur ou égal à la cible, la phase **est sautée** (`skipReason`
     `NO_CUT`) et les équipes passent telles quelles à la phase suivante. C'est le
     comportement voulu sur un tournoi sous-rempli : on saute purement et
     simplement un mode devenu inutile.
   - **Pourcentage (`PERCENT`)** — la cible **s'adapte** à l'effectif réel
     (arrondi vers le haut). La phase se joue toujours ; elle ne saute pas.
   La décision de saut se prend sur la cible **demandée**, avant tout ajustement
   (voir §4) : sans quoi une phase d'élimination simple serait insautable, puisque
   64 → 32 « coupe » toujours quelque chose.
4. **Élimination simple intermédiaire** — un bracket tronqué ne peut laisser
   qu'une **puissance de deux** de survivantes. La cible d'une phase `SINGLE` non
   finale est donc arrondie **à la puissance de deux inférieure** (20 → 16), et la
   phase ne joue que `maxRounds = log2(bracketSize / qualifiées)` manches. Les
   équipes encore en lice à l'issue de ces manches sont les qualifiées.
5. **Double élimination** — autorisée **uniquement en phase finale**
   (`DOUBLE_MUST_BE_LAST_PHASE`). Son tableau des perdants est un repêchage, pas
   un mécanisme de coupe : l'utiliser comme phase qualificative n'a pas de sens.
6. **Survie qualificative** — la survie coupe **à sa cadence** (deux équipes par
   coupe, une seule en effectif impair), le nombre de qualifiées servant de
   **plancher** : `teamsToEliminate` ne descend jamais sous la cible. Elle ne
   saute donc pas directement au seuil — la cadence réglée par l'organisateur
   garde son sens.
7. **Effectif dégénéré** — dès qu'une phase reçoit 0 ou 1 équipe, elle est sautée
   (`TOO_FEW_TEAMS`). Si toutes les phases le sont, le tournoi se clôt
   immédiatement (rang 1 à l'unique inscrite le cas échéant).
8. **Classement final** — les équipes sont ordonnées par la **phase la plus
   avancée atteinte** (décroissant), puis par leur **rang dans cette phase**. Les
   équipes sorties en phase 1 sont donc dernières.

## Paramètres (création)

Le payload `POST /api/tournaments` porte `format: "MULTI"` et un tableau `phases`.
L'**ordre du tableau fait foi** : la position n'est pas envoyée par le client,
elle est déduite du rang (`normalizePhaseConfigs`). Cela évite qu'une position
erronée contredise l'ordre affiché à l'écran.

Chaque entrée : `format`, `qualifierMode` (`COUNT` | `PERCENT`), `qualifierValue`,
et selon le format `swissTotalRounds`, `survivalRoundsBeforeFirstCut`,
`survivalRoundsPerCut`, `hasThirdPlaceMatch`.

Codes d'erreur (400) : `MISSING_PHASES`, `INVALID_PHASE_FORMAT`,
`DOUBLE_MUST_BE_LAST_PHASE`, `INVALID_QUALIFIER_VALUE`, `INVALID_QUALIFIER_COUNT`
(une phase qualifie plus que celle qui la précède), `INVALID_SURVIVAL_ROUNDS`,
`INVALID_SWISS_ROUNDS`.

## Architecture

- **`lib/shared/tournament-phases.ts`** — logique **pure**, sans base : résolution
  du plan (`resolvePhasePlan`), cible d'une phase (`resolvePhaseQualifiers`),
  validation (`validatePhases`), normalisation (`normalizePhaseConfigs`) et
  description française pour l'aperçu du formulaire (`describePhasePlan`).
- **`lib/server/tournaments/phases.ts`** — orchestration :
  `initializeMultiTournament` → `startPhase` → `reconcilePhases` →
  `finalizeMultiTournament`.
- **`lib/server/tournaments/phases-repository.ts`** — persistance des phases et de
  leurs rosters.

### Modèle de données

| Table | Rôle |
|---|---|
| `bg_tournament_phases` | Une ligne par phase : format, cible, réglages, état (`PENDING`/`RUNNING`/`FINISHED`/`SKIPPED`), effectifs résolus, compteurs de manches |
| `bg_tournament_phase_teams` | Roster d'une phase : `seed`, `rank` obtenu, `qualified` |
| `bg_tournaments.current_phase_id` | Phase active |
| `bg_matches.phase_id` | Rattachement d'un match à sa phase (**0** = tournoi sans phases) |
| `bg_swiss_standings` / `bg_survival_standings` | `phase_id` ajouté à la clé primaire — une même équipe peut jouer plusieurs phases |

Le sentinelle `phase_id = 0` est ce qui rend la migration sans risque : tous les
tournois existants le portent, et chaque requête scopée par phase les retrouve
inchangés.

### Cycle de vie

1. `REGISTRATION → RUNNING` déclenche `initializeMultiTournament` : seeding,
   résolution du plan, marquage des phases sautées, démarrage de la première
   phase jouable.
2. Chaque saisie de score appelle `reconcilePhases` dans la **même transaction**.
   La ligne du tournoi est verrouillée (`FOR UPDATE`) pour sérialiser deux
   réconciliations concurrentes.
3. Quand le moteur de la phase se déclare terminé, son **classement** est écrit
   (`savePhaseResults`), la phase passe `FINISHED`, puis le **plan restant est
   re-résolu à partir du nombre réel de qualifiées** — des abandons peuvent rendre
   une phase suivante inutile, qui devient `SKIPPED` à la volée.
4. La phase suivante démarre avec les qualifiées seedées par leur rang, et
   `reconcilePhases` récurse une fois (une phase instantanément complète enchaîne
   sans attendre une nouvelle saisie).
5. Sans phase suivante, `finalizeMultiTournament` écrit `final_rank` pour **toutes**
   les inscrites (§7 des règles) et clôt le tournoi.

Une phase `SINGLE`/`DOUBLE` fait **résoudre ses byes avant** d'être testée pour
complétude, et cette résolution est **portée par la phase** : les appels du reste
du moteur (`reportMatchScore`, résolution admin, synchronisation d'état) opèrent
sur `phase_id = 0`, où un tournoi `MULTI` n'a aucun match. Sans cela, un match
d'exemption — qui n'a pas de perdant — laissait le match de lower qu'il alimentait
avec une seule équipe et plus aucun feeder à attendre : le plateau se figeait sur
des matchs `PENDING` sans adversaire, la phase n'était jamais complète et le
tournoi ne se terminait jamais.

Le classement d'une phase provient **toujours du moteur** de cette phase
(`computeFinalRanks` en survie, `loadSwissRanking` en suisse,
`rankEliminationPhase` en bracket) — jamais de l'ordre des standings en base, qui
reste l'ordre de seeding tant que les rangs ne sont pas écrits.

## Verrouillage des scores

`lib/shared/match-lock.ts` applique deux règles cumulées :

- **intra-phase** — la règle du format **de la phase** (liens de bracket en
  élimination, tout round ultérieur en survie et en suisse) ;
- **inter-phases** — toute phase **ultérieure** dépend de celle-ci, puisque son
  plateau est constitué de ses qualifiées.

Serveur (`checkDownstreamMatchesHaveNoScores`) et interface consomment le même
module, de sorte que le verrou affiché et le verrou appliqué ne peuvent pas
diverger.

## Interface

- **Création** (`app/(secured)/tournois/creer/`) — constructeur de phases
  modulaire : cartes repliées par défaut (une seule dépliée), réordonnancement par
  boutons ↑/↓ étiquetés, ajout/suppression en un clic, et aperçu en direct du plan
  résolu contre l'effectif maximal annoncé.
  L'en-tête d'une carte (`PhaseCard`) est un **conteneur non interactif** : le
  repli/dépli est un bouton porté par le seul intitulé (`aria-expanded` +
  `aria-controls` vers le corps `phase-body-<position>`, région toujours présente
  dans le document pour que la référence désigne un élément réel), et les flèches
  d'ordre comme la suppression sont ses **frères**. Un `<button>` englobant
  aurait fait des trois commandes ses descendants — du HTML invalide, que React
  signale à l'hydratation et où ni le clavier ni un lecteur d'écran ne
  distinguent plus « déplier la phase » de « supprimer la phase ».
- **Détail** (`app/(secured)/tournois/[id]/`) — timeline horizontale des phases ;
  la phase sélectionnée pilote la vue affichée (survie, bracket ou suisse) et le
  **bouton flottant d'aide**, qui renvoie aux règles du mode réellement à l'écran
  (`visibleRulesFormat`).
- **Règles publiques** — `/regles/multi-phases`.

## Cas limites gérés

- Tournoi sous-rempli : phases `COUNT` sautées en cascade, l'effectif descend
  intact jusqu'à la première phase utile.
- Abandons en cours de phase : le plan restant est re-résolu, une phase devenue
  inutile passe `SKIPPED` sans intervention.
- 0 ou 1 inscription : clôture immédiate, rang 1 attribué le cas échéant.
- Réconciliations concurrentes : verrou de ligne, idempotence (aucun double
  démarrage de phase, aucun doublon de matchs).
- Tournois à format unique : `phase_id = 0` partout, tous les chemins de code
  conservent leur comportement d'origine.
