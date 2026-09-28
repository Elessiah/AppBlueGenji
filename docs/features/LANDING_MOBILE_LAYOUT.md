# Accueil en mobile — hero, chiffres et longueur de page

Trois défauts de mise en page de `/` en largeur de téléphone, relevés par l'audit UI/UX de l'accueil (2026-09-25) et réglés ensemble.

## Le hero débordait de l'écran

À 375 px, le hero entier dépassait de ~13 px à droite, et le `overflow: hidden` de `.root` rognait la fin du texte d'intro, le bouton « Regarder le live » et la quatrième case du compte à rebours.

La cause n'était pas le compte à rebours mais la grille : **un élément de grille a pour largeur minimale celle de son contenu** (`min-width: auto`). Le compte à rebours (étiquette + quatre cases de 54 px) imposait donc 376 px à la piste `1fr` qui l'accueille, pour 351 px disponibles. `min-width: 0` sur `.left` et `.right` (`components/cyber/landing/Hero.module.css`) rend à la piste sa largeur.

## Le compte à rebours s'écrasait

L'étiquette (« PROCHAIN TOURNOI · <nom> ») partageait toujours la ligne avec les cases, qui ne rétrécissent pas : elle finissait sur quatre lignes. `CountdownStrip.module.css` passe la racine en `flex-wrap: wrap` et donne à l'étiquette une base de 140 px (`flex: 1 1 140px`) : en dessous, elle passe **au-dessus** des cases et prend toute la largeur.

**Aucune requête média**, et c'est voulu : le composant ne sait pas dans quelle colonne il est posé, une règle sur la largeur d'écran se tromperait dès qu'on le déplace. La bascule suit la place réellement disponible. En desktop, rien ne change (étiquette et cases côte à côte).

## Les chiffres du hero se repliaient

Les trois chiffres (joueurs, équipes, tournois) étaient une ligne flexible à séparateurs : en mobile, le troisième passait à la ligne et un séparateur restait seul en bout de ligne. Sous 720 px, ils forment une grille de trois colonnes, alignées en tête, et les séparateurs disparaissent.

## Les chiffres de l'association en deux colonnes

La grille de `AboutStats` passait à une colonne sous 720 px, doublant la hauteur du bloc pour des cartes qui ne portent qu'un chiffre et un intitulé. Elle garde deux colonnes jusqu'à 340 px ; les boutons d'édition du staff passent à la ligne (`flex-wrap`) dans la demi-largeur.

## La page condensée (≈ 8 600 → 7 900 px à 375 px)

Mesuré en direct : la longueur ne tenait pas aux piliers de l'association (trois cartes, ~360 px) mais à des lignes **qui se repliaient** là où elles auraient dû tenir.

- **Classement** : le nom d'une équipe devait s'abréger, mais la règle visait `.team span:last-child` alors que le dernier enfant de la cellule est le lien (`TeamLink`, un `<a>`) — la règle ne s'appliquait à rien, et un nom de vingt caractères passait sur trois lignes (lignes de 80 à 99 px). Elle vise désormais `.team > :last-child` (le `title` du lien donne le nom entier), et sous 720 px les colonnes chiffrées se resserrent : huit lignes de 47 px, **~390 px** de gagnés.
- **Calendrier** : sous 720 px, l'heure passe sous la date (elle prenait une colonne à droite), si bien que jeu et état tiennent sur une ligne ; le nom du tournoi s'arrête à deux lignes.
- **Association** : le texte d'introduction passe de 22 à 18 px en mobile (onze lignes à 22 px sur une colonne de 350 px).
- **Partenaires** : deux colonnes jusqu'au plus petit écran — un logo 3:1 reste lisible à ~170 px. Les quatre boutons du staff, posés en absolu sur le logo, l'auraient recouvert en entier à demi-largeur : ils passent **dessous**, à la ligne.
- Les **piliers** ne sont pas repliés : trois cartes courtes ne justifient pas un contenu masqué derrière un geste.

## Le bouton d'accessibilité s'estompe au défilement

En `position: fixed`, le bouton recouvre ce qui se trouve dans son coin à l'instant où un défilement tactile s'arrête — aucune marge ne l'évite, le geste s'arrête à n'importe quel pixel. Sous 720 px, il s'efface donc (`opacity`, et `pointer-events: none` : le toucher passe au contenu dessous) le temps du geste et revient après 400 ms d'immobilité (`lib/shared/floating-button-scroll.ts`). Jamais quand on l'utilise : menu ouvert, ou focus dans le menu — flèches et Espace font défiler la page sans déplacer le focus. L'attribut `data-scrolling` est posé sur le DOM, pas en état React : un défilement ne re-rend rien. En desktop, rien ne change (le contenu, centré, n'atteint pas ce coin).

Tests : `tests/app/landing-mobile-layout.test.ts`, `tests/lib/shared/floating-button-scroll.test.ts` (déclarations CSS ; le débordement lui-même a été vérifié en direct à 375 px et 1366 px).
