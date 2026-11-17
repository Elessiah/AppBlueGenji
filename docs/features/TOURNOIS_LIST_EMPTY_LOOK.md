# `/tournois` vide ou presque — états vides et voiles sans arête

Demande (2026-11-17) : sans tournoi, ou avec une seule carte, la page paraissait
très sombre — un grand panneau vide sous la barre d'outils, et des dégradés
coupés net sur le noir.

## Voiles qui s'éteignent sur leurs bords

Le voile `.fabric` (dégradés radiaux glacier) est posé dans une boîte en
`overflow: hidden` : la page `/tournois` (`tournois.module.css`) et l'en-tête des
annuaires `/equipes` et `/joueurs` (`annuaire.module.css`, voile global de
`app/globals.css`, partagé avec les autres pages vitrine). Coupé par la boîte, il
dessinait un panneau aux arêtes dures, d'autant plus visible que la liste était
courte. Les deux `.fabric` portent désormais deux masques croisés
(`mask-composite: intersect`, `-webkit-mask-composite: source-in`) :
horizontal (`--fade-x`, `min(18 %, 220 px)` de chaque côté) et vertical
(`--fade-top`, `--fade-bottom`) ; seul le centre reste plein, à toute largeur
(375 px → grand écran).

Le filet bas de la page (`/tournois`) et de l'en-tête des annuaires n'est plus
un `border-bottom` tiré d'un bord à l'autre : un `::after` d'un pixel en
`linear-gradient(90deg, transparent, var(--line-soft) 20 %, … 80 %, transparent)`.

## États vides (`ListEmptyState`, `_lib/empty-state.ts`)

`listEmptyKind` (pur) choisit l'état :

| État | Quand | Contenu |
| --- | --- | --- |
| `empty` | aucune section, aucun filtre | « Aucun tournoi pour le moment », « Créer un tournoi » (droit `tournaments`), « Lire les règles » |
| `filtered` | aucune section, recherche ou jeu actif | « Aucun résultat », bouton « Effacer la recherche et les filtres » (vide la recherche, remet « Tous », rend le focus au champ) |
| `nothingUpcoming` | des sections, mais ni inscriptions ouvertes ni annonce (« Mes tournois » compris, avant découpage) et aucune recherche tapée | « Aucun tournoi à venir annoncé », `InfoHint` (Prochainement → Inscriptions ouvertes), « Créer » (staff), « Voir les tournois terminés » (s'il y en a : déplie la section), « Lire les règles » |
| `null` | liste pas encore lue, ou de quoi s'inscrire | rien |

Une recherche tapée ne donne jamais `nothingUpcoming` (son résultat répond déjà) ;
un jeu choisi le garde (« rien à venir en Marvel Rivals » reste vrai). Le panneau
`nothingUpcoming` se place là où seraient « Inscriptions » et « Prochainement »,
avant « Terminés ».

Le panneau : cadre glacier (jamais gris), halo radial qui s'éteint bien avant ses
bords, pictogramme Lucide dans un anneau qui respire (`transform`/`opacity`,
`animation-play-state: var(--deco-anim-state)`), titre en `<h2>`. Aucune teinte
chaude. Textes sous `tournaments.list.emptyState` (FR et EN) ; les anciennes clés
`emptyTitle`/`emptyUnfiltered`/`emptyFiltered` et `sectionEmptyMessage` ont disparu.

Tests : `tests/tournois/list-empty-look.test.tsx`.
