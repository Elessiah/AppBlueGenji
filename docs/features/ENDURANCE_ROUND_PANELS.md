# 🪟 BlueGenji Survie — volets de manche et arbre des play-offs

## Objectif

La vue du mode `BG_SURVIE` empilait **toutes** ses rencontres dans une seule
colonne, sous un simple intertitre « MANCHE 3 ». Deux conséquences :

- **La phase qualificative était illisible.** Un plafond de dix manches à seize
  équipes fait quatre-vingts cartes à la file : rien ne disait où commençait la
  manche courante, et une carte occupait toute la largeur d'un écran de 1400 px
  pour afficher deux noms et deux chiffres.
- **Les play-offs n'étaient pas un arbre.** L'arbre imposé (8v4 / 6v2 / 1v5 /
  3v7, puis demies, finale et petite finale) était rendu par le même empilement
  de cartes : on lisait bien les rencontres d'un tour, mais **rien ne montrait
  qui affrontait qui au tour suivant** — l'élimination directe sans son arbre.

La vue reprend donc les **volets repliables** des tableaux à élimination
(`BRACKET_SECTIONS.md`), et les play-offs sont dessinés par **le composant
d'arbre du site**, celui de l'élimination simple.

## 📐 Ce que voit le lecteur

Dans l'ordre, du haut vers le bas :

1. **Le barème et le classement d'endurance** — inchangés.
2. **Le tableau manche par manche** — inchangé.
3. **Les play-offs**, dès qu'ils sont lancés : l'arbre (`Phase finale`) puis la
   `Petite finale` dans son propre volet.
4. **Les manches qualificatives**, un volet par manche, dans l'ordre
   chronologique.

