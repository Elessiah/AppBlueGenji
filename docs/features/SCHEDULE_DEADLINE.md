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
  409 `SCHEDULE_DEADLINE_NOT_ALLOWED`. **24 heures** devant au moins (le
  préavis minimal d'un match : une saisie hâtive ou malveillante ne peut pas
  forfaiter une manche dans l'heure), 60 jours au plus
  (`SCHEDULE_DEADLINE_TOO_SOON` / `_TOO_FAR`), arrondie à la minute. Seule
  exception : la saisie en masse peut **reposer** la date butoir déjà portée
  par un match non joué du tournoi (celle de la manche, pour les matchs
  remplis depuis) jusqu'à 13 heures devant (`SCHEDULE_DEADLINE_REAPPLY_MIN_MS` :
  les 12 heures d'armement plus une heure de marge, l'annonce se réservant
  après la pose), et **seulement sur les matchs sans date butoir** : une date
  butoir plus lointaine déjà en place n'est jamais raccourcie. La fenêtre
  propose toutes ces dates parmi ses choix (`roundScheduleDeadlines`, une par
  manche ouverte), sans les préremplir : elle s'ouvre sur la date proposée.
- Transaction : `lockTournamentRow` en **première** instruction, puis les
  matchs `FOR UPDATE` ; changer ou retirer la date butoir efface les traces
  d'avis (les paliers repartent pour la nouvelle). Reposer la **même** date
  (geste commun relancé pour de nouveaux matchs) ne réécrit rien : aucun avis
  renvoyé ; le compte rendu (`count`) dit les matchs visés, qui portent
  désormais cette date, changés ou non. Geste publié au journal
  (`publishStaffAction`, catégorie `schedule`, lot du tournoi :
  « ⏳ Date butoir de planification — … : match #N, fixée au … (heure de
  Paris), par le staff », ou « N match(s) à planifier » ; aucun nom
  d'engagée, l'auteur nommé dans pm2 seulement) ; un geste qui ne change
  rien (même date reposée, match sans date butoir « effacé », en masse ou
  match par match) n'a que sa trace pm2 (`auditStaffAction`). Flux SSE réveillé.
- Saisie : un jour et une heure pile, **heure de Paris** ; préremplie par la
  date butoir en place, sinon par celle d'usage comptée depuis l'**ouverture**
  de la planification : la fin du dernier match joué qui alimente ce match
  (vainqueur ou perdant ; à défaut, du tournoi), sur les 7 derniers jours
  (`scheduleOpenedAt`, `updatedAt` du match — la base ne garde pas d'instant
  de clôture : une retouche ultérieure du match le décale), sinon
  l'instant de la saisie ; si cette date est déjà à moins de 24 heures, celle
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
sans attendre (un autre processus le tient : passage sauté). Pages de 200
matchs (`SWEEP_BATCH`, jusqu'à 10 pages et 100 gestes — forfaits, retraits,
extinctions, avis — par passage, `SWEEP_MAX_PAGES`/`SWEEP_MAX_ACTIONS` ; la
suite attend la minute d'après ; un passage qui épuise ses pages sans finir la lecture le dit dans
le journal), du plus urgent : seules les lignes **qui ont quelque chose à faire** sont lues — dates
butoir échues (matchs sans horaire, ou programmés/lancés pas encore retirés), tournoi `FINISHED`, et
dates butoir à venir d'un match à planifier dont l'annonce n'est pas partie pour la paire actuelle ou
dont le premier rappel (24 h avant, `SWEEP_LOOKAHEAD_MS`) est ouvert : un match annoncé dont la date
butoir est lointaine, ou dont une engagée manque, n'est pas relu chaque minute. Les **messages**
(DM, push) partent **après** le verrou nommé, hors de sa connexion, `SEND_CONCURRENCY` matchs de front
(`flushSends`) ; un envoi qui échoue avant toute remise rend ses paliers (le passage suivant les
renvoie) et compte comme un échec du match, celui de l'avis de forfait est seulement journalisé. L'effacement des avis d'une
paire précédente et la réservation des nouveaux se font dans une même transaction. Une date butoir
posée d'un coup sur un tournoi s'écrit par paquets (`WRITE_CHUNK`), non match par match. Décision
pure `sweepAction` :

