# Journal d'activité Discord

Le canal de logs du bot recevait deux lignes du site : un conflit de score, une
suppression de tournoi. Un tournoi pouvait donc s'ouvrir, se remplir, se lancer,
se jouer et se conclure sans qu'une seule ligne ne passe — le staff suivait la
soirée en rechargeant `/tournois` sur un second écran.

Le site pousse désormais **une ligne par fait accompli** dans ce même canal,
par le canal interne existant (`POST /internal/log`, qui préfixe chaque ligne de
`[AppBlueGenji]`). Le sens des appels reste **app → bot** : le bot n'appelle
jamais le site en retour.

## Ce qui est journalisé

| Évènement | Ligne | Déclencheur |
| --- | --- | --- |
| Création d'un tournoi | `📅 Nouveau tournoi « … » (#12) — Ronde suisse · Overwatch 2, 16 équipes max, créé par …, début le …` | `createTournament` |
| Inscription | `✅ Inscription — « … » (#12) : Alpha. 3/16 équipes.` | `registerTeam` (joueur ou staff) |
| Abandon | `🚪 Abandon — « … » (#12) : Alpha quitte la compétition.` | `forfeitTournamentTeamPublic` |
| Coup d'envoi | `🚀 Coup d'envoi — « … » (#12) : 8 équipes, Survie.` | bascule vers `RUNNING` |
| Fin d'un match | `🏁 « … » (#12) · Manche 2 : Alpha 2–1 Bêta.` | `finalizeMatch` |
| Conflit de score | `⚠️ Conflit de score — … Arbitrage requis.` | reports contradictoires |
| Clôture | `🏆 Tournoi terminé — « … » (#12) : Alpha l'emporte.` | `finishTournament` |
| Clôture sans adversaires | `🚫 Tournoi clos faute d'adversaires — « … » (#12) : aucun engagement.` | `finalizeUnderfilledTournament` |
| Suppression définitive | `🗑️ Tournoi supprimé définitivement : « … » (#12) par … (#3).` | `DELETE /api/admin/tournaments/[id]` |

L'identifiant suit toujours le nom : deux éditions d'un même tournoi portent
volontiers le même titre, et une ligne doit pouvoir être rapprochée de sa page
(`/tournois/<id>`) sans deviner de laquelle il s'agit.

## Ce qui n'est délibérément pas journalisé

Un journal illisible ne se lit pas, et un canal qui défile trop vite ne sert plus
à rien le soir où quelque chose cloche. Deux règles bornent le volume :

1. **Une ligne par évènement**, jamais un bloc. Dix évènements doivent tenir à
   l'écran.
2. **Un évènement = un fait accompli.** La *fin* d'un match, pas les deux reports
   de score qui y mènent ; l'inscription, pas la visite de la page.

Restent donc dehors, en connaissance de cause :

- **Les reports de score intermédiaires.** Seul un match tranché produit une
  ligne — par accord des deux engagés, par délai de report expiré ou par
  arbitrage. Un match corrigé plus tard en produit une seconde, avec son nouveau
  score : c'est justement ce qu'on veut voir passer.
- **Les byes et les matchs fantômes.** Leur score (1-0, 0-0) est posé par le
  moteur, pas saisi ; un effectif impair en produit à chaque manche.
- **Les ouvertures d'inscriptions.** Elles se déduisent des dates annoncées, et
  n'appellent aucune surveillance.
- **La programmation d'un match, la diffusion, l'ordre de seeding, l'édition d'un
  tournoi.** Réglages du staff, déjà visibles sur la page — et pour les rappels
  de match, le joueur concerné reçoit un message privé
  (`docs/features/DISCORD_NOTIFICATIONS.md`).
- **Les lectures.** Aucun trafic n'écrit dans le journal : le nombre de lignes
  d'un tournoi reste de l'ordre de son nombre de matchs, qu'il ait trois
  spectateurs ou trois cents.

## Modules

| Rôle | Fichier |
| --- | --- |
| Rédaction (pur) | `lib/shared/bot-logs.ts` |
| Libellés format / jeu (pur, partagés avec l'en-tête) | `lib/shared/tournament-labels.ts` |
| File par transaction et résolution | `lib/server/tournaments/bot-logs.ts` |
| Transport vers le bot | `lib/server/bot-integration.ts` (`sendBotLog`) |

## Pourquoi une file par transaction

Les évènements naissent au cœur d'une transaction : l'inscription s'insère, le
match se clôt, le tournoi passe « en cours ». Or une transaction peut encore
échouer après coup — et rien ne serait plus déroutant qu'un canal annonçant le
lancement d'un tournoi qui n'a pas démarré.

Le moteur **réserve** donc une ligne (`queueBotLog`) dans une file indexée par
connexion ; seul le commit la convertit en message (`flushBotLogs`), l'échec la
jetant avec le reste (`discardBotLogs`, appelé dans le `finally` de chaque
transaction concernée).

```ts
try {
  await connection.beginTransaction();
  // … le moteur appelle queueBotLog(connection, …) quelque part ici
  await connection.commit();
  flushBotLogs(connection);   // convertit et envoie
} catch (error) {
  await connection.rollback();
  throw error;
} finally {
  discardBotLogs(connection); // no-op après un flush
  connection.release();
}
```

Une entrée en attente n'est **pas un texte**, seulement un renvoi : « le match 42
s'est terminé ». Deux conséquences, l'une pratique et l'autre nécessaire :

- le moteur ne traîne aucun `JOIN` d'affichage sur ses chemins chauds — les noms,
  l'effectif et la championne sont relus après le commit, sur le pool ;
- la ligne parle de l'état **réellement enregistré**. Le classement final, par
  exemple, n'est écrit qu'*après* `finishTournament` : une ligne rédigée sur
  place ne saurait pas encore qui a gagné.

L'envoi ne bloque rien (`flushBotLogs` ne s'attend pas) et ne lève jamais : un
bot endormi ne doit pas allonger la réponse rendue à l'équipe qui vient de saisir
son score, ni la faire échouer. Une entrée qui ne se résout pas — match effacé
entre-temps, engagé sans nom — est ignorée : un journal manquant vaut mieux qu'un
journal faux.

La file est plafonnée à 32 entrées par transaction. Le cas nominal en produit une
ou deux (le dernier match d'un tournoi : sa fin **et** la clôture) ; le plafond
vise `npm run seed`, qui rejoue des milliers de matchs sur une même connexion
sans jamais vider la file.

## Points de passage uniques

Chaque évènement est réservé à l'endroit **par lequel tout le monde passe**, et
nulle part ailleurs :

- `finalizeMatch` (`./scoring`) est le seul point de clôture d'un match saisi —
  accord, délai expiré, arbitrage. Les byes ont leur propre écriture dans
  `./byes`, et les moteurs à classement posent leurs matchs de forfait
  eux-mêmes : ni les uns ni les autres n'encombrent le journal.
- `finishTournament` (`./repository`) est le seul point de clôture d'un tournoi,
  quel que soit le format qui la décide (élimination, survie, ronde suisse,
  endurance, phases).
- `syncTournamentState` (`./state`) est le seul point de bascule d'état. La
  condition porte sur l'état **d'arrivée** (`RUNNING`) et non sur le départ : un
  tournoi repasse par `UPCOMING` entre la clôture des inscriptions et son heure
  de début, et c'est donc de là qu'il part « en cours » le plus souvent.

Corollaire tiré au passage : `finishTournament` ne clôt plus qu'une fois
(`WHERE … AND state <> 'FINISHED'`). Un arbitre corrigeant le score d'une archive
rejoue toute la finalisation ; sans cette clause, le tournoi y gagnait une
nouvelle date de clôture — celle de la correction — et une seconde annonce de sa
championne.
