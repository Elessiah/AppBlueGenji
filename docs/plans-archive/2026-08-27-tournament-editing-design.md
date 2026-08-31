# Édition des tournois — design

*27/08/2026 — branche `feature/tournois-acces-bloque-494a18`*

## Problème

Un tournoi est aujourd'hui **immuable après création**. Une coquille dans le nom,
un effectif mal dimensionné, une cadence de coupe erronée : la seule issue est de
recréer le tournoi. Le besoin est le plus fort avant la publication — le staff
prépare une annonce à l'avance, la relit, la corrige — mais il ne disparaît pas
une fois le tournoi public : repousser une clôture d'inscriptions ou ouvrir
quelques places de plus reste une opération courante.

Hors périmètre : le contrôle d'accès aux tournois non visibles (`getTournamentDetail`
et le flux SSE ne le vérifient pas), traité ailleurs. Voir « Réserve connue ».

## Règle d'édition

Trois fenêtres, dérivées de l'état du tournoi. Le module pur
`lib/shared/tournament-edit.ts` en est l'unique implémentation, appelée par le
serveur **et** par l'interface — comme `match-lock` et `seeding` le font déjà.

| Fenêtre | Condition | Champs modifiables |
|---|---|---|
| `FULL` | `startVisibilityAt > now` — le tournoi n'est visible de personne | tous |
| `RESTRICTED` | visible, état `UPCOMING` ou `REGISTRATION` | `name`, `description`, `registrationCloseAt`, `startAt`, `maxTeams` **à la hausse seulement** |
| `LOCKED` | état `RUNNING` ou `FINISHED` | aucun — le bouton disparaît |

Le type `TournamentField` énumère ces champs ; `editWindowFor(card)` renvoie la
fenêtre et `editableFieldsFor(card)` l'ensemble des champs qu'elle autorise.

Champs couverts par `FULL` : `name`, `description`, `game`, `format`,
`participantType`, `maxTeams`, les quatre dates, `hasThirdPlaceMatch`,
`survivalRoundsBeforeFirstCut`, `survivalRoundsPerCut`, `swissTotalRounds`,
`swissPointsWin/Draw/Loss`, `endurancePoints`, `enduranceWinDelta`,
`enduranceLossDelta`, `endurancePlayoffSize`, `matchFormat`, `phases`.

`manual_seeding` et l'ordre de seeding restent hors de ce formulaire : ils ont
déjà leur propre éditeur et leur propre règle de verrouillage.

### Pas de fenêtre intermédiaire « visible mais sans inscrit »

Le déclencheur du verrouillage structurel est **la visibilité**, pas la présence
d'inscrits. Un tournoi visible mais sans inscrit reste en `RESTRICTED` : dès que
l'annonce est publique, elle est lue, et faire passer un « Survie » en « Double
élimination » sous les yeux des équipes casse la confiance même à zéro inscrit.
Le bénéfice d'une troisième fenêtre ne paierait ni sa complexité ni la phrase
supplémentaire à afficher dans l'interface.

### Date illisible

`new Date(...)` invalide ⇒ le tournoi est traité comme **visible** (donc au mieux
`RESTRICTED`). C'est le choix le plus sûr, et il s'aligne sur `isTournamentHidden`
de `lib/shared/tournament-visibility.ts` (branche `feature/mes-tournois-tab-cf799c`),
qui traite déjà une date illisible comme visible.

### Contraintes propres à `RESTRICTED`

- **`maxTeams` ne peut que croître.** Le réduire déclasserait des inscrites ou
  contredirait la capacité annoncée. Erreur `MAX_TEAMS_CANNOT_DECREASE` (400).
- **`registrationCloseAt` ne peut pas passer dans le passé** quand l'état est
  `REGISTRATION`. `computeTournamentState` renverrait alors `UPCOMING` — le
  tournoi reculerait d'un état au lieu de se clore. Erreur
  `REGISTRATION_CLOSE_IN_PAST` (400). Clore les inscriptions à l'instant présent
  reste possible en avançant `startAt`.
