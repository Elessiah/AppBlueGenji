# Format de match (BO5 / FT3)

Chaque tournoi peut fixer le **format de ses matchs** : combien de manches se
jouent, et donc quel score est atteignable. La contrainte est affichée au moment
de la saisie des scores et refusée côté serveur si elle n'est pas respectée.

## Les deux notations

| Notation | Sens | Manches à gagner | Manches jouées au maximum |
|---|---|---|---|
| `BO5` (Best of 5) | on joue **au plus 5 manches** | 3 | 5 |
| `FT3` (First to 3) | on joue **jusqu'à 3 manches gagnées** | 3 | 5 |

Les deux décrivent la même course, vue depuis deux bouts : `BO` compte le total
jouable, `FT` compte l'objectif. Tout le code ne manipule donc que deux
grandeurs dérivées :

- `matchWinsRequired(format)` — le score du vainqueur : `⌈N/2⌉` en `BO`, `N` en `FT` ;
- `matchMaxMaps(format)` — le plafond de la somme des deux scores : `2 × wins − 1`.

Un `BO` **pair** est refusé à la création : « best of 4 » pourrait finir 2-2,
sans vainqueur.

Un tournoi sans format défini reste en **score libre** (0-99), ce qui est l'état
de tous les tournois créés avant cette fonctionnalité.

## Règles appliquées à la saisie

Le module pur `lib/shared/match-format.ts` porte l'unique implémentation
(`checkMatchScores`), partagée par l'interface et le serveur :

| Contrôle | Code d'erreur |
|---|---|
| Un score dépasse l'objectif (4-1 en BO5) | `SCORE_EXCEEDS_MATCH_FORMAT` |
| La somme dépasse les manches jouables (3-3 en BO5) | `SCORE_EXCEEDS_MATCH_FORMAT` |
| Aucun des deux n'atteint l'objectif alors qu'il faut trancher (2-1 en BO5) | `SCORE_BELOW_MATCH_FORMAT` |

Le dernier contrôle ne s'applique qu'aux saisies **décisives** :

- **décisif** — report d'équipe (`POST /api/tournaments/[id]/matches/[matchId]/report`)
  et résolution par l'arbitrage (`POST /api/admin/matches/[matchId]/resolve`) :
  le vainqueur doit atteindre exactement l'objectif ;
- **non décisif** — sauvegarde d'un score sans désigner de vainqueur
  (`PATCH /api/admin/matches/[matchId]/scores`) : l'arbitrage peut noter un 1-0
  pendant que le match se joue, seul le plafond s'applique.

Les scores posés par le moteur — byes (1-0), matchs fantômes, forfaits — ne
passent pas par ces contrôles : ils ne sont pas saisis.

## Le format chiffre aussi les forfaits

`forfeitMapCount(format)` donne les manches qu'emporte le vainqueur d'un forfait,
l'autre restant à zéro : l'objectif du format (FT3 → 3-0), ou 1-0 en saisie libre
— le plus petit score qui désigne encore un vainqueur, un 0-0 n'en désignant
aucun.

Un forfait n'est donc pas une rencontre blanche, et ce n'est pas une subtilité
d'affichage : `adminResolveMatch` écrit ce score en base, si bien qu'il compte au
bilan de maps des fiches, au capital d'endurance d'une BlueGenji Survie et dans
la manche affichée (« 3 – FF »), sans qu'aucun de ces lecteurs ait à redécouvrir
la règle. Les forfaits enregistrés avant cette règle portent des colonnes vides :
`forfeitAwareMapScore` (fiches) et `enduranceMatchMaps` (BlueGenji Survie) les
rechiffrent depuis le format.

Les **abandons** l'écrivent aussi, par `forfeitMatchScores`
(`lib/server/tournaments/repository.ts`) : arbitrage, Survie, Ronde suisse et
BlueGenji Survie posent le même chiffre. La Survie et la Ronde suisse écrivaient
auparavant un 1-0 en dur — la manche affichait alors « 1 – FF » pendant que la
fiche de l'adversaire en comptait trois maps, le bilan dérivant du format.

## Une seule fonction écrit la notation

