# Messages Discord automatisés

Le site écrit aux joueurs sur Discord, par le canal interne du bot. Trois usages,
une seule mécanique : **le site rédige, le bot distribue**.

- **Rappels de match** — l'annonce de l'horaire dès qu'un arbitre le pose, le
  change ou le retire, puis un rappel 24 h avant le coup d'envoi, en message
  privé à chaque joueur des deux engagées. Les rappels « une semaine » et
  « 1 h avant » ont été retirés (demande de l'association, 2026-10 : trop de
  notifications) — l'annonce immédiate tient lieu du premier, le départ du
  match (push `MATCH_START`) du second.
- **Signalement d'un problème** — un inscrit alerte le staff depuis la page du
  tournoi ou depuis un match ; le bot le relaie au canal de logs et au rôle
  arbitre.
- **Demande d'adhésion** — le propriétaire et les managers d'une équipe sont
  prévenus en message privé qu'un joueur demande à la rejoindre ; voir
  `docs/features/TEAM_JOIN_REQUEST_NOTIFICATION.md`.

Le même canal « rôle arbitre » porte aussi les alertes que le **moteur** produit
de lui-même — conflit de score, report expiré non tranché : le signalement en est
le troisième cas, pas le seul. Le tri entre journal complet et canal arbitre vit
dans `lib/shared/referee-alerts.ts` ; voir `docs/features/REFEREE_ALERTS.md`.

Le sens des appels reste **app → bot**, comme pour l'auth, les logs et la
fréquentation : le bot n'appelle jamais le site en retour.

## Modules

| Rôle | Fichier |
| --- | --- |
| Règle pure (fenêtres, rédaction, validation) | `lib/shared/discord-notifications.ts` |
| Balayage et envoi des rappels | `lib/server/tournaments/match-reminders.ts` |
| Horaire posé ou changé (joueurs, arbitres, journal) | `lib/server/tournaments/schedule-notices.ts` |
| Signalement d'un problème | `lib/server/tournaments/issue-reports.ts` |
| Tri journal / canal arbitre (pur) | `lib/shared/referee-alerts.ts` |
| Lien vers la page d'un tournoi | `lib/server/tournaments/app-url.ts` |
| Transport vers le bot | `lib/server/bot-integration.ts` |
| Route du signalement | `app/api/tournaments/[id]/report-issue/route.ts` |
| Interface | `_components/IssueReportDialog.tsx`, `_lib/issue-report-context.tsx` |

Côté bot (`blueGenjiBot`) : `POST /internal/notify/dm` et
`POST /internal/notify/referees`, documentés dans `doc/internal-api.md`.

## Rappels de match

### Ce qui déclenche l'envoi

Next.js n'a pas d'ordonnanceur, et le bot n'appelle jamais le site : **c'est le
trafic qui entraîne l'horloge**. `dispatchDueMatchReminders()` est appelée depuis
`listTournamentBuckets`, juste après `syncVisibleTournaments` — même motif que la
bascule d'état d'un tournoi. Elle est étranglée à une minute et lancée sans
attente : un bot lent ne retarde pas `/tournois`, et le passage suivant rattrape
ce qui reste dû.

Un `setInterval` de processus aurait été remis à zéro à chaque redéploiement et
dupliqué à chaque worker.

### Le palier, et pourquoi c'est une fenêtre

`MATCH_REMINDER_OFFSETS` ne déclare plus qu'un palier : `P1D` (24 h avant). Il
ne vaut que dans **sa propre fenêtre** — `[début − palier, début − palier
suivant)`, le dernier s'arrêtant au coup d'envoi. La règle tient pour tout
palier qu'on rajouterait : sans ce découpage, plusieurs rappels partiraient
d'un coup pour une manche programmée tard, dans la même seconde.

Le rappel dit « dans **moins de** 24 heures » (`dueLabel`) et non « dans
24 heures » : le balayage n'est entraîné que par le trafic, il peut partir
n'importe quand dans sa fenêtre, jusqu'à quelques minutes du coup d'envoi — le
message donne l'horaire exact.

Les anciens paliers `P7D` (une semaine) et `PT1H` (une heure avant) ont été
retirés : leurs lignes déjà posées dans `bg_match_reminders` restent inertes,
le balayage ne lisant que les clés des paliers déclarés.