- L'ordre `startVisibilityAt ≤ registrationOpenAt ≤ registrationCloseAt ≤ startAt`
  reste vérifié sur les valeurs **résultantes**, en mêlant champs modifiés et
  champs conservés.
- **`registrationOpenAt` n'est pas modifiable**, y compris sur un tournoi visible
  encore en `UPCOMING` dont l'ouverture n'a pas eu lieu. Ce n'est pas un oubli :
  la date d'ouverture est le cœur de l'annonce publique, et la repousser après
  coup est précisément ce qui fait rater une inscription. Décaler une ouverture
  suppose de recréer le tournoi, ou de le faire pendant qu'il est encore caché.

## Serveur

### Route

`app/api/tournaments/[id]/edit/route.ts`, deux verbes sur la même ressource :

- **`GET`** → `{ window, values }` : la fenêtre calculée et la totalité des
  valeurs éditables. Une lecture dédiée est nécessaire parce que
  `TournamentCard` n'expose ni le barème suisse ni les réglages d'endurance —
  élargir la carte pour tout le monde afin de servir un écran de staff serait
  payer le formulaire sur chaque liste de tournois.
- **`PATCH`** → applique une modification partielle.

Les deux exigent `can(user, "tournaments")`. L'édition est ouverte à **tout le
staff `tournaments`**, pas seulement à l'organisateur : c'est la règle déjà
appliquée à l'arbitrage des scores et aux inscriptions fantômes, qui ne vérifient
pas la propriété du tournoi.

| Situation | Réponse |
|---|---|
| non connecté | 401 `UNAUTHORIZED` |
| sans permission `tournaments` | 403 `FORBIDDEN` |
| tournoi inconnu | 404 `TOURNAMENT_NOT_FOUND` |
| fenêtre `LOCKED` | 409 `TOURNAMENT_LOCKED` |
| champ hors fenêtre | 409 `FIELD_NOT_EDITABLE` (le champ est nommé dans la réponse) |
| valeur invalide | 400, code existant du POST (`INVALID_DATE_ORDER`, `INVALID_SWISS_POINTS`, …) |
| effectif réduit / clôture au passé | 400 `MAX_TEAMS_CANNOT_DECREASE`, `REGISTRATION_CLOSE_IN_PAST` |

### Module

`lib/server/tournaments/edit.ts` — nouveau. `index.ts` pèse déjà 893 lignes ; la
mise à jour n'y est pas ajoutée.

`updateTournament(tournamentId, patch)` :

1. transaction, `SELECT … FOR UPDATE` sur la ligne du tournoi ;
2. **fenêtre recalculée depuis la ligne verrouillée**, jamais depuis le client —
   un tournoi devenu visible ou lancé entre le chargement du formulaire et
   l'envoi est refusé plutôt que modifié en silence ;
