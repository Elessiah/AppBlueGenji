# Workflow

Texte déplacé tel quel depuis `CLAUDE.md` (allègement du fichier chargé à chaque session).

## Règles de travail

### Tests
- Chaque feature développée doit être accompagnée d'une couverture de tests complète et efficace (`npm test`).
- Les tests doivent couvrir les cas nominaux, les cas limites et les cas d'erreur.
- Aucune feature n'est considérée comme terminée sans ses tests associés.
- **Deux TypeScript cohabitent** : `typescript` (5.x) est celui que chargent Next (`next build`), ts-jest et typescript-eslint — aucun des trois n'accepte encore TypeScript 7, dont le compilateur réécrit en Go n'expose plus l'API JavaScript qu'ils appellent ; `typescript-native` (alias npm de `typescript@^7`) ne sert qu'à `npm run typecheck`, environ sept fois plus rapide. Les deux paquets fournissent un binaire `tsc` et celui que retient `node_modules/.bin` dépend de l'ordre d'installation : les scripts désignent donc leur compilateur **par chemin** (`node node_modules/<paquet>/bin/tsc`), jamais par `tsc` ni `npx tsc`. Deux réglages de configuration tiennent la cohabitation, écrits pour être lus pareil par les deux versions : `noUncheckedSideEffectImports: false` dans `tsconfig.json` (défaut de TypeScript 6+, qui refuserait `import "./globals.css"`, Next ne déclarant que les `*.module.css`), et aucun `moduleResolution` dans `tsconfig.jest.json` (`node`, c.-à-d. node10, a été retiré en TypeScript 7). Le passage complet attendra que ts-jest et typescript-eslint acceptent la version 7.
- **Les tests sont type-vérifiés** (`npm run typecheck`, configuration `tsconfig.typecheck.json`) : `tsconfig.json` exclut `tests/` et ts-jest ne fait que transpiler, si bien qu'un millier d'erreurs s'y étaient accumulées sans bruit — fixtures périmées (un champ ajouté au type n'était jamais reporté dans les fabriques de test) et contrats écrits au type (`@ts-expect-error`) qui ne vérifiaient rien. Une fabrique rend donc l'objet **complet** du type du jour. Quatre pièges de `@jest/globals` : un `jest.fn()` sans type fait de `mockResolvedValue(x)` un paramètre `never` — d'où les ~1 350 `x as never` qui taisaient le type de chaque valeur simulée, désormais tous retirés, et qu'un balayage refuse (`tests/test-hygiene/typed-mock-values.test.ts`) : une fonction importée se simule par `jest.mocked(fn)` (ou `jest.fn<typeof fn>()`), qui vérifie la valeur contre son vrai type de retour, et un **double SQL** par `jest.fn<SqlQuery>()` (`tests/helpers/sql-double.ts`), dont la valeur est `unknown` — des lignes que seul le SQL décrit n'ont pas de type à opposer, et `unknown` admet sans rien affirmer là où `never` taisait tout ; le pool ou la connexion partiels passent par `fakePool` / `fakeConnection` / `connectionMock` ; `it.each([...] as const)` est refusé (tuples `readonly`), la table se type par `it.each<[A, B]>([...])` ; et `Partial<LigneMysql>` refuse tout littéral à cause du `constructor` de `RowDataPacket` — `RowOverrides<T>` (`tests/helpers/row-overrides.ts`) le retire ; enfin, depuis Jest 30, `toHaveBeenCalledWith` confronte ses arguments à la signature de la fonction simulée, et un double partiel de connexion (`{ execute, … }`) s'y passe `as never`. Une `TournamentCard` ou un `BracketMatch` de test part de `tournamentCard()` / `bracketMatch()`, une ligne de base de `tournamentRow()` / `matchRow()` / `phaseRow()` / `registrationRow()` (`tests/helpers/tournament-rows.ts` — colonnes **toutes requises**, signatures d'index de `RowDataPacket` retirées, défauts calés sur ceux des colonnes), un compte de `authUser()` / `publicUserProfile()` / `fullProfileResponse()`, une fiche d'équipe de `teamDetailResponse()`, un instantané de `tournamentSnapshot()` / `tournamentDetail()` (`tests/helpers/`) : une fabrique locale n'écrit que ses valeurs propres, un champ ajouté au type ne se reporte qu'une fois. La migration en a montré le prix : des fixtures partielles passaient par accident — `registration_min_players` absent valait `NaN`, donc aucun effectif minimal, et deux tests d'inscription n'étaient verts que pour cela ; un `AuthUser` de test portait encore `email` et `platformRoles`, retirés du type depuis.