| Match à l'échéance | Effet |
| --- | --- |
| Toujours **à planifier** (deux engagées, ni horaire ni lancement), tournoi `RUNNING`, date butoir **armée** à temps pour cette paire | **Double forfait** |
| Engagée manquante, option éteinte, tournoi pas `RUNNING` ou `FINISHED`, paire jamais prévenue, prévenue moins de 12 h avant, ou dont aucun avis n'a joint personne | La date butoir **s'éteint** (effacée, traces comprises) |
| Horaire posé ou match lancé | La date butoir est **retirée** (marque `RETIRED` dans `bg_schedule_deadline_notices`, jamais envoyée, posée seulement si le match est toujours programmé ou lancé à l'écriture, et gardée par précaution quand les avis d'une paire précédente s'effacent — aucun état atteignable ne les réunit aujourd'hui, une date butoir changée effaçant tous les avis) : elle reste sur le match, où le planning la lit encore (confirmation d'office à la date butoir), mais ne frappera plus — un match qui repasse à planifier (horaire retiré, lancement défait) voit alors sa date butoir s'éteindre, sans forfait |
| Match joué | Rien |

**Armée** (`deadlineArmed`) : le premier avis **remis** de la paire
**actuelle** l'a été au moins 12 heures avant l'échéance
(`SCHEDULE_DEADLINE_ARM_MIN_MS`). Remis = un message privé ou un push au
moins est réellement parti (`reachedSomeone`, colonne `delivered` de
`bg_schedule_deadline_notices`, notée après l'envoi) : un palier réservé dont
rien n'est parti n'arme rien. Bot qui ne répond pas (`botUnreachable`, appel
perdu) : la réservation est rendue et le match mis de côté 10 minutes
(`BOT_RETRY_DELAY_MS`), au plus 3 fois pour une même date butoir
(`BOT_RETRY_MAX`) — une courte panne à l'annonce n'éteint pas la date
butoir, et un bot lent qui remet pourtant le message ne le répète pas sans
fin ; essais épuisés, la réservation reste. Pas de nouvel essai quand l'envoi
échoue en route (une engagée a pu être prévenue). Aucun responsable joignable
ou sujet coupé par tous : la réservation reste — pas de renvoi chaque minute
—, le palier suivant peut armer, sinon la date butoir s'éteint. Remise et
retour d'une réservation visent la paire **et la date butoir** de l'envoi
(une date changée pendant un envoi lent garde ses propres avis). Remis à
**une** engagée suffit : la date butoir est affichée aux deux sur la carte du
match, et exiger les deux laisserait une équipe échapper au forfait en
coupant le sujet. Une paire complétée trop tard
(match d'origine fini juste avant) ou changée après l'annonce n'est donc
jamais forfaitée. Un rappel ne se réserve que si le match est **toujours à
planifier** au moment de la réservation (ni horaire, ni lancement de la
paire, ni résultat, tournoi toujours planifié par l'arbitrage et pas
terminé) : un horaire posé entre la lecture et la réservation ne
reçoit pas « toujours sans horaire ». Un envoi en échec ne rend que les
paliers posés par **sa** réservation (un palier parti avant garde sa date). Le
double forfait passe par un contrôle sans verrou (`scheduleDeadlineForfeitDue`)
avant d'entrer dans la chaîne d'écriture, puis tout se relit sous verrou ; sa
ligne « Match terminé » dit « date butoir de planification passée sans
horaire » (`markDeadlineForfeit`).

**Retour en arrière** : un résultat défait (`rollback.ts`, `clearMatchResults`)
efface la date butoir **déjà passée** d'une rencontre close en **double
forfait**, ou close **sans horaire ni lancement** (résultat d'office, forfait
simple), rendue à jouer, et ses traces d'avis (`clearPastScheduleDeadlines`,
avant l'effacement du résultat) — sinon le balayage referait le double
forfait dans la minute ; une date butoir encore devant reste, comme celle,
passée et retirée, d'une rencontre programmée ou lancée (le planning la lit). Retirer l'horaire d'un match après une
date butoir passée l'efface de même, traces comprises (`setMatchStartAt`). Un match dont le passage échoue
5 fois d'affilée pour la même date butoir (`SWEEP_MAX_FAILURES`, forfait
refusé à chaque fois, avis qui n'arrive jamais à partir — la réservation qui
le précède ne remet pas la série à zéro —, ou verrou tenu longtemps) est **mis de côté** 15 minutes
(`SWEEP_FAILURE_BACKOFF_MS`, sauté par la lecture), avec une erreur dans le
journal pour l'arbitrage ; repris, il repart d'une série neuve (compte
borné). Sa date butoir **reste** : une panne passagère ne la fait jamais
perdre. La pastille « à planifier » n'affiche qu'une date butoir à venir (un minuteur posé sur la date butoir, un autre 24 h avant pour la teinte d'avertissement, `useInstantClock` ; aucun sans date butoir, ni onglet caché — `useClientPower().clocks`, heure relue au retour). Les échecs d'un match que la lecture ne rend plus sont
oubliés.

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
(`withPlanningLock`). Marques et propositions ne se lisent que pour les entrées dont l'instant de confirmation est atteint (aucune lecture quand aucune ne l'est ; listes `IN` par paquets de `KEY_CHUNK`), et les marques s'écrivent par paquets de `MARK_CHUNK`. Recalculer la semaine entière pour confirmer une entrée échue est voulu (mini-lot précoce, puis réoptimisation des suivantes autour des confirmées). La marque `bg_planning_auto_confirms` (entrée, début
confirmé `start_at`, propositions provisoires comptées par rôle
`pending_roles` : celles lues avant la confirmation et encore provisoires
après, `leftoverRoles` — ce qu'elle n'a pas pu confirmer —, date) est posée
**après** la confirmation : une
confirmation faite ne se refait pas pour le même début (un staff qui retire
ensuite une affectation n'est pas contredit : le membre retiré n'est plus
proposé pour ce rôle ; un **autre** membre proposé ensuite pour la place
vide compte comme une proposition de plus, et se confirme au passage
suivant, comme le remplaçant d'un désistement). Une entrée **reprogrammée** se
confirme de nouveau à son nouvel instant ; une proposition provisoire **de
plus** qu'à la marque, pour un rôle (nouveau calcul, caster libéré, même
entre la confirmation et la marque), rouvre l'entrée au passage suivant —
un reste que la confirmation n'a pas pu confirmer, recréé à l'identique par
un nouveau calcul, ne la rouvre pas (aucun compte nommé n'est gardé). Une semaine en échec attend 10 minutes avant d'être relancée
(`FAILED_WEEK_RETRY_MS`). Marques purgées avec le planning (90 jours).
La carte d'une entrée montre « Confirmation d'office : … » (et la date butoir)
tant que cet instant est à venir, puis « Confirmation d'office en attente »
s'il est passé alors qu'une confirmation d'office reste à faire
(`autoConfirmAwaiting`, même règle que le balayage, comptée sur les mêmes lignes
en base, marques lues pour ces seules entrées : propositions provisoires sans marque pour ce début,
ou plus nombreuses qu'à la marque — semaine en échec, reprise plus tard) ;
rien sinon : un reste que la confirmation n'a pas pu confirmer se confirme à
la main (`entryConfirmState`). L'état « en attente » est une pastille
(`waiting`) suivie de l'heure prévue et d'un « i » qui dit que le balayage
réessaie ; la ligne « à venir » reste un texte discret.

## Écrans (revue UI/UX)

- **Fenêtre de saisie** (`ScheduleDeadlineDialog`) : jour et heure de Paris.
  Les jours et heures **refusés d'avance ne sont pas proposés** (les heures à
  moins de 24 heures ; ni aujourd'hui, ni jour passé) — `deadlineEntryChoices`,
  `deadlineEntryHours` ; une date butoir en place **déjà passée** n'est pas
  rejouée (`deadlineEntryStart` repart de la date proposée) ; une plus lointaine
  est **triée** dans la liste. Un refus « trop proche » se rattache à l'**heure**,
  les autres au jour. La saisie en masse prévient (« i ») qu'elle remplace les
  dates butoirs posées ; « Aucune date butoir » n'efface, comme la pose, que les
  matchs **à planifier** (celle d'un match programmé ou lancé — retirée, lue par
  le planning — reste).
- **Fenêtre d'horaire** : « Date butoir… » est bloqué (toast) tant qu'une date
  saisie n'est pas enregistrée ; la fermeture de la date butoir **rouvre** la
  fenêtre d'horaire (le focus y revient).
- **Pastille « À planifier »** : la date n'apparaît qu'une fois l'horloge connue
  (rien dans le HTML serveur), suivie de « (heure de Paris) », en teinte neutre
  et en ambre seulement à moins de 24 h ; le texte lu par les lecteurs d'écran
  suit le libellé, avant la date.

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
`tests/lib/server/planning/view.test.ts` (`entryConfirmState`),
`tests/lib/server/match-schedule-service.test.ts` (horaire retiré),
`tests/app/api/admin/match-schedule-deadline.test.ts`,
`tests/app/api/admin/tournament-schedule-deadlines.test.ts`,
`tests/app/schedule-deadline-ui-render.test.tsx` (fenêtre, pastille, câblage).
