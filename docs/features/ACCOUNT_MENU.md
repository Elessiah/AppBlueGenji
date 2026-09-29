# Menu du compte et hauteur des barres de navigation

## Constat (audit UI/UX, septembre 2026)

- La déconnexion n'existait qu'au bas de `/profil` (~4 200 px de défilement sur mobile) ; ni la barre de l'espace connecté, ni l'en-tête public ne la proposaient.
- Sous 720 px, « Mon équipe » disparaissait de la barre connectée ; l'onglet « Équipes » mène à l'annuaire, pas à sa propre équipe.
- L'en-tête public passait sur deux lignes collantes jusqu'à 1100 px (124 px en portrait, 134 px en paysage), la moitié droite de la première ligne restant vide.
- La barre connectée faisait 110 px sous 720 px ; entre 721 et ~1150 px « ⌂ ACCUEIL » / « 🛡 MON ÉQUIPE » se repliaient sur deux lignes et rognaient le pseudo.

## Ce qui est en place

### `components/account-menu.tsx`

Un bouton (avatar + pseudo + ▾) ouvre un panneau : **Mon profil**, **Mon équipe** (si le joueur en a une active, nom de l'équipe en rappel), **Déconnexion**. Le même composant est rendu par `ArenaNav` et par `PublicHeader`.

- Bouton de divulgation (`aria-expanded`, `aria-controls` seulement ouvert), jamais `role="menu"` : c'est une courte liste de liens.
- Nom accessible `« <pseudo>, menu du compte »` — il commence par le texte visible (WCAG 2.5.3).
- Fermeture : clic en dehors, clic sur un lien, Échap (focus rendu au bouton), tabulation qui sort du menu. Les règles viennent de `PublicNavMenu` (`handleMenuEscape`, `focusLeftMenu`), réutilisées telles quelles.
- `requestLogout()` rend `false` sur un refus ou une panne : un toast le dit, et le joueur n'est pas ramené à l'accueil en restant connecté.
- `PublicHeader` ne transmet au client que `{ teamId, teamName }`, pas les rôles.

Le bouton « Déconnexion » du bas de `/profil` reste en place.

### Hauteur des barres

- **En-tête public** : une seule ligne à toutes les largeurs. Le CTA passe à « Compétition → » sous 960 px, la marque se réduit à l'emblème sous 480 px (mot-symbole masqué à l'œil seulement, il reste le nom accessible du lien), et sous 480 px le menu du compte peut passer sous le CTA plutôt que de provoquer un défilement horizontal.
- **Barre connectée** : entre 721 et 1150 px, « Accueil » / « Mon équipe » sont en pictogramme seul (libellé visuellement masqué, nom accessible inchangé) ; sous 720 px, espacements et logo resserrés.
- **Paysage bas** (`max-height: 500px` — téléphone couché, zoom 200 % d'un portable) : les deux barres cessent d'être collantes.

## Tests

`tests/app/account-menu.test.tsx`, `tests/app/navigation-a11y.test.tsx`, `tests/app/public-header.test.ts`.
