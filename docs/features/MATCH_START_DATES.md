# Dates de début des matchs

Chaque match d'un tournoi peut porter son **heure de début**, fixée par un
arbitre ou un admin. Elle annonce la manche aux engagés et aux spectateurs, et
sert de déclencheur d'antenne aux matchs castés.

## Pourquoi le tournoi ne suffit pas

`bg_tournaments.start_at` dit quand le tournoi commence — une seule heure pour
tout un plateau. Or un tableau à 32 équipes se joue sur une journée, un mode
Survie sur plusieurs soirées, et un multi-phases sur plusieurs week-ends. Sans
horaire par manche, un engagé du tableau perdants n'a aucun moyen de savoir
quand il joue, et le staff annonce les créneaux à côté du site (Discord).

La date vit donc sur `bg_matches.start_at` (`DATETIME NULL`), une par manche,
`NULL` valant « aucun horaire annoncé ».

## Une date descriptive, jamais prescriptive

**La date n'avance pas le match.** Elle ne le fait pas passer en `READY`, ne
verrouille pas la saisie du score, ne clôt pas le tournoi et n'entre dans aucune
règle du moteur. Le statut d'un match reste dérivé de son appariement et de son
score, exactement comme avant.

C'est un choix, pas un raccourci. Un horaire qui déclencherait le match ferait
d'un simple décalage d'organisation (« on prend trente minutes de retard ») une
manipulation de l'état du tournoi, avec tout ce que cela implique en cascade —
appariements, verrouillages, réconciliations. À l'inverse, une date purement
annoncée peut être corrigée à tout moment, y compris après coup, sans rien
défaire.

Il n'y a donc **aucune garde d'état** sur l'écriture : programmer un match déjà
joué n'est pas une incohérence, c'est une correction d'archive.

## Qui la fixe

Permission `tournaments` — arbitre et admin (`lib/shared/permissions.ts`).
Volontairement **distincte de `live`** : un caster porte `live` sans
`tournaments`, il pose la chaîne d'un match mais ne décide pas de son horaire,
qui engage l'organisation vis-à-vis des engagés.

Côté interface, le droit voyage dans `TournamentViewerContext.isAdmin`, qui est
déjà la permission `tournaments` et qui est déjà câblé sur **les deux portes** —
la route du flux SSE et la lecture REST de secours.

## Le mode d'antenne « à la date de début »

`bg_matches.live_trigger` accepte un troisième mode, `START_TIME`, à côté de
`AUTO` (à l'antenne dès que le match est jouable) et `MANUAL` (à l'antenne au
clic) :

```
liveTrigger === "START_TIME" && status === READY && now >= startAt → LIVE
liveTrigger === "START_TIME"                                       → SCHEDULED
```

C'est le mode d'un plateau annoncé à l'avance : l'antenne suit le programme
publié, sans que personne n'ait à cliquer à l'heure dite. `AUTO` et `MANUAL`
restent inchangés — un tournoi qui ne programme rien se comporte exactement
comme avant.

### Ce que le temps change

`resolveMatchLiveState(match, now)` prend désormais un instant en argument
(défaut `Date.now()`), pour que serveur, client et tests se placent au même
moment. `START_TIME` est le seul mode dont l'état bascule **sans écriture** : à
20 h 30, un match programmé passe à l'antenne alors que rien n'a bougé en base,
et le flux SSE n'a donc rien à pousser.

Côté client, `nextMatchLiveChangeAt` donne l'horaire de cette bascule et
`useMatchLiveState` (`lib/shared/hooks/`) en fait un unique `setTimeout` — même
principe que `useScheduledBuckets` pour les cartes de tournoi. Aucun minuteur
n'est armé pour les autres modes ni pour une frontière déjà franchie : sur un
plateau de 128 matchs, seuls ceux réellement programmés dans le futur en
consomment un.

