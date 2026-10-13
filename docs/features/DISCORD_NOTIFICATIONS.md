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
| retirée | « Horaire du match retiré », s'il l'avait reçue, qu'elle était encore devant et que le tournoi est planifié par l'arbitrage |
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
ultérieur lui sera dit « programmé » plutôt que « reprogrammé », ou tu ; et
l'engagée **retirée** de l'affiche n'est pas prévenue que l'horaire reçu ne la
concerne plus (le plateau le montre).

### La marque `TOLD` : un horaire reçu

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
palier hérité `P7D` / `PT1H` est recopié en `TOLD` (l'ancien code ne les
posait qu'avec un message, le nouveau ne les écrit jamais ; `P1D` n'est pas
lu — le nouveau code le réserve avant l'envoi, et l'ancien ne le posait jamais
sans `P7D`) ; et une marque `SEEN` posée seule, en silence, par
l'ancien balayage (sept à huit jours avant, dans l'attente du palier « une
semaine ») est effacée pour une manche à venir, jusqu'au 2026-10-31 — le
nouveau balayage l'annoncera. À retirer de la liste une fois jouées partout.

### Programmer, reprogrammer ou retirer l'horaire d'une manche

`setMatchStartAt`, **quand la date change réellement**, remet les marques à
jour **dans la transaction** qui écrit la date (`resetReminderMarks`) : un
balayage ne voit jamais la nouvelle date avec les marques de l'ancienne. Une
erreur (autre qu'une table absente) défait l'écriture de la date — un refus que
l'arbitre peut rejouer plutôt qu'un horaire changé dont personne n'est prévenu.
Il lit d'abord `TOLD` (`alreadyAnnounced`) puis, si une date est
posée :

- les deux engagées connues, efface les lignes de la manche **sauf** `SEEN` et
  `TOLD`, et pose `SEEN` dans le même geste. Un balayage qui passerait entre ce
  ménage et l'annonce ne peut donc plus la prendre pour lui (et annoncer sans
  l'ancienne date) : il ne peut prendre qu'un palier ouvert, dont le rappel
  porte la nouvelle date — l'annonce se tait alors ;
- une engagée manquante, efface tout sauf `TOLD` : le balayage annoncera la
  manche quand elle sera connue.

Une date **effacée** garde toutes ses marques (inertes : le balayage ne lit que
les manches datées). Puis `notifyMatchScheduleChange`
(`lib/server/tournaments/schedule-notices.ts`) prévient **sans attendre le
balayage** :

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

  pour une date posée ou changée ; pour un retrait d'un horaire encore devant, « Horaire du match retiré » (corps arbitre sans « te sera annoncé », même étiquette `-schedule`, qui remplace leur avis « programmé »). « Reprogrammé » dès
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

Le prix est symétrique et assumé : un bot injoignable au moment précis de l'envoi
consomme le palier. C'est le bon sens du risque — un rappel manqué se rattrape au
palier suivant, un rappel envoyé en boucle ne se rattrape pas.

La table suit la manche (`ON DELETE CASCADE`) : un plateau régénéré —
réappariement d'une ronde suisse, correction de score en survie — efface ses
matchs, donc ses rappels.

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
