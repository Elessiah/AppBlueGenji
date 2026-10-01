# Pages d'erreur et arrivée des ancres sous l'en-tête collant

## Pages d'erreur

Le site n'avait ni `not-found.tsx`, ni `error.tsx`, ni `global-error.tsx` :
toute URL inconnue et tout `notFound()` rendaient la 404 de Next — en anglais
(« This page could not be found. »), fond blanc imposé en thème clair, sans
en-tête ni lien de retour — et une erreur d'exécution son « Application error ».

| Fichier | Quand | Rendu |
| --- | --- | --- |
| `app/not-found.tsx` | URL inconnue, `notFound()` sans limite plus proche | `PublicPageShell` (en-tête, `<main>`, pied de page), « Page introuvable », liens vers l'accueil, les tournois et les règles ; titre « Page introuvable · BlueGenji Esport », `noindex` |
| `app/error.tsx` | erreur d'exécution d'une page | carte dans `<main>`, « Réessayer » (`router.refresh()` puis `reset()` — `reset()` seul rejouerait la réponse fautive) et retour à l'accueil, **référence** = `digest` de Next |
| `app/global-error.tsx` | erreur de la mise en page racine elle-même | document complet (`<html lang="fr">`), mêmes textes, « Réessayer » et retour par rechargement complet |

Les textes sont purs, dans `lib/shared/error-pages.ts` ; la carte est
`components/error-page/ErrorPanel.tsx`, sans état ni accès serveur, pour servir
à la fois un composant serveur (404) et les limites d'erreur (client).
`error.tsx` ne peut pas exporter de métadonnées : il rend un `<title>`
(`errorPageTitle`), que React remonte dans `<head>`. La référence affichée
n'est que l'empreinte `digest` (le message n'y renvoie que s'il y en a une — `runtimeErrorCopy`) — le message d'une erreur serveur est masqué en
production, et c'est l'empreinte qui la relie aux journaux pm2.

`error.tsx` n'a pas d'en-tête : `PublicHeader` est un composant serveur
asynchrone, qu'une limite d'erreur (client) ne peut pas rendre.

## Arrivée des ancres (WCAG 2.4.11)

Huit feuilles posaient `scroll-margin-top: 96px` sur leurs cibles d'ancre, alors
que l'en-tête collant mesure 110, 124 ou 134 px selon l'en-tête et la largeur :
le titre visé passait dessous (« Règles communes » du sommaire de
`/regles/[slug]`, sections de `/tournois`), et les ancres `#tournois` /
`#equipes` de l'accueil n'avaient aucune marge.

La hauteur est désormais **mesurée** :

- les deux en-têtes collants (`PublicHeader`, `ArenaNav`) portent
  `data-sticky-header` ;
- `components/sticky-header-offset.tsx`, monté dans la mise en page racine, le
  recherche dès qu'il a quitté le document (`MutationObserver` — l'en-tête
  change sans que le chemin change, page d'erreur puis « Réessayer »), suit sa
  taille (`ResizeObserver`, `resize`) et la pose sur `<html>` en
  `--sticky-header-h` (`lib/shared/sticky-header.ts` : arrondi au pixel
  supérieur, `0px` sans en-tête ou quand il n'est plus collant — sous 500 px
  de haut, les deux en-têtes repassent en `position: relative`) ;
- une seule règle, `html { scroll-padding-top: calc(var(--sticky-header-h,
  134px) + 16px) }`, vaut pour toute ancre, tout `scrollIntoView` et tout
  défilement de focus — lien d'évitement compris.

**Règle** : aucune cible ne pose de `scroll-margin-top` en pixels (il
s'ajouterait à la marge globale). `tests/app/sticky-header-offset.test.ts` le
balaie. Le sommaire collant des règles se pose à `--sticky-header-h`.

## Notes reprises de CLAUDE.md

Texte déplacé tel quel depuis `CLAUDE.md` (allègement du fichier chargé à chaque session).

- **Pages d'erreur et arrivée des ancres** (`app/not-found.tsx`, `app/error.tsx`, `app/global-error.tsx` + `lib/shared/error-pages.ts` ; `lib/shared/sticky-header.ts` + `components/sticky-header-offset.tsx`) : 404 et erreurs d'exécution en français, dans le thème du site, avec des chemins de retour (la 404 passe par `PublicPageShell`). Les ancres s'arrêtent sous l'en-tête collant par **une** règle, `html { scroll-padding-top }`, calée sur la hauteur **mesurée** de l'en-tête (`data-sticky-header` → `--sticky-header-h`) — jamais de `scroll-margin-top` en pixels sur une cible, un balayage le refuse. Voir `docs/features/ERROR_PAGES_AND_ANCHORS.md`.
