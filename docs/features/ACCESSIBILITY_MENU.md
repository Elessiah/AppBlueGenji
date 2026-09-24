# Menu d'accessibilité et pauses (notifications, bandeau)

Un bouton flottant, en bas à gauche de **toutes** les pages, ouvre un menu de
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
- `font` remet l'espacement des lettres à zéro partout ; combiné à `spacing`,
  l'espacement est reposé élément par élément par une règle aux deux clés.

## Le bouton et son panneau (`components/accessibility/AccessibilityMenu.tsx`)

- **Coin bas-gauche**, le seul libre : à droite vivent le bouton « ? » des
  règles (`.cta-float-help`) et le témoin du régime de charge. Les
  notifications, qui tenaient ce coin, montent au-dessus du bouton.
- Disque plein de bleu glacier, logo en bleu nuit découpé par un **masque CSS**
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
  déclenché par le focus arrête l'élément atteint au-dessus du bouton au lieu
  de le cacher dessous (WCAG 2.4.11). Invisible tant qu'on ne tabule pas, donc
  acquis pour tous.
- Panneau opaque — un texte qui transparaît derrière des réglages de
  lisibilité serait un contresens.
- « Tout désactiver » est désactivé par `aria-disabled` et non `disabled` : il
  garde le focus après avoir servi au lieu de le jeter au `<body>`.

## Seconde porte : « Accessibilité » dans le pied de page

Le bouton flottant se manque, et c'est dans le pied de page qu'on cherche
d'abord « accessibilité ». La colonne « Légal » de `PublicFooter` porte donc
une entrée **Accessibilité** (`components/accessibility/AccessibilityFooterLink.tsx`)
qui ouvre **le même menu** — jamais une seconde copie, qui aurait son propre
état. C'est un **bouton** et non un lien : il n'emmène nulle part.

- **Un évènement de la fenêtre**, pas un contexte React
  (`lib/shared/accessibility-menu-request.ts` : `requestAccessibilityMenu()`,
  `OPEN_ACCESSIBILITY_MENU_EVENT`). Le pied de page est un composant serveur,
  sans ancêtre client commun avec le menu monté par `app/layout.tsx`. Sans
  menu à l'écoute, la demande ne fait rien et ne casse rien.
- Ouvert ainsi, le menu **prend le focus** (le panneau, `tabIndex={-1}`, sans
  devenir un arrêt de tabulation) : il ne suit pas le pied de page dans l'ordre
  du document, et le focus resté en bas de page l'aurait refermé à la première
  tabulation. Échap et « × » **rendent le focus à qui l'a demandé** — le bouton
  du pied de page — et au bouton flottant à défaut.
- Seules les pages vitrine ont un pied de page : l'espace connecté n'a que le
  bouton flottant.

## Contraste du pied de page

Le pied de page porte `.a11y-always-contrast`, comme le menu : ses textes
secondaires (`--ink-mute`, `--ink-dim`, jusqu'aux étiquettes 10 px du bloc
Contact) prennent les valeurs du réglage « Contraste renforcé », toutes au-dessus
de 4,5:1. On y cherche les mentions légales et l'accessibilité : il doit se lire
sans réglage, quitte à être moins discret. Il pose aussi son **fond opaque**
(`--cyber-bg`) pour que le contraste ne dépende pas du décor de la page, souligne
ses liens et leur donne un anneau de focus explicite.

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

- Bouton pause au bout d'un fondu, arrêt au survol et au focus (WCAG 2.2.2).
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
