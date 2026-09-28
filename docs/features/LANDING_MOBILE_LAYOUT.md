# Accueil en mobile — hero et chiffres

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

## Ce qui reste

La longueur totale de la page en mobile (~11 écrans) tient surtout aux sections partenaires, piliers et classement/calendrier, dont le condensé suppose un arbitrage de contenu : consigné dans `ERREUR.txt`.

Tests : `tests/app/landing-mobile-layout.test.ts` (déclarations CSS ; le débordement lui-même a été vérifié en direct à 375 px et 1366 px).
