# Hauteur des créneaux de l'arbre à élimination

`BracketTree` range chaque match dans un **créneau** de hauteur uniforme, et
toute sa géométrie en descend : un trait de liaison est posé à
`(index + 0.5) × hauteur de créneau`, et deux rounds voisins ne s'alignent que
parce que leurs créneaux couvrent la même hauteur totale (`maxMatchCount ×
hauteur`). La hauteur tient les traits — pas l'inverse.

- Décision pure : `app/(secured)/tournois/[id]/_lib/bracket-layout.ts`
- Mesure : `app/(secured)/tournois/[id]/_hooks/useSlotHeight.ts`
- Rendu : `app/(secured)/tournois/[id]/_components/BracketTree.tsx`

## Le symptôme

La hauteur était une constante de 140 px. Or la carte d'un match n'a pas de
hauteur fixe : elle grandit d'une rangée par action offerte au lecteur.

| Rangée | Quand |
|---|---|
| deux équipes et leur score | toujours |
| horaire, chaîne du caster, « en direct » | `MatchLiveStrip`, selon la programmation |
| saisie du score (format + deux champs) | engagé, manche jouable |
| « ✎ Éditer le score » | permission `tournaments`, score non verrouillé |
| « ⚠ Signaler un problème » | engagé, deux adversaires connus |
| « 🔒 Score verrouillé » | permission `tournaments`, manche suivante entamée |

Passé 140 px, la carte débordait de son créneau **par le haut et par le bas** (un
enfant plus grand que son conteneur centré déborde des deux côtés), et le
libellé du match suivant — « Quart de finale 2 » — venait se poser sur elle.
Mesuré sur le jeu de test, un quart de finale daté, casté et arbitrable fait
158 px : **18 px** de chevauchement avec son voisin, trois fois de suite dans le
premier round.

## La correction

La hauteur de créneau n'est plus une constante mais se **mesure**, round par
round :

```
besoin d'un round = ⌈sa plus haute carte⌉ + air
unité             = max(plancher, max sur les rounds (besoin × effectif / plus grand effectif))
créneau d'un round = plus grand effectif × unité / son effectif
```

- **Plancher** (`MIN_SLOT_HEIGHT = 140`) : l'ancienne constante. Une carte
  ordinaire est bien plus courte, et l'arbre garde l'allure qu'il avait.
- **Air** (`SLOT_BREATHING_ROOM = 20`) : le contenu étant centré dans son
  créneau, c'est l'espace qui sépare deux cartes voisines à hauteur maximale.

Ce qui est mesuré est l'**enveloppe** du créneau — libellé *et* carte — et non la
carte seule : c'est le libellé qui chevauchait, l'oublier ne réglerait rien.

### Pourquoi round par round

Un round de `n` matchs ne reçoit pas l'unité mais `hauteur totale / n` : plus il
est étroit, plus ses créneaux sont hauts. La contrainte n'est donc pas « l'unité
tient la plus haute carte du tableau » mais « le créneau **de ce round** tient la
plus haute carte **de ce round** ».

La différence n'est pas théorique. Un tableau à 128 équipes dont seule la finale
est datée et castée verrait, sur la règle naïve, ses **soixante-quatre** créneaux
de premier tour grandir de ce qu'une seule carte réclame — à un endroit où le
créneau fait déjà seize fois la taille demandée, et pour quelques milliers de
pixels de page en plus.

### Pourquoi une unité, et non un créneau par carte

Des créneaux inégaux seraient plus compacts encore, mais les traits de liaison
sont posés à un multiple de la hauteur : il faudrait une position cumulée par
match *et* par round, et deux rounds voisins ne s'aligneraient plus.

## Pourquoi mesurer, et non compter les rangées

La hauteur d'une rangée dépend de la police chargée, du repli d'un nom d'équipe
long et du format du match. Une table de correspondance « nombre d'actions →
hauteur » serait un second modèle du rendu, à tenir à jour à chaque retouche de
`MatchRow` — et sa dérive serait **muette**, exactement comme la panne d'origine.

Deux chemins entretiennent la mesure, et le premier suffit dans le cas nominal :

1. un **effet de mise en page** rejoué à chaque rendu — le plateau arrive par le
   flux SSE, et la rangée qui fait grandir une carte apparaît *dans* un rendu ;
   mesurer avant la peinture évite le saut de mise en page ;
2. un **`ResizeObserver`** pour ce qui échappe à React : chargement d'une police,
   redimensionnement de la fenêtre qui fait replier un nom.

Aucune boucle à craindre : le contenu mesuré est de hauteur automatique et
seulement *centré* dans son créneau, sa taille ne dépend donc pas de la hauteur
qu'on en déduit. Une mesure nulle ou absurde est ignorée — `getBoundingClientRect`
rend `0` au rendu serveur et sous jsdom, et la retenir ferait retomber tout
l'arbre sur son plancher.
