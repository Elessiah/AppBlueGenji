# Édition d'un tournoi après création

Un tournoi n'est pas immuable : le staff (`tournaments`) peut le modifier jusqu'à un certain point — le point dépendant de son stade de vie. La fenêtre d'édition se rétracte en trois étapes : **tout est modifiable** tant qu'un tournoi reste caché, **peu de choses** une fois annoncé, **plus rien** une fois lancé.

La règle vit dans un module pur partagé (`lib/shared/tournament-edit.ts`) entre le serveur et l'interface, exactement comme `match-lock.ts` ou `seeding.ts`. Le serveur la rejoue sous verrou — `SELECT … FOR UPDATE` — pour refuser une modification qui aurait pu devenir interdite entre le chargement du formulaire et sa soumission.

## Les trois fenêtres

La fenêtre est déterminée d'abord par l'**état**, puis par la **visibilité**. L'état prend toujours la priorité : un tournoi `RUNNING` reste `LOCKED` même si sa date de visibilité est repoussée dans le futur.

### 1. `FULL` — Tournoi masqué

**Condition :** `state !== "RUNNING" AND state !== "FINISHED" AND startVisibilityAt > maintenant()`

Tout est modifiable : nom, jeu, format, barèmes, réglages de survie ou de suisse, phases du format MULTI. Le staff peut réécrire le tournoi de zéro jusqu'à ce qu'il passe la visibilité.

### 2. `RESTRICTED` — Tournoi annoncé mais pas lancé

**Condition :** `state !== "RUNNING" AND state !== "FINISHED" AND startVisibilityAt ≤ maintenant()`

Seuls cinq champs survivent à la publication :
- `name` — le titre du tournoi
- `description` — la présentation générale
- `registrationCloseAt` — la date de clôture des inscriptions
- `startAt` — le début du tournoi
- `maxTeams` — la capacité (sous contrainte)

Tout ce qui change la **structure** du tournoi est verrouillé : format, jeu, barèmes, réglages. Changez une `Survie` en `Double élimination` une fois que le tournoi est lisible, et vous démentez l'annonce lue par les équipes.

### 3. `LOCKED` — Tournoi en cours ou terminé

**Condition :** `state === "RUNNING" OR state === "FINISHED"`

Plus rien : l'arbitrage des scores prend le relais. L'état prime : un tournoi lancé reste verrouillé quelle que soit sa date de visibilité.

## Pourquoi c'est la **visibilité** qui verrouille, pas le nombre d'inscrits

