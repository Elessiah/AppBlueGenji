# Logos d'équipe dans l'annuaire

Le logo d'une équipe s'affiche **partout où l'équipe est présentée** : sur sa
fiche `/equipes/[id]`, et dans l'annuaire `/equipes`.

## Le symptôme

Le logo apparaissait sur la fiche, jamais dans la liste. Une équipe qui venait
d'importer son logo le voyait sur sa page et sur nulle part ailleurs.

## La cause

Rien n'était cassé : il manquait un rendu.

Le champ voyageait de bout en bout — `listTeams` sélectionne `t.logo_url`
(`lib/server/teams-service.ts`), `TeamListItem.logoUrl` le porte
(`lib/shared/types.ts`), `GET /api/teams` le renvoie. Mais
`app/(secured)/equipes/cards/TeamCard.tsx` affichait **toujours** l'initiale du
nom dans son emblème, sans jamais lire `team.logoUrl`.

C'est la panne la plus discrète de la famille : pas de 404, pas d'image cassée,
pas d'erreur console — une initiale parfaitement rendue à la place du logo.
Aucun repli inexistant n'était en cause ici (le `/vercel.svg` manquant ne
concerne que les avatars de compte, pas les logos d'équipe).

## Le correctif

`TeamCard` rend le logo quand il y en a un, et retombe sur l'initiale sinon —
le même partage que la fiche d'équipe, qui affiche un écusson à défaut de logo.

Poser une image dans l'emblème a demandé de corriger deux règles de mise en
page, toutes deux invisibles tant que la case ne contenait qu'une lettre :

1. **`.head > div` visait aussi l'emblème.** L'emblème est un `div`, frère du
   bloc de texte, donc le sélecteur l'attrapait — et, plus spécifique que
   `.sigil`, son `flex: 1` écrasait le `flex-shrink: 0` de la case. L'emblème
   occupait la moitié de l'en-tête (127 px pour une case déclarée carrée de 56)
   et le nom de l'équipe s'y élidait pour rien. La règle est désormais portée
   par une classe dédiée au bloc de texte, `.headText` : `min-width: 0` et
   `flex: 1` sont des besoins de **texte** (élision du nom), l'emblème n'a
   jamais eu affaire à eux.
2. **Une image en flux impose sa taille intrinsèque.** La minimale automatique
   d'un élément flex (`min-width: auto`) vaut son contenu minimal, et
   `flex-shrink: 0` n'interdit que le rétrécissement : un logo importé en 128 px
   étirait la case et débordait sur les statistiques de la carte. Le logo est
   donc posé **hors du flux** (`position: absolute; inset: 0`) dans un cadre
   déjà dimensionné — 56 px carrés quel que soit le fichier.

Pas d'`overflow: hidden` sur l'emblème pour arrondir le logo : son halo
(`.sigil::after`) déborde de trois pixels et serait rogné avec lui. Le rayon est
porté par l'image, d'un pixel de moins que celui du cadre — l'épaisseur de la
bordure.

## Ce que le correctif ne change pas

Les **trois étages d'empilement** de la carte d'annuaire (voir
`docs/features/ENTITY_LINKS.md`) : décorations en `z-index: auto` < plaque de
lien `.cardOverlay` en `1` < liens imbriqués du roster en `2`. Le logo est une
décoration, il reste sous la plaque : cliquer dessus mène à la fiche de
l'équipe, comme le reste de la carte. Il est rendu **hors** de l'ancre, pour ne
pas rouvrir le `<a>` dans un `<a>` que la plaque existe précisément pour éviter.

## Couverture

- `tests/app/team-card-logo.test.tsx` — rendu du logo, repli sur l'initiale,
  absence de repli inventé, unicité de l'ancre, et gardes sur la feuille de
  style (le cadre reste carré, le logo reste hors du flux).
- `tests/lib/server/teams-service.list.test.ts` — l'autre bout du fil :
  `listTeams` expose bien le logo, `null` quand il n'y en a pas, et le garde
  attaché à son équipe après le tri par classement.