La fonction ne renvoie une frontière que si la franchir **change réellement**
l'état : un match encore `PENDING` à son heure de début reste « programmé », et
se réveiller pour redessiner à l'identique serait du gâchis.

### Le couple mode / date

Poser `START_TIME` sur un match **sans date** produirait une diffusion qui ne
s'ouvrirait jamais, et l'échec ne se verrait qu'à l'heure du match. La route de
diffusion le refuse donc en `409 MATCH_START_AT_REQUIRED`, et le dialogue de
diffusion désactive l'option en amont.

L'inverse — effacer la date d'un match déjà casté en `START_TIME` — est en
revanche **autorisé**. Le calendrier ne doit pas être pris en otage par une
configuration de diffusion : le match retombe simplement à « programmé » sans
jamais passer à l'antenne, et l'interface le signale (`⚠ sans date` sur le
bandeau, avertissement dans le dialogue de date) à ceux qui peuvent le défaire.

## Interface

Tout tient sur le bandeau existant sous la feuille de score
(`MatchLiveStrip`) : horaire et diffusion se répondent — c'est la date qui ouvre
l'antenne en `START_TIME` — et les séparer ajouterait une ligne à une carte de
210 px pour montrer deux moitiés de la même information.

| Public | Ce qu'il voit |
|---|---|
| Tout le monde | `🕑 29/08 20:30` (date complète en infobulle), l'état de diffusion, le lien. |
| `live` | + bouton d'antenne (`MANUAL`) et configuration de diffusion. |
| `tournaments` | + bouton `🗓 Date` ouvrant `MatchScheduleDialog`. |

Le dialogue est un simple `<input type="datetime-local">` : champ vidé =
horaire effacé.

## Fichiers

| Fichier | Rôle |
|---|---|
| `lib/shared/match-schedule.ts` | Module **pur** : validation, bornes, formatage, valeur du champ HTML. |
| `lib/shared/live-streams.ts` | `START_TIME`, `resolveMatchLiveState(match, now)`, `nextMatchLiveChangeAt`. |
| `lib/shared/hooks/useMatchLiveState.ts` | Bascule client à la seconde dite (un `setTimeout`). |
| `lib/server/tournaments/match-schedule.ts` | Écriture de `start_at` + publication de l'événement. |
| `app/api/admin/matches/[matchId]/schedule/route.ts` | `PUT` — permission `tournaments`. |
| `app/(secured)/tournois/[id]/_components/MatchScheduleDialog.tsx` | Saisie de la date. |
| `app/(secured)/tournois/[id]/_components/MatchLiveStrip.tsx` | Affichage de l'horaire et du bouton. |

## Codes d'erreur

| Code | HTTP | Sens |
|---|---|---|
| `INVALID_MATCH_START_AT` | 400 | Date illisible, ou hors des bornes (2000–2100). |
| `MATCH_NOT_FOUND` | 404 | Match inexistant. |
| `MATCH_START_AT_REQUIRED` | 409 | Mode d'antenne `START_TIME` demandé sur un match sans date. |

Les bornes sont **absolues** et non relatives à « maintenant » : une borne
glissante rendrait la validation dépendante de l'horloge, donc intestable, et
capable de refuser à la relecture une date qu'elle avait acceptée à l'écriture.
Elles n'existent que pour écarter l'absurde (un `1970` issu d'un horodatage en
secondes, un débordement), pas pour juger du calendrier de l'organisation.

## Jeu de test

`npm run seed` produit trois tournois avec horaires (`lib/server/seed-cases.ts`,
champ `matchSchedule` — décalage de la manche 1 et écart entre manches) :

- **Live Horaire (heure passée)** — `START_TIME` dont l'heure est franchie : à
  l'antenne sans clic.
- **Live Horaire (heure à venir)** — même configuration, heure future : reste
  « programmé » et bascule tout seul.
- **Plateau Horaires (sans live)** — le cas le plus courant : des horaires
  annoncés, aucune diffusion.
