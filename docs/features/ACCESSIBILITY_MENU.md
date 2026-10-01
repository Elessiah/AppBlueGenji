# Menu d'accessibilité et pauses (notifications, bandeau)

Un bouton flottant, au bord gauche de **toutes** les pages, ouvre un menu de
réglages d'accessibilité. Deux règles de conception, voulues ensemble :

1. **Tout ce qui change l'apparence du site est désactivé par défaut** et ne
   s'active que dans ce menu. Le site de base garde son esthétique ; qui a
   besoin de la déplacer le fait, pour lui seul.
2. **Ce qui n'enlève rien à l'esthétique est acquis pour tous** : les boutons
   pause des notifications et du bandeau défilant, et leur annonce aux lecteurs
   d'écran, ne sont pas des réglages.

## Les réglages (`lib/shared/accessibility-settings.ts`)

| Clé | Intitulé | Effet |
|---|---|---|
| `contrast` | Contraste renforcé | Jetons de texte secondaire au-dessus de 4,5:1 sur tous les fonds (`--ink-dim` n'atteint que 2,8:1 d'origine), bordures et séparateurs plus marqués, texte indicatif lisible |
| `focus` | Focus très visible | Double anneau blanc + bleu sur liseré sombre, visible sur n'importe quel fond ; relayé sur la pastille de `Coche` |
| `links` | Liens soulignés | Tous les liens de texte soulignés (WCAG 1.4.1) ; les liens habillés en bouton (`.btn`, `CyberButton`) et les plaques `cardOverlay` ne le sont pas |
| `font` | Police simplifiée | Toutes les familles (`--font-title`, `--font-body`, `--font-mono`, `--font-display`) ramenées à Inter, sans capitales forcées ni lettres écartées |
| `spacing` | Espacement du texte | Interlignage 1,7 sur les blocs de lecture, écart des mots et des lettres, respiration entre paragraphes (WCAG 1.4.12) |
| `motion` | Réduire les animations | Même effet que la préférence système : animations décoratives figées, transitions et animations finies sautées, **et** régime éco pour les boucles JS (fond animé, inclinaison du logo) — `useClientPower` observe l'attribut (`motionSetting`), sans faire paraître le témoin du régime de charge |

Il n'y a **pas** de réglage de taille du texte : le site est écrit en pixels,
et le zoom du navigateur (Ctrl +) fait déjà ce travail sans casser la mise en
page. Le menu le dit.

### Le mécanisme

Un seul attribut : `<html data-a11y="contrast focus …">`, une liste de mots que
`app/globals.css` lit par `:root[data-a11y~="<clé>"]`. Aucun composant ne
connaît un réglage : un écran ajouté demain en hérite. Sans l'attribut, aucune
règle ne s'applique — le site est exactement celui d'avant le menu.

L'attribut est posé **par le serveur**, dans le HTML initial (`app/layout.tsx`),
depuis le cookie `bg_a11y`. Appliqué après l'hydratation, un contraste renforcé
ferait d'abord clignoter la page dans ses couleurs d'origine à chaque
chargement — précisément chez qui ne les lit pas. D'où un **cookie** plutôt que
`localStorage` : c'est le seul état du navigateur qu'une requête transporte.
Le cookie n'existe que si un réglage est actif, ne contient que les clés
(`contrast.focus`), dure un an, et il est effacé quand tout est désactivé. Une
valeur inconnue est ignorée (`parseA11yCookie`). Il est mentionné sur `/rgpd`,
mais n'a **pas** d'entrée dans `PRIVACY_CHANGES` : il ne porte aucune donnée sur
une personne, n'est déposé qu'à la demande du lecteur et reste dans ce qui est
déjà annoncé à tous (« seuls des cookies techniques sont déposés »).

Deux pièges de spécificité, tenus dans la feuille :

- les jetons de police sont posés **en ligne** sur `<body>` (`FONT_VARIABLES`) :
  seule une déclaration `!important` les surcharge ;
- `font` remet l'espacement des lettres à zéro partout, en lisant le jeton
  `--a11y-letter-spacing` (repli `normal`) ; `spacing` pose ce jeton sur
  `:root`, si bien que, combinés, chaque élément reprend l'écart de
  l'espacement — sans règle aux deux clés ni valeur `!important` en dur.

## Le bouton et son panneau (`components/accessibility/AccessibilityMenu.tsx`)

