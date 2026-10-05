# Versionnage du site

La version du site vit dans `package.json` (et `package-lock.json`), au format [SemVer](https://semver.org/lang/fr/) `MAJEUR.MINEUR.CORRECTIF`. La première version publiée est **v1.0.0**.

## Comment la version monte

Le workflow `.github/workflows/version-bump.yml` se déclenche à la **fusion** d'une PR dans `main`, par le `push` sur `main` qu'elle produit. Il tourne dans le contexte du dépôt : une PR venue d'un fork est versionnée comme les autres, et aucun déclencheur privilégié (`pull_request_target`) ne risque d'extraire du code de PR avec un jeton en écriture. Un push direct sur `main`, sans PR, ne monte rien ; une PR dont le titre porte `[skip ci]` non plus (GitHub ne lance alors aucun workflow) :

1. il retrouve la PR fusionnée par l'API (`commits/<sha>/pulls`, trois essais) et lit le niveau sur ses **étiquettes** ;
2. extrait `main` à jour (pas le commit de fusion : une autre fusion a pu passer entre-temps) et lance `npm version <niveau> --no-git-tag-version` ;
3. commite `release vX.Y.Z (#N) [skip ci]` au nom de `github-actions[bot]` et pousse ce commit **et** le tag `vX.Y.Z` d'un seul push atomique ; en cas de refus (une autre fusion est passée), il repart de `main` à jour et recalcule la version, cinq essais au plus ;
4. publie la release GitHub avec `gh release create --generate-notes`.

Aucun groupe de concurrence global : GitHub n'y garde qu'une exécution en attente et **annule** les autres, si bien qu'un bump serait perdu sans erreur. Les fusions rapprochées se départagent au push atomique — deux versions successives, jamais deux fois la même. Un tag déjà existant fait échouer le job plutôt que d'écraser une release.

**Relancer un job** est sûr : si `main` porte déjà le commit `(#N)` de la PR, le job reprend cette version (tag reposé au besoin, release publiée si elle manque) au lieu d'en monter une seconde.

Pas de boucle : le commit de version porte `[skip ci]`, qui empêche son push de relancer ce workflow, et le job ignore les branches `release/*` et les PR ouvertes par `github-actions[bot]`. `[skip ci]` évite de rejouer le CI sur ce seul changement de numéro.

## Étiquettes

| Étiquette | Effet à la fusion |
|---|---|
| `release:major` | `X+1.0.0` |
| `release:minor` | `X.Y+1.0` |
| *(aucune)* | `X.Y.Z+1` (correctif, défaut) |
| `release:skip` | aucun bump, aucune release |

`release:skip` l'emporte sur les autres, `release:major` sur `release:minor`.

## Choisir le niveau

- **major** — changement **cassant** pour les utilisateurs, les données ou l'API : parcours supprimé ou profondément changé, migration irréversible (colonne supprimée, données effacées), route d'API retirée ou dont le contrat change, retour arrière impossible sans restauration.
- **minor** — **nouvelle fonctionnalité** visible : écran, mode de tournoi, réglage, route, notification.
- **patch** (défaut) — correctif, refonte interne, performance, dépendances, tests, documentation.
- **skip** — la PR ne doit pas produire de version (outillage de dépôt pur, ou PR qui fixe elle-même la version, comme celle qui a posé v1.0.0).

Les **notes de release** générées tiennent lieu de journal des modifications : elles listent les PR fusionnées depuis le tag précédent, d'où l'intérêt d'un titre de PR lisible.

## Jeton

Le job pousse avec `secrets.RELEASE_TOKEN` s'il existe, sinon avec le `GITHUB_TOKEN` du dépôt (`permissions: contents: write`). `main` n'a aujourd'hui ni protection de branche ni ruleset : le `GITHUB_TOKEN` suffit. Si une protection est posée un jour, il faudra soit autoriser GitHub Actions en contournement du ruleset, soit créer le secret `RELEASE_TOKEN` (PAT à droit `contents: write`) — ne jamais affaiblir la protection pour autant.
