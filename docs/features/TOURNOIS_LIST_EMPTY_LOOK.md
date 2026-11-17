# `/tournois` vide ou presque — états vides et voiles sans arête

Demande (2026-11-17) : sans tournoi, ou avec une seule carte, la page paraissait
très sombre — un grand panneau vide sous la barre d'outils, et des dégradés
coupés net sur le noir.

## Voiles qui s'éteignent sur leurs bords

Le voile `.fabric` (dégradés radiaux glacier) est posé dans une boîte en
`overflow: hidden` : la page `/tournois` (`tournois.module.css`) et l'en-tête des
annuaires `/equipes` et `/joueurs` (voile global `.fabric` de `app/globals.css`).
Coupé par la boîte, il dessinait un panneau aux arêtes dures, d'autant plus
visible que la liste était courte. Ces trois voiles portent le modificateur
global **`.fabric-fade`** : deux masques croisés (`mask-composite: intersect`,
`-webkit-mask-composite: source-in`), horizontal (`--fade-x`, défaut
`min(18 %, 220 px)` de chaque côté) et vertical (`--fade-top`, défaut 48 px ;
`--fade-bottom`, défaut `min(30 %, 160 px)`) ; seul le centre reste plein, à
toute largeur (375 px → grand écran). C'est un **opt-in** : les autres pages qui
posent `.fabric` (connexion, pages légales, règles, accueil, classement, carte du
bot…) gardent leur voile d'origine, dont les halos ancrés au-delà des bords.

Sur `/tournois`, le voile règle ses propres variables et sa hauteur est bornée
(`max-height: 1400px`) : la page porte toute la liste, et un calque masqué de
plusieurs milliers de pixels se recomposerait à chaque carte ajoutée ou retirée.
Le halo du bas vit donc dans une seconde boîte, `.fabricBottom` (aussi en
`.fabric-fade`, `height: min(100 %, 560 px)`), ancrée au **vrai** bas de la page :
borné à 1400 px, le voile du haut l'aurait sinon posé au milieu d'une longue liste.

Le filet bas de la page (`/tournois`) et de l'en-tête des annuaires n'est plus
un `border-bottom` tiré d'un bord à l'autre : la classe globale
**`.hairline-fade`** pose un `::after` d'un pixel en
`linear-gradient(90deg, transparent, var(--line-soft) 20 %, … 80 %, transparent)`.

## États vides (`ListEmptyState`, `_lib/empty-state.ts`)

`listEmptyKind` (pur) choisit l'état :

| État | Quand | Contenu |
| --- | --- | --- |
| `empty` | aucune section, aucun filtre | « Aucun tournoi pour le moment », « Créer un tournoi » (droit `tournaments`), « Lire les règles » |
| `filtered` | aucune section, recherche ou jeu actif, et aucune recherche n'attend l'archive des terminés | « Aucun résultat », bouton « Effacer la recherche et les filtres » (vide la recherche, remet « Tous » ; focus au champ s'il portait un texte, à la pastille « Tous » sinon — pas de clavier virtuel ouvert pour rien) |
| `nothingUpcoming` | des sections, mais ni inscriptions ouvertes ni annonce (« Mes tournois » compris, avant découpage, et, pour le staff, les invisibles à venir) et aucune recherche tapée | « Aucun tournoi à venir annoncé », `InfoHint` (Prochainement → Inscriptions ouvertes), « Créer » (staff), « Voir les tournois terminés » (s'il y en a : déplie la section), « Lire les règles » |
| `pending` | aucune section, une recherche tapée attend encore l'archive des terminés | la ligne « Chargement des tournois terminés… » |
| `null` | liste pas encore lue, ou de quoi s'inscrire | rien |

Une recherche tapée ne donne jamais `nothingUpcoming` (son résultat répond déjà).
Un jeu choisi le garde, mais le panneau le dit : « Aucun tournoi à venir pour ce
jeu », d'autres jeux pouvant avoir des inscriptions ouvertes, avec un bouton
« Afficher tous les jeux », qui ne remet que le jeu à « Tous » (un texte en cours
de frappe reste) et place le focus sur la pastille « Tous ».

Une **recherche tapée** qui demande l'archive des terminés n'affiche « Aucun
résultat » qu'**après** l'arrivée de l'archive (`searchAwaitsArchive`) : avant, la
liste courte ne porte pas les terminés anciens, et le panneau aurait menti. Pendant
l'attente, la région live annonce le chargement, jamais un compte partiel (« 2 »
qui deviendrait « 7 »). Un jeu choisi sans recherche n'attend rien : les comptes
de l'archive (`finishedTotals`, par jeu) arrivent avec la liste courte. Une
archive en échec n'est plus attendue (`archiveFailed`, oublié dès que l'archive
n'est plus demandée) : la page tranche avec ce qu'elle a au lieu de rester sur
« Chargement… » ; la ligne d'attente sous « Terminés » dépliée suit la même règle.

Les invisibles à venir (staff) sont comptés d'après l'état recalculé à l'horloge
(`useScheduledBuckets`), comme les listes publiques : un invisible dont les
inscriptions ferment page ouverte ne compte plus comme « à venir ».

Les props de `ListEmptyState` sont une union discriminée : `filtered` exige
`onClearFilters`, `nothingUpcoming` exige `finishedCount` et `onShowFinished`. Le panneau
`nothingUpcoming` se place là où seraient « Inscriptions » et « Prochainement »,
avant « Terminés ».

Le panneau : cadre glacier (jamais gris), halo radial qui s'éteint bien avant ses
bords, pictogramme Lucide dans un anneau qui respire (`transform`/`opacity`,
`animation-play-state: var(--deco-anim-state)`), titre en `<h2>`. Aucune teinte
chaude. Textes sous `tournaments.list.emptyState` (FR et EN) ; les anciennes clés
`emptyTitle`/`emptyUnfiltered`/`emptyFiltered` et `sectionEmptyMessage` ont disparu.

Tests : `tests/tournois/list-empty-look.test.tsx`.
