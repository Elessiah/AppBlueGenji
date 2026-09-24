# Accessibilité — lien d'évitement, titres, langue, navigation

Cinq tâches de `ACCESSIBILITE.md` réglées ensemble (anciennes tâches 1, 2, 3, 4
et 14). Aucune ne change l'apparence du site : elles ne relèvent donc pas du
menu d'accessibilité (`docs/features/ACCESSIBILITY_MENU.md`) et valent pour tous.

## Lien d'évitement « Aller au contenu » (WCAG 2.4.1 · RGAA 12.7)

`components/accessibility/SkipLink.tsx`, rendu par `app/layout.tsx` **juste
après** le bouton d'accessibilité : Tab depuis le haut de n'importe quelle page
l'atteint en deuxième position. Il est hors de l'écran tant qu'il n'a pas le
focus (`.skip-link` dans `app/globals.css`, par `transform` — jamais
`display: none` ni `visibility: hidden`, qui le retireraient de la tabulation).

**La cible n'est pas désignée par un identifiant** : le lien cherche le
`<main>` de la page au clic. Quinze fichiers rendent chacun le leur ; un
`id="contenu"` sur chacun aurait été oublié sur la seizième page.

**Mais `<main>` ne suffit pas** : les pages vitrine rendent leur en-tête
(`PublicHeader`, précédé du JSON-LD) **dans** `<main>`. Y poser le focus ferait
repartir la tabulation du menu et de la marque — précisément ce que le lien
promet d'éviter. `skipLinkTarget` (`lib/shared/skip-link.ts`, pur) descend donc
sur le premier enfant de `<main>` qui n'est ni un script, ni un `<header>`, ni
une `<nav>`, ni un élément `aria-hidden="true"` — **en tête seulement** : un
en-tête placé plus bas fait partie du contenu. Sans enfant de contenu, `<main>`
lui-même. Le défaut de repères qui rend ce détour nécessaire est consigné à
`ACCESSIBILITE.md` (§15) ; la règle restera juste une fois corrigé.

La cible reçoit `tabindex="-1"` (et `data-skip-target`, qui éteint l'anneau
autour du contenu entier) **le temps du focus seulement** : laissé en place, un
clic dans une zone vide du contenu y ramènerait le focus. Une cible déjà
focalisable garde son `tabindex`. Sans `<main>`, le lien laisse le navigateur
suivre son ancre (`#contenu`). Les en-têtes étant collants, la cible porte une
marge de défilement : ramenée en haut de la vue, elle ne passe pas dessous
(WCAG 2.4.11).

## Titres des espaces connectés (WCAG 2.4.2 · RGAA 8.6)

`/tournois`, `/equipes`, `/joueurs` et `/profil` s'intitulaient tous
« BlueGenji Esport ». Ce sont des pages clientes, qui ne peuvent pas exporter
`metadata` : chaque segment reçoit une mise en page serveur qui ne sert qu'à
ça, comme la fiche d'un tournoi. Les formulaires de création ont la leur
(« Créer un tournoi », « Créer une équipe »).

Deux choix à connaître :

- **Un titre et rien d'autre**, pas de `pageMetadata()`. Une mise en page
  transmet ses métadonnées à tout son segment : l'URL canonique et l'`og:url`
  de la liste seraient descendues sur chaque fiche, et un lien vers
  `/equipes/12` se serait annoncé comme `/equipes`.
- **`segmentTitle()`** (`lib/shared/page-metadata.ts`) et non une chaîne. Next
  transmet aux segments enfants le gabarit du titre **résolu** de la mise en
  page, qu'une chaîne remet à `null` : posé en `"Tournois"`, `/tournois` était
  juste mais `/tournois/creer` devenait « Créer un tournoi » tout court.
  `segmentTitle` rend `{ default, template }` avec le gabarit du site
  (`SITE_TITLE_TEMPLATE`, que la racine déclare aussi). Le test rejoue la
  résolution de Next (`resolveTitle`) le long de la chaîne des mises en page.

Les fiches d'équipe et de joueur héritent du titre de leur annuaire — mieux que
le nom du site, mais pas encore leur propre nom (`ACCESSIBILITE.md` §16).

## Langue des pages légales du bot (WCAG 3.1.2 · RGAA 8.7)

`BotLegalDoc` bascule le texte en anglais sous une page `lang="fr"`. Chaque
`<section>` déclare désormais `lang={lang}` — sur les sections plutôt qu'un
conteneur ajouté, pour ne rien changer à la mise en page de l'hôte —, et chaque
bouton du sélecteur est écrit dans **sa** langue (`lang="en"` sur « English »).

## Navigations : page courante et pictogrammes (WCAG 1.3.1 / 4.1.2)

- `isNavLinkActive` (`lib/shared/nav-active.ts`, pur) décide du lien actif pour
  `ArenaNav` et `PublicNavMenu`, qui en tenaient chacun une copie. La réponse
  sert le style **et** `aria-current="page"`. Une ancre de l'accueil
  (`/#tournois`) ne désigne jamais la page courante, `/` ne l'est que sur
  l'accueil.
- Les pictogrammes « ⌂ » et « 🛡 » de `ArenaNav` passent dans un
  `<span aria-hidden="true">`, et la navigation est nommée.
- `PublicNavMenu` perd son `aria-haspopup="true"` (il annonçait un
  `role="menu"`, dont le lecteur d'écran attend les flèches), gagne un
  `aria-controls` tant que le panneau existe, et Échap rend le focus au bouton
  quand il était dans le panneau.
- Le lien du profil de `PublicHeader` portait `aria-label="Mon profil"` à côté
  du pseudo affiché : son nom commence désormais par le pseudo (WCAG 2.5.3).

## Indicateur de développement de Next

`devIndicators: { position: "top-right" }` dans `next.config.ts` : le bouton
« N » occupait le coin bas-gauche, sous le bouton d'accessibilité, et
interceptait ses clics. Sans effet en production.
