# Alertes au rôle arbitre

Le canal de logs Discord reçoit **une ligne par fait accompli** d'un tournoi :
création, inscription, abandon, coup d'envoi, fin de manche avec son score,
clôture (`docs/features/BOT_ACTIVITY_LOG.md`). C'est ce qu'on attend d'un
journal, et son volume est de l'ordre du nombre de matchs — un tournoi à 64
équipes en produit une centaine.

C'est aussi ce qui le rend inutilisable pour arbitrer. L'arbitre suit dix
plateaux depuis son téléphone ; la seule ligne qui l'attend est noyée entre
quarante fins de manche dont personne n'a rien à faire. Il y a donc désormais
**deux canaux**, alimentés par le même moteur : le journal complet, et un canal
arbitre qui ne porte que ce qui appelle une intervention.

## Le tri

Un seul critère, appliqué à chaque évènement :

> **Un arbitre doit-il faire quelque chose en lisant cette ligne ?**

Si la réponse est non, la ligne reste au journal. Ce n'est pas une question
d'importance — la clôture d'un tournoi est un évènement majeur, et elle n'appelle
aucun geste. C'est une question de **tâche** : une ligne qui n'attend rien de
personne n'a pas à faire vibrer un téléphone.

### Ce qui part au canal arbitre

| Évènement | Ce que l'arbitre a à faire |
| --- | --- |
| **Conflit de score** | Trancher. Les deux engagées annoncent des scores contradictoires ; le moteur ne peut pas départager deux affirmations opposées, et la rencontre est bloquée jusqu'à un arbitrage. |
| **Report expiré, toujours pas tranché** | Trancher, en retard. Le délai de report est passé et le conflit dure : c'est le seul cas où l'expiration ne débloque rien. |
| **Signalement d'un problème** | Répondre. Un engagé appelle à l'aide depuis la page du tournoi ou d'un match (`docs/features/DISCORD_NOTIFICATIONS.md`). |

Les trois ont la même forme : **une rencontre ou un tournoi est immobilisé, et
rien ne le débloquera sans un humain.** C'est ce qui les sépare du reste, et
non leur gravité.

### Ce qui reste au journal, et pourquoi

- **Création, inscription, coup d'envoi, clôture.** Des faits d'organisation. Les
  lire est utile, les recevoir en message privé ne l'est pas.
- **Fin de manche ordinaire.** C'est précisément le cas où *personne* n'a eu à
  intervenir : les deux engagées se sont accordées, ou le délai a tranché. C'est
  aussi l'évènement de loin le plus nombreux — l'y router ferait du canal
  arbitre une copie du journal, et le bot démarcherait tous les membres du rôle
  à chaque manche. La borne de 25 messages privés par serveur, côté bot, dit
  assez que ce canal n'est pas dimensionné pour ça.
- **Abandon.** Le moteur le traite seul : rejeu du classement, réappariement de
  la manche suivante. L'arbitre n'a rien à valider.
- **Clôture faute d'adversaires.** Un incident d'organisation, constaté après
  coup. Il n'y a plus rien à sauver le soir même ; la ligne du journal suffit à
  en parler le lendemain.
- **Suppression d'un tournoi.** Un geste d'administrateur, déjà accompli.

## Une règle unique et pure

Le tri vit dans `lib/shared/referee-alerts.ts`, sous la forme d'un `Record`
**exhaustif** sur `BotEventKind` (le vocabulaire des évènements, déclaré dans
`lib/shared/bot-logs.ts`) :

```ts
export const BOT_EVENT_CHANNELS: Record<BotEventKind, BotEventChannel> = {
  tournament_created: "JOURNAL",
  …
  score_conflict: "REFEREE",
  score_report_stalled: "REFEREE",
};
```

Deux conséquences, et c'est tout l'intérêt de la forme :

- **Un évènement ajouté demain ne compile pas tant qu'il n'est pas classé.** Le
  choix du canal ne peut donc pas rester implicite, ni se décider deux fois
  différemment.
- **Aucun appelant ne connaît le tri.** Le moteur réserve un évènement comme
  avant (`queueBotLog`) ; c'est la file qui choisit son transport au moment de
  l'envoi. Router un nouvel évènement vers les arbitres ne demande de toucher
  ni au moteur, ni aux routes.

Une garde de compilation dans `lib/server/tournaments/bot-logs.ts` lie les deux
côtés : les natures d'entrée de la file sont **exactement** celles que le tri
connaît, dans les deux sens.

## Le canal côté bot : celui qui existait déjà

Aucune route nouvelle n'a été demandée au bot. Le canal arbitre est
`POST /internal/notify/referees`, celui que le signalement d'un problème utilise
depuis toujours (`lib/server/tournaments/issue-reports.ts`). Il fait deux choses
en un appel :

1. il poste le message dans le canal de logs ;
2. il l'envoie en privé à chaque membre du rôle arbitre configuré serveur par
   serveur (`/set-referee-role`), plafonné à 25 par serveur.

Le sens des appels reste **app → bot** : le site rédige, le bot distribue, et le
bot n'appelle jamais le site en retour.

### Pas de doublon, par construction

Le point d'entrée arbitre écrivant **déjà** dans le canal de logs, un évènement
qui partirait à la fois par `sendBotLog` et par `pushRefereeAlert` s'afficherait
deux fois dans le même salon. D'où la règle : **chaque évènement part par
exactement un transport.** Un conflit de score n'a donc plus de ligne de journal
distincte — le canal de logs en garde une trace, posée par le bot, dans la
rédaction courte de l'alerte.