Rien ne part une fois le match commencé : un rappel en retard n'est plus un
rappel, et un match reprogrammé vers le passé (correction d'archive) ne doit
réveiller personne.

### Une date posée tardivement : l'annonce

Un palier déjà dépassé n'est **pas rattrapé** : il est consommé sans message et
remplacé par une **annonce unique** portant la date
(`buildMatchScheduleAnnouncement`). Le palier encore devant, lui, suit son cours.

| Date posée par l'arbitrage | Ce que reçoit le joueur |
| --- | --- |
| à J-10 ou J-3 | annonce tout de suite (« Match programmé » + « Coup d'envoi : … »), puis P1D |
| changée | « Match reprogrammé » + « Nouveau coup d'envoi : …, au lieu du … », s'il avait reçu l'ancienne |
| à H-5 | annonce, et rien après |
| retirée | « Horaire du match retiré », s'il l'avait reçue, qu'elle était encore devant (ou passée depuis moins de 12 h) et que le tournoi est planifié par l'arbitrage |
| posée quand une place était vide | rien tant qu'elle l'est ; annonce par le balayage dès que les deux engagées sont connues, au plus tard 48 h avant (une journée avant le rappel) |

Le partage entre les deux régimes tient à la **marque d'observation** `SEEN` :
elle dit que l'annonce de cette date est **prise en charge**. `setMatchStartAt`
la pose pour toute date posée sur deux engagées connues (et annonce aussitôt) ;
le balayage ne découvre donc que les manches dont une engagée manquait alors,
ou a changé depuis, et les **annonce** à leur première observation, quelle que
soit l'échéance. La marque fait aussi verrou : seule la requête qui la pose
annonce.

D'où la marge de `MATCH_REMINDER_LOOKAHEAD_MS` : le balayage lit **une journée
plus loin** que le palier (48 h), pour que l'annonce d'une manche qu'il
découvre parte une journée avant l'ouverture du rappel, plutôt qu'à sa place.

Une engagée **remplacée** sur l'affiche (correction d'un score amont :
`vacateSlot` dans `bracket-cascade.ts`, ou `pushTeamToTarget` dans
`scoring.ts`) efface les marques de la manche (`forgetMatchReminders`,
`reminder-marks.ts`, seul point de cette règle), comme un retour en arrière
(`forgetChangedPosters`, `rollback.ts`, comparé après la réconciliation —
byes reposés compris —, qui épargne une rencontre rendue aux mêmes engagées,
dans un sens ou dans l'autre ; une rencontre laissée
incomplète perd les siennes, et sera annoncée de nouveau si le même résultat
est ressaisi — un doublon plutôt que des engagées jamais prévenues) : la
remplaçante n'a reçu aucun horaire, le balayage lui annoncera la date. Limite
connue : l'engagée restée en place perd aussi sa marque `TOLD` (les marques
sont par manche, pas par engagée) — un changement ou un retrait d'horaire
ultérieur lui sera dit « programmé » plutôt que « reprogrammé », ou tu.

**Engagée retirée de sa manche par un changement des résultats** (décision
utilisateur, 2026-10-13, étendue par la revue de sécurité). Quand une engagée
quitte une manche dont ses joueurs tenaient l'horaire, ils apprennent qu'il ne
les concerne plus : « **Match retiré de ton programme** » / "Match removed from
your schedule" (« Le tournoi a été mis à jour et tu ne joues plus ce match… » /
"The tournament has been updated and you no longer play this match…") — message privé Discord (français, « Ton match » en tournoi
individuel, aucun pseudo) et push `MATCH_REMINDER` dans la langue de chacun,
même étiquette que l'annonce qu'il remplace. Chemins couverts :

- correction de score : `pushTeamToTarget` remplace l'occupant (seule
  implémentation, dans `lib/server/tournaments/target-slot.ts`, que les
  exemptions empruntent aussi ; deux instructions par pose, la place et le
  statut écrits ensemble, le statut calculé par la base sur la valeur actuelle
  de l'autre place), `detachDownstreamOutcome` vide une place ;
- retour en arrière (`rollback.ts`) : affiche détachée qui a changé une fois
  re-remplie, manches supprimées. L'horaire des rencontres détachées est
  relevé **avant** le détachement (`holdDepartures`) et les sorties se
  constatent sur l'état d'arrivée (`settleDepartures`) : une pose
  intermédiaire de la réconciliation (exemption tranchée) ne prévient pas une
  engagée qui n'avait rien reçu, et n'efface pas l'horaire de celles qui
  l'avaient (`withoutSettledLater` : `pushTeamToTarget` et la cascade
  laissent les marques de ces manches au retour en arrière, qui les efface si
  l'affiche d'arrivée a changé) ;
- manches **supprimées** par le moteur — ronde suisse ou de Survie
  réappariée, manche de BlueGenji Survie défaite, arbre final refait, plateau
  périmé reconstruit — et rencontres d'arbre final réécrites sur place.

Avant chaque `DELETE FROM bg_matches` du moteur, `noteDeletedMatches` (même
filtre, constant) lit les manches visées **sous verrou** (une seule table, leurs
seules places) puis leurs marques `TOLD` sous verrou, par paquets de 500 ; le
contexte n'est lu que pour les manches dont un horaire est tenu : une marque posée par un envoi concurrent
après l'image de la transaction n'échappe pas, et un envoi qui n'a pas encore
posé la sienne attend la suppression puis ne trouve plus la manche ; un test
balaie les sources pour qu'aucune suppression n'y échappe
(`departed-notices-wiring.test.ts`). La suppression d'un tournoi entier n'est
pas couverte (le tournoi disparaît).

