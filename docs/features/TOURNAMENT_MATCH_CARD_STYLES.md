# Carte de match et fiche de tournoi — styles sur les jetons

## Constat

`MatchRow` (la carte de match, passage unique des quatre vues du plateau) et
`app/(secured)/tournois/[id]/page.tsx` portaient leurs styles **en ligne**, avec
des couleurs littérales et des jetons d'avant la refonte :

- l'ambre du forfait (`rgba(255,157,46,0.9)`), le voile des lignes, les
  bordures (`var(--border, #444)`) : des valeurs écrites en dur, que le réglage
  « Contraste renforcé » — qui ne redéfinit que des **jetons** — ne pouvait pas
  atteindre ;
- deux jetons **définis nulle part** : `--surface-1` (le fond de la carte, donc
  transparent) et `--green` (le score du vainqueur, qui prenait la couleur de sa
  ligne) — panne muette, une déclaration invalide au calcul n'affichant rien ;
- le titre de l'échec définitif en `.ds-title` : un dégradé découpé dans un
  texte transparent, sans couleur que le contraste renforcé puisse éclaircir ;
- le classement d'une phase terminée (multi-phases) **recopié trois fois**, un
  `<div>` pour titre, intitulé « Classement » dans une branche et « Qualifiées »
  dans les deux autres pour le même contenu.

## Ce qui a changé

- `MatchRow.module.css` : la carte passe sur les jetons cyber (`--cyber-bg-2`,
  `--line-strong-cy`, `--ink`, `--ink-mute`, `--amber`, `--blue-300`,
  `--blue-500-rgb`) ; le vert du vainqueur reste `--accent-green`, seul vert du
  système. Les boutons d'action vivent dans le pied d'action de la carte
  (`MatchCardActions.module.css`, sur les mêmes jetons) — voir
  `MATCH_CARD_LAYOUT.md`.
- `page.module.css` : ce que la page pose autour de ses panneaux (textes vides,
  espacement des tableaux, aperçu, zone de danger). Le cadre des panneaux
  (`.ds-block`, `.ds-section-title`) **reste la classe globale** : c'est celui de
  tous les panneaux de l'espace connecté, voisins de cette page compris
  (inscrites, contacts, progression) — le migrer ici seul fragmenterait la page.
- `PhaseStandingsBlock` : un seul composant, un vrai titre (`<h3>`, section
  nommée par `aria-labelledby`) et un seul intitulé, **« Classement de la
  phase »** — le tableau liste toutes les engagées avec leur rang, les
  qualifiées marquées d'une colonne.
- La classe `.match-anchor-target` (halo d'un lien profond) reste globale : le
  réglage « Réduire les animations » la vise par son nom.

`tests/app/tournament-match-card-styles.test.ts` garde l'état : aucun style en
ligne ni couleur littérale dans les deux fichiers, aucun `var(--x)` sans repli
qui désigne un jeton absent, et le classement de phase rendu une seule fois.
