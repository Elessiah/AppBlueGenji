# Grands écrans et tableau des données /rgpd

## Annuaires larges (`.page-wide`)

Sur un écran 2K et au-delà, la colonne de l'espace connecté (`.page-shell`,
1200 px) laissait plus de la moitié de l'écran vide sur la liste des tournois et
l'annuaire des équipes, et leurs commandes tenaient sur deux rangées.

- La racine de ces deux pages porte la classe globale **`page-wide`**
  (`app/(secured)/tournois/TournamentsList.tsx`, `app/(secured)/equipes/page.tsx`).
- Au-delà de **1800 px** de fenêtre, `app/globals.css` élargit `.page-shell`
  qui la contient (`:has(.page-wide)`) jusqu'à **1680 px**, gouttière de
  l'onglet d'accessibilité comprise, et le `.container` intérieur suit. Les
  autres pages (formulaires, fiches) gardent leur colonne.
- Les commandes sont groupées dans un conteneur **`.controls`** : sans boîte
  (`display: contents`) sous 1800 px — la mise en page d'avant ne change pas —,
  une seule rangée qui se replie au besoin au-delà (recherche + jeux, puis
  sommaire des sections pour les tournois, tri pour les équipes).
- Au même seuil, les grilles de cartes passent de 3 à **4 colonnes**
  (`.sectionBody` des tournois, `.tmGrid` des équipes).

## Tableau « Données collectées » de /rgpd

`table-layout: fixed` et des parts fixées par l'en-tête (`th:nth-child`) :
Donnée 20 %, Finalité 38 %, Base légale 18 %, Conservation 24 %. Auparavant la
colonne « Donnée » ne revenait jamais à la ligne (`white-space: nowrap`) : son
plus long intitulé (« Données de connexion (adresse IP, …) ») l'élargissait et
ne laissait qu'un filet à la finalité. Sous 680 px, les lignes restent des
fiches empilées.

Tests : `tests/app/wide-screen-layout.test.ts`.
