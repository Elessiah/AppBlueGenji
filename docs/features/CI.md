# CI GitHub Actions

`.github/workflows/ci.yml`, avec l'action commune `.github/actions/setup/` (Node 20 + `node_modules`). Le bump de version à la fusion est à part : `VERSIONING.md`.

## Déclencheurs

- **PR vers `main`/`develop`** (ouverte, poussée, rouverte, sortie de brouillon) : la vérification. Une PR en brouillon ne joue rien.
- **Push sur `main`** (fusion) : lint, build et tests rejouent le code fusionné et **remplissent les caches** ; le job E2E n'y fait que remplir celui de Chromium, sans lancer de test. GitHub ne laisse une PR lire que les caches de sa branche et de `main` — jamais ceux d'une autre PR : sans ce passage, la première exécution de chaque PR partirait à froid. Une poussée de documentation seule (`docs/**`, `*.md`, `ERREUR.txt`, `LICENSE`, `NOTICE`) ne déclenche rien ; le commit de version porte `[skip ci]`.
- `concurrency` : une nouvelle poussée annule l'exécution en cours de la même PR ; sur `main`, les exécutions s'enchaînent sans s'annuler.

## Jobs joués selon les fichiers modifiés

Le job `changes` lit la liste des fichiers de la PR (API GitHub, anciens chemins des renommages compris) et la passe à `scripts/ci-changed-jobs.cjs`, **extrait de la base de la PR** : une PR qui modifie le tri ne choisit pas elle-même ce qu'elle doit passer.

| Job | Joué quand la PR touche |
| --- | --- |
| Lint (+ typecheck) | un fichier `.ts`, `.tsx`, `.js`, `.jsx`, `.mjs`, `.cjs`, `.json`, ou `eslint-rules/` |
| Build | `app/`, `components/`, `lib/`, `messages/`, `public/`, un `.css`, `tsconfig.json`, `postcss.config.*`, et **tout `.ts`/`.tsx` hors `tests/`** (`tsconfig.json` les inclut : `next build` les type-vérifie en TypeScript 5) |
| E2E | ce qui joue le build, plus `e2e/` |
| Test (Jest) | toujours — les tests lisent aussi la documentation |

**Tout joue** dès qu'une incertitude se présente : `.github/`, `scripts/ci-*`, `package.json` ou `package-lock.json` modifiés, liste illisible (API en panne), vide, ou au plafond de 3 000 fichiers de l'API. Le tri ne doit jamais laisser passer au vert ce qu'il n'a pas lu : un script en erreur fait échouer le job `changes` (`shell: bash`, donc `pipefail`), et les portes sont écrites `!= 'false'` — un `changes` réussi sans sortie fait jouer le job. Un `changes` **en échec** écarte tous les jobs (Test compris) mais la PR reste rouge : aucun contrôle n'est requis par le ruleset de `main`, il faut donc lire ce rouge avant de fusionner. Les chemins passent en JSON (`@json`), un nom à saut de ligne ou caractère de contrôle fait tout jouer. Une base sans script de tri (la PR qui l'ajoute, un renommage) fait tout jouer aussi. Un job écarté apparaît « Skipped » sur la PR. Ajouter un dossier compilé par Next ou lu par l'E2E = l'ajouter au script et à son test (`tests/scripts/ci-workflow.test.ts`).

## Caches et doublons

- **`node_modules`** tel quel, clé = OS + Node 20 + **empreinte des dépendances** (`scripts/ci-deps-hash.cjs`) : `npm ci --ignore-scripts` (~50 s par job) n'a lieu qu'au changement des dépendances. L'empreinte lit `package.json` et le verrou **sans le numéro de version du paquet** — le bump à la fusion le réécrit dans les deux, et chaque PR serait repartie à froid. `package.json` y compte : une dépendance ajoutée sans verrou à jour change la clé, et `npm ci` refuse le désaccord au lieu d'un vert sur l'ancien `node_modules`. Les clés ESLint, Next et Jest reprennent cette empreinte.
- **ESLint** (`.next/cache/eslint`) en `--cache-strategy content` : un checkout neuf change toutes les dates, la stratégie par défaut ne retrouverait rien. Mesuré : 3 min 30 à froid, 10 s à chaud. Sûr parce qu'aucune règle ne lit les types d'un autre fichier — à revoir si une règle typée (`parserOptions.project`) arrive.
- **Next** (`.next/cache`) pour le build ; **Jest** (cache de transformation ts-jest, `$RUNNER_TEMP/jest-cache`) par moitié de tests ; **Chromium** de Playwright, clé = version de Playwright. Un Chromium restauré se passe d'`apt` : l'image `ubuntu-24.04` porte ses bibliothèques.
- Clés à `github.sha` + `restore-keys` : chaque exécution repart du dernier cache et enregistre le sien.
- `next build --no-lint` : le job Lint passe déjà ESLint (sur plus de dossiers). La vérification TypeScript 5 de Next reste dans le build.
- Tests Jest répartis sur deux machines (`--shard`, `fail-fast: false` : une moitié rouge n'interrompt pas l'autre).
- Chaque job a un `timeout-minutes`.

## Sécurité

- Une PR (même venue d'un fork) ne lit que les caches de sa branche et de `main`, et n'écrit que dans les siens ; seul le push sur `main`, code fusionné, écrit ceux de `main`. C'est ce qui permet de restaurer `node_modules` (et les caches Jest/Next, du code transformé) sans la vérification d'intégrité de `npm ci`.
- En conséquence, **l'action `.github/actions/setup` et ces caches ne s'utilisent jamais depuis un déclencheur privilégié** (`pull_request_target`, `workflow_run`, `issue_comment`…) : du contenu non fiable écrirait alors dans la portée de `main`.
- Risque accepté : une PR peut remplir le quota de 10 Go de caches du dépôt et évincer ceux de `main` (les PR suivantes repartent à froid, sans atteinte à l'intégrité).
- `permissions: {}` au niveau du workflow, puis par job : `contents: read` partout, `pull-requests: read` en plus pour `changes` seul ; aucun secret n'est exposé au CI. Les actions sont épinglées par SHA de commit, version en commentaire — mettre à jour les deux workflows ensemble (`version-bump-wiring.test.ts` l'exige).