### Branches
- Pour chaque demande de feature, créer une branche dédiée : `feature/<nom-de-la-feature>` (kebab-case, anglais de préférence).
- Exemple : `feature/swiss-pairing`, `feature/discord-login`.

### Pull Requests
- À l'achèvement d'une feature, ouvrir une Pull Request vers `main`.
- Si le CI de la PR échoue, tenter de corriger automatiquement dans cet ordre : lint → build → tests.
- Si une erreur ne peut pas être corrigée automatiquement, l'expliquer clairement et proposer une piste de résolution.

### CI / Qualité
- Le CI GitHub Actions (`.github/workflows/ci.yml`) vérifie à chaque PR : lint (+ `npm run typecheck`) → build → tests (dans cet ordre, enchaînés via `needs:`).
- Ne pas merger si le CI est rouge.

### Erreurs préexistantes (`ERREUR.txt`)
- Toute erreur rencontrée mais **non réglée parce qu'elle préexiste** à la tâche en cours (bug déjà présent sur `main`, hors périmètre de la feature) doit être consignée dans `ERREUR.txt`, à la racine du dépôt, pour être traitée plus tard.
- Ne jamais élargir silencieusement le périmètre d'une tâche pour corriger un problème préexistant : le noter dans `ERREUR.txt`, le signaler dans le résumé de fin, puis poursuivre.
- Une entrée par erreur, ajoutée à la fin du fichier, au format :
  ```
  - [AAAA-MM-JJ] <fichier:ligne ou zone> — <symptôme observé> — <cause supposée / piste> — (rencontré sur : <branche ou PR>)
  ```
- Avant d'ajouter une entrée, vérifier qu'elle n'y figure pas déjà ; le cas échéant, compléter l'entrée existante plutôt que d'en créer une seconde.
- Retirer l'entrée du fichier dans le commit qui règle enfin l'erreur.

### Accessibilité (`ACCESSIBILITE.md`)
- Tout problème d'accessibilité **repéré au cours du développement** (contraste, focus, nom accessible, rôle ARIA, titre de page, langue, ordre de tabulation, cible trop petite…) et **non réglé dans la PR en cours** — parce qu'il préexiste ou sort du périmètre — s'ajoute à `ACCESSIBILITE.md`, à la racine du dépôt, pour être retravaillé plus tard. Même règle que `ERREUR.txt` : ne pas élargir la tâche en silence, consigner, le signaler dans le résumé de fin, poursuivre.
- Une section par problème, **à la suite**, au format du fichier : titre, **Critère** (WCAG / RGAA), **Constat** (fichier et symptôme), **À faire**. Vérifier d'abord qu'il n'y figure pas déjà ; le cas échéant, compléter la section existante.
- **Choisir ou ajouter une tâche ne se fait plus dans une PR : cela se pousse sur `main` sur-le-champ.** Numéroter dans la branche de feature faisait prendre le même « numéro suivant » à deux sessions parallèles, et la collision ne se voyait qu'au merge — une fois que chacune avait déjà désigné sa tâche par ce numéro. Deux gestes passent donc par un commit direct sur `main`, qui ne touche **que** `ACCESSIBILITE.md`, poussé **avant** d'écrire la moindre ligne de code :
  - **Sélectionner des tâches à résoudre** : `git fetch origin` puis partir de `origin/main` à jour, **retirer du fichier** la section de chaque tâche retenue, commiter (`take a11y tasks N, M`), pousser vers `main` — **puis seulement** créer la branche de feature et résoudre. Une tâche absente du fichier ne peut plus être choisie par une autre session. Si le push est refusé, récupérer `main` et revérifier que les tâches y figurent toujours avant de repousser : si l'une a disparu, une autre session l'a prise. Garder le texte de la section (constat, à faire) dans la description de la PR, puisqu'il ne vit plus dans le fichier.
  - **Ajouter une tâche** : même chemin, le numéro étant pris sur `main` **au moment du push** — celui qui suit le « dernier numéro attribué » noté en tête du fichier, avancé dans le même commit. Un push refusé se rejoue avec le numéro relu. Les numéros ne sont jamais réattribués.
- La PR qui règle le problème n'a donc **rien** à retirer du fichier. Une tâche abandonnée ou réglée seulement en partie y est **remise** par un nouveau commit direct sur `main`, sous son numéro d'origine.