3. rejet des champs hors fenêtre ;
4. validation des valeurs résultantes ;
5. `UPDATE`, puis pour `MULTI` remplacement des lignes `bg_tournament_phases`
   (suppression + réinsertion : en fenêtre `FULL` aucun match n'existe, le
   tournoi n'étant pas même ouvert aux inscriptions) ;
6. commit, puis `publishUpdatedEvent(id)` — les fiches ouvertes se rafraîchissent
   par SSE.

Un changement de format vers ou depuis `MULTI` suit le même chemin : les phases
sont posées ou effacées selon le format d'arrivée.

### Validation partagée

Les règles de validation du POST (ordre des dates, format de match, barème suisse
monotone, réglages survie et endurance, plan de phases) sont extraites de
`app/api/tournaments/route.ts` vers `lib/server/tournaments/validation.ts` et
appelées par POST **et** PATCH. Sans cette extraction les deux jeux de règles
divergeront au premier format ajouté — la création acceptant ce que l'édition
refuse, ou l'inverse.

L'extraction ne change aucun comportement de la création : mêmes codes d'erreur,
mêmes bornes, mêmes défauts. Les tests existants du POST la couvrent en l'état et
servent de filet.

## Interface

### Formulaire partagé

`app/(secured)/tournois/creer/page.tsx` (667 lignes) est extrait en
`app/(secured)/tournois/_components/TournamentForm.tsx` :

```ts
type TournamentFormProps = {
  mode: "create" | "edit";
  initialValues: TournamentFormValues;
  editableFields: ReadonlySet<TournamentField>;
  submitLabel: string;
  onSubmit: (values: TournamentFormValues) => Promise<void>;
};
```

`/tournois/creer` devient une coquille qui fournit les valeurs par défaut et
poste sur `/api/tournaments`. Le formulaire ne connaît ni route ni fenêtre : il
reçoit un ensemble de champs éditables et rend le reste `disabled`.

### Page de modification

`app/(secured)/tournois/[id]/modifier/page.tsx` : charge
`GET /api/tournaments/[id]/edit`, rend le même formulaire, envoie un `PATCH`, puis
revient sur la fiche avec un toast de succès.

La raison d'un verrouillage est affichée **une fois en tête de section**, pas
répétée sur chaque champ : « Le tournoi est visible depuis le 12/09 — le format,
le jeu et les réglages ne sont plus modifiables. »

Un utilisateur sans la permission est renvoyé sur `/tournois` avec un toast,
comme le fait déjà la page de création.

### Bouton d'accès

En haut de `app/(secured)/tournois/[id]/page.tsx`, à côté du titre : un
`CyberButton variant="ghost"` « Modifier », rendu si `detail.isAdmin` **et**
fenêtre ≠ `LOCKED`. Aucun bouton grisé — un tournoi en cours n'en affiche pas.

### Messages

`useToast()` en superposition, jamais en ligne. Les nouveaux codes d'erreur sont
traduits dans `app/(secured)/tournois/[id]/_lib/error-map.ts`.

## Tests

| Fichier | Couverture |
|---|---|
| `tests/lib/shared/tournament-edit.test.ts` | matrice fenêtre × champ ; bascule `FULL`→`RESTRICTED` à la seconde près ; date illisible ⇒ visible ; `RUNNING`/`FINISHED` ⇒ `LOCKED` |
| `tests/lib/server/tournaments-edit.test.ts` | champ hors fenêtre 409 ; fenêtre recalculée sous verrou ; ordre des dates sur valeurs résultantes ; effectif à la baisse refusé ; clôture au passé refusée ; phases remplacées ; `MULTI` ↔ mono-format ; `publishUpdatedEvent` émis une fois |
| `tests/app/api/tournaments/edit.test.ts` | 401 / 403 / 404 / 409 ; `GET` renvoie fenêtre + valeurs ; `PATCH` partiel n'écrase pas les champs absents |
| `tests/tournois/tournament-form.test.ts` | champs `disabled` selon `editableFields` ; libellé de raison affiché une fois |

Les tests existants de `POST /api/tournaments` restent verts sans modification :
c'est le contrôle que l'extraction de la validation n'a rien changé.

`npm run seed` en fin de parcours — seul contrôle qui exerce réellement les
migrations et le SQL, que les tests simulant MySQL ne peuvent pas couvrir.

## Documentation

- `docs/features/TOURNAMENT_EDITING.md` — les fenêtres, les codes d'erreur, le
  point d'extension (ajouter un champ = l'ajouter à `TournamentField` et à la
  fenêtre qui le porte).
- Une ligne dans `CLAUDE.md`, section « Tournament Engine ».

## Réserve connue — hors périmètre

L'audit mené avant ce design a établi que **l'accès aux tournois non visibles
n'est pas bloqué** : un compte sans rôle qui connaît l'identifiant obtient
`HTTP 200` sur `/api/tournaments/[id]`, sur `/api/tournaments/[id]/stream` et sur
la page `/tournois/[id]` (vérifié en base seedée, utilisateur 743 sans rôle,
tournoi 241 visible à partir du 19/09/2026). `getTournamentDetail` ne consulte
jamais `start_visibility_at`.

La branche `feature/mes-tournois-tab-cf799c` élargit la **liste** pour
l'organisateur mais ne referme pas cette lecture. Le présent design n'y touche
pas ; il n'aggrave rien non plus, la nouvelle route étant gardée par
`can(user, "tournaments")`. Le correctif — 404 sur la fiche et le flux pour qui
n'a pas la permission `tournaments` — reste à placer.
