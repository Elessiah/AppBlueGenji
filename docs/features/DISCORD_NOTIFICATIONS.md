# Messages Discord automatisés

Le site écrit aux joueurs sur Discord, par le canal interne du bot. Deux usages,
une seule mécanique : **le site rédige, le bot distribue**.

- **Rappels de match** — une semaine, 24 h puis 1 h avant le coup d'envoi d'une
  manche programmée, en message privé à chaque joueur des deux engagées.
- **Signalement d'un problème** — un inscrit alerte le staff depuis la page du
  tournoi ou depuis un match ; le bot le relaie au canal de logs et au rôle
  arbitre.

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

### Les paliers, et pourquoi ce sont des fenêtres

`MATCH_REMINDER_OFFSETS` déclare trois paliers, du plus lointain au plus proche :
`P7D`, `P1D`, `PT1H`. Chacun ne vaut que dans **sa propre fenêtre** —
`[début − palier, début − palier suivant)`, le dernier s'arrêtant au coup
d'envoi.

Sans ce découpage, une manche programmée pour dans trente minutes déclencherait
d'un coup les trois rappels — « dans une semaine », « dans 24 heures » et « dans
1 heure » — pour le même match, dans la même seconde.

Rien ne part une fois le match commencé : un rappel en retard n'est plus un
rappel, et un match reprogrammé vers le passé (correction d'archive) ne doit
réveiller personne.

### Une date posée tardivement : l'annonce

Le staff programme souvent une manche à trois jours, parfois à cinq heures. Les
paliers déjà dépassés ne sont alors **pas rattrapés** : ils sont consommés sans
message et remplacés par une **annonce unique** portant la date
(`buildMatchScheduleAnnouncement`). Les paliers encore devant, eux, suivent leur
cours.

| Date posée | Ce que reçoit le joueur |
| --- | --- |
| à J-10 | rien tout de suite, puis P7D, P1D, PT1H |
| à J-3 | annonce (« Match programmé, le … »), puis P1D, PT1H |
| à H-5 | annonce, puis PT1H |
| à H-0,5 | annonce, et rien après |

Le partage entre les deux régimes tient à la **marque d'observation** `SEEN`,
posée au premier passage du balayage sur cette manche : elle sépare « le site
découvre cette date » de « le temps a passé depuis ». Sans elle, un match
programmé à trois jours recevrait le rappel « dans une semaine » — la fenêtre du
palier est bel et bien ouverte, mais ce qu'il annonce est faux.

C'est aussi ce qui impose la marge de `MATCH_REMINDER_LOOKAHEAD_MS` : le balayage
lit **une journée plus loin** que le plus grand palier. Une fenêtre de lecture
égale à l'horizon ferait découvrir chaque manche à la seconde exacte où le palier
« une semaine » s'ouvre — donc toujours par le régime d'annonce, et ce palier ne
partirait jamais.

### Reprogrammer une manche

`setMatchStartAt` efface les lignes `bg_match_reminders` de la manche **quand la
date change réellement**. Le cycle repart donc de zéro, et le déplacement produit
une nouvelle annonce portant la nouvelle date — ce qu'un déplacement doit faire.
Une date réécrite à l'identique ne touche à rien.

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
- **Pas sur le serveur BlueGenji** : le bot cherche le destinataire dans la
  guilde `GUILD_ID` et **ne tente aucun envoi** s'il ne l'y trouve pas. Un tag
  mal saisi ne doit pas faire écrire le bot à un inconnu croisé sur un serveur
  partenaire.

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
- **Sur chaque match** dont les deux adversaires sont connus.

**Réservé aux engagés.** Ce n'est pas un formulaire de contact : le bouton n'est
rendu que si `myTeamId` n'est pas `null`, et le serveur **revérifie**
l'inscription — sans quoi n'importe quel visiteur pourrait faire sonner le
téléphone des arbitres. La résolution de l'engagé est la même que partout
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
tous les arbitres.

## Configuration

Côté site, rien de nouveau : le canal interne existant (`BOT_INTERNAL_URL`,
`BOT_INTERNAL_TOKEN`) suffit. `APP_URL`, si elle est réglée, ajoute le lien du
tournoi au bas de chaque message.

Côté bot, `GUILD_ID` désigne le serveur BlueGenji — seule population démarchée —
et `/set-referee-role` désigne le rôle arbitre, serveur par serveur.