### Gestion de la complexité
- Pour toute demande importante (≥ 2 features liées, refactoring architectural, intégration d'un nouveau service externe, ou tâche estimée > ~2h), établir d'abord un plan écrit (étapes ordonnées, fichiers touchés, points de vérification), puis l'exécuter dans cette session.
- Ne pas déléguer ce travail à un pipeline d'exécution externe ou à un modèle local (`/OpusLocalManager`, `/opus-haiku-pipeline`) : la planification et l'exécution restent dans la session courante.

### Dépôt voisin `blueGenjiBot`

Une partie du travail de ce projet se fait dans le dépôt du bot (`../blueGenjiBot`, surchargeable par `BOT_DOCS_PATH`). Deux obligations y suivent le code, et elles ne se recouvrent pas :

- **La doc Markdown du bot est en ligne sans déploiement.** `doc/*.md`, `help.md` et `helpfr.md` sont lus **à chaud** par `lib/server/bot-docs.ts` et publiés sur `/bot/docs` (registre `BOT_DOC_SECTIONS`, revalidation 60 s). Toucher une commande du bot sans corriger son Markdown met le site en contradiction avec le bot dans la minute qui suit — aucun rebuild ne fait écran, et aucun test ne le verra.
- **La référence JSDoc (`docs/`) se régénère dans la même PR que le code.** Toute PR du bot qui touche `src/` — ajout, renommage, suppression d'un module, ou réécriture d'un bloc JSDoc — vide `docs/` puis relance `npm run docs`, et commite le résultat **à part** (chaque page porte son horodatage de génération, l'arbre entier ressort modifié à chaque passage). Sans le ménage préalable, la page d'un module supprimé survit indéfiniment. Détail des pièges : section « Documentation » du `CLAUDE.md` du bot.

Ne pas confondre les deux dossiers : `doc/` est le Markdown servi par le site, `docs/` la référence HTML générée.

---

## Pipeline Git (workflow de livraison)

Chaque tâche : quatre commits sur une branche de feature, puis une revue de PR.

**Règle Co-Authored-By :**
- **Tous** les commits (fonctionnel, docs, tests, polish) portent un trailer `Co-authored-by: <modèle> <noreply@anthropic.com>`.
- **`<modèle>` est le modèle qui écrit réellement le commit**, jamais une valeur recopiée : `Claude Opus 5`, `Claude Sonnet 5`, `Claude Opus 4.8`, selon le cas. Cette ligne a longtemps nommé `Claude Opus 4.8` en dur, et elle a continué d'être suivie à la lettre bien après : des commits écrits par un autre modèle portent donc une attribution fausse. Un co-auteur inexact vaut moins qu'aucun — c'est précisément ce que le trailer sert à dire.
- Se relire sur ce point **au premier commit d'une session**, pas au cinquième : quatre commits à réécrire, c'est un historique qu'on ne corrige plus.

Enchaîner la pipeline **sans s'arrêter** : ne pas attendre de validation de l'utilisateur après le commit fonctionnel — dérouler les commits, le push et la PR d'affilée.

Ajouter le trailer avec `git commit --trailer 'Co-authored-by: <modèle> <noreply@anthropic.com>'` — par exemple `git commit --trailer 'Co-authored-by: Claude Opus 5 <noreply@anthropic.com>'`.

1. **Branche de feature** : `git checkout -b feature/<short-name>`
2. **Commit fonctionnel** : ≤ 5 mots, impératif minuscule — `add swiss pairing` — *avec Co-Authored-By*
3. **Commit docs** : README / JSDoc limité à ce qui a été construit — *avec Co-Authored-By*
4. **Commit tests** : `jest` — *avec Co-Authored-By*
5. **Commit polish UI/UX** : espacements, états, accessibilité — aucun changement de logique — *avec Co-Authored-By*. Tout problème d'accessibilité repéré pendant la tâche et **non réglé** dans la PR s'ajoute à `ACCESSIBILITE.md` par un commit poussé directement sur `main`, pas dans ce commit (voir « Accessibilité » plus haut) ; les tâches que la PR règle en ont déjà été retirées sur `main` au moment de leur sélection.
6. **Push** : `git push -u origin feature/<short-name>`
7. **Revue de PR — en boucle jusqu'à zéro finding** : ouvrir la PR (`gh pr create`), puis lancer une revue du diff avec `/code-review --comment` pour poster les retours en **commentaires inline** sur la PR.

   **SonarQube avant et après les cycles de revue — exigence maximale sur tous les axes** : lancer `npm run sonar` **avant** le premier cycle de `/code-review` (pour partir d'un état mesuré et corriger d'emblée ce qu'il remonte), puis de nouveau **après** le dernier cycle sans finding.

   **Aucun jeton à demander ni à fournir — ne jamais en réclamer à l'utilisateur.** L'instance est **locale** : conteneur Docker `sonarqube` sur `http://localhost:9000`, que le script démarre lui-même s'il est arrêté (Docker Desktop doit tourner). `scripts/sonar-scan.mjs` s'y authentifie avec le compte d'administration local (`admin`/`admin`), tire un jeton d'analyse **temporaire**, lance le scanner par l'image Docker `sonarsource/sonar-scanner-cli`, puis révoque le jeton. Il fait tout le reste : couverture Jest (`coverage/lcov.info`), analyse, attente du traitement, puis **rapport** des critères ci-dessous — chaque problème avec son fichier, sa ligne et sa règle. Code de sortie : **0** tous les critères tenus, **1** au moins un ne l'est pas (le rapport dit lequel), **2** l'analyse n'a pas pu avoir lieu (message d'échec : Docker arrêté, serveur injoignable…). Options : `npm run sonar -- --skip-coverage` réutilise la couverture déjà produite (itérations rapides — la clôture se fait **sans** cette option) ; `-- --fresh-baseline` rejoue l'analyse de référence.

   **« Nouveau code » = ce que la branche change par rapport à `origin/main`**, et rien d'autre. L'édition Community n'analyse pas de branches : chaque branche a son propre projet (`appbluegenji-<branche>`), dont la première analyse porte sur le merge-base avec `origin/main` — le script s'en charge, et la rejoue seul si la branche est rebasée (le projet est alors recréé : les justifications déjà posées dans SonarQube sont à reposer). Les problèmes du code existant n'y figurent donc pas ; ils relèvent d'`ERREUR.txt`.

   L'analyse de clôture doit satisfaire, **sur le nouveau code** de la PR, chacun des critères suivants — aucun n'est négociable contre un autre :
   - **Quality Gate au vert** ;
   - note **A** en **fiabilité**, en **sécurité** et en **maintenabilité** ;
   - **zéro problème ouvert**, toutes sévérités confondues (bugs, vulnérabilités, *code smells* — y compris mineurs et informatifs) ;
   - **100 % des *security hotspots* examinés**, chacun corrigé ou justifié par écrit dans SonarQube ;
   - **couverture de tests ≥ 80 %** et **duplication ≤ 3 %** ;
   - aucun problème fermé par « Accepté » / « Faux positif » sans justification écrite dans le commentaire du problème (interface `http://localhost:9000`, compte `admin`/`admin`, projet de la branche) — marquer un vrai problème comme faux positif pour passer le seuil est interdit, et corriger reste toujours le premier geste.

   Critère non tenu → corriger, commiter, pousser, **relancer un cycle de revue complet** (une correction peut en appeler d'autres), puis une nouvelle analyse, jusqu'à ce que tous le soient. Un problème qui préexiste à la tâche (hors du nouveau code) suit la règle d'`ERREUR.txt` plutôt que d'élargir la PR, et est mentionné dans le résumé de fin.

   **Cycler la revue** : corriger les points remontés, commiter, pousser, puis **relancer une revue complète**. Répéter jusqu'à ce qu'un cycle ne remonte plus aucun finding. Une seule passe ne suffit pas : les corrections d'un cycle en révèlent d'autres, et les zones non couvertes par le premier passage doivent l'être par les suivants.

   **Cycles thématiques** : une fois la boucle propre, une PR qui ajoute ou modifie une fonctionnalité passe trois cycles UI/UX, sécurité et performance, chacun relancé jusqu'à revenir propre ; documentation ou texte légal seul → un cycle juridique à la place ; renommage seul → aucun ; changements critiques → deux cycles standard consécutifs propres. Détail : `docs/REVIEW_CYCLES.md`.

   Ne rendre la main à l'utilisateur qu'une fois la boucle standard **et** les cycles thématiques dus terminés **sans finding** (deux cycles standard consécutifs pour un changement critique), une analyse SonarQube de clôture — lancée après le **dernier** de ces cycles, thématiques compris — satisfaisant **tous** les critères ci-dessus, et `npm test`, `npm run lint` et `npm run typecheck` verts.

   **Valider aussi en conditions réelles** : les tests simulent MySQL et ne peuvent pas détecter une colonne manquante ou une requête invalide. Lancer `npm run seed` avant de conclure — c'est le seul contrôle qui exerce réellement les migrations et le SQL. (Le worktree a besoin d'une copie du `.env` du dépôt parent ; il est déjà couvert par `.gitignore`.)
