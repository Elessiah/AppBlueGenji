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

Les cibles s'arrêtent sous l'en-tête collant (`html { scroll-padding-top }` calé sur la hauteur mesurée de l'en-tête, voir `docs/features/ERROR_PAGES_AND_ANCHORS.md`) ; le sommaire collant se pose à cette même hauteur (`--sticky-header-h`).

## Teintes

Chaque mode a **une** teinte froide (`RULE_MODE_TONE`, `lib/shared/rules-display.ts`, indexée par `diagram`), posée en `data-tone` sur sa carte de `/regles` (via `CyberCard tone`), sur l'en-tête et le corps de sa page, et sur sa pastille dans « Autres modes » : on reconnaît un mode d'un écran à l'autre. Chaque feuille traduit `data-tone` en `--tone-ink` (texte, AA sur le voile le plus teinté) et `--tone-rgb` (voiles, liserés, halos seulement). Le texte courant des règles reste en `--ink` / `--ink-mute` sur fond uni : aucun effet derrière un paragraphe. « Disponible » / « Bientôt » : `RULE_STATUS_PILL` (vert d'eau / violet). Les schémas (`components/rules/RuleDiagram.tsx`) n'emploient ni ambre ni rouge : bracket bas et rangée « 0 victoire » en violet, zone de coupe en rose — leurs légendes dans le registre le disent. Vérifié par `tests/app/public-bright-ui.test.ts`.

## Notes reprises de CLAUDE.md

Texte déplacé tel quel depuis `CLAUDE.md` (allègement du fichier chargé à chaque session).

- `/regles` + `/regles/[slug]` — Règles publiques de chaque mode de tournoi (schémas SVG inline). Contenu et mapping format → page dans `lib/shared/tournament-rules.ts` ; ajouter un mode = ajouter une entrée au registre (les pages sont pré-générées via `generateStaticParams`). Le bouton flottant « ? » des pages de tournoi (`components/rules/RulesHelpFab.tsx`) résout sa cible depuis le format du tournoi. Depuis une fiche, il porte `?tournoi=<id>` : la page affiche alors en tête les réglages de ce tournoi (`lib/shared/tournament-settings.ts`, lus par la même porte que la fiche — `docs/features/TOURNAMENT_RULES_SETTINGS.md`). Le mode `SURVIVAL` s'affiche « Survie par coupes », pour ne pas se confondre avec BlueGenji Survie. Une page de mode se lit dans un ordre fixe — réglages du tournoi (seul bloc mis en avant), l'essentiel (principes + schéma), règles du mode, règles communes **repliées** — avec un sommaire collant (`components/rules/RulesToc.tsx`) ; ancres et sommaire descendent d'un même plan pur (`lib/shared/rules-page-outline.ts`), jamais d'un `id` écrit à la main. Voir `docs/features/RULES_PAGE_LAYOUT.md`.
- **Emphase des textes de règles** (`lib/shared/inline-emphasis.ts` pur + `components/rules/EmphasisText.tsx`) : le registre `tournament-rules.ts` est rédigé avec le gras Markdown, mais `/regles` rendait ses paragraphes en texte brut — les astérisques s'affichaient au visiteur. Le module rend des **segments**, jamais du HTML (rien à injecter), et ne connaît que `**gras**` : ce n'est pas un moteur Markdown (`lib/server/bot-docs.ts` en tient un, pour de vrais fichiers `.md`) mais la seule marque que le registre emploie. Une marque non refermée reste littérale — mieux vaut une astérisque visible qu'un paragraphe avalé.