`matchFormatLabel(format)` est la **source unique** du libellé — « BO5 »,
« FT3 » — et il n'y a aucune autre façon d'assembler le type et le nombre. La
règle n'est pas décorative : la carte « en cours » de l'accueil portait sa
propre fonction, `toBestOfLabel`, qui **devinait** la notation depuis le nom de
la manche (« BO5 » dès que le libellé contenait « final », « BO3 » sinon) sans
jamais lire `TournamentCard.matchFormat`. Un tournoi réglé en FT3 s'y annonçait
donc « BO3 », et un tournoi en score libre aussi.

Deux conséquences à retenir avant d'afficher un format quelque part :

1. la notation se **lit** dans `matchFormat`, elle ne se déduit ni du nom de la
   manche, ni du format de bracket, ni de l'étape du tournoi ;
2. un tournoi **sans** format n'a pas de notation à montrer. Les pastilles se
   gardent donc par `matchFormat && …` plutôt que de rendre le libellé de repli
   « Score libre », qui n'a de sens que dans une phrase d'aide de formulaire.

Un test de source (`tests/app/live-card-match-format.test.tsx`) tient les deux
bouts : le rendu réel de la carte pour chaque valeur des deux notations, et
l'absence de toute notation écrite en dur hors du module partagé.

## Où c'est visible

- **Création du tournoi** (`/tournois/creer`) : un sélecteur *Best of / First to /
  Libre* et le nombre de manches, avec le rappel de ce que ça implique. Le même
  formulaire sert à l'**édition** (`/tournois/[id]/modifier`) : les deux
  notations y sont donc offertes de la même façon, dans la fenêtre `FULL`.
- **Page du tournoi** : une pastille `BO5` à côté du format de bracket.
- **Accueil**, carte du tournoi en cours : la notation suit le numéro du match
  (« MATCH 42 · FT3 »), et disparaît sur un tournoi en score libre.
- **Saisie d'équipe** : le rappel « BO5 · premier à 3 » au-dessus des deux
  champs, bornés à l'objectif.
- **Dialogue d'arbitrage** : le format en toutes lettres sous le titre, les
  boutons `+`/`−` bornés, et le bouton « ✓ Gagnant » désactivé tant que le score
  ne désigne pas de vainqueur au sens du format.

Le format descend jusqu'aux cartes de match par un contexte React
(`app/(secured)/tournois/[id]/_lib/match-format-context.tsx`) : les quatre
arborescences qui les rendent — arbre d'élimination, survie, ronde suisse,
endurance — n'ont pas à le transporter.

## Portée

Le réglage est **au niveau du tournoi** : il vaut pour tous ses matchs, y compris
dans un tournoi multi-phases (les phases n'ont pas de format de match propre) et
dans les modes à classement (Survie, Ronde suisse, BlueGenji Survie).

## Stockage

Deux colonnes sur `bg_tournaments`, ajoutées par migration :

```sql
match_format_type  ENUM('BO', 'FT') NULL
match_format_value INT NULL
```

Elles vont **par paire** : tant que l'une est `NULL`, `parseMatchFormat` renvoie
`null` et la saisie reste libre. La route de création refuse un format à moitié
renseigné (`INVALID_MATCH_FORMAT`) plutôt que d'écrire une contrainte bancale.

## Jeu de test

`npm run seed` couvre trois cas (`lib/server/seed-cases.ts`) : un BO5 en
élimination simple, un FT3 en ronde suisse, un BO3 en survie terminée. Le
simulateur de matchs du seed lit l'objectif du tournoi, de sorte que les scores
générés sont toujours saisissables dans l'interface.

## Fichiers

| Rôle | Fichier |
|---|---|
| Logique pure (validation, libellés, contrôles) | `lib/shared/match-format.ts` |
| Migration des colonnes | `lib/server/database.ts` |
| Création du tournoi | `app/api/tournaments/route.ts`, `lib/server/tournaments/index.ts` |
| Garde-fou report d'équipe | `lib/server/tournaments/scoring.ts` |
| Garde-fou arbitrage | `lib/server/tournaments/admin.ts` |
| Contexte React | `app/(secured)/tournois/[id]/_lib/match-format-context.tsx` |
| Interface de saisie | `_components/MatchRow.tsx`, `_components/AdminScoreDialog.tsx`, `_hooks/useScoreForm.ts` |
| Carte « en cours » de l'accueil | `components/cyber/landing/LiveCard.tsx` |
| Formulaire (création **et** édition) | `app/(secured)/tournois/_components/TournamentForm.tsx` |
