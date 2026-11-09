# Annonce d'un nouveau match (NEW-MATCH-NOTIF)

Demande de l'utilisateur du 2026-11-09 : une manche se termine, la suivante
arrive avec de nouveaux matchs → prévenir les équipes concernées pour qu'elles
s'organisent.

## Ce qui part

Dès que les **deux engagées** d'un match sont connues (match `PENDING` ou
`READY`, ni exempt, sans score, pas lancé — un horaire déjà dépassé par une manche en retard
s'annonce quand même —,
tournoi `RUNNING` et publié), **tous les membres actifs** de chaque équipe
(`loadEntrantPlayerIds` ; le joueur d'une entrée solo ; personne pour une
fantôme ; comptes supprimés écartés) reçoivent, vu de leur engagée :

- un **push** du sujet `NEW_MATCH` (« Nouveau match », `newMatchPush`,
  `lib/shared/push-messages.ts`, clés `pushMessages.newMatch`) : « A contre B à
  « Coupe », Manche 2 », l'horaire (heure de Paris) ou « Horaire pas encore
  fixé » ; lien : la page du match (`matchPageHref`, sous `/en` pour un compte
  anglais), étiquette `rencontre-<id>-new` ;
- un **message privé Discord** (`formatNewMatchDm`,
  `lib/server/tournaments/new-match-dm.ts`) : titre, manche et tournoi,
  « Ton équipe « A » affronte « B » », horaire ou son absence, lien absolu de
  la page du match (tu sans `APP_URL`), rappel de s'organiser, puis la ligne
d'opposition `matchDmOptOutLine` (où couper ces messages) comme tout message
privé de match. Message privé
  **de match** : tag Discord certifié seulement, coupé par la case « Messages
  privés Discord de mes matchs » (`loadNotificationRecipients(…, "certified",
  { matchDm: true })`).

Noms d'équipe seulement (`discordInline`, guillemets neutralisés) ; en tournoi
individuel, « Ton match » / « L'adversaire de ton prochain match est connu » :
aucun pseudo, BattleTag ni tag Discord. FR/EN selon la langue du compte
(bilingue si illisible).

## Quand

`dispatchNewMatchNotices` (`lib/server/tournaments/new-match-notices.ts`),
balayage étranglé à 10 s avec relève (`throttledSweep`), lancé à chaque
publication d'évènement de tournoi (`notifications.ts` : un score validé fait
avancer le tableau) et à la lecture de la liste des tournois (entretien
passif). **Après le commit, hors du verrou du tournoi** : aucun moteur n'appelle
la notification, ce qui couvre d'un coup tous les endroits où un match reçoit
ses deux engagées — tableau simple et double (perdants, grande finale), ronde
suisse, survie, multi-phases, BG Survie (qualifications et phase finale),
retour arrière et tableau reconstruit.

## Une seule fois

Réservation `bg_new_match_notices`, clé = **place** du match (tournoi, phase,
tableau, manche, numéro) + **affiche** (`LEAST:GREATEST` des deux engagées),
relue puis posée avant l'envoi : lecture **non verrouillante** du match, de son
tournoi et de ses équipes (un `INSERT … SELECT` les verrouillerait en partage
face au moteur qui tient le verrou du tournoi), puis `INSERT IGNORE … VALUES`
— la clé primaire et `affectedRows` tranchent entre deux balayages. La ligne
garde l'horaire annoncé (`start_at`). Si la réservation échoue, les marques de
rappel que le passage venait de prendre sont rendues. Ainsi :

- deux balayages concurrents, une relance : un seul envoi ;
- un réappariement du même match avec la même affiche, ou un match effacé puis
  recréé à la même place avec les mêmes engagées (retour arrière, manche
  régénérée) : rien de plus ;
- une autre affiche à la même place (retour arrière puis autre vainqueur) :
  c'est un autre adversaire, annoncé ;
- la réservation relit aussi l'horaire et les équipes (existantes, fantômes
  ou non comme lues) : un horaire posé, une équipe supprimée entre la lecture
  et la réservation font relire le match au passage suivant ;
- destinataires lus **match par match, juste avant** sa réservation (quatre
  matchs à la fois) : une panne de lecture ne consomme rien, et un membre parti
  pendant un long passage n'est plus prévenu ; l'erreur d'un match (marque,
  réservation, envoi) ne retient pas les autres ; un bot injoignable consomme l'annonce (journal pm2), comme les
  rappels — une annonce manquée ne se répète pas en boucle.

## Première manche et horaire déjà posé (décisions du 2026-11-09)

- **Toutes les manches sont annoncées**, première comprise. Seuls les matchs
  déjà appariés à la **mise en service** sont marqués `skipped`
  (`installNewMatchNotices`, une fois par base : marques d'abord, puis la clé
  `new_match_notices_since` de `bg_settings` ; lecture simple puis
  insertion de valeurs par paquets). La mise en service a lieu au premier
  balayage après le déploiement : un match apparié avant lui (déploiement de
  nuit, hors match) compte parmi les anciens.
- **L'annonce part à l'appariement**, avant qu'on puisse programmer le match :
  tout évènement de tournoi publié après commit relance le balayage (10 s
  d'étranglement au plus).
- **Horaire déjà posé** (programme de manche fixé à l'avance) : l'annonce le
  donne, et `coverMatchSchedule` pose d'abord les marques des rappels
  (observation `SEEN`, horaire reçu `TOLD`, paliers déjà ouverts **sauf celui
  du check-in**, 10 h : l'annonce ne porte pas le check-in, le rappel de 10 h
  suit et le porte) — « Match programmé » ne part pas pour cet horaire. Un
  horaire posé par un arbitre sur un match qui attend encore son annonce
  (`setMatchStartAt` → `notifyMatchScheduleChange`) n'envoie pas non plus
  « Match programmé » aux joueurs : il relance le balayage, et l'annonce porte
  l'horaire (les arbitres sont prévenus comme d'habitude) ; de même quand
  l'annonce l'a déjà porté (`start_at` de la réservation, balayage passé entre
  le commit et la relecture). L'attente ne retient les rappels que
  30 minutes après la dernière modification du match : un balayage des
  annonces en panne ne coupe jamais les rappels.
- Couper le sujet `NEW_MATCH` (ou les messages privés de match) coupe aussi
  l'horaire donné à l'appariement : seuls les rappels de 24 h et 10 h le
  redonnent ensuite. Le balayage des rappels ignore un
  match qui attend son annonce (`newMatchPendingSql`,
  `lib/server/tournaments/new-match-sql.ts`). « Match programmé » ne part que
  pour une (re)programmation ultérieure (`setMatchStartAt`).

## Réglages

Le sujet apparaît de lui-même dans « Mon profil » (registre `PUSH_TOPICS`,
libellé et `InfoHint` FR/EN dans `messages/*/push.json`). Comme tout sujet, il
est **actif d'office** sur les appareils déjà abonnés (décision D5 du
2026-11-09), ce que disent `/rgpd`, le registre (T12) et l'entrée
`2026-11-annonce-nouveau-match` de `PRIVACY_CHANGES`.

