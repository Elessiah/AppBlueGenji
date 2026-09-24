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
| `contrast` | Contraste renforcé | Jetons de texte secondaire au-dessus de 4,5:1 sur tous les fonds (`--ink-dim` n'atteint que 2,8:1 d'origine), traits moins transparents, texte indicatif lisible |
| `focus` | Focus très visible | Double anneau blanc + bleu sur liseré sombre, visible sur n'importe quel fond ; relayé sur la pastille de `Coche` |
| `links` | Liens soulignés | Tous les liens de texte soulignés (WCAG 1.4.1) ; les liens habillés en bouton (`.btn`, `CyberButton`) et les plaques `cardOverlay` ne le sont pas |
| `font` | Police simplifiée | Toutes les familles (`--font-title`, `--font-body`, `--font-mono`, `--font-display`) ramenées à Inter, sans capitales forcées ni lettres écartées |
| `spacing` | Espacement du texte | Interlignage 1,7 sur les blocs de lecture, écart des mots et des lettres, respiration entre paragraphes (WCAG 1.4.12) |
| `motion` | Réduire les animations | Même effet que la préférence système : animations décoratives figées, transitions et animations finies sautées |

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
valeur inconnue est ignorée (`parseA11yCookie`). Il est mentionné sur `/rgpd`.

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
- **Premier arrêt du clavier** sur chaque page.
- Panneau **non modal** (motif « disclosure ») : on voit l'effet d'un réglage
  en le cochant. Échap et un clic à côté le referment, Échap rend le focus au
  bouton. Panneau opaque — un texte qui transparaît derrière des réglages de
  lisibilité serait un contresens.
- « Tout désactiver » est désactivé par `aria-disabled` et non `disabled` : il
  garde le focus après avoir servi au lieu de le jeter au `<body>`.

## Notifications (`components/ui/toast.tsx`)

- Bouton **pause** et bouton **fermer** sur chaque notification, barre de
  progression qui s'arrête avec le décompte (masquée en mouvement réduit).
- Décompte suspendu au survol et au **focus clavier** (`:focus-visible` : un
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