Changer le format ou le jeu en silence après l'annonce brise la confiance — même à zéro inscription. L'annonce est un contrat public : « ce sera une Survie ». Un tournoi peut être visible depuis des semaines sans aucune inscription (c'est normal pendant les périodes creuses) ; une équipe qui découvre le tournoi vendredi sait ce qu'elle s'apprête à jouer. S'il devient `DOUBLE` samedi, elle s'inscrit à autre chose.

Le seuil est donc le seuil public : une date, qui change une seule fois, qui est annoncée, et sur laquelle on peut compter.

## Les contraintes de la fenêtre `RESTRICTED`

### `MAX_TEAMS_CANNOT_DECREASE`

Une fois le tournoi visible, l'effectif ne peut que rester ou augmenter. Le baisser discréditerait l'annonce : « 32 équipes » et le dimanche on en refuse les 33e — ou pire, on coupe aux « 16 qualifiées » alors qu'on disait 32.

### `REGISTRATION_CLOSE_IN_PAST`

On refuse de reculer `registrationCloseAt` au-delà de maintenant si le tournoi est en `REGISTRATION` : cela ne ferait **pas** fermer les inscriptions. Le calcul d'état (`computeTournamentState`) le verrait revenir à `UPCOMING` au lieu de basculer à `RUNNING`. Le tournoi reculerait d'un état au lieu de se fermer — une incohérence.

Pour clore au moment, avancez plutôt `startAt` : l'ordre des dates demeure valide, et `computeTournamentState` fait le bon transi.

## Dates imparsables

Une date de visibilité illisible (`Invalid Date`) est traitée comme **visible**, ce qui verrouille le format et le jeu à titre préventif. C'est le parti pris inverse de celui qui refuse une action sûre : mieux vaut être strict et autoriser une correction au besoin, que d'autoriser une modification qu'on regrette quelques secondes après. La même logique guide `isTournamentHidden` dans `tournament-visibility.ts`.

## Validation

La validation des valeurs est **identique à celle de la création**, tirée de `lib/server/tournaments/validation.ts`. Ni l'édition ni la création n'ont leur propre jeu de règles : les deux empruntent le même code. Si la création accepte un barème suisse monotone et l'édition le refuse, vous avez un bug. Les tests gardent la couverture en place — la création teste le module, l'édition le réappelle sur ses propres cas.

## Ce que la validation partagée normalise

`validateTournamentInput` ne fait pas que refuser : elle **normalise** aussi. La petite
finale n'a de sens qu'en élimination simple, et c'est là que la règle vit —
`hasThirdPlaceMatch` retombe à `false` dès que le format n'est pas `SINGLE`.

Elle ne vivait auparavant que dans `createTournament`. Une **édition** basculant un
tournoi de `SINGLE` à `DOUBLE` gardait donc la case cochée en base, là où la création du
même tournoi l'aurait mise à zéro — et `rankEliminationPhase` (`finalization.ts`) relit
cette colonne en double élimination aussi. C'est exactement le genre de divergence que
l'extraction de la validation devait supprimer.

## La route de l'édition

`PATCH /api/tournaments/[id]/edit` — réservée au staff `tournaments` (`can(user, "tournaments")`).

Le corps est une liste blanche : seuls les champs de `ALL_TOURNAMENT_FIELDS` passent ; tout le reste est silencieusement ignoré, ce qui protège la route contre l'ajout futur de colonnes qui ne devraient pas s'éditer.

### Codes d'erreur et réponses HTTP

| Erreur | HTTP | Sens |
|---|---|---|
| `UNAUTHORIZED` | 401 | Pas de session |
| `FORBIDDEN` | 403 | Utilisateur connecté, pas la permission `tournaments` |
| `INVALID_TOURNAMENT_ID` | 400 | Identifiant mal formé |
| `TOURNAMENT_NOT_FOUND` | 404 | Tournoi introuvable |
| `EMPTY_PATCH` | 400 | Aucun champ envoyé |
| `TOURNAMENT_LOCKED` | 409 | Tournoi en cours ou terminé |
| `FIELD_NOT_EDITABLE` (+ `field`) | 409 | Champ refusé par la fenêtre courante |
| `MAX_TEAMS_CANNOT_DECREASE` | 400 | Effectif réduit en fenêtre `RESTRICTED` |
| `REGISTRATION_CLOSE_IN_PAST` | 400 | Clôture reculée dans le passé en `REGISTRATION` |
| Codes de validation (`INVALID_*`, `MISSING_*`) | 400 | Valeurs incohérentes (dates, barèmes) |
| `DOUBLE_MUST_BE_LAST_PHASE` | 400 | Format MULTI invalide |
| `TOURNAMENT_UPDATE_FAILED` | 500 | Erreur non classée |

## Recomputation serveur sous verrou

La fenêtre est calculée **à nouveau** une fois la transaction commencée, sous `SELECT … FOR UPDATE` sur la ligne du tournoi. Un tournoi devenu visible ou lancé entre le chargement du formulaire et sa soumission est refusé, pas modifié. Le formulaire est rassurant : la fenêtre qu'il affiche était juste au moment du chargement, mais le serveur ne vous laisse pas l'exploiter si elle a fermé.

## Point d'extension : ajouter un champ éditable

Pour rendre un champ modifiable :

1. Ajouter son nom à `ALL_TOURNAMENT_FIELDS` dans `lib/shared/tournament-edit.ts` —
   `TournamentField` en est **dérivé** (`typeof ALL_TOURNAMENT_FIELDS[number]`), il n'y a
   donc plus qu'une liste à tenir. C'est ce tableau que parcourt la liste blanche de la
   route : un champ ajouté au seul type y aurait été ignoré en silence.
2. Si le champ doit survivre à la publication, l'ajouter à `RESTRICTED_FIELDS`
3. Ajouter la colonne au `SELECT` et au `UPDATE` dans `loadEditRow` et `updateTournament` (`lib/server/tournaments/edit.ts`)
4. Ajouter le champ à `EditableTournamentValues` (type d'échange) dans `lib/server/tournaments/edit.ts`
5. L'ajouter au formulaire — `_components/TournamentForm.tsx` pour un champ commun,
   `_components/FormatSettings.tsx` s'il ne concerne qu'un format

Si le champ a des règles de validation propres (range, contrainte avec un autre champ), ajouter le contrôle dans `checkEditPatch` si c'est un droit d'édition (avant/après l'application), ou dans `validateTournamentInput` si c'est une cohérence de valeurs.

Les phases du format MULTI n'ont pas de colonne : elles voyagent dans
`EditableTournamentValues.phases` (type brut, à normaliser avant insertion, comme en
création). Elles sont reposées à neuf — `DELETE` puis `INSERT` — **quand le patch les
concerne**, c'est-à-dire s'il porte `phases` ou `format`. Un patch qui n'y touche pas
les laisse en place : le `DELETE` n'est sûr que parce qu'aucune phase n'est en cours
d'usage tant que le tournoi n'est pas `RUNNING` (et `RUNNING` ⇒ `TOURNAMENT_LOCKED`),
un invariant qu'aucune clé étrangère ne protège. Ne l'exercer que quand c'est utile
réduit d'autant la surface de cette dépendance.

## Surfaces

| Élément | Emplacement |
| --- | --- |
| Logique pure (fenêtres, droits) | `lib/shared/tournament-edit.ts` |
| Orchestration (verrou, validation, écriture) | `lib/server/tournaments/edit.ts` |
| Validation (partagée) | `lib/server/tournaments/validation.ts` |
| API | `PATCH /api/tournaments/[id]/edit` (`app/api/tournaments/[id]/edit/route.ts`) |
| Page du tournoi (bouton) | `app/(secured)/tournois/[id]/_components/TournamentDetail.tsx` |
| Formule du bouton et notice | `app/(secured)/tournois/[id]/_lib/edit-entry.ts` |
| Interface | `app/(secured)/tournois/[id]/modifier/page.tsx` |
| Formulaire (partagé avec la création) | `app/(secured)/tournois/_components/TournamentForm.tsx` |
| Réglages propres au format | `app/(secured)/tournois/_components/FormatSettings.tsx` |
| Valeurs du formulaire et ponts avec l'API | `app/(secured)/tournois/_lib/tournament-form-values.ts` |

La page d'édition ne reçoit du serveur que la **fenêtre**, pas l'état : elle en tire ses
champs modifiables par `editableFieldsForWindow`, la même fonction que sert
`editableFieldsFor` côté serveur. Elle rejouait auparavant le `switch` en miniature —
deux écritures de la même règle, dont une seule aurait suivi l'ajout d'une fenêtre.
