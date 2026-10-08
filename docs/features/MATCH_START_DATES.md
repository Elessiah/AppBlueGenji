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
`AUTO` (à l'antenne au lancement du match) et `MANUAL` (à l'antenne au
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
260 px pour montrer deux moitiés de la même information.

| Public | Ce qu'il voit |
|---|---|
| Tout le monde | `🕑 29/08 20:30` (date complète en infobulle), l'état de diffusion, le lien. |
| `live` | + bouton d'antenne (`MANUAL`) et configuration de diffusion. |
| `tournaments` | + action « Programmer une date » / « Modifier la date » (menu « Plus d'actions » de la carte, `MATCH_CARD_LAYOUT.md`) ouvrant `MatchScheduleDialog`. |

### Saisie sans année

Le dialogue demande le **jour** (liste 1–31), le **mois** (liste janvier–décembre)
et l'**heure** (liste des 96 **quarts d'heure**, `00:00` … `23:45`), à l'**heure de
Paris** quel que soit le fuseau du navigateur — **jamais l'année**. Une date
déjà posée pré-remplit les trois champs (`matchStartEntryOf`).

- **Heure par défaut : 21:00** (`MATCH_ENTRY_DEFAULT_TIME`) pour un match sans
  date — les matchs se jouent en soirée ; « Vider la date » y ramène aussi.
- **Mois par défaut : le mois courant** (`matchEntryDefaultMonth`, heure de
  Paris, figé à l'ouverture) pour un match sans date : reste à choisir le jour.
  Envoyer sans jour est refusé (« jour manquant ») ; « Vider la date » vide
  aussi le mois, pour effacer l'horaire.
- **Quarts d'heure seulement** (`MATCH_ENTRY_QUARTER_HOURS`) : une liste native se
  parcourt au clavier (flèches, première lettre) et ouvre le sélecteur du
  système sur mobile, sans saisie partielle à gérer.
- **Heure déjà posée entre deux quarts d'heure** (`20:50`, venue d'un autre
  chemin ou d'une date antérieure) : `matchEntryTimeOptions` l'insère à sa
  place dans la liste, présélectionnée — elle s'affiche juste et reste gardée
  si on enregistre sans y toucher ; la changer fait choisir un quart d'heure.
- **Le serveur ne l'impose pas** : `normalizeMatchStartAt` accepte toujours
  n'importe quelle minute — les dates existantes et les autres chemins
  d'écriture ne cassent pas. C'est une aide de saisie, pas une règle.
- **Sans jour ni mois, aucune date** (`readMatchStartEntry` → `empty`) : la
  liste des heures garde toujours une valeur, et une heure seule ne programme
  rien. Jour et mois vidés (ou bouton « Vider la date ») = horaire effacé.

Un match n'est jamais programmé à plus de trois mois : l'année se **déduit**
(`resolveMatchStartEntry`, `lib/shared/match-start-entry.ts`, pur) :

- référence (`matchEntryReference`, figée à l'ouverture du dialogue) : le début
  du tournoi s'il est **terminé** (correction d'archive) ; sinon le plus tardif
  du début du tournoi et de maintenant — un tournoi à venir se programme autour
  de son début, une ligue en cours depuis des mois autour d'aujourd'hui ;
  maintenant si le début est illisible. La date déjà posée sur le match n'y
  entre pas : elle ancrerait l'année sur une erreur ou un report, sans champ
  année pour en sortir ;
- en revanche, tant que le jour et le mois restent ceux de la date déjà posée,
  **son année est gardée** (`readMatchStartEntry`, `currentStartAt`) : retoucher
  l'heure ou enregistrer sans rien changer ne déplace jamais un match d'un an ;
  changer le jour ou le mois relance la déduction ;
- **échappatoire** : la déduction tombe juste à six mois près autour de sa
  référence. Pour l'archive d'un match plus ancien, ou une année déjà fausse,
  un bouton « Mauvaise année ? » sous l'aperçu déplie deux boutons
  « Année précédente » / « Année suivante » (libellés fixes) qui décalent l'année d'un cran (`shiftMatchStartYear`,
  `withYearShift` ; quatre ans pour un 29 février, `nextValidYearShift`). Ce n'est pas un champ année : rien n'est demandé, et la
  correction reste repliée tant qu'on ne la demande pas. Le décalage repart de
  zéro quand le jour ou le mois change ;
- les cartes de match affichent l'heure **du navigateur** : hors du fuseau de
  Paris, l'aperçu ajoute « (… à ton heure locale) »
  (`localMatchTimeIfDifferent`), pour que l'organisateur reconnaisse l'horaire
  de la carte ;
- l'aide est rattachée au champ jour et l'aperçu au champ heure
  (`aria-describedby`) : chacun lu une fois, plutôt qu'à chaque champ. L'aide
  n'explique plus la déduction de l'année (retiré à la demande des
  organisateurs) : l'aperçu, qui montre l'année retenue, suffit ;
- une saisie inachevée affiche une consigne neutre dans l'aperçu (« À
  compléter… », « Aucune date possible… ») ; le refus lui-même part en
  notification à l'envoi et se rattache au champ ;
- `Y` = année **à Paris** de la référence ; parmi `Y − 1`, `Y`, `Y + 1`, on garde
  la date la plus proche de la référence. Toute date à moins de six mois de la
  référence tombe donc sur la bonne année — dans les deux sens : « 3 janvier »
  saisi le 20 décembre donne l'année suivante, « 28 décembre » corrigé le
  5 janvier l'année précédente ;
- une année où le jour n'existe pas (31 avril, 29 février hors bissextile) est
  écartée ; si aucune ne convient, le champ jour est signalé
  (`useFieldErrors`) et le refus part en notification ;
- changement d'heure : une heure avalée (2 h 30 le dernier dimanche de mars)
  est lue avec le décalage d'hiver, soit 3 h 30 ; une heure doublée (fin
  octobre) retient sa première occurrence (heure d'été).

La **date complète, année comprise** (« dimanche 3 janvier 2027 à 20:00 »)
s'affiche sous les champs avant l'envoi, dans une région d'état, pour que
l'organisateur la vérifie. Rien ne change côté serveur : la route reçoit
toujours un instant ISO complet, validé par `normalizeMatchStartAt`, et un
refus `INVALID_MATCH_START_AT` est rattaché au champ jour
(`MATCH_SCHEDULE_FIELD_ERRORS`).

## Fichiers

| Fichier | Rôle |
|---|---|
| `lib/shared/match-schedule.ts` | Module **pur** : validation, bornes, formatage. |
| `lib/shared/match-start-entry.ts` | Module **pur** : saisie jour/mois/heure de Paris, déduction de l'année, aperçu. |
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

`npm run seed` produit trois tournois avec horaires (`lib/server/seed/cases.ts`,
champ `matchSchedule` — décalage de la manche 1 et écart entre manches) :

- **Live Horaire (heure passée)** — `START_TIME` dont l'heure est franchie : à
  l'antenne sans clic.
- **Live Horaire (heure à venir)** — même configuration, heure future : reste
  « programmé » et bascule tout seul.
- **Plateau Horaires (sans live)** — le cas le plus courant : des horaires
  annoncés, aucune diffusion.

## Notes reprises de CLAUDE.md

Texte déplacé tel quel depuis `CLAUDE.md` (allègement du fichier chargé à chaque session).

- **Dates de début des matchs** (`lib/shared/match-schedule.ts` pur + `lib/server/tournaments/match-schedule.ts`) : chaque match porte son heure (`bg_matches.start_at`, `NULL` = aucun horaire annoncé), fixée par la permission `tournaments` (arbitre, admin) — **distincte de `live`** : un caster pose la chaîne d'un match, pas son horaire. La date est **descriptive** : elle n'avance pas le match, ne verrouille rien, n'entre dans aucune règle du moteur, et n'a donc **aucune garde d'état** en écriture (programmer un match déjà joué est une correction d'archive). Son seul effet est le mode d'antenne `START_TIME` (`LIVE` une fois l'heure atteinte sur un match jouable) — le seul état de diffusion qui bascule **sans écriture**, donc sans que le flux SSE puisse l'annoncer : `resolveMatchLiveState(match, now)` prend l'instant en argument, `nextMatchLiveChangeAt` donne la frontière, et `useMatchLiveState` en fait un unique `setTimeout` côté client (même principe que `useScheduledBuckets`). `START_TIME` sans date est refusé en 409 à l'écriture de la diffusion, mais effacer la date d'un match déjà casté reste permis — le calendrier n'est pas pris en otage par la diffusion, le match retombe à « programmé » et l'interface le signale. Voir `docs/features/MATCH_START_DATES.md`.
