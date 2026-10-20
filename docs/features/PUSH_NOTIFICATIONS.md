# Notifications push

Le site prévenait ses joueurs de deux façons : **dans la page** (modale de
lancement d'un match, alertes d'onglet), ce qui supposait la page ouverte, et
**en message privé Discord**, ce qui supposait un Discord rattaché. Un joueur
qui a fermé l'onglet pour lancer son jeu, sans Discord rattaché, n'apprenait
pas que son match commençait. Les notifications push du navigateur (Web Push)
comblent ce trou — sur ordinateur comme sur téléphone, site fermé.

## Un registre, un point d'entrée, un composant

La demande était double : les notifications de **départ de match**, et un
mécanisme **réutilisable** qui vaille pour toutes les notifications du site,
aujourd'hui et demain. D'où trois pièces, et une seule règle pour la suite.

| Pièce | Fichier | Rôle |
|---|---|---|
| Registre des sujets | `lib/shared/push-notifications.ts` (`PUSH_TOPICS`) | Chaque notification est un **sujet** : libellé, description, public (`null` = tout joueur, sinon une permission). L'ordre des clés est l'ordre de l'écran. |
| Point d'entrée serveur | `lib/server/notify.ts` | `notifyUsers` (des personnes nommées : message privé Discord à qui Discord joint, push à tous) et `notifyStaff` (un métier : l'envoi Discord de l'appelant, push aux comptes qui détiennent la permission du sujet). |
| Composant | `components/notifications/PushNotificationsPanel.tsx` (+ `usePushNotifications.ts`) | Construit **depuis le registre**. Forme `full` sur `/profil#notifications`, forme `compact` dans la modale de lancement d'un match. |

**La règle pour demain** : une notification nouvelle est une entrée de
`PUSH_TOPICS`, un rédacteur dans `lib/shared/push-messages.ts`, et un appel à
`notifyUsers` / `notifyStaff`. Son réglage paraît de lui-même sur `/profil`.
`notifyStaff` écarte les comptes **suspendus** (`subscribedStaffCandidates`,
même règle SQL que la session : `lib/server/suspension-sql.ts`) : un arbitre
suspendu n'a plus de droit effectif, il ne reçoit plus rien du staff.
Un balayage (`tests/lib/server/notification-channels.test.ts`) refuse tout
`pushDiscordDirectMessages` hors de `notify.ts`, et tout `pushRefereeAlert` /
`pushLeadershipAlert` hors d'un `notifyStaff` : une notification qui passerait à
côté n'arriverait jamais en push. Il exige aussi que chaque sujet du registre
ait un producteur côté serveur.

## Ce qui est notifié