### Le rôle est nommé, pas mentionné

Les alertes disent « Arbitrage requis » ; elles ne portent pas de mention
Discord (`<@&identifiant>`). Le site ne connaît pas l'identifiant du rôle — il se
configure côté bot, serveur par serveur, et diffère de l'un à l'autre. C'est le
bot qui résout le rôle et écrit à ses membres.

## Le format

Une alerte tient sur **une ligne**, comme les lignes du journal, et se limite à
ce qui permet d'agir :

```
⚠️ Arbitrage requis — « Coupe BlueGenji » (#12) · Manche 2 : Les Renards vs Team Nova (match #31) — reports de score contradictoires. https://…/tournois/12
⏱️ Arbitrage requis — « Coupe BlueGenji » (#12) · Manche 2 : Les Renards vs Team Nova (match #31) — toujours pas tranché 30 minutes après le report. https://…/tournois/12
```

Nature de l'intervention en tête, tournoi et identifiant, manche, les deux
engagées, l'identifiant du match, le lien. Pas de score, pas d'effectif, pas
d'historique : tout cela se lit sur la page, que l'arbitre va ouvrir de toute
façon. Le lien disparaît si `APP_URL` n'est pas réglée — le site ne sait alors
pas sous quel nom il est servi, et un lien inventé vaut moins que pas de lien.

Les deux alertes partagent une seule rédaction (`alertLine`) : elles désignent la
même rencontre au même arbitre, et deux formulations parallèles rendraient
l'escalade plus difficile à rapprocher du conflit qui l'a précédée.

## L'escalade : un délai expiré qui ne débloque rien

Le délai de report (`SCORE_REPORT_TIMEOUT_MINUTES`) tranche une manche à **un
seul** report : le silence de l'adversaire vaut accord. Sur une manche où les
**deux** engagées ont reporté des scores contradictoires, il ne peut rien —
départager deux affirmations opposées n'est pas une règle, c'est une décision.
Ces manches restent `AWAITING_CONFIRMATION` indéfiniment.

`resolveExpiredScoreReports` les repère : ce sont exactement celles que ses deux
branches d'auto-résolution laissent passer. Elle y pose une seconde alerte,
distincte du conflit lui-même — la première part au moment du désaccord, celle-ci
constate qu'une demi-heure plus tard personne n'a tranché. Un canal chargé un
soir de tournoi avale la première ; la seconde arrive quand le match est
vraiment en souffrance.

### Pourquoi une table

Cette alerte ne naît pas d'une écriture mais d'un **constat**, refait à chaque
passage d'entretien — donc à chaque lecture de la page du tournoi. Sans marque,
l'arbitre recevrait le même message toutes les quelques secondes.

`bg_referee_alerts (match_id, alert_key)` porte une clé unique, et seule
l'insertion qui gagne réserve l'envoi (`claimRefereeAlert`) — même motif que
`bg_match_reminders`, à une différence près : la réservation est écrite sur **la
connexion de la transaction**, pas sur le pool. Réservation et évènement sont
donc validés ou annulés ensemble, et un rollback ne consomme pas l'alerte. La
table suit la manche (`ON DELETE CASCADE`) : un plateau régénéré — réappariement
d'une ronde suisse, correction de score en survie — efface ses matchs, donc ses
réservations.

## Dégradation

Rien de tout cela ne peut faire échouer une transaction du moteur.

- Les alertes suivent le cycle habituel du journal :
  `queueBotLog` / `flushBotLogs` / `discardBotLogs` en `finally`. Une transaction
  annulée n'envoie rien.
- `flushBotLogs` ne s'attend pas et ne lève jamais. Une entrée qui ne se résout
  pas (match effacé entre-temps, engagé manquant) est ignorée.
- `pushRefereeAlert` rend `null` quand le bot est injoignable : c'est un
  résultat, pas une exception.
- **Rôle arbitre non configuré** : le bot répond quand même 200 et se contente du
  log. Le site n'a rien de particulier à prévoir — et c'est bien la trace de
  l'incident qui compte, plus que le message privé.
- Le **coupe-circuit** de `bot-integration` est **respecté** sur ce chemin,
  contrairement au signalement d'un problème. La distinction est celle de
  l'attente : un signalement est une action utilisateur, à qui l'on doit une
  tentative et une réponse honnête ; une alerte du moteur part en arrière-plan,
  et laisser chaque envoi de fond patienter sur la fenêtre de 30 s qu'impose la
  lecture des membres du rôle ne servirait personne.

## Modules

| Rôle | Fichier |
| --- | --- |
| Tri (pur) et rédaction des alertes | `lib/shared/referee-alerts.ts` |
| Vocabulaire des évènements (pur) | `lib/shared/bot-logs.ts` (`BotEventKind`) |
| File par transaction, routage, réservation | `lib/server/tournaments/bot-logs.ts` |
| Détection du report expiré non tranché | `lib/server/tournaments/finalization.ts` |
| Transport vers le bot | `lib/server/bot-integration.ts` (`pushRefereeAlert`) |
| Lien vers la page d'un tournoi | `lib/server/tournaments/app-url.ts` |
| Table de réservation | `bg_referee_alerts` (`lib/server/database.ts`) |

Côté bot (`blueGenjiBot`), rien à ajouter : `POST /internal/notify/referees` et
`/set-referee-role` existent déjà, documentés dans `doc/internal-api.md`.