L'horaire est celui que tient la marque `TOLD`, lu dans la transaction
**avant** l'effacement des marques ou la suppression, par une seule lecture
verrouillante sans jointure pour toutes les sortantes (`noteDepartedEntrants`,
`lib/server/tournaments/departed-notices.ts`) ; ce que l'avis dit de la manche
(tournoi, manche, ronde suisse, tournoi individuel) est relevé au même moment
— une manche supprimée n'est plus lisible après le commit —, et l'adversaire
est celui **de l'horaire reçu**, relevé avant le changement (si les deux
engagées sortent l'une après l'autre, chacune a l'autre pour adversaire),
jamais l'occupant actuel de l'autre place. Une engagée n'est notée qu'une
fois par manche et par transaction, et une manche n'est lue qu'une fois par
transaction : une seconde sortie sur la même manche (deux remplacements, ou une
exemption puis une correction) retrouve l'horaire lu par la première, alors
que ses marques ont été effacées entre-temps (le moteur n'écrit jamais `TOLD`).
Seules les **détentrices** de l'horaire sont prévenues : l'affiche d'avant la
première sortie notée sur la manche (chaque sortante et l'adversaire qu'elle
avait), fixée pour la transaction ; l'adversaire nommé est l'autre
détentrice. Une engagée posée puis retirée dans la même transaction n'avait
rien reçu et n'est pas prévenue. L'avis part après le commit avec le
journal (`flushBotLogs`) et se jette avec lui si le changement échoue
(`discardBotLogs`) — même contrat de cycle de vie ; plafond de 512 avis par
transaction (une ronde suisse entière réappariée en compte deux par manche ;
le dépassement est écrit dans pm2). Une engagée revenue sur la manche
entre-temps (seconde correction) n'est pas prévenue. Rien ne part sans horaire
reçu (pas de `TOLD`, ou plus d'horaire après un retrait remis), ni pour un
horaire passé depuis plus de 12 h. Limite connue (marques par manche) : `TOLD`
est posée dès qu'une des deux engagées a été atteinte, et l'avis part alors aux
deux — une engagée qu'aucun message n'avait atteinte peut recevoir le retrait
d'un horaire qu'elle n'a pas reçu (un message de trop, jamais à un tiers).
Ce que dit l'avis se décide sur l'état d'arrivée, relu après le commit : une
engagée **reposée contre le même adversaire dans la même manche** (même
tournoi, phase, partie de plateau et numéro — une ronde réappariée ou un
plateau refait recrée ses rencontres) n'a perdu que son horaire et lit
« Horaire du match retiré » (un nouvel horaire lui sera annoncé) — rien si la
nouvelle rencontre tient le même horaire, ni dans un tournoi sans horaires
d'arbitrage (`referee_scheduling`) dont la nouvelle rencontre n'en a pas : le
lancement préviendra, comme après un retrait ; les autres lisent « Match
retiré de ton programme ». Accepté : la nouvelle rencontre n'a aucune marque,
le balayage l'annonce donc comme un « Match programmé » 48 h avant (au même
horaire, un doublon plutôt qu'un silence ; à un autre, « Horaire du match
retiré » puis l'annonce du nouveau). Une rencontre d'arbre final de BlueGenji Survie
réécrite avec les mêmes engagées dans l'autre sens n'est pas « changée » (paire
non ordonnée, comme au retour en arrière). L'étiquette reste celle de l'ancienne
rencontre (l'avis remplace son annonce sur l'appareil) ; le lien du push mène à
la rencontre qui existe, ou à la page du tournoi quand elle a disparu. Trois
lectures pour tous les avis (`announceEntrantsWithdrawn` : manches d'avant et
celles des sortantes dans le tournoi, noms des sortantes et de leurs
adversaires, destinataires), puis les envois, quatre à la fois. Les deux
suppressions écrivent leur filtre deux fois (`noteDeletedMatches` puis le
`DELETE`) : accepté, le test de balayage des sources garde la règle, et
regrouper l'écriture changerait les relevés exacts du moteur.

### La marque `TOLD` : un horaire reçu

La ligne `TOLD` retient aussi **l'horaire envoyé** (`bg_match_reminders.start_at`,
colonne ajoutée par cette PR, aux deux endroits du schéma) : c'est l'horaire que
les joueurs tiennent. « Au lieu du … » le cite, et « Horaire du match retiré »
le retire — jamais une date intermédiaire seulement journalisée (date passée
saisie de travers). Une marque sans horaire (`NULL`) ne dit qu'une chose : un
retrait remis — les joueurs ne tiennent plus d'horaire, rien n'est cité ni
retiré (les marques héritées reçoivent au démarrage l'horaire de leur manche,
voir « Passage à `TOLD` »). L'horaire tenu vaut tant qu'il est devant
ou passé depuis moins de 12 h (un match en retard qu'on décale ou dont on
retire l'horaire). L'horaire est posé dans la marque **avant** l'envoi (un
arbitre qui corrige sa saisie dans la seconde le lit déjà) et rendu à son
état d'avant si rien n'a abouti — seulement si la marque porte encore
l'horaire de cet envoi (`start_at <=> ?`) : un changement plus récent, remis
entre-temps, garde le sien (un rendu en échec est écrit dans pm2, l'échec de
l'envoi restant celui qui remonte) ; un avis de retrait le remet à `NULL` : la
date suivante se dit « reprogrammée », sans rien citer. Une date rendue à
l'horaire que les joueurs tiennent déjà (après une saisie de travers seulement
journalisée) ne leur est pas réannoncée, et garde ses marques (le rappel déjà
parti ne repart pas) — sauf un palier daté d'un **autre** horaire (pris pour
une date intermédiaire dont l'annonce n'a atteint personne), qui ferait sauter
au balayage le rappel 24 h de l'horaire rendu ; l'observation y est redatée
(reposée si un passage par un match joué l'avait retirée, deux engagées
connues), pour qu'un échec tardif de l'avis intermédiaire ne la rende pas et que
le balayage ne réannonce pas l'horaire tenu ; une date déjà passée, annoncée
à personne, laisse elle aussi les marques en place.

