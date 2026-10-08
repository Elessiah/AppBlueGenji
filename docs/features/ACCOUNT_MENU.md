# Menu du compte et hauteur des barres de navigation

## Constat (audit UI/UX, septembre 2026)

- La déconnexion n'existait qu'au bas de `/profil` (~4 200 px de défilement sur mobile) ; ni la barre de l'espace connecté, ni l'en-tête public ne la proposaient.
- Sous 720 px, « Mon équipe » disparaissait de la barre connectée ; l'onglet « Équipes » mène à l'annuaire, pas à sa propre équipe.
- L'en-tête public passait sur deux lignes collantes jusqu'à 1100 px (124 px en portrait, 134 px en paysage), la moitié droite de la première ligne restant vide.
- La barre connectée faisait 110 px sous 720 px ; entre 721 et ~1150 px « ⌂ ACCUEIL » / « 🛡 MON ÉQUIPE » se repliaient sur deux lignes et rognaient le pseudo.

## Ce qui est en place

### `components/account-menu.tsx`

Un bouton (avatar + pseudo + ▾) ouvre un panneau : **Mon profil**, **Mon équipe** (si le joueur en a une active, nom de l'équipe en rappel), **Déconnexion** — chaque entrée précédée d'un pictogramme Lucide (`aria-hidden`), hors du nom accessible ; survol (bouton compris) réservé à `@media (hover: hover) and (pointer: fine)` et jamais sur la déconnexion en cours (désactivée). Le même composant est rendu par `ArenaNav` et par `PublicHeader`.

- Bouton de divulgation (`aria-expanded`, `aria-controls` seulement ouvert), jamais `role="menu"` : c'est une courte liste de liens.
- Nom accessible `« <pseudo>, menu du compte »` — il commence par le texte visible (WCAG 2.5.3).
- Fermeture : clic en dehors, clic sur un lien, Échap (focus rendu au bouton), tabulation qui sort du menu. Les règles viennent de `PublicNavMenu` (`handleMenuEscape`, `focusLeftMenu`), réutilisées telles quelles.
- `requestLogout()` rend `false` sur un refus ou une panne : un toast le dit, et le joueur n'est pas ramené à l'accueil en restant connecté.
- `PublicHeader` ne transmet au client que `{ teamId, teamName }`, pas les rôles.

Le bouton « Déconnexion » du bas de `/profil` reste en place.

### Hauteur des barres

- **En-tête public** : une seule ligne à toutes les largeurs. Le CTA passe à « Compétition → » sous 960 px, la marque se réduit à l'emblème sous 480 px (mot-symbole masqué à l'œil seulement, il reste le nom accessible du lien), et sous 480 px le menu du compte peut passer sous le CTA plutôt que de provoquer un défilement horizontal.
- **Barre connectée** (allégée, octobre 2026) : plus de boutons « Accueil » ni « Mon équipe » — l'accueil passe par le logo central (nom accessible et infobulle « Accueil »), l'équipe par le menu du compte. À droite, un groupe d'**outils** discrets (`.navTools`, séparé du compte par un filet) : la langue (globe + code « EN », le même bouton que dans l'en-tête public — `I18N.md` § Sélecteur de langue) et, pour la modération, un drapeau « Signalements » — ambre seulement quand un signalement attend (`.navReportsPending`), neutre à zéro ; libellé visible dès 1150 px, lu seul en dessous (sans `title`, qui doublerait le nom) —, compteur en pastille à la suite, dans le bouton — rien de recouvert, ni le drapeau ni le contour de focus — (plafonnée à « 99+ »), lu tel qu'affiché (« Signalements, 99+ à traiter », WCAG 2.5.3 ; séparateur et suite par les clés `nav.reportsCountLead` / `nav.reportsPending`) ; page courante en cadre bleu plein (ambre plein s'il reste à traiter) ; survol réservé à `@media (hover: hover) and (pointer: fine)`, convention du dépôt (collé au toucher, il passait pour la page courante) ; l'état courant reste distinct du survol, et en contraste forcé une bordure `Highlight` la marque (le contour de focus reste libre). Au toucher, `:active` donne le retour que le survol ne donne plus ; sous 380 px le globe s'efface (code seul) pour que la barre tienne à 320 px. Cibles de 44 px. Le groupe n'est rendu que s'il a un contenu : la langue seulement sur une route traduite (`useSwitchablePath()`, la décision même du sélecteur), le drapeau seulement avec la permission `moderation` — jamais de filet orphelin. Le menu du compte reste le seul bouton marqué. Sous 1000 px, les losanges des liens disparaissent pour que les quatre sections tiennent sur une ligne (le trait du lien actif marque la section) ; sous 720 px, espacements et logo resserrés.
- Toute page de l'espace connecté (`app/(secured)/layout.tsx` → `ArenaShell`) et toute page publique suivie par la session (`SessionPageShell`) rendent cette même barre : aucune sous-mise en page n'en ajoute une autre.
- **Paysage bas** (`max-height: 500px` — téléphone couché, zoom 200 % d'un portable) : les deux barres cessent d'être collantes.

## Tests

`tests/app/account-menu.test.tsx`, `tests/app/navigation-a11y.test.tsx`, `tests/app/public-header.test.ts`.

## Notes reprises de CLAUDE.md

Texte déplacé tel quel depuis `CLAUDE.md` (allègement du fichier chargé à chaque session).

- **Menu du compte et hauteur des barres** (`components/account-menu.tsx`) : « Mon profil / Mon équipe / Déconnexion » vivent sous l'avatar, **le même composant** dans `ArenaNav` et dans `PublicHeader` — la déconnexion n'existait qu'au bas de `/profil`, et « Mon équipe » disparaissait de la barre sous 720 px. Bouton de divulgation (jamais `role="menu"`), mêmes règles de fermeture que le burger de la vitrine (`handleMenuEscape`, `focusLeftMenu`) ; une déconnexion refusée le dit en toast au lieu de ramener à l'accueil un joueur toujours connecté. Les deux barres étant collantes, elles tiennent sur **une ligne** là où c'est possible (l'en-tête public raccourcit son CTA sous 960 px et réduit la marque à l'emblème sous 480 px ; « Accueil » / « Mon équipe » ont depuis quitté la barre — voir « Barre connectée » plus haut) et **cessent d'être collantes** en paysage bas (`max-height: 500px`). Voir `docs/features/ACCOUNT_MENU.md`.
