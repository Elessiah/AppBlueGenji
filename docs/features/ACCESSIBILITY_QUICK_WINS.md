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
une `<nav>`, ni un élément `aria-hidden="true"` ou `hidden` (où `focus()`
échouerait sans bruit), ni un **décor vide** — sans enfant ni texte, comme le
fond `.fabric` qui ouvre le `<main>` de `/connexion` — **en tête seulement** : un
en-tête placé plus bas fait partie du contenu. Sans enfant de contenu, `<main>`
lui-même. Le défaut de repères qui rendait ce détour nécessaire (ancienne
tâche 15) est réglé depuis par `PublicPageShell`
(`docs/features/ACCESSIBILITY_LANDMARKS_FOCUS.md`) ; la règle reste juste, et
couvre le JSON-LD et le décor qui ouvrent encore certains `<main>`.

La cible reçoit `tabindex="-1"` **le temps du focus seulement** : laissé en
place, un clic dans une zone vide du contenu y ramènerait le focus. Une cible
déjà focalisable garde son `tabindex` — et son anneau. Toutes reçoivent
`data-skip-target`, retiré au `blur` : combiné à `tabindex="-1"`, il éteint
l'anneau autour du contenu entier, et il porte une marge de défilement — les
en-têtes étant collants, une cible ramenée en haut de la vue passerait sinon
dessous (WCAG 2.4.11). Sans `<main>`, le lien laisse le navigateur suivre son
ancre (`#contenu`).

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

`BotLegalDoc` basculait le texte en anglais sous une page `lang="fr"`. Depuis le
lot 7a, chaque langue a son adresse (`/en/…`, `<html lang="en">`) et la bascule a
disparu ; chaque `<section>` garde `lang={lang}`, désormais celle de la page.

## Navigations : page courante et pictogrammes (WCAG 1.3.1 / 4.1.2)

- `isNavLinkActive` (`lib/shared/nav-active.ts`, pur) décide du lien actif pour
  `ArenaNav` et `PublicNavMenu`, qui en tenaient chacun une copie. La réponse
  sert le style **et** `aria-current="page"`. Une ancre de l'accueil
  (`/#tournois`) ne désigne jamais la page courante, `/` ne l'est que sur
  l'accueil. Le panneau du menu burger est extrait (`PublicNavPanel`), et la
  règle d'Échap écrite à part (`handleMenuEscape`) : les deux se testent sans
  navigateur.
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

## Notes reprises de CLAUDE.md

Texte déplacé tel quel depuis `CLAUDE.md` (allègement du fichier chargé à chaque session).

- **Nom accessible d'un lien : il doit contenir son texte visible** (WCAG 2.5.3) — un `aria-label` posé à la main sur un lien qui porte déjà du texte le **remplace**, et la commande vocale ne répond alors plus à ce qu'on lit dessus. Deux liens de la vitrine en souffraient : la marque de l'en-tête (`aria-label="BlueGenji Esport"` contre « BlueGenji » + « ESPORT », deux éléments donc deux mots collés) et le bouton « Regarder le live » du hero, dont le libellé annonçait le tournoi sans jamais dire « Regarder le live ». Deux remèdes selon le cas : **retirer** le libellé quand le contenu visible suffit (l'emblème passe alors en `alt=""`, décoratif à côté du mot-symbole), ou le faire **commencer par le texte affiché** quand il ajoute du contexte utile.
- **Lien d'évitement et page courante** (`lib/shared/skip-link.ts` + `components/accessibility/SkipLink.tsx`, `lib/shared/nav-active.ts`) : « Aller au contenu » est rendu par `app/layout.tsx` juste après le bouton d'accessibilité — deuxième arrêt du clavier sur toutes les pages, hors écran tant qu'il n'a pas le focus. Il ne vise pas un identifiant mais le `<main>` trouvé au clic (une page ajoutée demain est couverte), **en sautant ce qui le précède sans en faire partie** (script, `<header>`, `<nav>`, élément `aria-hidden`, `hidden` ou vide — le JSON-LD de la vitrine, le fond `.fabric` de `/connexion`) : viser `<main>` nu ferait partir le focus d'un décor, ou du menu d'une page qui y rendrait encore un en-tête. La cible reçoit `tabindex="-1"` (si elle n'est pas déjà focalisable) et `data-skip-target` — qui porte la marge de défilement sous l'en-tête collant — le temps du focus seulement. Les deux navigations (`ArenaNav`, `PublicNavMenu`) décident du lien actif par `isNavLinkActive`, qui sert **à la fois** le style et `aria-current="page"` ; leurs pictogrammes sont `aria-hidden`. Les espaces connectés, pages clientes, reçoivent leur titre d'une mise en page de segment qui ne déclare **que** `title` — un `pageMetadata()` y ferait descendre l'URL canonique de la liste sur chaque fiche —, et par `segmentTitle()` plutôt qu'une chaîne : une chaîne remet le gabarit à `null` pour les sous-pages, qui perdaient le nom du site. Les **fiches** d'équipe et de joueur posent le leur (`generateMetadata` d'une mise en page `[id]`, règle pure `lib/shared/entity-page-titles.ts`) : nom ou pseudo, « Compte supprimé » pour un compte anonymisé, et titre générique pour un lecteur non connecté, à qui la fiche est refusée — l'onglet ne nomme pas ce que la page tait (`docs/features/ACCESSIBILITY_ARIA_AND_ENTITY_TITLES.md`). Voir `docs/features/ACCESSIBILITY_QUICK_WINS.md`.