`dispatchPlannedSend` réserve `TOLD` **avant** d'envoyer une annonce ou un
rappel (un arbitre qui corrige sa saisie dans la seconde la lit déjà, et
reçoit « reprogrammé »), puis la rend si rien n'a **abouti** (aucun message
privé remis, aucun appareil atteint — bot injoignable sans appareil abonné). Une manche programmée avant
l'arrivée de `TOLD` a ses preuves héritées recopiées en `TOLD` au démarrage
(voir « Passage à `TOLD` ») : `TOLD` est la seule source. Ni `SEEN` (le balayage la pose aussi en silence) ni
la ligne d'un palier (réservée avant l'envoi, consommée sans message par une
annonce) ne le prouvent. `TOLD` survit aux changements de date : c'est elle qui
fait dire « reprogrammé » à la date suivante et « retiré » à une date effacée.
Une date posée sur un
match **déjà joué** (ou dont le score est saisi, `AWAITING_CONFIRMATION`), ou
déjà passée, n'est que journalisée (ni joueurs, ni arbitres). Le dialogue
d'horaire de l'arbitre dit qui sera prévenu (`schedule.notice` /
`noticePlanning`, ou `noticeTbd` quand une place est encore vide : l'annonce
attend alors le balayage, dans les 48 h qui précèdent le coup d'envoi).

**Passage à `TOLD` (déploiement de la PR #441).** Deux reprises de données,
au démarrage (`RECENT_SCHEMA_CHANGES`), sans effet une seconde fois : tout
palier hérité `P7D` / `PT1H` est recopié en `TOLD`, avec l'horaire de sa
manche (l'ancien code effaçait ses paliers à chaque changement de date, et ne les
posait qu'avec un message, le nouveau ne les écrit jamais ; `P1D` n'est pas
lu — le nouveau code le réserve avant l'envoi, et l'ancien ne le posait jamais
sans `P7D`) ; et une marque `SEEN` posée seule, en silence, par
l'ancien balayage (sept à huit jours avant, dans l'attente du palier « une
semaine ») est effacée pour une manche à venir, jusqu'au 2026-10-31 — le
nouveau balayage l'annoncera. À retirer de la liste une fois jouées partout.

### Programmer, reprogrammer ou retirer l'horaire d'une manche

`setMatchStartAt` verrouille le **tournoi** puis la manche (l'ordre de toute
écriture du moteur : une correction de score qui efface les marques d'une
manche voisine puis met celle-ci à jour ne peut plus s'interbloquer avec une
programmation) et, **quand la date change réellement**, remet les marques à
jour **dans la transaction** qui écrit la date (`resetReminderMarks`) : un
balayage ne voit jamais la nouvelle date avec les marques de l'ancienne. Une
erreur (autre qu'une table absente) défait l'écriture de la date — un refus que
l'arbitre peut rejouer plutôt qu'un horaire changé dont personne n'est prévenu.
Il lit d'abord `TOLD` (`alreadyAnnounced`) puis, si une date est
posée :

- les deux engagées connues, pose `SEEN` puis efface les lignes de la manche
  **sauf** `SEEN` et `TOLD`, dans le même geste. Un balayage qui passerait entre
  ce ménage et l'annonce ne peut donc plus la prendre pour lui (et annoncer sans
  l'ancienne date) : il ne peut prendre qu'un palier ouvert, dont le rappel
  porte la nouvelle date — l'annonce se tait alors. L'insertion **précède**
  l'effacement : un `DELETE` sur une manche sans marque verrouille l'intervalle
  d'index qui l'entoure, et deux arbitres qui programment au même instant deux
  manches voisines s'interbloqueraient sur leurs insertions suivantes (la
  transaction perdante rendrait l'horaire en refus) ;
- une engagée manquante, efface tout sauf `TOLD` : le balayage annoncera la
  manche quand elle sera connue.

Une date **effacée** garde toutes ses marques (inertes : le balayage ne lit que
les manches datées). Puis `notifyMatchScheduleChange`
(`lib/server/tournaments/schedule-notices.ts`) prévient **sans attendre le
balayage**, la manche lue **une fois** pour le journal, les arbitres et les
joueurs (`announceMatchSchedule` / `announceMatchScheduleCleared` la reçoivent,
`MatchNotice`, et ne la relisent pas). Les joueurs ne sont prévenus que si la
manche relue a encore les engagées de l'écriture (`entrantIds`, sous verrou) :
une place remplie ou une engagée remplacée entre-temps n'a pas les marques que
l'écriture a posées, et son annonce revient au balayage. Ni joueurs ni
arbitres ne sont prévenus si la manche relue porte déjà un autre horaire (une
correction plus récente, qui fait ses propres annonces) ; la ligne de journal
reste. Dans la transaction, l'option du tournoi se lit sous le verrou déjà
tenu : la lecture de `TOLD` est la première lecture ordinaire, et voit l'état
le plus récent :

- **Joueurs** des deux engagées (équipes ou entrées solo, push dans la langue de
  chacun, message privé Discord en français) : `announceMatchSchedule` consomme
  le palier déjà ouvert et envoie « Match programmé » ou « Match reprogrammé »
  — reprogrammé seulement si les joueurs avaient reçu un horaire (`TOLD`), avec
  « , au lieu du … » quand l'ancienne date est connue (pas après un
  effacement) et que les joueurs ont pu la recevoir : encore devant, ou passée
  depuis moins de 12 h (match en retard qu'on décale) — une date passée depuis
  longtemps n'a été que journalisée. Une date posée quand une place était vide n'a jamais été
  annoncée : sa remplaçante se dit « programmé », sans ancienne date. Une date
  **retirée** (`announceMatchScheduleCleared`) donne « Horaire du match
  retiré » — seulement si les joueurs l'avaient reçue, qu'elle était encore
  devant et que le tournoi est **planifié par l'arbitrage** (sans l'option, un
  match sans horaire part en lancement : aucun nouvel horaire ne viendra, et le
  départ du match prévient les joueurs) — avec la même étiquette push que
  l'annonce, qu'il remplace ; le bot le reçoit sous le contexte
  `match-schedule-cleared` (journaux du bot). Les corps push d'une
  reprogrammation et d'un retrait commencent par le changement (« Nouveau coup
  d'envoi : …, au lieu du … » / « L'horaire du … est retiré … ») : c'est la fin
  d'un corps trop long que `PUSH_BODY_MAX` coupe. Une engagée **remplacée**
  (correction d'un score amont, `scoring.ts`) efface les marques de la manche :
  la nouvelle n'a reçu aucun horaire. En
  tournoi individuel, le message privé (annonce, rappel, retrait) dit « **Ton
  match** » au lieu de « A contre B » : les deux noms sont des pseudos, et
  aucun pseudo de joueur ne passe par Discord — même règle que le push.
- **Arbitres** : push `MATCH_SCHEDULED` aux comptes qui portent la permission
  `tournaments`, **sauf l'auteur** du geste (`notifyStaff({ excludeUserIds })`),

  pour une date posée ou changée ; pour un retrait d'un horaire encore devant (ou passé depuis moins de 12 h), « Horaire du match retiré » (corps arbitre sans « te sera annoncé », même étiquette `-schedule`, qui remplace leur avis « programmé »). « Reprogrammé » dès
  qu'une date précédait (ils la voyaient sur le plateau). Étiquette
  distincte de l'annonce aux joueurs (`rencontre-<id>-schedule`) : un arbitre
  qui joue ce match reçoit les deux versions — un doublon plutôt que sa
  version joueur (« Ton match ») remplacée par la version arbitre, ou
  aucune. Le push reprend le titre et le corps de
  l'annonce aux joueurs (clés `matchReminder.*`) ; une place vide s'y lit
  « TBD », comme sur le plateau et au journal.
- **Journal Discord** : une ligne `formatMatchScheduledLog` (« 🗓️ Match
  programmé / reprogrammé — « Tournoi » (#id) : Manche 2 — A vs B (#42), coup
  d'envoi …, au lieu du …, par le staff ») ou `formatMatchScheduleClearedLog`
  (« 🗓️ Horaire retiré — … l'horaire du … (heure de Paris) est retiré,
  par le staff »). Auteur anonyme sur Discord, nommé dans pm2
  (`publishStaffAction`) ; engagées par `entrantLabel` (« un joueur » en
  tournoi individuel). Pas de message privé au rôle arbitre : ce n'est pas une
  alerte qui attend une intervention.

Rien ne part pour une date **inchangée**, ni pour une date posée **déjà
passée** (correction d'archive) ; un retrait sans date d'avant n'est même pas
journalisé. Une manche dont une engagée manque encore n'a pas d'annonce joueurs
(le balayage l'annoncera) mais a sa ligne de journal et son push arbitre.

### Pourquoi la réservation précède l'envoi

`bg_match_reminders` porte une clé unique `(match_id, offset_key)`. La ligne est
insérée **avant** l'envoi, et seule l'insertion qui gagne envoie : deux requêtes
concurrentes déclenchent le même balayage, et sans ce verrou le joueur recevrait
son rappel en double.

**Destinataires atteignables.** Ne comptent que les joueurs qu'un message
atteindrait : un tag Discord, ou un appareil abonné aux rappels
(`usersReachableByPush`, une lecture pour tout le passage, et seulement pour les
joueurs sans Discord ; même règle que la distribution, écrite une fois dans
`push-subscriptions.ts`). Une engagée que rien n'atteint ne pose pas `TOLD` —
qui ferait dire « reprogrammé » à des joueurs n'ayant rien reçu — et ne coûte
ni écriture ni lecture d'abonnements. Si cette lecture échoue, chacun est tenu
pour atteignable : le message privé part comme avant.

**Coût du balayage.** Sa fenêtre se lit par l'index `idx_bg_matches_start_at`
(sans lui, chaque passage relisait toute l'histoire des matchs), et une manche
dont le dernier palier (`P1D`) est déjà pris n'y est plus relue ; une manche
déjà observée n'y est lue qu'à l'ouverture de son premier palier (24 h avant) —
au-delà, seules les manches jamais vues (à annoncer). Les marques
d'observation et d'horaire reçu viennent avec chaque manche, dans la même
requête. Une première
observation dont un palier ne peut être réservé rend sa marque `SEEN` : le
passage suivant annoncera la manche. L'horaire écrit par `setMatchStartAt`
perd ses millisecondes (la colonne `DATETIME` les arrondirait), pour que les
comparaisons d'horaires de `schedule-notices` portent sur la valeur gardée ;
l'option du tournoi se lit dans la lecture verrouillante qui le tient. Réservations
et envois vont quatre manches à la fois (`inBatches` : une réserve de quatre
exécutants, dont aucun n'attend le plus lent des autres, et qui traite tous les
éléments avant de lever la première erreur ; `SWEEP_CONCURRENCY`), les
deux engagées d'une manche ensemble : une ronde suisse appariée sur des
horaires déjà posés donne autant d'annonces que de manches, et chacune attend
le bot puis les appareils — les réservations, prises avant, interdisent le
doublon quel que soit l'ordre. Un envoi en échec ne retient pas les autres
(leurs réservations sont prises : un passage interrompu les perdrait), et sa
marque `TOLD` reprend son état sauf si une engagée a été atteinte. Une
réservation ne vaut que **pour l'horaire lu** (`INSERT … SELECT … WHERE
start_at = ?`) : un arbitre qui déplace la manche entre la lecture du balayage
et son envoi la fait échouer, et l'annonce du nouvel horaire garde son
palier. Juste avant l'envoi, la pose de `TOLD` relit l'horaire actuel de la
manche et ses engagées : horaire déplacé ou engagée remplacée depuis, rien ne
part (l'annonce de l'arbitre, ou celle de la nouvelle affiche, s'en charge) ;
un avis de retrait dont la marque `TOLD` a disparu entre-temps ne part pas non
plus.
Une réservation qui échoue (attente de verrou, interblocage) est journalisée
et réessayée au passage suivant, sans retenir les autres manches. La pose de `TOLD` porte elle-même la condition (horaire et engagées de
la manche, dans un `INSERT … SELECT … FROM bg_matches` — la manche lue avant
la marque, dans l'ordre de verrouillage du moteur ; `ON DUPLICATE KEY UPDATE`
pour une marque déjà là) : une
correction ou un déplacement qui tombe entre la relecture et l'écriture fait
échouer la pose, et rien ne part. Deux envois d'un même horaire ne coexistent
pas : ce sont les réservations (observation, palier) qui n'en laissent passer
qu'un — la pose de `TOLD` ne les départage pas (`FOUND_ROWS`). Un envoi qui échoue avant d'atteindre les joueurs (pose de `TOLD` en
attente de verrou, destinataires illisibles) **rend** les marques qu'il avait
réservées (`PlannedSend.claimed` : observation, palier) — sans quoi le rappel,
ou l'annonce, serait consommé sans message et jamais retenté. Chaque marque
réservée retient l'horaire pour lequel elle l'est (`bg_match_reminders.start_at`,
recopié de la manche ; `setMatchStartAt` y date l'observation), et seul l'envoi
de cet horaire la rend (`start_at <=> ?`, `releaseDatedMarks` dans
`reminder-marks.ts`, seul chemin de rendu) : un ancien envoi en échec n'efface
pas les marques d'un changement plus récent ; un rendu en échec est écrit dans
pm2, comme un passage du balayage en échec (hors table absente). Une réservation vérifie aussi les
engagées de la manche ; si `schedule-notices` ne peut relire la manche après
le commit, il rend l'observation de la date, et le balayage l'annoncera (un
redémarrage dans cet intervalle reste une limite connue : seul le rappel 24 h
partirait) ; l'annonce d'un
arbitre rend aussi l'observation posée par `setMatchStartAt`, et le balayage
annoncera la manche. `setMatchStartAt` est rejoué sur interblocage, ou sur le
refus de l'isolation par instantané de MariaDB (`ER_CHECKREAD`, 1020)
(`retryOnDeadlock`, `lib/server/tournaments/deadlock-retry.ts`, partagé avec le
report de score) ; une panne qui persiste ne sort de la route qu'en code
(`MATCH_SCHEDULE_UPDATE_FAILED`), son texte reste dans pm2. La route refuse un
corps illisible ou sans `startAt` (400 `INVALID_MATCH_START_AT`) : seul un
`null` (ou une chaîne vide) explicite efface l'horaire, puisque l'effacement
prévient tous les joueurs ; et elle plafonne les gestes d'un arbitre
(`MATCH_SCHEDULE_WRITE_RULE`, 60 en 5 minutes, 429 `TOO_MANY_REQUESTS`) —
assez pour planifier une ronde entière, pas pour qu'un client qui boucle fasse
écrire le bot en rafale.

Un tournoi **clos** (`FINISHED`) ne se joue plus : ses manches restées
ouvertes comptent pour jouées — une seule règle, `isMatchOver`
(`lib/shared/match-schedule.ts`), pour l'écriture de la date (aucune
observation posée), les avis (`loadMatchInfo` les lit `COMPLETED`), le
balayage (qui les écarte) et le dialogue de l'arbitre (aucune promesse
d'annonce) : une date corrigée pour l'archive n'est que journalisée.

Le retrait d'un horaire n'est poussé aux arbitres que s'ils l'avaient reçu :
la marque `STAFF` (`MATCH_STAFF_KEY`) retient l'horaire de « Match programmé »,
réservée **avant** l'envoi (`markStaffPushed` : une transaction qui verrouille
la manche puis sa marque, comme le moteur ; conditionnée à l'horaire encore
en place : un retrait qui suit de près la trouve ; refusée, la manche ne tient
plus cet horaire et rien n'est poussé) et rendue si aucun appareil n'est
atteint (`releaseStaffPush`), sur sa ligne, à ce qu'elle tenait avant — jamais
quand elle tenait déjà cet horaire (`held` : preuve d'un envoi précédent qui,
lui, a atteint les arbitres) — `pushToUsers` compte les appareils atteints
même si un autre envoi lève ou si la tenue des abonnements échoue ensuite ; elle se lit avec `TOLD` sous les verrous
de l'écriture de la date, survit aux ménages de marques (changement de date,
retour à l'horaire tenu, affiche changée, reprise des marques héritées, qui ne
la compte pas comme preuve d'un horaire reçu par les joueurs), et s'oublie une
fois le retrait poussé (`forgetStaffPush`) — sauf si la manche a retrouvé cet
horaire pendant l'envoi (reposé par un autre arbitre).
`refereesWerePushed` exige qu'elle tienne l'horaire retiré, encore valable
(devant, ou passé de moins de 12 h) : une date seulement journalisée — passée,
posée sur un match joué ou dans un tournoi clos, même rouvert ensuite — n'a
rien à remplacer. `forgetMatchReminders` la garde : une affiche changée ne
change pas l'horaire que les arbitres ont reçu. Une date posée sur un match au score saisi ne pose pas
d'observation (tout part sauf `TOLD`) : si la rencontre revient à jouer, le
balayage l'annoncera. La place remplacée par `pushTeamToTarget` se lit sous
verrou (`FOR UPDATE`).

Accepté, non changé : un message par engagée (chacune lit « ton équipe contre
l'autre »), donc une lecture des abonnements push par message ; et la
réservation `INSERT … SELECT` prend un verrou partagé sur la manche — face à
une correction de score sur une manche voisine, l'interblocage éventuel
désigne la réservation (aucune ligne écrite), réessayée au passage suivant. Le rappel 24 h d'un horaire
déjà reçu lit la marque `TOLD` sans la réécrire (elle tient déjà cet horaire),
et une cascade de correction de score efface les marques des affiches quittées
en une instruction (`detachDownstreamOutcome`).

Le prix est symétrique et assumé : un bot injoignable au moment précis de l'envoi
consomme le palier. C'est le bon sens du risque — un rappel manqué se rattrape au
palier suivant, un rappel envoyé en boucle ne se rattrape pas.

La table suit la manche (`ON DELETE CASCADE`) : un plateau régénéré —
réappariement d'une ronde suisse, correction de score en survie — efface ses
matchs, donc ses rappels ; les engagées qui en tenaient l'horaire sont
prévenues (`noteDeletedMatches`, ci-dessus).

### Qui reçoit

Les joueurs des **deux** engagées : membres actifs d'une équipe, ou le joueur
d'une entrée solo (`bg_teams.solo_user_id`), qui n'a pas de ligne de membre. Un
message **par engagée**, pas un pour tout le monde : chaque joueur lit « ton
équipe contre l'autre », dans le bon sens.

Deux exclusions, silencieuses toutes les deux :

- **Pas d'identité Discord** (ni `discord_id`, ni `discord_pseudo`) : le joueur
  est simplement écarté. Ce n'est pas une anomalie — un compte créé par Google
  n'a pas de tag.
- **Pas sur un serveur BlueGenji** : le bot cherche le destinataire sur les
  serveurs `SERV_GENJI` et `SERV_RIVALS` (ou ceux de `GUILD_ID`, surcharge
  facultative) et **ne tente aucun envoi** s'il ne l'y trouve pas. Un tag mal
  saisi ne doit pas faire écrire le bot à un inconnu croisé sur un serveur
  partenaire.

**Aucun serveur joignable n'est pas une absence.** Le bot répond alors `503`
(`HOME_GUILD_UNAVAILABLE`), le site y voit un bot injoignable et rend ses
réservations. Il répondait auparavant `200` en déclarant tous les destinataires
« introuvables » : le site gardait la réservation (un joueur absent du serveur
ne se relance pas) et le message ne repartait jamais. C'est ce qui s'est
produit, sans bruit, depuis la création de ces envois : le bot lisait
`GUILD_ID`, une variable absente de sa configuration réelle
(blueGenjiBot#23).

Le tag suffit — le bot résout le membre. L'ID, quand le compte a été lié par code
Discord, évite cette recherche et reste donc prioritaire.

Seules les manches dont **les deux** engagées sont connues sont rappelées : un
plateau programmé à l'avance dont les qualifiées ne sont pas désignées n'a
personne à prévenir, et un bye n'est pas un match.

## Signalement d'un problème

Un tournoi se joue en soirée, sur Discord, pendant qu'un arbitre suit dix
plateaux. Le joueur bloqué doit pouvoir alerter depuis la page où il est déjà.

- **Dans l'en-tête du tournoi** — portée « tournoi entier », à toute heure du
  tournoi : un problème d'inscription se signale avant le coup d'envoi comme un
  litige de score se signale après.
- **Sur le match du lecteur**, et sur lui seul, une fois ses deux adversaires
  connus.

**Réservé aux engagés.** Ce n'est pas un formulaire de contact : le bouton n'est
rendu que si l'engagé du lecteur figure **parmi les inscrites**
(`isViewerEntrant`, `lib/shared/match-card-viewer.ts`) — `myTeamId` seul ne
suffit pas, c'est l'équipe active du lecteur, inscrite ou non —, et le serveur
**revérifie** l'inscription (`NOT_REGISTERED` → 403) — sans quoi n'importe quel
visiteur pourrait faire sonner le téléphone des arbitres.

**Une manche n'est signalée que par qui la joue.** Un inscrit qui suit le
plateau d'à côté n'a rien à en dire à l'arbitrage — il garde le bouton de
l'en-tête pour tout ce qui concerne le tournoi. La carte ne porte le bouton
que pour le lecteur engagé dans la rencontre (`canReportOwnMatch`), et le
serveur refuse un `matchId` dont aucun des deux créneaux n'est l'engagé de
l'auteur (`NOT_MATCH_PARTICIPANT` → 403). La résolution de l'engagé est la même que partout
ailleurs (`resolveUserEntrantTeamId`) : équipe active en tournoi par équipes,
entrée solo en tournoi individuel.

Le message part sur **deux canaux** : le canal de logs du bot (`sendLog`) et un
message privé à chaque membre du rôle arbitre configuré côté Discord
(`/set-referee-role`, par serveur). Les deux, pas l'un ou l'autre : le log garde
la trace consultable même si aucun arbitre n'est joignable.

Rien n'est stocké côté site — c'est une alerte, pas un ticket.

**Le bot injoignable est remonté, pas avalé** (`BOT_INTERNAL_UNREACHABLE`, 503) :
répondre « signalement envoyé » quand rien n'est parti laisserait le joueur
attendre un arbitre qui n'a rien reçu.

Le **coupe-circuit** de `bot-integration` est ignoré sur ce chemin — et sur celui-là
seulement : les alertes que le moteur produit en arrière-plan le respectent, elles
(`pushRefereeAlert(…, { honourCircuit: true })`). Ici, comme pour
l'envoi du code de connexion : il protège le site d'un bot en panne que le trafic
de fond sollicite en boucle, mais un balayage de rappels qui vient de l'ouvrir
refuserait sinon le signalement d'un joueur sans même essayer. Une action
explicite mérite sa tentative.

Le bouton **par match** disparaît quand le suivi temps réel décroche (`frozen`) —
le plateau affiché ne bouge plus, et signaler « ce match » depuis une manche
périmée désignerait la mauvaise. Celui de l'**en-tête** reste : c'est justement
quand le site décroche qu'il faut pouvoir joindre un arbitre.

Le plafond de débit (`ISSUE_REPORT_RULE`) est étroit à rebours des autres — cinq
par dix minutes et par utilisateur : chaque appel fait vibrer le téléphone de
tous les arbitres. Il ne bornait qu'une rafale — sept cents messages par jour
restaient possibles —, d'où un second plafond, `ISSUE_REPORT_DAILY_RULE`
(vingt par 24 h et par utilisateur), qui couvre une soirée difficile.

## Configuration

Côté site, rien de nouveau : le canal interne existant (`BOT_INTERNAL_URL`,
`BOT_INTERNAL_TOKEN`) suffit. `APP_URL`, si elle est réglée, ajoute le lien du
tournoi au bas de chaque message.

Côté bot, `SERV_GENJI` et `SERV_RIVALS` désignent les serveurs BlueGenji — seule
population démarchée, `GUILD_ID` pouvant les remplacer — et `/set-referee-role`
désigne le rôle arbitre, serveur par serveur.

## Notes reprises de CLAUDE.md

Texte déplacé tel quel depuis `CLAUDE.md` (allègement du fichier chargé à chaque session).

- **Messages Discord automatisés** (`lib/shared/discord-notifications.ts` pur + `lib/server/tournaments/match-reminders.ts` / `issue-reports.ts`) : le site **rédige**, le bot **distribue** — le sens des appels reste app → bot. Deux usages. (1) **Rappels de match** : 24 h avant `bg_matches.start_at` (les paliers « une semaine » et « 1 h avant » sont retirés), en message privé aux joueurs des deux engagées. Chaque palier ne vaut que dans **sa fenêtre** (`[début − palier, début − palier suivant)`). Une date posée **tardivement** ne rattrape pas les paliers manqués : elle donne une **annonce** unique portant la date, puis les paliers restants — le partage tient à la marque `SEEN`, posée à la première observation. Poser ou changer la date (`setMatchStartAt`) efface ses paliers (un retrait garde toutes les marques), et poser, changer ou retirer l'annonce aussitôt aux joueurs (« Match programmé / reprogrammé / Horaire du match retiré », marque `TOLD` = horaire reçu), aux arbitres (push `MATCH_SCHEDULED`) et au journal Discord (`schedule-notices.ts`). Aucun ordonnanceur : le balayage est entraîné par le trafic depuis `listTournamentBuckets`, étranglé à 1 min, et la ligne `bg_match_reminders (match_id, offset_key)` est **réservée avant l'envoi** — c'est la clé unique qui interdit le doublon. Un joueur sans tag Discord est écarté du message privé — il reçoit le rappel en **push** s'il a abonné un appareil (`notifyUsers`, voir `docs/features/PUSH_NOTIFICATIONS.md`) ; un joueur absent des serveurs BlueGenji (`SERV_GENJI` / `SERV_RIVALS` côté bot, `GUILD_ID` en surcharge) ne reçoit **aucune tentative** d'envoi — et un bot qui ne joint **aucun** de ces serveurs répond `503`, jamais un « tous introuvables » en `200` que le site garderait pour définitif. (2) **Signalement d'un problème** : bouton dans l'en-tête du tournoi et sur chaque match, **réservé aux engagés** (`myTeamId`, revérifié serveur) ; part au canal de logs **et** au rôle arbitre configuré par `/set-referee-role`. Un bot injoignable est remonté en 503, jamais avalé. Voir `docs/features/DISCORD_NOTIFICATIONS.md`.
