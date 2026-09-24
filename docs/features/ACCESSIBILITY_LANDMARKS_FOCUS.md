# Accessibilité — repères des pages vitrine, focus des champs, menu burger

Quatre tâches de `ACCESSIBILITE.md` réglées ensemble (anciennes tâches 7, 8, 15
et 17). La tâche 5 (modales de la vitrine sans piège de focus) a été retirée du
fichier sans code : `LandingDialog` passe déjà par `useDialogBehavior` pour les
six modales qu'elle citait.

## En-tête et pied de page hors de `<main>` (WCAG 1.3.1 · RGAA 12.6)

Onze pages vitrine (accueil, `/association`, `/benevoles`, `/recrutement`,
`/regles`, `/regles/[slug]`, `/rgpd`, `/rgpd/registre`, `/mentions-legales` et
les deux pages légales du bot) rendaient `PublicHeader` et `PublicFooter`
**dans** leur `<main>`. Un `<header>` ou un `<footer>` imbriqué dans `<main>`
perd son rôle de repère (`banner`, `contentinfo`) : la navigation par repères
d'un lecteur d'écran ne trouvait ni l'en-tête ni le pied de page, et le
« contenu principal » annoncé commençait par le menu.

Elles passent désormais par **`PublicPageShell`**
(`components/cyber/landing/PublicPageShell.tsx`), qui rend l'en-tête, `<main>`
puis le pied de page **en frères**. Un gabarit plutôt que l'ordre recopié à la
main : la page ajoutée demain le reçoit sans y penser — et le changement dans
chaque page se réduit à remplacer `<main …>` par `<PublicPageShell>`, sans
réindenter le contenu. `/bot` et `/bot/docs` faisaient déjà juste, avec leur
propre `<main className="bot-main">`, et sont laissées telles quelles.

**Empilement.** `<main>` garde `position: relative; z-index: 1`. L'en-tête
collant (`z-index: 30`), sorti de ce contexte, reste au-dessus du contenu au
défilement, et son panneau de menu (`z-index: 50`, dans le contexte de
l'en-tête) aussi. La banderole de recrutement (`z-index: 40`) reste au-dessus de
l'en-tête. Vérifié dans le navigateur.

Le lien d'évitement (`lib/shared/skip-link.ts`) sautait les en-têtes en tête de
`<main>` pour contourner ce défaut ; la règle reste juste — `<main>` s'ouvre
encore sur le JSON-LD ou sur un fond décoratif.

## Repères et titres (RGAA 9.1 / 12.6)

- **`/association` et `/mentions-legales`** posaient des `<aside>` dans le héros
  et dans le bloc « Adhérer » : imbriqués dans `<main>`, ils ne sont pas des
  repères de premier niveau (signalé par axe), et ce qu'ils portent est le
  contenu de la page, pas un contenu complémentaire. Ce sont des `<div>`.
- **`/connexion`** : la modale de consentement (`RgpdConsentModal`, titre
  « Avant de continuer » en `h2`) était rendue **avant** la carte qui porte le
  `h1`. Elle l'est après : l'ordre du document est celui de la lecture. Sa
  position fixe la garde au-dessus, et le focus y est porté par
  `useDialogBehavior`, pas par l'ordre.

## Focus des champs (WCAG 2.4.7 / 1.4.11 · RGAA 10.7)

Les champs des modales de la vitrine (`.modalInput` de `/recrutement`,
`/association`, `/benevoles`, des chiffres, piliers et partenaires ;
`.input` du contact du pied de page et des textes éditables), la barre de
recherche `.searchbar-input` et celle des annuaires posaient `outline: none`
avec, pour seul repère, une bordure qui change de couleur (ou un halo à 6 %
d'opacité pour l'annuaire). Deux corrections :

- **Un anneau** (`box-shadow: 0 0 0 3px …`) au focus, comme les champs `.field`
  — dans la teinte de chaque écran.
- **En contrastes forcés**, une règle globale (`app/globals.css`) rétablit un
  contour pour **tout** contrôle focalisé :

  ```css
  @media (forced-colors: active) {
    :focus-visible:not([tabindex="-1"]) {
      outline: 2px solid CanvasText !important;
      outline-offset: 2px !important;
    }
  }
  ```

  Ce mode impose une seule couleur de bordure et supprime les ombres : ni la
  bordure qui change ni l'anneau n'y laissent de trace. Une règle globale plutôt
  qu'une correction par feuille, parce que les `outline: none` sont éparpillés
  à toutes les spécificités (`.field input…:focus` pèse (0,4,1)) et que celui
  qu'on écrira demain doit être couvert — d'où `!important`, qui ne vaut que dans
  ce mode, choisi par le lecteur. Les conteneurs focalisés par programme
  (`tabindex="-1"` : modales, cible du lien d'évitement) en sont exclus.

## Menu burger (WCAG 2.4.3 · RGAA 12.8)

`PublicNavMenu` se fermait au clic dehors, sur un lien et avec Échap, mais pas
quand la tabulation quittait le panneau : il restait ouvert par-dessus le
contenu où le focus était parti. Il se ferme désormais au `focusout` dont la
nouvelle cible (`relatedTarget`) est hors du composant — `focusLeftMenu`, pur.
Une cible `null` ne ferme **pas** : c'est une fenêtre qui perd le focus
(changement d'application), où l'on retrouve le menu tel qu'on l'a laissé, ou un
clic dans le vide, que l'écouteur de clic extérieur traite déjà.

## Tests

`tests/app/accessibility-landmarks-focus.test.tsx` :

- le gabarit rend en-tête, `<main>` et pied de page en frères ;
- **balayage** : toute page qui rend `PublicHeader` ou `PublicFooter` les place
  hors de son `<main>`, et aucune page ne pose d'`<aside>` ;
- `/connexion` rend la modale de consentement après la carte du `h1` ;
- `focusLeftMenu` (sortie, passage d'un lien à l'autre, fenêtre qui perd le
  focus, racine absente) et son branchement ;
- la règle globale des contrastes forcés, et **balayage** de toutes les feuilles
  de `app/` et `components/` : aucune règle de focus ne se contente de changer
  la couleur d'une bordure. Le balayage lit le sélecteur **du focalisé
  lui-même** (un focus dans `:not(…)`, dans `:has(…)` ou sur un ancêtre habille
  un voisin, qui porte son propre repère) et cumule les règles d'un même
  sélecteur dans une feuille (un anneau écrit en deux fois reste un anneau).