Les manches restent affichées **sous** l'arbre une fois les play-offs lancés.
L'ancienne vue les remplaçait purement (`playoffsStarted ? playoffs :
qualification`) : le parcours d'une équipe disparaissait au moment précis où il
devenait intéressant.

### En-tête d'un volet de manche

| Élément | Ce qu'il dit |
| --- | --- |
| `MANCHE 3` | le numéro de la manche |
| `4 matchs` | la taille de la manche |
| `2/4 jouées` ou `Terminée` (vert) | l'avancement — c'est ce qu'on vient regarder |

Les libellés vivent dans le module pur (`enduranceMatchCountLabel`,
`enduranceProgressLabel`, `enduranceRoundRegionLabel`) et **s'accordent** : un
effectif actif impair fait chômer une équipe, si bien qu'une manche à une seule
rencontre — « 1 match, 0/1 jouée » — est un cas courant du mode, pas une
curiosité. Le nom accessible du volet énonce la même chose en toutes lettres,
la barre oblique se lisant « zéro barre oblique un ».
| `★ Votre match` | le lecteur a une rencontre **non jouée** dans cette manche |

Le cadre du volet se teinte de l'accent quand il est ouvert **ou** qu'il porte la
marque du lecteur : une pile de dix volets repliés doit se lire d'un coup d'œil.

### Volet ouvert par défaut

Décidé par `defaultOpenEnduranceRound` (module pur), par ordre de priorité :

1. la manche où le lecteur a une rencontre à jouer ;
2. la première manche inachevée — la manche courante, celle qui bouge ;
3. sinon, la **dernière** manche… mais seulement si l'arbre final n'a pas
   commencé. Sinon rien n'est ouvert : c'est l'arbre qui porte l'action, et
   déplier par-dessus une manche close le repousserait sous la ligne de
   flottaison.

Le volet à ouvrir **change en cours de tournoi** : une manche s'achève, la
suivante arrive par le flux SSE. Un état figé au montage laisserait le lecteur
sur une manche close. On ouvre donc la nouvelle manche courante **à chaque fois
qu'elle change**, et seulement alors — sinon un volet refermé à la main se
rouvrirait au prochain instantané.

`BracketSections` suit désormais **la même règle** : son état était lui aussi
figé au montage, ce qui ne se voyait pas sur un tableau à élimination (le
découpage y est acquis dès la génération du plateau) mais se voit sur l'arbre
final, où le découpage se réorganise quand un tour s'ajoute — au-delà de trois
tours, la « phase finale » glisse d'une section à l'autre, et la section qui
venait de recevoir le tour vivant naissait repliée. Les deux composants
partagent leur chrome ; leur ouverture ne pouvait pas suivre deux règles.

### Disposition des cartes

Les cartes de match ont une **largeur fixe** (210 px) : rangées en `flex-wrap`,
elles se répartissent d'elles-mêmes en autant de colonnes que la place le
permet. Une manche de huit rencontres tient alors sur deux lignes au lieu de
huit, et la même vue reste juste sur un mobile, où il n'y a qu'une colonne.

## 🌳 L'arbre des play-offs

Les play-offs passent par `BracketSections` — **le composant de l'élimination
simple**, sans variante : mêmes volets, mêmes stades nommés (`Quarts de finale`,
`Demi-finales`, `Finale`), mêmes traits d'un tour à l'autre, même badge
« ★ Votre match ».

Trois points méritent une explication.

### La petite finale est un tableau à part

Le moteur pose la petite finale dans **la même manche** que la finale
(`finalizePlayoffsIfDone`), avec `bracket = 'THIRD_PLACE'`. Alignée dans la
dernière colonne de l'arbre, elle serait nommée « Finale 2 » et semblerait mener
quelque part. Elle est donc rendue par un second `BracketSections`, de type
`THIRD_PLACE` — exactement ce que fait déjà la page pour les tableaux à
élimination.

### L'arbre pousse un tour à la fois — deux pièges

`BracketSections` a été écrit pour des tableaux qui **naissent entiers** : il en
déduisait tout des tours qu'on lui passe. BG Survie n'en pose qu'un à
l'ouverture des play-offs, puis un de plus à chaque tour complété. D'où deux
symptômes, de même cause :

- **Les stades étaient nommés à l'envers.** `buildSections([1000], "UPPER")`
  rendait un volet « Finale » et quatre cartes « Finale 1 » … « Finale 4 » ; une
  fois les demies créées, les quarts devenaient « Demi-finales ». Le tableau ne
  disait juste qu'au dernier tour. `BracketSections` prend donc un
  `plannedRounds` — le nombre de tours **une fois complet** —, calculé par
  `endurancePlayoffRoundCount` depuis l'effectif du premier tour. Il ne sert
  qu'à nommer les stades ; le découpage en volets, lui, porte toujours sur les
  tours réellement posés (on ne fait pas un volet pour ce qui n'existe pas).
- **Le volet se refermait tout seul.** La clé de section était son titre, et le
  titre change quand la section grandit (« Finale » → « Phase finale »).
  `openKeys` n'étant écrit qu'au montage, plus aucune section ne correspondait
  et l'arbre se repliait sous les yeux du lecteur, au moment précis où il venait
  d'avancer. La clé est désormais le **numéro du premier tour** de la section —
  stable tant que la section commence au même endroit.

### Les liens de l'arbre sont **dérivés**, pas lus en base

`BG_SURVIE` ne renseigne **aucun** `next_winner_match_id` : le moteur ne crée le
tour suivant qu'une fois le précédent complet, en appariant les vainqueurs deux à
deux dans l'ordre des numéros de match. Sans lien, `BracketTree` ne dessinait
aucun trait — un arbre en colonnes séparées.

La règle d'appariement étant connue, elle est **rejouée côté interface** par
`endurancePlayoffLinks` : le vainqueur du i-ème match d'un tour joue le
(i/2)-ème match du tour suivant. `BracketTree` accepte pour cela un
`resolveNextMatchId` optionnel, dont le repli est le comportement d'origine
(`nextWinnerMatchId ?? nextLoserMatchId`).

Deux garde-fous à retenir :

- **Ce lien ne sert qu'au dessin.** Le verrouillage d'un score en BlueGenji
  Survie se décide sur le **numéro de manche** (`dependentMatches` range le mode
  avec la Survie et la Ronde suisse), jamais sur les liens de bracket ; et rien
  de ce qui est calculé ici ne remonte au serveur.
- **Un tour non encore créé n'a pas de cible.** Le trait s'arrête au bord de la
  carte, ce qui est exactement ce qu'il faut montrer : le tour suivant n'existe
  pas.

Si la règle d'appariement du moteur changeait, c'est `endurancePlayoffLinks`
qu'il faudrait suivre — d'où un test qui la compare à la structure réellement
produite par le service.

## 🧩 Architecture

| Élément | Emplacement |
| --- | --- |
| Logique pure (découpage, liens dérivés) | `app/(secured)/tournois/[id]/_lib/endurance-sections.ts` |
| Volets de manche | `app/(secured)/tournois/[id]/_components/EnduranceRoundPanels.tsx` |
| Chrome partagé d'un volet | `app/(secured)/tournois/[id]/_components/BoardPanel.tsx` (+ `.module.css`) |
| Vue du mode | `app/(secured)/tournois/[id]/_components/EnduranceView.tsx` |
| Arbre | `BracketSections.tsx` (props `plannedRounds`, `resolveNextMatchId`) → `BracketTree.tsx` |

### `BoardPanel` — un seul chrome de volet

Le chevron, le titre, les pastilles, la marque du lecteur et les attributs
`aria-expanded` / `aria-controls` vivaient dans `BracketSections`. Les manches
d'endurance en demandent **exactement** le même : deux copies auraient divergé au
premier réglage. `BoardPanel` ne porte que l'habillage — ce qu'un volet contient
et lequel s'ouvre restent la décision de l'appelant.

Le passage en CSS Module apporte au passage un **anneau de focus clavier**
(`:focus-visible`), qui manquait aux volets des tableaux à élimination : le
contour par défaut du navigateur est invisible sur ce fond.

### `EnduranceView` reçoit ses props comme ses voisines

La vue recevait une fonction `renderMatch` et la page rendait les cartes à sa
place — elle était la seule des quatre vues de plateau dans ce cas. Elle prend
désormais les mêmes props que `SurvivalView` et `SwissView` (`canReport`,
`adminResolvable`, `drafts`, `onSubmit`, `format`, `emptyLabel`…), et rend ses
cartes elle-même. La page ne connaît plus `MatchRow`.

## 🔗 Ancre `#match-[id]`

