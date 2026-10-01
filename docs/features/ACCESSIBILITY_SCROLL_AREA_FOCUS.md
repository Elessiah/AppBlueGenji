# Zones défilantes — focalisables seulement quand elles défilent

Tâche 18 d'`ACCESSIBILITE.md` · WCAG 2.4.3 / 2.1.1 · RGAA 12.8, 12.6.

## Le problème

`components/cyber/ScrollArea.tsx` posait **toujours** `tabIndex={0}` et, dès
qu'un `ariaLabel` était fourni, `role="region"`. Sur un grand écran où le contenu
tient dans la zone, cela faisait :

- un **arrêt de tabulation qui ne fait rien** — les flèches n'y ont rien à
  défiler ;
- un **repère de plus** autour d'un contenu souvent déjà nommé. Le classement de
  la ronde suisse s'annonçait deux fois : « Classement du tournoi — défilement
  horizontal » (la zone), puis « Classement du tournoi » (le tableau).

## La règle

Écrite une fois, dans le module pur `lib/shared/scroll-overflow.ts` :

| État de la zone                     | `tabIndex` | `role`   | `aria-label` |
| ----------------------------------- | ---------- | -------- | ------------ |
| Déborde, avec `ariaLabel`           | `0`        | `region` | posé         |
| Déborde, sans `ariaLabel`           | `0`        | —        | —            |
| Ne déborde pas                      | —          | —        | —            |
| Ne déborde plus mais a le focus     | `0`        | si nommée | si nommée   |

- **Débordement** (`hasScrollableOverflow`) : `scrollWidth − clientWidth` ou
  `scrollHeight − clientHeight` au-delà d'**1 px** (les deux mesures sont
  arrondies chacune de leur côté). Les deux axes sont lus quelle que soit
  l'orientation : `overflow-y: visible` à côté d'un `overflow-x: auto` est
  calculé `auto`, une zone « horizontale » peut donc aussi défiler verticalement.
- **Le nom part avec le rôle** : `aria-label` est interdit sur un élément
  générique (ARIA 1.2).
- **Avant toute mesure** — rendu serveur, puis jusqu'à la première mesure après
  l'hydratation — la zone est **focalisable**. Le choix n'est pas symétrique :
  un arrêt de trop est une gêne, une zone qui déborde sans pouvoir être atteinte
  au clavier est un blocage (WCAG 2.1.1). Le rendu serveur et le premier rendu
  client coïncident ainsi, sans écart d'hydratation.
- **Une zone qui a le focus le garde** : retirer le `tabindex` d'un élément
  focalisé renvoie le focus en tête de document. Seul compte le focus posé sur la
  zone elle-même (`isOwnFocusEvent` — celui d'un bouton qu'elle contient remonte
  par `onFocus`), et un `blur` dû à la seule perte de focus de la **fenêtre** ne
  compte pas (`releasesFocus`) — la zone reste alors l'élément actif et le
  retrouvera au retour. Chaque mesure relit aussi `document.activeElement` : un
  `focus()` appelé dans un onglet ouvert en arrière-plan (la modale RGPD) n'émet
  **aucun** évènement, et sans cette relecture la première mesure retirait le
  `tabindex` sous le focus.

## La surveillance

`watchScrollOverflow` relit le débordement quand :

- la **zone** change de taille (fenêtre, panneau replié) ;
- un **enfant direct** change de taille — le flux SSE ajoute une ronde, la zone
  garde la sienne ; un enfant ajouté est observé à son tour, un enfant retiré
  cesse de l'être (d'après les `MutationRecord`, sans tout réinscrire) ;
- le **contenu** change sans qu'aucune boîte observée ne bouge
  (`MutationObserver` sur tout le sous-arbre) : les pistes en `em` d'une grille
  débordent de la grille, dont la largeur reste celle de la zone ;
- le **texte** s'élargit sans aucune écriture dans la zone : réglage
  d'accessibilité posé sur `<html data-a11y>` (« Espacement du texte »,
  « Police simplifiée »), ou police web chargée après la première mesure
  (`document.fonts`, `loadingdone`).

Les deux derniers cas sont ceux où se tromper coûte le plus : ils font
**apparaître** un débordement, et une zone restée non focalisable serait
inatteignable au clavier.

Tout ce que la surveillance lit du navigateur lui est passé en argument : le
module se teste sans DOM. Sans `ResizeObserver`, rien n'est mesuré et la zone
garde le défaut prudent.

## Appelants

Aucun appelant ne dépendait du rôle pour fonctionner, un seul le lisait :
`PrivacyChangesModal` y cherche la liste des changements pour y reposer le focus
au retour de la confirmation (`[role="region"]`). La zone y est remontée dans le
même rendu, donc encore focalisable ; et si elle ne l'était pas, le repli existant
pose le focus sur la modale elle-même — jamais sur le bouton de refus.

À l'ouverture de la même modale, `useDialogBehavior` prend le premier élément
focalisable : la liste si elle l'est, sinon le lien vers la politique, qui la
suit — là encore, pas le bouton de refus.

## Notes reprises de CLAUDE.md

Texte déplacé tel quel depuis `CLAUDE.md` (allègement du fichier chargé à chaque session).

- **Zones défilantes** : toute zone qui défile passe par `<ScrollArea>` (`@/components/cyber`) — jamais un `overflowX/Y: "auto"` posé à la main. Le style des barres est global (`app/globals.css`) : plus aucune barre blanche par défaut, ni sur la page, ni dans un conteneur. `ScrollArea` y ajoute la variante discrète (barre révélée au survol), le dégradé de bord optionnel (`fade`) et l'accessibilité clavier — `tabIndex` et, avec un `ariaLabel` (à renseigner systématiquement), `role="region"` et le nom, **seulement quand la zone déborde réellement** (`lib/shared/scroll-overflow.ts`, relu à chaque changement de taille de la zone ou d'un enfant, de son contenu, d'un réglage d'accessibilité et au chargement d'une police) : une zone dont le contenu tient n'est ni un arrêt de tabulation ni un repère. Avant toute mesure (rendu serveur, hydratation) elle est focalisable — un arrêt de trop gêne, une zone qui déborde sans être atteignable bloque —, et elle le reste tant qu'elle a le focus. Un appelant ne compte donc jamais sur le `role` pour retrouver la zone sans prévoir de repli (voir `docs/features/ACCESSIBILITY_SCROLL_AREA_FOCUS.md`). Les couleurs se règlent par les tokens `--scrollbar-size`, `--scrollbar-thumb`, `--scrollbar-thumb-hover`, `--scrollbar-track`, surchargeables localement. Au doigt (`(pointer: coarse)`), une zone horizontale sans `fade` estompe le bord où il reste du contenu (`data-scroll-hint`, `lib/shared/scroll-hint.ts`) : la barre des navigateurs mobiles se superpose et s'efface, rien d'autre ne dit que la zone continue.
