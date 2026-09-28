# Mise en page d'une page de règles

`/regles/<mode>` empilait neuf blocs de même poids — deux pastilles (dont une qui répétait le titre), les chiffres clés, trois cartes de principe, le schéma, une carte par règle du mode, une carte par règle commune, les autres modes — sans rien pour dire où l'on était ni ce qui comptait. Sur BlueGenji Survie, cela faisait quatorze cartes à la file.

## Ordre de lecture

1. **En-tête** : retour, titre, accroche, bandeau « Bientôt disponible » le cas échéant, chiffres clés. Les pastilles « Disponible à la création » et le libellé court du mode ont disparu : l'une disait l'état par défaut, l'autre répétait le titre.
2. **Ce tournoi** (seulement avec `?tournoi=<id>`, voir `TOURNAMENT_RULES_SETTINGS.md`) : le seul bloc mis en avant, en **un** panneau encadré de bleu, les groupes de réglages séparés par un filet plutôt qu'une carte chacun. C'est ce que vient chercher un joueur arrivé depuis la fiche de son tournoi.
3. **L'essentiel** : les principes en liste numérotée, puis le schéma — les deux disent la même chose, l'un en mots, l'autre en dessin.
4. **Règles du mode** : des blocs de texte séparés par un filet, pas une pile de cartes ; le poids visuel reste aux titres, et les lignes sont bornées à 76 caractères.
5. **Règles communes** : repliées (`<details>`), un titre par ligne. Elles sont les mêmes sur toutes les pages, le lecteur vient pour le mode.
6. **Autres modes**.

## Sommaire

`components/rules/RulesToc.tsx` : colonne collante à gauche sur grand écran, bloc de liens en tête de contenu sous 960 px (sans les sous-entrées, qui repousseraient le texte). Il marque la section en cours d'un `aria-current="location"` — la dernière dont le titre a franchi la ligne de lecture —, calculée au défilement sous `requestAnimationFrame`. Sans JavaScript, il reste une liste de liens d'ancre qui fonctionne.

## Une seule source pour les ancres

`lib/shared/rules-page-outline.ts` (pur) écrit le plan **une fois** — ancres fixes (`RULES_PAGE_ANCHORS`), ancre de chaque règle (`ruleSectionAnchors`, préfixée `regle-` et départagée si deux titres se ressemblent), sommaire (`rulesPageOutline`) — et la page comme le sommaire le lisent. Une ancre renommée d'un seul côté donnerait un lien qui ne mène nulle part, sans erreur ; `tests/lib/shared/rules-page-outline.test.ts` vérifie que la page pose bien chaque ancre du plan.

Les cibles s'arrêtent sous l'en-tête collant (`scroll-margin-top: 96px` sur tout `[id]` du contenu).
