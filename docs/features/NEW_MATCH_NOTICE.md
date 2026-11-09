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
posée en une instruction (`INSERT IGNORE … SELECT` qui relit le match et son
tournoi, `affectedRows`), avant l'envoi. Ainsi :

- deux balayages concurrents, une relance : un seul envoi ;
- un réappariement du même match avec la même affiche, ou un match effacé puis
  recréé à la même place avec les mêmes engagées (retour arrière, manche
  régénérée) : rien de plus ;
- une autre affiche à la même place (retour arrière puis autre vainqueur) :
  c'est un autre adversaire, annoncé ;
- destinataires lus **avant** toute réservation : une panne de lecture ne
  consomme rien ; un bot injoignable consomme l'annonce (journal pm2), comme les
  rappels — une annonce manquée ne se répète pas en boucle.

## Première manche et horaire déjà posé (décisions du 2026-11-09)

- **Toutes les manches sont annoncées**, première comprise. Seuls les matchs
  déjà appariés à la **mise en service** sont marqués `skipped`
  (`installNewMatchNotices`, une fois par base : marques d'abord, puis la clé
  `new_match_notices_since` de `bg_settings`).
- **L'annonce part à l'appariement**, avant qu'on puisse programmer le match :
  tout évènement de tournoi publié après commit relance le balayage (10 s
  d'étranglement au plus).
- **Horaire déjà posé** (programme de manche fixé à l'avance) : l'annonce le
  donne, et `coverMatchSchedule` pose d'abord les marques des rappels
  (observation `SEEN`, horaire reçu `TOLD`, paliers déjà ouverts) — « Match
  programmé » ne part pas pour cet horaire. Le balayage des rappels ignore un
  match qui attend son annonce (`NEW_MATCH_PENDING_SQL`,
  `lib/server/tournaments/new-match-sql.ts`). « Match programmé » ne part que
  pour une (re)programmation ultérieure (`setMatchStartAt`).

## Réglages

Le sujet apparaît de lui-même dans « Mon profil » (registre `PUSH_TOPICS`,
libellé et `InfoHint` FR/EN dans `messages/*/push.json`). Comme tout sujet, il
est **actif d'office** sur les appareils déjà abonnés (décision D5 du
2026-11-09), ce que disent `/rgpd`, le registre (T12) et l'entrée
`2026-11-annonce-nouveau-match` de `PRIVACY_CHANGES`.

