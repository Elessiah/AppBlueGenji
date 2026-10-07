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

Chaque mode a **une** teinte froide (`RULE_MODE_TONE`, `lib/shared/rules-display.ts`, indexée par `diagram` ; cinq néons pour six modes : le multi-phases partage le violet de la double élimination, jamais voisins dans l'ordre du registre), posée en `data-tone` sur sa carte de `/regles` (via `CyberCard tone`), sur l'en-tête et le corps de sa page, et sur sa pastille dans « Autres modes » : on reconnaît un mode d'un écran à l'autre. La feuille commune `app/regles/tones.module.css` (classe `.tone`, posée avec `data-tone`) le traduit en `--tone-ink` (texte, AA sur le voile le plus teinté) et `--tone-rgb` (voiles, liserés, halos seulement). Le texte courant des règles reste en `--ink` / `--ink-mute` sur fond uni : aucun effet derrière un paragraphe. « Disponible » / « Bientôt » : `RULE_STATUS_PILL` (vert d'eau / violet). Les schémas (`components/rules/RuleDiagram.tsx`) n'emploient ni ambre ni rouge : bracket bas et rangée « 0 victoire » en violet, zone de coupe en rose — leurs légendes dans le registre le disent. Vérifié par `tests/app/public-bright-ui.test.ts`.

## Notes reprises de CLAUDE.md

Texte déplacé tel quel depuis `CLAUDE.md` (allègement du fichier chargé à chaque session).

- `/regles` + `/regles/[slug]` — Règles publiques de chaque mode de tournoi (schémas SVG inline). Mapping format → page dans `lib/shared/tournament-rules.ts` (structure seule) ; textes dans `messages/<langue>/rules.json`, sous la clé du format (voir § Langues). Ajouter un mode = une entrée au registre **et** ses textes dans les deux langues. Le bouton flottant « ? » des pages de tournoi (`components/rules/RulesHelpFab.tsx`) résout sa cible depuis le format du tournoi ; composant client, il n'importe que `lib/shared/rule-mode-definitions.ts` (structure + noms français des modes, sans `rules.json`), jamais `tournament-rules.ts`, qui embarquerait tout le texte des règles dans le paquet de `/tournois`. Depuis une fiche, il porte `?tournoi=<id>` : la page affiche alors en tête les réglages de ce tournoi (`lib/shared/tournament-settings.ts`, lus par la même porte que la fiche — `docs/features/TOURNAMENT_RULES_SETTINGS.md`). Le mode `SURVIVAL` s'affiche « Survie par coupes », pour ne pas se confondre avec BlueGenji Survie. Une page de mode se lit dans un ordre fixe — réglages du tournoi (seul bloc mis en avant), l'essentiel (principes + schéma), règles du mode, règles communes **repliées** — avec un sommaire collant (`components/rules/RulesToc.tsx`) ; ancres et sommaire descendent d'un même plan pur (`lib/shared/rules-page-outline.ts`), jamais d'un `id` écrit à la main. Voir `docs/features/RULES_PAGE_LAYOUT.md`.
- **Emphase des textes de règles** : depuis le lot 3 d'`I18N.md`, le gras s'écrit `<b>…</b>` dans les messages et `components/rules/RuleText.tsx` le monte en `<strong>` — des éléments React, jamais du HTML injecté. `lib/shared/inline-emphasis.ts` + `EmphasisText` (`**gras**`) ne servent plus qu'aux conditions d'utilisation.

## Langues (`/en/regles`, lot 3 d'`I18N_MIGRATION_PLAN.md`)

- Espace de messages `rules` (`messages/fr|en/rules.json`) : `meta`, `breadcrumb`, `index`, `mode`, `toc`, `diagram` (textes des schémas SVG), `seedingRule`, `common` (règles communes) et `modes.<FORMAT>` (libellé, accroche, chiffres clés, principes, légende du schéma, sections). Les listes (sections, puces) sont des tableaux JSON.
- Rendu **serveur** sans `next-intl` : `messagesFor(locale).rules` + le formateur réduit `lib/shared/message-format.ts` (`RuleText` pour les textes riches, `formatMessage` pour les arguments). `t()` ne parcourt pas un tableau ; l'équivalence avec `next-intl` est testée message par message (`tests/lib/shared/message-format.test.ts`). Rien n'est sérialisé au navigateur : le sommaire (`RulesToc`, client) reçoit ses libellés en props.
- Arguments : `{launchDelay}`, `{reportTimeout}`, `{minutesPerMap}` (délais réels du moteur) et `{seedingRule}` (la règle de seeding, écrite une fois, `{basePoints}` dedans) — `ruleTextValues()`.
- **Ancres** : calculées sur les titres **français**, dans les deux langues (`/en/regles/survie#regle-coupes`) — un lien vers une section survit au changement de langue.
- `TOURNAMENT_RULE_MODES` / `COMMON_RULES` restent le registre **français** (bouton d'aide des pages de tournoi, client et pas encore traduit) : `tournament-rules.ts` n'importe que `messages/fr/rules.json`, l'anglais n'est lu que par le serveur.
- Réglages d'un tournoi (`?tournoi=<id>`) : traduits depuis le lot 8a-2 (`lib/shared/tournament-settings-text.ts`, espace `tournament.settings`) ; le français reste celui de `tournament-settings.ts`.
- Pages rendues à la demande (la mise en page racine lit les en-têtes) : `generateStaticParams` ne prérend rien, la racine du site (`APP_URL`) est lue au rendu, pour chaque langue.
