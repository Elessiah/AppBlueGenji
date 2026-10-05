# Carte de match — hiérarchie et pied d'action

## Constat

La carte de match (`MatchRow`, passage unique de l'arbre, de la survie, de la
ronde suisse et de BlueGenji Survie) faisait 210 px de large, en 11–13 px, et
empilait jusqu'à **huit boutons** de 11 px répartis dans trois bandeaux
(diffusion, lancement, rediff) puis trois rangées (score joueur, score
d'arbitrage, signalement). Il fallait plisser les yeux pour lire les noms, et
l'arbitrage voyait « 🗓 Date », « ⚙ Live », « ⇄ Hôte », « ▶ Forcer »,
« 🎙 Caster » et « ✎ Éditer le score » côte à côte sur chaque carte.

## Mise en page

De haut en bas, par ordre d'importance :

1. **Engagés et score** — 14 px (graisse 500), score en 16 px gras à chiffres
   tabulaires, lignes de 40 px. Vainqueur en vert, perdant en retrait
   (inchangé). Les noms passent toujours par `EntrantName`.
2. Mention « Match nul » / « Double forfait » (inchangée).
3. **Zone d'état** (`.meta`, 12 px) — `MatchLiveStrip` (horaire, « sans date »
   pour le staff, en direct / programmé, lien de la chaîne) puis
   `MatchLaunchStrip` (phase, équipe hôte, caster). Ces deux bandeaux
   **n'ont plus de bouton**. Vide, la zone disparaît avec son filet (`:empty`).
4. Bandeau « Rediff disponible » (lien seul) et proposition de score en attente.
5. **Pied d'action** (`MatchCardActions`) — une action principale pleine
   largeur et, s'il reste des actions, un bouton « Plus d'actions » (⋯).