Un lien profond peut viser une rencontre qui dort dans un volet **replié** : le
hook la chercherait alors dans le DOM jusqu'à renoncer (20 s). Comme
`BracketSections`, `EnduranceRoundPanels` écoute `useMatchAnchorTarget()` et
ouvre le volet de la manche visée — en **ajoutant**, jamais en refermant, pour
que le lecteur reste libre de replier ensuite.

L'arbre des play-offs hérite du même mécanisme, puisqu'il passe par
`BracketSections`.

## ✅ Tests

- `tests/tournois/endurance-sections.test.ts` — module pur : découpage
  qualification / play-offs, avancement d'une manche, volet ouvert par défaut
  (les trois priorités et le silence sous play-offs), séparation de la petite
  finale, nombre de tours prévus d'un arbre incomplet, et liens dérivés (y
  compris un tour incomplet et un plateau impair).
- `tests/tournois/endurance-round-panels-wiring.test.ts` — câblage : les cartes
  passent par `MatchRow`, l'ancre déplie le volet, les play-offs empruntent
  `BracketSections` avec les liens dérivés, et le chrome des volets est partagé.
- `tests/tournois/bracket-sections.test.ts` — un arbre qui ne porte pas encore
  tous ses tours : stades nommés sur le compte prévu, clé de section stable
  quand un tour la rejoint, et découpage inchangé pour les tableaux complets.
- `tests/tournois/match-anchor-wiring.test.ts`,
  `tests/tournois/underfilled-start.test.ts`,
  `tests/tournois/forfeit-eligibility.test.ts` — invariants existants, mis à
  jour pour la nouvelle vue.

## 📎 Voir aussi

- `BG_SURVIE_MODE.md` — le mode lui-même (barème, plafond, arbre imposé).
- `BRACKET_SECTIONS.md` — les volets des tableaux à élimination.
- `FEATURED_MATCH_LINK.md` — l'ancre `#match-[id]`.