| Sujet | Déclencheur | Discord aussi ? |
|---|---|---|
| `MATCH_START` | Match entré en lancement (« déclare-toi prêt »), ou lancé sans être passé par là (lancement forcé) | Non |
| `SCORE_TO_CONFIRM` | L'adversaire a saisi un score ; ou un score seul a été validé d'office après 2 h (`SCORE_DISPUTE_LOCK.md`, aux deux équipes) | Non |
| `TOURNAMENT_START` | Coup d'envoi d'un tournoi où l'on est engagé | Non |
| `MATCH_REMINDER` (« Horaires et rappels de match ») | Annonce de l'horaire posé, changé ou retiré par l'arbitrage (« Match programmé / reprogrammé », avec l'ancienne date ; « Horaire du match retiré »), « Match retiré de ton programme » quand une mise à jour du tournoi (correction de score, retour en arrière, ronde réappariée, plateau refait avant le départ, finales BG Survie réécrites) sort l'engagée de la manche, puis rappels H-24 et H-10 — ce dernier avec le lien du check-in, porté par l'annonce quand la manche est programmée moins de 10 h avant (les rappels J-7 et H-1 sont retirés) ; le push qui porte le check-in ouvre l'invitation au toucher (`/check-in`, redirection vers `CHECK_IN_INVITE_URL`). Un seul sujet pour les deux rappels : le check-in fait partie des rappels de match | Oui |
| `TEAM_JOIN_REQUEST` | Demande d'adhésion (gestion de l'équipe) | Oui |
| `CONTENT_REPORT` | Signalement qui vise le compte ou son équipe | Oui |
| `MODERATION` | Avatar ou logo masqué, supprimé, rétabli | Oui |
| `PRIVACY_CHANGE` | Changement du traitement des données | Oui |
| `REFEREE_ALERT` | Conflit de score, litige de score resté trop longtemps sans arbitrage, problème signalé (`tournaments`) | Oui (rôle arbitre) |
| `MATCH_SCHEDULED` (« Matchs planifiés ») | Un autre arbitre planifie un match, ou en change ou en retire l'horaire — l'auteur du geste n'est pas prévenu ; un retrait d'un horaire encore devant donne « Horaire du match retiré » ; une manche planifiée supprimée par le moteur (ronde réappariée, retour en arrière) donne aussi « Horaire du match retiré », à **tout** le staff (personne n'est exclu : c'est le moteur qui l'a retirée) ; étiquette distincte de l'annonce aux joueurs (un arbitre qui joue reçoit les deux) (`tournaments`) | Ligne au journal Discord (`publishStaffAction`) pour un geste d'arbitre, aucune pour une suppression par le moteur ; pas de message privé |
| `REFEREE_DIGEST` (« Programme d'arbitrage ») | Environ 10 h avant, la liste des matchs à venir non encore cités (horaire, affiche, tournoi et manche ; « Un match » en solo), lien vers le tournoi s'il n'y en a qu'un, un message par balayage (`referee-digest.ts`) (`tournaments`) | Ligne au journal Discord (`sendBotLog`), sans auteur ; pas de message privé |
| `STAFF_REPORT` | Signalement ou contestation reçu (`moderation`) | Oui (direction) |

Un compte **sans** moyen Discord est désormais un destinataire : il peut avoir
un appareil abonné. Le message privé, lui, garde ses règles (`proven` : un
identifiant ou un tag certifié ; `certified` — tag certifié seul — pour les
messages de match : un tag saisi n'a que ses push).

## Départ de match

`lobby_opened_at` est posé par l'entretien passif, un « Prêt » ou un lancement
forcé, dans des transactions qui n'ont pas à connaître les notifications. Un
**balayage** (`lib/server/tournaments/player-pushes.ts`) relit ensuite ce qui
s'est ouvert récemment (délai du lancement d'office + 5 min ; 10 min pour un
départ), **réserve** l'annonce dans `bg_match_start_notices` — clé unique
`(match_id, pairing, phase)`, deux balayages concurrents n'envoient qu'une
fois, et un appariement réécrit sur place réannonce —, puis envoie. Il est
déclenché par chaque publication d'évènement de tournoi
(`tournaments/notifications.ts`, import dynamique, étranglé à 10 s) et par la
lecture de la liste des tournois. Un appel étranglé — ou arrivé pendant un
balayage en vol, dont la lecture a pu précéder le lancement — n'est pas perdu :
une **relève** unique repasse une fois le délai écoulé.

En tournoi individuel, le nom d'un engagé est un pseudo : les notifications de
match y disent « Ton match » et « Ton adversaire », sans nommer personne.

Un match lancé parce que tout le monde a cliqué « Prêt » n'est pas annoncé une
seconde fois : l'annonce « lancé » ne part que si le lancement n'a pas été
annoncé. Les deux portent la même étiquette (`tag`) : la seconde remplace la
première sans resonner. Urgence `high` et durée de vie limitée au délai du
lancement d'office : une notification tardive ferait courir un joueur vers une
partie déjà jouée. Le caster inscrit est prévenu comme les joueurs.

Sans clés VAPID, rien n'est balayé **ni réservé** : une annonce réservée sans
canal serait perdue pour de bon. Même règle pour les changements de politique :
un compte sans Discord n'est candidat à l'annonce que push allumé, et la
lecture retombe sur Discord seul si la table des abonnements manque.

Les alertes d'arbitrage portent une étiquette par nature et par manche : deux
conflits d'un même tournoi ne se remplacent pas, et une alerte renvoyée après un
échec du bot remplace la précédente sans resonner. Un signalement de problème
qui n'a pas atteint le bot mais a atteint l'appareil d'un arbitre n'est pas annoncé
« injoignable » au joueur (qui le renverrait). Les sujets coupés s'écrivent en
série (`lib/shared/latest-value-writer.ts`) : deux cases cochées coup sur coup
ne peuvent plus laisser au serveur la liste la plus ancienne.

Bornes du contenu (`buildPushPayload`) : titre 80, corps 240 (`PUSH_BODY_MAX`),
étiquette 64 caractères, coupés par caractère (`clipPushText`). Le titre est
replié sur une ligne ; le **corps garde ses retours à la ligne** (programme
d'arbitrage), chaque ligne repliée, les lignes vides ôtées. Un rédacteur dont la
fin compte la protège lui-même : le programme d'arbitrage ne garde que les
lignes qui tiennent (« … et N autres » et le fuseau compris), le rappel du
check-in raccourcit son début plutôt que l'invitation ; une étiquette qui
nommerait une liste en porte une empreinte.

Une notification de même étiquette remplace la précédente **sans sonner** —
sauf `renotify` (`PushContent.renotify`, porté par la charge seulement quand il
est vrai, appliqué par `public/push-sw.js` à une notification étiquetée) : les
rappels de match (24 h, puis 10 h avec le check-in) remplacent l'annonce du
même match en sonnant, sans quoi le lien du check-in passerait inaperçu.

## Protocole

`lib/server/web-push.ts`, sur `node:crypto`, sans dépendance : VAPID (RFC 8292,
jeton ES256 signé, `aud` = origine du service) et chiffrement `aes128gcm`
(RFC 8291 : ECDH P-256, HKDF, AES-128-GCM, un enregistrement). Un test fait
l'aller-retour complet en déchiffrant avec la clé du « navigateur ».

- **404 / 410** : l'abonnement est mort, il est **supprimé**.
- Les redirections ne sont pas suivies (`redirect: "manual"`).
- Les adresses d'abonnement viennent du client : seuls les services des
  navigateurs du marché sont acceptés (`PUSH_SERVICE_HOSTS` : FCM, Mozilla,
  WNS, Apple), en `https` sans port — sans quoi l'abonnement ferait du serveur
  un relais de requêtes vers n'importe quel hôte.

Configuration : `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` (générées par
`npm run push:keys`), `VAPID_SUBJECT` (`mailto:` ou `https:`, défaut `APP_URL`
si elle est en `https`). Une paire dépareillée éteint le canal (une ligne au
journal) au lieu de faire échouer chaque envoi. **Ne jamais changer la paire**
une fois en production : la clé publique est gravée dans chaque abonnement.

## Navigateur

- Service worker `public/push-sw.js`, portée `/` : il affiche et ouvre, **rien
  d'autre** — aucun cache, aucune interception. Le lien d'une notification est
  relu comme une entrée (chemin du site seulement, jamais une route d'API :
  ouverte d'ici, elle partirait du site comme un clic — `pushTargetPath` côté
  serveur, `sitePath` côté service worker). `pushsubscriptionchange`
  renvoie l'abonnement renouvelé au site.
- iPhone / iPad : Safari ne livre le push qu'à un site **ajouté à l'écran
  d'accueil et ouvert en app web** (mode autonome). Le manifeste reste en
  `minimal-ui` (`lib/shared/web-manifest.ts`, « jamais `standalone` », pour que
  l'OAuth garde ses cookies) : ce n'est donc pas lui qui ouvre ce mode, mais
  l'option « Ouvrir en tant qu'app web » d'iOS 26, cochée par défaut à l'ajout.
  Hors de ce mode, le panneau le dit à la place du bouton (`pushSupport` →
  `IOS_NEEDS_INSTALL`) et nomme l'option. Arbitrage assumé : sous iOS 18 et
  avant, une icône en `minimal-ui` s'ouvre dans Safari, et le push n'y est pas
  disponible.
- Permission bloquée : le panneau dit où la rouvrir, sans bouton qui mènerait
  à un refus.
- Au montage du panneau, un abonnement déjà présent dans le navigateur est
  renvoyé (upsert) : c'est ce qui rattache un navigateur partagé au compte qui
  s'y connecte — **sur preuve** : un appareil rangé sous un autre compte ne
  change de titulaire que si les clés `p256dh`/`auth` envoyées sont, octet par
  octet (`BINARY`, la collation de la table ignorant la casse), celles déjà
  rangées (un navigateur rend le même abonnement à quiconque s'y connecte).
  L'adresse seule n'est pas un secret suffisant, comme pour le désabonnement ;
  sans preuve, rien n'est touché et la route répond 409
  `PUSH_SUBSCRIPTION_CLAIMED`.
- CSP : `worker-src 'self' blob:` couvre déjà le service worker.

## Routes

| Route | Rôle |
|---|---|
| `GET /api/push` | Clé publique (`null` = push éteint), sujets visibles, sujets coupés, nombre d'appareils |
| `POST /api/push/subscriptions` | Range l'abonnement de l'appareil (`{ subscription }`), 503 sans clés, 409 si l'appareil est à un autre compte sans preuve des clés |
| `DELETE /api/push/subscriptions` | Retire l'abonnement (`{ endpoint }`), borné au compte connecté |
| `PUT /api/push/topics` | Remplace la liste des sujets coupés (`{ disabledTopics }`) |

Toutes exigent une session et partagent `PUSH_WRITE_RULE` (30 écritures / 10 min
par compte).

## Données

- `bg_push_subscriptions` : adresse (unicité sur son SHA-256, elle dépasse
  souvent 255 caractères), clés, dates d'abonnement et de dernière remise.
- `bg_push_topic_optouts` : sujets coupés, par compte (tous appareils).
- `bg_match_start_notices` : réservations des annonces de départ.

Les trois sont des tables **tolérées** (`catch` muet à la création,
`isMissingTableError` à la lecture) : un canal accessoire. Effacées avec le
compte (cascade) et par l'anonymisation ; exportées dans l'export RGPD, clés
comprises. Un abonnement sans remise depuis `PUSH_SUBSCRIPTION_RETENTION_DAYS`
(180 j) est oublié par une purge horaire. Déclaré au registre (**T12**) et dans
`PRIVACY_CHANGES` (`2026-09-notifications-push`), section « Notifications push »
de `/rgpd`. **Aucune notification ne porte le pseudo d'un joueur**, même règle
que les journaux Discord.

**Langue** (lot 9-3) : chaque notification est rédigée dans la langue du compte
destinataire (`bg_users.locale`, `fr` ou `en`). Le contenu passé à
`notifyUsers` / `notifyStaff` est une fonction de la langue
(`LocalizedPushContent`) ; `pushToUsers` en tire une charge par langue. Tout
rédacteur nouveau prend la langue en dernier argument, ses textes dans
`messages/{fr,en}/pushMessages.json`. Règle de pose : `I18N.md` § Langue du compte.

## Notes reprises de CLAUDE.md

Texte déplacé tel quel depuis `CLAUDE.md` (allègement du fichier chargé à chaque session).

- **Notifications — un registre, un point d'entrée, un composant** (`lib/shared/push-notifications.ts` + `lib/shared/push-messages.ts`, purs, + `lib/server/notify.ts` + `lib/server/push-subscriptions.ts` + `lib/server/web-push.ts` + `components/notifications/PushNotificationsPanel.tsx`) : le site ne prévenait que dans la page (modale de lancement, alertes d'onglet — page ouverte requise) ou en message privé Discord (Discord rattaché requis). Les notifications **push** du navigateur passent là où aucun des deux ne passait, site fermé. **Règle pour toute notification future** : c'est un **sujet** de `PUSH_TOPICS` (libellé, description, public : tout joueur ou une permission), un rédacteur dans `push-messages.ts` (titre = l'évènement, corps = quoi faire, **aucun pseudo de joueur**, lien = chemin du site), et un appel à `notifyUsers` (personnes nommées : DM Discord à qui Discord joint, push à tous — un compte sans Discord est désormais un destinataire) ou `notifyStaff` (un métier : l'envoi Discord de l'appelant, push aux comptes qui détiennent la permission du sujet). Le réglage paraît seul sur `/profil#notifications`, le panneau se construisant depuis le registre ; sa forme `compact` vit dans la modale de lancement. Un balayage refuse tout `pushDiscordDirectMessages` hors de `notify.ts` et tout `pushRefereeAlert` / `pushLeadershipAlert` hors d'un `notifyStaff`, et exige un producteur pour chaque sujet. **Départ de match** (la demande d'origine) : un balayage (`tournaments/player-pushes.ts`, déclenché par chaque publication d'évènement de tournoi et par la liste des tournois, étranglé à 10 s) relit les lancements ouverts récemment, **réserve** l'annonce (`bg_match_start_notices`, `(match_id, pairing, phase)`) puis pousse « déclare-toi prêt » — ou « lancé » si le lancement n'a jamais été annoncé (forcé), même étiquette pour que la seconde remplace la première sans resonner ; urgence haute, durée de vie bornée au lancement d'office. Protocole écrit sur `node:crypto`, sans dépendance (VAPID RFC 8292 + `aes128gcm` RFC 8291, aller-retour testé) ; 404/410 supprime l'abonnement ; les adresses d'abonnement viennent du client, donc **liste blanche** des services de push (`PUSH_SERVICE_HOSTS`) — sans elle, s'abonner ferait du serveur un relais vers n'importe quel hôte. Sans clés VAPID, rien n'est balayé **ni réservé**. iOS n'accepte le push qu'au site ouvert **en app web** depuis l'écran d'accueil — le manifeste reste en `minimal-ui` pour l'OAuth (`lib/shared/web-manifest.ts`), c'est l'option « Ouvrir en tant qu'app web » d'iOS 26 qui ouvre ce mode, et le panneau le dit à la place du bouton. Tables tolérées, effacées avec le compte et par l'anonymisation, exportées ; abonnement oublié après `PUSH_SUBSCRIPTION_RETENTION_DAYS` sans remise. Registre T12, `PRIVACY_CHANGES`. Voir `docs/features/PUSH_NOTIFICATIONS.md`.