6. « Score verrouillé » (constat d'arbitrage, inchangé).

Largeur : **260 px** (`MatchRow.module.css`), reprise par `CARD_W` de
`BracketTree` (connecteurs de l'arbre) et `COL_W` (276 px) de `RoundColumns`.

## Inventaire des actions

Chaque action garde **exactement** le public et l'effet qu'elle avait dans son
ancien bandeau : `matchCardActionList` (`_lib/match-card-actions.ts`) ne fait que
lire les drapeaux déjà calculés (`launchStripControls`, `canToggleOnAir`,
`canConfigureLive`, `canEditReplay`, `canReportOwnMatch`, `usePlayerScore`…).

| Action (libellé) | Public | Effet |
| --- | --- | --- |
| Saisir / Confirmer / Corriger le score | engagé du match (`usePlayerScore`) | modale joueur |
| Ouvrir le lancement / Infos du match | engagé ou caster du match, phases `LOBBY`/`LAUNCHED` | modale de lancement (`MATCH_LAUNCH_OPEN_EVENT`) |
| Planifier | permission `tournaments`, phase `TO_PLAN` | `MatchScheduleDialog` |
| Éditer le score / Valider le score proposé / Prononcer un forfait | carte arbitrable, score non verrouillé | modale d'arbitrage |
| Programmer une date / Modifier la date | `tournaments`, hors `TO_PLAN` | `MatchScheduleDialog` |
| Forcer le lancement | `tournaments`, phases `TO_PLAN`/`SCHEDULED`/`LOBBY` | **`ConfirmActionDialog`** puis `POST …/launch` |
| Changer l'équipe hôte | `tournaments` | `PUT …/host` |
| Caster ce match | `live`, match castable hors du sien, sans caster | `POST …/caster` (`aria-disabled` + motif si identité manquante) |
| Ne plus caster / Retirer le caster | caster inscrit / `tournaments` | `DELETE …/caster` |
| Lancer / Couper le direct | `live`, mode `MANUAL` | `POST …/live` |
| Diffuser ce match / Configurer la diffusion | `live` | configuration du direct |
| Ajouter / Modifier la rediff | `live` (`canEditReplay`) | dialogue de rediff |
| Signaler un problème | engagé inscrit, sur **son** match | signalement |

## Règle de rangement

`groupMatchCardActions` :

- **une seule action** offerte : elle reste visible, quelle qu'elle soit (un
  menu d'un élément n'ajouterait qu'un clic) ;
- sinon, l'action principale est la première offerte dans l'ordre
  **saisie joueur → ouvrir le lancement → planifier → score d'arbitrage** ;
  tout le reste passe derrière « Plus d'actions », dans l'ordre du tableau ;
- aucune principale (seules des actions secondaires) : « Plus d'actions »
  prend la largeur et montre son libellé.

En pratique : un engagé voit son score à saisir (ou son lancement), un spectateur
ne voit aucun bouton, l'arbitrage voit « Planifier » ou « Éditer le score ».

## « Plus d'actions » — clavier et accessibilité

- Bouton de **divulgation** (`aria-expanded`, `aria-controls`), pas
  `role="menu"` : même motif que le menu du compte. Le panneau se déplie
  sous le pied (au-dessus faute de place), **en `position: fixed` par-dessus
  les cartes voisines** : la carte garde sa taille. Déplié dans la carte, il
  la grandissait, et l'arbre — qui mesure ses cartes (`useSlotHeight`) pour
  régler la hauteur de **tous** ses créneaux — sautait sous le pointeur ; en
  `absolute`, il était rogné par le cadre des plateaux et les zones
  défilantes. Ses coordonnées (`panelPlacement`) le posent du côté du pied
  qui a le plus de place, **sans jamais recouvrir le pied** ni sortir de la
  fenêtre (8 px de marge) ; plus haut que cette place, sa liste
  (`<ScrollArea>` verticale) est bornée et défile. Elles suivent le
  défilement de la page, le redimensionnement, l'ajout ou le retrait d'une
  action par le flux et tout déplacement de la carte sans défilement (une
  ligne ajoutée par le flux, une voisine qui grandit : les ancêtres de la
  carte sont observés par un `ResizeObserver` tant que le panneau est ouvert),
  origine du repère retranchée (la page est sous un ancêtre transformé,
  `.fade-in`). Le défilement d'une zone **qui contient la carte** (arbre,
  colonnes de manche) le referme, focus rendu au bouton : la carte pourrait y
  sortir de la partie visible. Le panneau reste dans le DOM de
  la carte — l'ordre de tabulation suit le bouton — toujours rendu, masqué par
  `hidden` (sa zone défilante n'est montée qu'à l'ouverture). La carte garde
  son `overflow: hidden` : un descendant en `position: fixed` a son repère
  hors d'elle, elle ne le rogne pas.
- Échap referme et rend le focus au bouton (`handleMenuEscape`) ; un clic
  extérieur ou une tabulation qui sort du pied le referme (`focusLeftMenu`).
- Choisir une action referme le panneau et pose le focus sur « Plus
  d'actions » **avant** d'exécuter le geste : la modale ouverte rend ensuite
  le focus à un bouton qui existe encore.
- Nom accessible = libellé visible, puis le match (« Forcer le lancement :
  Alpha contre Bravo ») — WCAG 2.5.3, et huit cartes d'une ronde se
  distinguent. Le lien de la chaîne suit la même règle.
- Cibles de 36 px (44 px sous `pointer: coarse`), texte 13 px, couleurs par
  jetons ; aucune animation infinie.

## Tests

- `tests/tournois/match-card-actions.test.tsx` — liste et rangement (pur),
  public de chaque action par rendu de la carte, divulgation reliée à son
  panneau, branchements clavier et confirmation du lancement forcé.
- `tests/tournois/match-launch-strip.test.tsx`, `match-replay-strip.test.tsx` —
  bandeaux sans bouton, boutons retrouvés dans le pied d'action.
