# Accueil en desktop — l'appel principal au premier écran

Relevé par l'audit UI/UX de l'accueil (2026-09-25) : sur un portable, le bouton « Inscrire mon équipe » tombait à 862–903 px du haut de la page. Il était donc **sous la ligne de flottaison** dès 1366×768 — et plus encore dans un vrai navigateur, où la barre d'onglets ne laisse qu'environ 657 px de fenêtre. Le titre, en 82 px, remplissait le premier écran à lui seul.

## Ce qui a changé

`components/cyber/landing/Hero.module.css` :

- **Titre réglé sur la hauteur d'écran** : `clamp(38px, min(5.2vw, 8.4vh), 68px)` (classe `.title`, qui remplace le style en ligne). À 82 px, sur la colonne de gauche d'un portable, « gagner ensemble. » passait sur deux lignes : le titre en faisait quatre. `min()` retient la plus contraignante des deux dimensions ; le plancher de 38 px est celui qu'avait déjà le mobile, qui ne change pas.
- **Haut du hero proportionnel** : `padding-top: clamp(32px, 6vh, 80px)` au lieu de 80 px fixes (le mobile garde ses 48 px sous 720 px).
- **Accroche et actions resserrées** : interligne 1,8 → 1,65, marges 24 → 20 et 34 → 28 px.
- **Jambages du titre** : le dégradé de la dernière ligne (`.accent`, `background-clip: text`) ne peint que la boîte de l'élément, haute d'une ligne à `line-height: 1.02` ; le bas du « g » restait transparent. La boîte est allongée vers le bas (`padding-bottom` compensé par une marge négative), sans rien déplacer.

`components/cyber/landing/DiscordCommunity.module.css` : le libellé « Rejoindre le Discord » passe **en contour** (bordure blurple, texte clair) au lieu d'un aplat blurple. Plein, c'était l'élément le plus saillant du hero, devant l'appel principal de la page. L'aplat revient au survol et au focus, quand le bloc est déjà celui qu'on vise ; l'emblème blurple garde la reconnaissance de Discord.

## Mesures (en direct, compte staff, un tournoi à l'antenne)

| Fenêtre     | Titre   | « Inscrire mon équipe » (haut → bas) |
|-------------|---------|--------------------------------------|
| 1366×657    | 55 px   | 603 → 644 px                         |
| 1366×768    | 64,5 px | 650 → 691 px (avant : 862 → 903)     |
| 1920×1080   | 68 px   | 684 → 725 px                         |
| 375×812     | 38 px   | inchangé                             |

Aucun défilement horizontal à ces quatre largeurs.

Tests : `tests/app/landing-hero-fold.test.ts` (déclarations CSS ; la position elle-même ne se mesure qu'en navigateur).