- **Onglet collé au bord gauche, à mi-hauteur** (28 × 64 px) au-delà de
  720 px. Il tenait le coin bas gauche, où il couvrait « Inscrire mon équipe »
  sur la fiche d'un tournoi (1280 × 720, vue staff) à certaines positions de
  défilement : un coin est là où le contenu d'une colonne finit par passer en
  défilant, et aucune position fixe posée *sur* la colonne n'y échappe. Le bord
  gauche est **hors** de la colonne : toute colonne de page y réserve une
  gouttière d'au moins 32 px, où l'onglet tient avec 4 px d'écart — il ne
  couvre donc aucun contenu, à aucune position de défilement. La gouttière est
  un **jeton**, `--a11y-tab-gutter` (`app/globals.css` : 0 sous 721 px, 80 px
  au-delà, soit 32 px par côté une barre de défilement de 16 px déduite), et
  une colonne l'écrit `calc(100vw - max(<sa gouttière>, var(--a11y-tab-gutter)))`
  — `.page-shell` de l'espace connecté comme les colonnes des pages vitrine
  (accueil, association, bénévoles, recrutement, règles, pages légales, en-tête
  et pieds de page, `/bot` et `/bot/docs` par `.bot-container`). Sous 721 px le
  `max()` rend la gouttière propre à chaque page, inchangée.
  `tests/app/a11y-tab-gutter.test.ts` refuse toute colonne (au moins 720 px de
  large) à gouttière littérale hors d'une requête `max-width` de 720 px au
  plus : c'est ce motif recopié qui avait laissé les pages vitrine à 20 px. Mi-hauteur plutôt que haut ou bas : le haut est à
  l'en-tête collant, le bas aux notifications. Les coins droits restent au
  bouton « ? » des règles (`.cta-float-help`) et au témoin du régime de charge.
  Le panneau s'ouvre à droite de l'onglet, centré sur la hauteur de l'écran
  (`position: fixed` + `translate`, que l'animation d'ouverture ne réécrit pas).
  Cible : 28 px de large (au-dessus des 24 px de WCAG 2.5.8), 64 px de haut.
- **Sous 720 px**, la gouttière n'a plus que 12 px : le bouton redevient un
  **disque de 48 px dans le coin bas gauche**, s'estompe pendant un défilement
  (`floating-button-scroll.ts`) et son panneau s'ouvre vers le haut.
- **Notifications** : en bas à gauche, à 40 px du bord sur ordinateur (jamais
  sur l'onglet, même quand la pile monte jusqu'à lui) ; sous 720 px, elles
  montent au-dessus du disque.
- **Modale ouverte** : le bouton reste offert, au-dessus de tous les voiles,
  réduit à un disque de 36 px en haut à gauche, panneau ouvert vers le bas ;
  il se retire seulement sous le recadrage d'image.
- Bleu glacier plein, logo en bleu nuit découpé par un **masque CSS**
  (`public/accessibility-icon.webp`, dérivé du logo fourni) : le fichier
  n'apporte que la forme, la couleur est celle de la feuille — y compris en
  contrastes forcés, où elle devient `ButtonText`.
- Une pastille compte les réglages actifs, et l'intitulé du bouton le dit aussi.
- **Le menu est toujours en contraste renforcé**, réglage coché ou non : c'est
  lui qui permet de l'activer, il doit donc se lire avant. Sa racine porte la
  classe `.a11y-always-contrast`, ajoutée à la règle même du réglage
  (`:root[data-a11y~="contrast"], .a11y-always-contrast`) — mêmes jetons,
  aucune seconde liste de valeurs à tenir. C'est la seule règle de la section
  qui vaille sans l'attribut (elle habille aussi le pied de page, voir plus bas).
- **Premier arrêt du clavier** sur chaque page.
- Panneau **non modal** (motif « disclosure ») : on voit l'effet d'un réglage
  en le cochant. Échap, un clic à côté **et le focus clavier qui en sort** le
  referment (laissé ouvert, il masquerait la suite de la tabulation) ; Échap
  rend le focus au bouton — mais ne répond que si le focus est dans le menu ou
  nulle part : une modale ouverte par-dessus (lancement de match) garde le sien.
- `html { scroll-padding-bottom }` (92 px, 76 px sous 720 px) : un défilement
  déclenché par le focus arrête l'élément atteint au-dessus des boutons
  flottants du bas (le disque d'accessibilité sous 720 px, le « ? » et le
  témoin) au lieu de le cacher dessous (WCAG 2.4.11). Invisible tant qu'on ne tabule pas, donc
  acquis pour tous.
- Panneau opaque — un texte qui transparaît derrière des réglages de
  lisibilité serait un contresens.
- « Tout désactiver » est désactivé par `aria-disabled` et non `disabled` : il
  garde le focus après avoir servi au lieu de le jeter au `<body>`.

## Seconde porte : « Réglages d'accessibilité » dans le pied de page

