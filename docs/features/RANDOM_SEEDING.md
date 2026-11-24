# Tirage au sort de l'ordre de départ (RANDOM-SEEDING)

Case du formulaire de tournoi, **décochée par défaut**, FR « Tirage au sort de
l'ordre de départ » / EN « Random starting order », avec son `<InfoHint>`
(`form.randomSeeding.*`, `RandomSeedingField`).

Allumée, l'ordre de départ (le seeding, `SEEDING_ORDER.md`) n'est ni l'ordre
d'inscription ni le classement du site : il est **tiré au sort à la clôture des
inscriptions**, une fois toutes les engagées connues. S'inscrire tôt ou tard ne
donne donc aucune place dans l'arbre. Le tirage fait les appariements du premier
tour dans tous les formats.

## Fenêtre

Un champ de l'édition comme la phase de lancement (`randomSeeding` dans
`RESTRICTED_FIELDS`, `lib/shared/tournament-edit.ts`) : modifiable à la création
et à l'édition **jusqu'au coup d'envoi**, figé ensuite (fenêtre `LOCKED`,
`TOURNAMENT_EDITING.md`). Il part avec le reste du formulaire (`PATCH` de
l'édition), validé par `validateTournamentInput` (`INVALID_RANDOM_SEEDING`,
rattaché au champ par `TOURNAMENT_FIELD_ERRORS`).

## Le tirage

Règles pures : `lib/shared/random-seeding.ts`. Écriture :
`drawRandomSeedingIfDue` (`lib/server/tournaments/random-seeding.ts`).

- **Quand** : dès que l'option est allumée, les inscriptions closes
  (`now > registration_close_at`) et le tournoi pas encore lancé (état stocké
  `UPCOMING` ou `REGISTRATION`) — `isRandomDrawDue`. Il se fait :
  - à l'entretien qui suit la clôture (`syncTournamentState` : la clôture est un
    jalon de calendrier, le balayage le visite — `TOURNAMENT_SYNC_SCOPE.md` ;
    un tirage dû sans changement d'état, clôture avancée dans le passé, est
    lui aussi visité : `findCrossedMilestones` et la reconstruction de
    l'instantané testent `isRandomDrawDue`) ;
  - au plus tard au coup d'envoi, **avant** que le premier tour soit posé (même
    appel, en tête de `syncTournamentState`) ;
  - à l'enregistrement de l'édition, quand l'option est allumée **après** la
    clôture (`applyRandomSeedingChange`, `lib/server/tournaments/edit.ts`).
- **Comment** : Fisher–Yates (`shuffleOrder`) sur `crypto.randomInt` — vrai aléa
  du système, sans biais de modulo. L'ordre tiré s'écrit dans
  `bg_tournament_registrations.seed` (1 à N) et pose `manual_seeding = 1` : tous
  les moteurs (élimination, Suisse, Survie, BG Survie, Multi) le lisent alors tel
  quel, sans code propre au tirage.
- **Une seule fois** : `random_seeding_drawn_at` date le tirage. Un tirage ne
  vaut que s'il **suit** la clôture (`randomDrawStatus` : `OFF` / `PENDING` /
  `DRAWN`) : une clôture repoussée après lui (inscriptions rouvertes) le rend
  caduc, et un nouveau tirage a lieu à la nouvelle clôture. La comparaison se
  fait **à la seconde** (`DATETIME` sans fraction, tronqué par MariaDB) : un
  tirage fait dans la seconde même de la clôture compte.
