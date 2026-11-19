# Date butoir de planification des matchs

Dans un tournoi **planifié par l'arbitrage** (`MATCH_PLANNING.md`), le staff
des tournois fixe à un match une **date butoir** : ses deux engagées doivent
convenir d'un horaire, que l'arbitrage pose, avant elle. Passée sans horaire,
le match est clos en **double forfait** (`DOUBLE_FORFEIT.md`). La date butoir
pilote aussi la **confirmation d'office** du planning des casts et arbitres
(`CAST_PLANNING.md`).

Contexte : BlueGenji Strike (`BG_SURVIE`) joue une manche par semaine ; la
planification s'ouvre au dernier match de la manche (souvent dimanche 23:00),
un match se pose 24 h d'avance au moins, et les équipes doivent s'accorder
avant le mardi soir.

Code : `lib/shared/schedule-deadline.ts` (règle pure),
`lib/shared/schedule-deadline-notices.ts` (messages privés),
`lib/server/tournaments/schedule-deadline.ts` (écriture, balayage),
`lib/server/planning/auto-confirm.ts` (confirmation d'office),
`app/(secured)/tournois/[id]/_components/ScheduleDeadlineDialog.tsx`.

## Où elle vit, qui la pose

- Colonne `bg_matches.schedule_deadline_at` (`DATETIME NULL`, index
  `idx_bg_matches_schedule_deadline`), lue dans l'instantané
  (`BracketMatch.scheduleDeadlineAt`, publique comme `startAt`).
- Posée, changée ou retirée par `can(user, "tournaments")`, mêmes règles
  d'écriture que l'horaire (`MATCH_SCHEDULE_WRITE_RULE`) :
  - un match : `PUT /api/admin/matches/[matchId]/schedule-deadline`
    `{ deadlineAt: ISO | null }` (bouton de la fenêtre « Planifier ») ;
  - tous les matchs à planifier d'un tournoi :
    `POST /api/admin/tournaments/[id]/schedule-deadlines` → `{ count }`
    (bouton « ⏳ » du panneau de planification).
- Acceptée sur un match non joué, sans horaire ni lancement, dans un tournoi
  `referee_scheduling` (`acceptsScheduleDeadline`) ; ses engagées peuvent être
  encore inconnues (date butoir d'une manche posée d'avance). Sinon
  409 `SCHEDULE_DEADLINE_NOT_ALLOWED`. Une heure devant au moins, 60 jours au
  plus (`SCHEDULE_DEADLINE_TOO_SOON` / `_TOO_FAR`), arrondie à la minute.
- Transaction : `lockTournamentRow` en **première** instruction, puis les
  matchs `FOR UPDATE` ; changer ou retirer la date butoir efface les traces
  d'avis (les paliers repartent pour la nouvelle). Reposer la **même** date
  (geste commun relancé pour de nouveaux matchs) ne réécrit rien : aucun avis
  renvoyé, et le compte rendu ne compte que les matchs changés. Geste audité
  (`auditStaffAction`, staff anonymisé sur Discord), flux SSE réveillé.
- Saisie : un jour et une heure pile, **heure de Paris** ; préremplie par la
  date butoir en place, sinon par celle d'usage comptée depuis l'**ouverture**
  de la planification : la fin du dernier match joué du tournoi, sur les
  7 derniers jours (`scheduleOpenedAt`, `updatedAt` du match), sinon
  l'instant de la saisie ; si cette date est déjà à moins d'une heure, celle
  d'usage depuis maintenant (`suggestedScheduleDeadline`). Les équipes la voient sur la
  carte du match (« À planifier · avant le … », `MatchLaunchStrip`).

**Défaut** (`defaultScheduleDeadline`) : **21:00, heure de Paris, deux jours
calendaires après l'ouverture** — dimanche 23:00 → mardi 21:00, lundi 10:00 →
mercredi 21:00. Le changement d'heure ne décale pas l'heure murale.
*Décision requise* : la demande dit « 48 h plus tard, au 21:00 suivant », ce
qui, pris à la lettre, donnerait mercredi 21:00 pour dimanche 23:00 ; ses
exemples (« la date butoir mardi 21:00 ») ont été suivis.

## Échéance : double forfait ou extinction

Balayage `sweepScheduleDeadlines`, chaque minute (`startScheduleDeadlineClock`,
`instrumentation.ts`), sous le verrou nommé **`bg_schedule_deadlines`** pris
sans attendre (un autre processus le tient : passage sauté). Lot de 200
matchs, du plus urgent : dates butoir des matchs sans horaire, et dates
**échues** des matchs programmés. Décision pure `sweepAction` :

| Match à l'échéance | Effet |
| --- | --- |
| Toujours **à planifier** (deux engagées, ni horaire ni lancement), tournoi `RUNNING`, date butoir **armée** à temps pour cette paire | **Double forfait** |
| Engagée manquante, option éteinte, tournoi pas `RUNNING` ou `FINISHED`, paire jamais prévenue ou prévenue moins de 30 min avant | La date butoir **s'éteint** (effacée, traces comprises) |
| Horaire posé ou match lancé | La date butoir **s'éteint** : un match qui repasserait à planifier (horaire retiré, lancement défait) n'est jamais forfaité sans nouvelle date butoir |
| Match joué | Rien |

**Armée** (`deadlineArmed`) : le premier avis de la paire **actuelle** est
parti au moins 30 minutes avant l'échéance (`SCHEDULE_DEADLINE_ARM_MIN_MS`).
Une paire complétée trop tard (match d'origine fini juste avant) ou changée
après l'annonce n'est donc jamais forfaitée. Un match dont le passage échoue
5 fois d'affilée (`SWEEP_MAX_FAILURES`, forfait refusé à chaque fois par
exemple) voit sa date butoir s'éteindre, avec une erreur dans le journal : il
n'occupe plus la tête du lot.

Le double forfait passe par la chaîne existante, rien de neuf par format :
`forfeitMissedScheduleDeadlinePublic` → `runPlayerMatchWrite` (verrou du
tournoi, `retryOnDeadlock`) → `forfeitMissedScheduleDeadline`, qui **relit
sous verrou** l'état `RUNNING`, la date butoir **inchangée**, l'issue
`FORFEIT` et l'armement de la paire, puis `adminResolveMatch(…, { doubleForfeit: true })`. Les
réconciliations (survie, suisse, endurance, phases, `BG_SURVIE` qualification
rejouée et arbre final), la finalisation et les journaux sont ceux du double
forfait posé à la main (`DOUBLE_FORFEIT.md` § Ce que chaque moteur en fait).
Un horaire posé entre la lecture et le verrou annule le forfait. Retirer
l'horaire d'un match après sa date butoir efface celle-ci
(`match-schedule.ts`) : jamais de forfait rétroactif.

## Avis aux équipes

Destinataires : ceux qui **mènent le match** pour chaque engagée
(`loadEntrantMatchLeaderIds` : propriétaire, managers, capitaine ; le joueur
d'une entrée solo), en message privé Discord (tag certifié, interrupteur
« messages privés de match », `matchDm`) et en push, sujet
**`SCHEDULE_DEADLINE`** (`dmFollowsTopic` : couper le sujet coupe aussi le
message privé). Noms d'équipe seulement ; en individuel « Ton match » ;
aucun membre du staff nommé.

| Palier | Quand |
| --- | --- |
| `SET` | dès la pose (ou au premier passage) |
| `DL24` | 24 h avant |
| `DL3` | 3 h avant |
| `FORFEIT` | double forfait prononcé |

Un palier déjà ouvert quand un plus proche l'est aussi est **consommé** avec
lui : un seul message, le plus récent (`dueDeadlineReminder`). Chaque palier
se **réserve** dans `bg_schedule_deadline_notices` (PK `match_id, notice_key`,
avec la paire `pairing` et l'instant d'envoi) par un `INSERT IGNORE … SELECT …
WHERE schedule_deadline_at = ? AND team1_id <=> ? AND team2_id <=> ?` : jamais
deux fois, jamais pour une date butoir qui vient de changer ni pour une paire
remplacée. Les avis d'une paire précédente sont effacés : la nouvelle paire
reçoit son annonce. Rien ne part pour un
match qui n'est plus à planifier.

## Planning : confirmation d'office

Chaque entrée **ouverte** du planning se confirme à
**`min(date butoir, début − L)`** (`planningConfirmAt`), `L` = réglage
`confirmLeadHours` du planning (24–168 h, 24 par défaut : jamais moins que le
préavis d'un match). Sans date butoir (tournoi entier) : `début − L`.

- Match posé tôt (lundi soir pour mardi 22:00, date butoir mardi 21:00) :
  confirmé lundi 22:00, dans un petit lot à lui.
- Match lointain : confirmé à la date butoir, avec tout ce qui est posé d'ici
  là.

`sweepAutoConfirms`, chaque minute (`startPlanningAutoConfirmClock`), verrou
nommé **`bg_planning_confirms`** : entrées échues groupées par semaine du
planning ; pour chacune, `runAutoAssign(null, semaine)` refait les
propositions **provisoires** autour de ce qui est confirmé, puis
`confirmAssignments(null, { entryKeys })` ne confirme **que** les échues ; les
affectés reçoivent `PLANNING_ASSIGNED`. Écritures sous `bg_planning`
(`withPlanningLock`). La marque `bg_planning_auto_confirms` (entrée, début
confirmé `start_at`, date) est posée **après** la confirmation : une
confirmation faite ne se refait pas pour le même début (un staff qui retire
ensuite une affectation n'est pas contredit). Une entrée **reprogrammée** se
confirme de nouveau à son nouvel instant ; une proposition provisoire née
**après** la marque (nouveau calcul, caster libéré) est confirmée au passage
suivant. Une semaine en échec attend 10 minutes avant d'être relancée
(`FAILED_WEEK_RETRY_MS`). Marques purgées avec le planning (90 jours).
La carte d'une entrée montre « Confirmation d'office : … » (et la date butoir)
tant que cet instant est à venir (`upcomingConfirmAt`).

## RGPD

Registre T04 (avis, traces, base : intérêt légitime, opposition par
l'interrupteur et le sujet), T08 (remise par le bot), T12 (sujet push), T20
(confirmation d'office, marques) ; `/rgpd` FR et EN ; `PRIVACY_CHANGES`
« 2026-11-date-butoir-planification ». Aucun changement du bot : les messages
privés passent par la remise existante.

## Tests

`tests/lib/shared/schedule-deadline*.test.ts`,
`tests/lib/server/tournaments/schedule-deadline*.test.ts`,
`tests/lib/server/planning/auto-confirm.test.ts`,
`tests/lib/server/planning/view.test.ts` (`upcomingConfirmAt`),
`tests/lib/server/match-schedule-service.test.ts` (horaire retiré),
`tests/app/api/admin/match-schedule-deadline.test.ts`,
`tests/app/api/admin/tournament-schedule-deadlines.test.ts`.