Le bouton flottant se manque, et c'est dans le pied de page qu'on cherche
d'abord « accessibilité ». La colonne « Légal » de `PublicFooter` porte donc
une entrée **Réglages d'accessibilité** (`components/accessibility/AccessibilityFooterLink.tsx`)
qui ouvre **le même menu** — jamais une seconde copie, qui aurait son propre
état. C'est un **bouton** et non un lien : il n'emmène nulle part. Le libellé
se distingue à dessein de la mention RGAA voisine, « Accessibilité : non
conforme » — deux liens presque homonymes l'un sous l'autre ne disaient pas
lequel des deux ouvre le menu et lequel mène à la déclaration.

- **Un évènement de la fenêtre**, pas un contexte React
  (`lib/shared/accessibility-menu-request.ts` : `requestAccessibilityMenu()`,
  `OPEN_ACCESSIBILITY_MENU_EVENT`). Le pied de page est un composant serveur,
  sans ancêtre client commun avec le menu monté par `app/layout.tsx`. Sans
  menu à l'écoute, la demande ne fait rien et ne casse rien.
- Ouvert ainsi, le menu **prend le focus** (le panneau, `tabIndex={-1}`, sans
  devenir un arrêt de tabulation) : il ne suit pas le pied de page dans l'ordre
  du document, et le focus resté en bas de page l'aurait refermé à la première
  tabulation. Échap et « × » **rendent le focus à qui l'a demandé** — le bouton
  du pied de page — et au bouton flottant à défaut. Le déclencheur voyage
  **dans l'évènement** (`CustomEvent`, `detail.opener`) plutôt que d'être lu
  sur `document.activeElement` : Safari ne donne pas le focus à un bouton
  cliqué. Les deux décisions sont pures (`resolveMenuOpener`,
  `focusReturnTarget`).
- Seules les pages vitrine ont un pied de page : l'espace connecté n'a que le
  bouton flottant.

## Contraste du pied de page

Le pied de page porte `.a11y-always-contrast`, comme le menu : ses textes
secondaires (`--ink-mute`, `--ink-dim`, jusqu'aux étiquettes 10 px du bloc
Contact) prennent les valeurs du réglage « Contraste renforcé », toutes au-dessus
de 4,5:1. On y cherche les mentions légales et l'accessibilité : il doit se lire
sans réglage, quitte à être moins discret. Il pose aussi son **fond opaque**
(`--cyber-bg`) pour que le contraste ne dépende pas du décor de la page, et
donne à ses liens un anneau de focus explicite. Ses liens ne sont **pas**
soulignés au repos : souligner chaque ligne de cinq colonnes rendait le bloc
illisible, et une colonne de liens sous un intitulé se reconnaît par sa place
(WCAG 1.4.1 ne vise que les liens pris dans un texte courant). Le soulignement
revient au survol, au focus, et en permanence avec « Liens soulignés » — que le
bouton « Réglages d'accessibilité » reprend dans sa feuille, la règle globale ne
visant que `a[href]`. Ce bouton est aligné à gauche comme ses voisins (un
bouton centre son texte, ce qui se voyait dès qu'il passait sur deux lignes).
Le contraste renforcé permanent est une **exception
voulue** à la règle « tout ce qui change l'apparence est désactivé par défaut » :
le pied de page est justement l'endroit où l'on cherche le menu, il ne peut pas
dépendre d'un réglage. Enfin son rembourrage du bas (92 px, 76 px sous 720 px,
comme le `scroll-padding-bottom` global) sort sa dernière ligne de sous le
bouton flottant, que rien ne peut plus faire défiler en fin de page.

## Notifications (`components/ui/toast.tsx`)

- Bouton **pause** et bouton **fermer** sur chaque notification, barre de
  progression qui s'arrête avec le décompte (masquée en mouvement réduit).
- Une notification fermée avec le focus le rend à l'élément d'où il venait,
  au lieu de le laisser tomber sur `<body>`.
- La pile s'arrête à la moitié de l'écran, et sous 720 px elle monte au-dessus
  de la pastille de lancement de match (`MatchLaunchCenter`).
- Décompte suspendu au survol **à la souris** (un tap tactile émule l'entrée
  du pointeur sans sa sortie) et au **focus clavier** (`:focus-visible` : un
  clic de souris laisse le focus sur le bouton cliqué, et le décompte ne
  reprendrait jamais). Le bouton pose un choix explicite qui prime sur les deux
  (`isCountdownHeld`) : « Reprendre » relance même sous le pointeur qui vient
  de cliquer. Logique pure dans `lib/shared/pausable-countdown.ts`.
