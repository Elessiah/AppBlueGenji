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
— la clé primaire et `affectedRows` tranchent entre deux balayages ; seul le
contrôle de clé étrangère attend brièvement le tournoi, et une attente de
verrou ne compte jamais comme un échec du match — puis **relue encore**
(engagées, équipes non dissoutes, état ; pas l'horaire : un horaire posé après
l'insertion part en « Match programmé ») : un match changé entre-temps voit sa
réservation rendue, et le passage suivant l'annonce tel qu'il est, à ses
équipes du moment. La ligne
garde l'horaire annoncé (`start_at`). Les marques de rappel posées avant (une
seule `INSERT IGNORE … VALUES`, sans relire le match) sont rendues si le match
a changé — seulement si toutes ont été prises là —, gardées si un autre
balayage a pris la réservation. Un match contre une équipe dissoute n'est pas
annoncé (marqué `skipped`). Si la table ne peut être créée, les migrations le
journalisent sans tomber, et les rappels ne l'attendent pas. Ainsi :

- deux balayages concurrents, une relance : un seul envoi ;
- un réappariement du même match avec la même affiche, ou un match effacé puis
  recréé à la même place avec les mêmes engagées (retour arrière, manche
  régénérée) : rien de plus ;
- une autre affiche à la même place (retour arrière puis autre vainqueur) :
  c'est un autre adversaire, annoncé ;
- la réservation relit aussi l'horaire et les équipes (existantes, fantômes
  ou non comme lues) : un horaire posé, une équipe supprimée entre la lecture
  et la réservation font relire le match au passage suivant ;
- destinataires lus **match par match, juste après** sa réservation (quatre
  matchs à la fois), au plus près de l'envoi : un membre parti entre-temps
  n'est plus prévenu ; une panne avant l'envoi rend la réservation et les
  marques (le passage suivant réessaie) ; au troisième échec d'affilée, l'affiche
  lue (mêmes engagées) est marquée `skipped` (ses rappels donneront l'horaire) ;
  un match sorti des candidats oublie ses échecs ;
- l'erreur d'un match ne retient pas les autres, l'échec d'envoi d'une équipe
  ne retient pas l'autre ; un bot injoignable consomme l'annonce (journal pm2,
  nombre de messages perdus seulement), comme les rappels — une annonce
  manquée ne se répète pas en boucle.

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
  le commit et la relecture) **et que les joueurs ne tenaient encore aucun
  horaire** : une date rendue à celle de l'annonce après une autre
  reprogrammation s'annonce. L'attente ne retient les rappels que si le
  balayage des annonces est vivant : pouls `new_match_sweep_at` de
  `bg_settings`, posé en début de passage (une fois par minute au plus, et
  seulement après un passage abouti et la mise en service), frais de moins de
  5 minutes. Balayage en panne ou pas encore en service : les rappels partent
  comme avant.
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

