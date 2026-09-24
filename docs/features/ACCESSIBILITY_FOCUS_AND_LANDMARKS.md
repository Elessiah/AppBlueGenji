# Accessibilité — focus, cibles et repères

Lot de tâches d'`ACCESSIBILITE.md` réglées ensemble : 5, 6, 7, 8 et 17.

## 5. Modales de la vitrine

Déjà réglée avant cette PR : les six modales citées passent toutes par
`LandingDialog`, donc par `useDialogBehavior` (focus, Échap, piège de
tabulation, retour au déclencheur). La tâche est retirée du fichier.

## 6. Lien « Voir → » de la banderole de recrutement

`components/recruitment-highlight.tsx`. Le texte affiché reste « Voir → » ; le
lien porte un nom accessible qui **commence** par ce mot et nomme l'annonce
(`bannerLinkLabel` : « Voir l'annonce : <titre> » — WCAG 2.4.4 et 2.5.3). La
flèche est `aria-hidden`. La cible passe de 14 à **24 px** de haut
(`min-height`, WCAG 2.5.8), prise sur le rembourrage de la banderole, dont la
hauteur ne change pas — une banderole qui grandit fait sauter la page.

## 7. Focus des champs hors `.field`

Trois champs retiraient l'`outline` et ne signalaient le focus que par une
bordure recolorée : `.modalInput` (`/recrutement`, `/association`) et
`.searchbar-input`. Un quatrième, la recherche de l'annuaire
(`app/(secured)/_shared/annuaire.module.css`, `/equipes` et `/joueurs`), avait
un anneau à 6 % d'opacité, invisible. Tous portent désormais un anneau de 3 px
à 28 %.

En **contrastes forcés**, le mode supprime les `box-shadow` et impose la couleur
des bordures : il ne restait aucun repère — halo de `.field` compris, et de même
pour tout anneau fait d'une ombre (liens de navigation de `/profil`, recherche
du dialogue des fantômes…). Plutôt qu'un repli par classe — dix-neuf feuilles
posent `outline: none` —, une **règle unique** dans `app/globals.css` pose
`outline: 2px solid !important` sur `:focus-visible` sous
`@media (forced-colors: active)` : elle couvre aussi l'élément ajouté demain.
`!important` pour l'emporter sur chaque `outline: none` ; le réglage « Focus
très visible » du menu, plus spécifique, garde la main.

## 8. Titres de `/connexion`, repères de `/association`

- La modale de consentement RGPD (`h2` « Avant de continuer ») est rendue
  **après** la carte de connexion : c'est une surcouche fixe, sa place dans le
  document ne change rien à l'écran, mais elle précédait le `h1` de la page.
- Les deux `<aside>` de `/association` deviennent des `<div>` : ce sont des
  faits de leur section, pas un contenu complémentaire, et un repère
  `complementary` dans `<main>` n'est pas au premier niveau.

## 17. Menu burger de la vitrine

`PublicNavMenu` se ferme quand la tabulation quitte le panneau
(`handleMenuBlur` → `focusLeavesMenu`, sur l'`onBlur` de la racine). Seule une cible **connue et
extérieure** ferme : `relatedTarget` vaut `null` pour la barre du navigateur ou
un clic sur une zone inerte — y compris dans le panneau —, et le clic dehors a
déjà son écouteur.

## Tests

`tests/app/field-focus-ring.test.ts`, `tests/app/heading-landmark-order.test.ts`,
et des cas ajoutés à `tests/app/navigation-a11y.test.tsx` et
`tests/app/recruitment-highlight-server.test.tsx`.