- Deux zones d'annonce **permanentes** et invisibles (`role="status"`,
  `role="alert"`) : un lecteur d'écran n'annonce de façon fiable que ce qui
  change *dans* une zone déjà présente.

## Bandeau défilant (`components/cyber/Ticker.tsx`)

- Bouton pause au bout d'un fondu, arrêt au survol du texte (WCAG 2.2.2).
  Ni le survol ni le focus du **bouton** ne figent la piste : c'est le seul
  élément focalisable du bandeau, et un clic le focalise — un arrêt au
  `:focus-within` tenait le bandeau figé après « ▶ », si bien que la reprise ne
  reprenait rien.
- La copie qui fait boucler la piste est `aria-hidden` : chaque élément n'est
  plus lu deux fois. Le bandeau est un `role="marquee"` nommé.

## Tests

- `tests/lib/shared/accessibility-settings.test.ts`, `pausable-countdown.test.ts` — logique pure ;
- `tests/app/accessibility-menu.test.tsx`, `toast.test.tsx`, `ticker.test.tsx` — rendu ;
- `tests/app/accessibility-styles.test.ts` — chaque clé du registre a sa règle
  dans `globals.css`, et aucune règle ne s'applique sans l'attribut ; les
  éléments flottants ne se chevauchent pas.

Les points d'accessibilité relevés par l'audit et non traités ici sont listés
dans `ACCESSIBILITE.md`, à la racine.

## Notes reprises de CLAUDE.md

Texte déplacé tel quel depuis `CLAUDE.md` (allègement du fichier chargé à chaque session).

- **Menu d'accessibilité** (`lib/shared/accessibility-settings.ts` pur + `components/accessibility/AccessibilityMenu.tsx`) : bouton flottant au bord **gauche** de toutes les pages — **onglet collé au bord, à mi-hauteur**, au-delà de 720 px, dans la gouttière que `.page-shell` réserve (32 px au moins, `@media (min-width: 721px)`) : posé dans le coin bas gauche, il couvrait « Inscrire mon équipe » sur la fiche d'un tournoi à certaines positions de défilement, et aucune position fixe *sur* la colonne n'y échappe ; disque en bas à gauche sous 720 px, où il s'estompe au défilement ; réduit en haut à gauche au-dessus des modales (le coin droit est au « ? » des règles et au témoin du régime de charge ; les notifications tiennent le bas à gauche, à 40 px du bord sur ordinateur, au-dessus du disque sur téléphone) —, premier arrêt du clavier. **Règle pour la suite : tout réglage qui change l'apparence du site est désactivé par défaut et vit dans ce menu** ; ce qui n'enlève rien à l'esthétique (pause d'une notification ou d'un bandeau, annonce aux lecteurs d'écran) est acquis pour tous. Six réglages (`contrast`, `focus`, `links`, `font`, `spacing`, `motion` — ce dernier alimente aussi le régime de charge, pour les boucles JS), un seul mécanisme : `<html data-a11y="…">` posé **par le serveur** depuis le cookie `bg_a11y` (sans quoi le contraste clignoterait à chaque chargement), lu par `:root[data-a11y~="<clé>"]` dans `app/globals.css` — aucun composant ne connaît un réglage. Le menu lui-même est **toujours** en contraste renforcé (classe `.a11y-always-contrast`, ajoutée à la règle du réglage : mêmes jetons) — il doit se lire avant qu'on ait pu y cocher quoi que ce soit. Le **pied de page** vitrine porte la même classe (il doit se lire sans réglage) et une entrée « Réglages d'accessibilité » qui ouvre **le même** menu par un évènement de la fenêtre (`requestAccessibilityMenu`, `lib/shared/accessibility-menu-request.ts`) — le menu prend alors le focus et le rend au bouton qui l'a demandé (transmis dans l'évènement : Safari ne focalise pas un bouton cliqué). Le contraste renforcé y est une **exception voulue** à la règle ci-dessus : c'est là qu'on cherche le menu. Ses liens, eux, ne sont soulignés qu'au survol, au focus ou avec le réglage « Liens soulignés » : soulignée ligne à ligne, la grille de cinq colonnes devenait illisible. Ajouter un réglage = une entrée au registre **et** sa règle (`tests/app/accessibility-styles.test.ts` refuse une clé sans règle). Notifications : pause, fermeture, décompte suspendu au survol et au focus clavier (`lib/shared/pausable-countdown.ts`), zones d'annonce permanentes. Bandeau défilant : pause, copie `aria-hidden`. Le reste de l'audit RGAA/WCAG est listé dans `ACCESSIBILITE.md`. Voir `docs/features/ACCESSIBILITY_MENU.md`.