- **Sous verrou** : avant le départ (`writesRegistrations` : état stocké
  `UPCOMING`/`REGISTRATION`, lu hors transaction), les transactions d'entretien
  (balayage de fond, reconstruction de l'instantané) prennent le verrou du
  tournoi **en première instruction** — un tournoi en cours garde l'ordre de son
  entretien (matchs d'abord), qui croiserait sinon les gestes des joueurs — puis le tournoi et les inscriptions sont relus en lecture
  verrouillante (`FOR UPDATE`, table seule) : deux entretiens concurrents ne
  tirent jamais deux fois, et aucun ne poursuit sur un instantané d'avant le
  tirage de l'autre. Le pré-contrôle de
  `syncTournamentState` se fait sur la lecture ordinaire, pour ne prendre le
  verrou du tournoi que si un tirage semble dû. Un plateau déjà présent arrête
  tout : on ne réécrit jamais l'ordre d'un tirage joué.
- Un engagé retiré après le tirage (`ENTRANT_REMOVAL.md`) referme son trou sans
  changer l'ordre (`resequenceSeeds`).

## Éteindre l'option

Éteindre après un tirage ramène le tournoi à l'ordre par défaut de son format :
seeds remis dans l'ordre d'inscription, `manual_seeding` à 0 (ordre
d'inscription pour l'élimination, classement du site pour les formats à
classement) et `random_seeding_drawn_at` effacé — l'ordre tiré n'est pas un
ordre fixé par le staff, et le garder l'afficherait « Ordre fixé par le
staff ». Il se règle ensuite aux flèches. Éteindre avant tout tirage ne change
rien (un ordre manuel antérieur reste). La rallumer après la clôture refait un
tirage à l'enregistrement.

## Ce que l'écran montre

- **Ordre de départ** : `seedingSource` rend `RANDOM` (prioritaire sur `MANUAL`)
  — pastille « Tirage au sort » de la liste des inscrites, réglages du tournoi
  (`settings.seeding.RANDOM`), page de règles.
- **Flèches** : retirées tant que l'option est allumée (`seedingLockReason` →
  `RANDOM_DRAW`, phrase `registrations.lock.RANDOM_DRAW`) ; le serveur refuse en
  409 `SEEDING_LOCKED_RANDOM_DRAW`.
- **Après le tirage** : la phrase du verrou (`registrations.lock.RANDOM_DRAWN`,
  `seedingLockKey`) et le texte d'attente du plateau (`page.preLaunch.randomDrawn`)
  disent l'ordre tiré, non plus « à la clôture » ; la phrase du verrou prévient
  qu'éteindre l'option rend l'ordre par défaut. Un tirage fait par la
  reconstruction de l'instantané oublie l'aperçu et prévient les flux ouverts
  (`updated`, sans jeter l'instantané en cours, qui lit déjà le tirage).
- **Explication** derrière le « i » de la liste : tirage à venir
  (`registrations.randomPending` — la liste montre l'ordre d'inscription d'ici
  là) ou fait (`registrations.randomDrawn`).
- **Aperçu du premier tour** (`TOURNAMENT_PREVIEW.md`) : **aucun** tant que le
  tirage n'est pas fait (`loadTournamentPreview` rend `null`) — il montrerait un
  premier tour que le sort va défaire. Une fois tiré, l'aperçu montre l'ordre
  tiré, celui qui sera joué. Le texte d'attente du plateau dit le tirage
  (`page.preLaunch.random`).

## Stockage

`bg_tournaments.random_seeding TINYINT(1) NOT NULL DEFAULT 0` et
`random_seeding_drawn_at DATETIME NULL` (dans le `CREATE TABLE` et dans
`RECENT_SCHEMA_CHANGES`). Portés par la carte du tournoi (`randomSeeding`,
`randomSeedingDrawnAt`, publics : c'est une règle du tournoi).

## Données de test et RGPD

Seed : « Tirage au Sort (inscriptions) » (élimination simple, 6 inscrites,
option allumée). RGPD : rien de nouveau n'est collecté ni lu — l'option ne
change que l'ordre des engagées déjà inscrites ; pas d'entrée `PRIVACY_CHANGES`
ni de traitement nouveau au registre.

## Tests

- `tests/lib/shared/random-seeding.test.ts` — statut du tirage, échéance,
  mélange (permutation, entrée intacte, aléa invalide refusé).
- `tests/lib/server/random-seeding.test.ts` — tirage écrit (seeds, `manual_seeding`,
  date), rien avant la clôture, rien une fois tiré, rien sur un plateau existant.
- `tests/lib/shared/seeding.test.ts` — source `RANDOM`, verrou `RANDOM_DRAW`.
- `tests/tournois/seeding-service.test.ts` — refus `SEEDING_LOCKED_RANDOM_DRAW`.
- `tests/lib/server/tournaments-validation.test.ts` — `INVALID_RANDOM_SEEDING`.
