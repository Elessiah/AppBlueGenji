# Check-in du match (MATCH-CHECKIN, ex-brief du salon MR-4)

**15 minutes avant le coup d'envoi** d'un match **en autogestion**, ceux qui
gèrent ses deux engagées (propriétaire et managers, ou le joueur d'une entrée
solo) reçoivent son **check-in** : un seul message, en message privé Discord
et en notification push (sujet `MATCH_LOBBY_BRIEF`, « Check-in du match »),
**une seule fois par match et par engagée**.

Spécification : décisions de l'utilisateur du 2026-10-26 et du 2026-10-27
(`MATCH_REFEREE.md`), **refondues le 2026-11-04** — le brief du salon et le
rappel des règles de l'autogestion fusionnent en un seul message, déplacé à
H-15, élargi à tous les joueurs, et stylisé (titre, sections, puces).

Trois changements de fond par rapport au brief du salon :

| | Avant (MR-4) | Maintenant |
| --- | --- | --- |
| Moment | ouverture du salon (coup d'envoi) | **15 min avant le coup d'envoi** ; à défaut d'horaire, l'ouverture du salon |
| Destinataires | `OWNER` et `MANAGER` d'une équipe | `OWNER` et `MANAGER` (CAST-FOLLOWUP ; tous les joueurs du 2026-11-04 au 2026-11-05) |
| Contenu | réglages de la partie | check-in complet (vocal, paramètres, maps, cast, scores, problème) |

## CAST-FOLLOWUP (décisions du 2026-11-05)

- **Autogestion seulement** : `BRIEF_DUE_SQL` exige `m.self_managed = 1 AND
  m.referee_user_id IS NULL`, à la lecture des candidats **et** dans la
  réservation (même instruction). Un match arbitré ou sans décision
  d'arbitrage ne reçoit rien ; les lignes « arbitre désigné » et l'ouverture
  neutre « sans décision » ont disparu du message (l'ouverture neutre reste
  contre une fantôme, `introGhost`).
- **Aux gérants** : `loadEntrantManagerIds` (propriétaire et managers,
  `hasTeamManagementRole` ; le joueur d'une entrée solo), et non plus
  `loadEntrantPlayerIds`.
- **Jamais deux fois** : la réservation est faite par engagée — phase
  `LOBBY_BRIEF` (`LOBBY_BRIEF_PHASE`), `pairing` = l'id de l'engagée — et
  n'est plus rendue ni par une nouvelle heure (`match-schedule`), ni par un
  lancement défait, ni par `adoptCurrentPairing` ou le replanificateur
  d'arbitrage (leurs `DELETE` excluent `phase LIKE 'LOBBY_BRIEF%'`). Un
  réappariement n'en renvoie pas à l'engagée restée ; celle qui arrive reçoit
  le sien. Les anciennes réservations (`LOBBY_BRIEF_1`/`_2`, clé
  `team1:team2`) restent honorées (`LEGACY_BRIEF_SQL`), par engagée et quel
  que soit l'adversaire d'alors — la sélection des candidats
  (`sideBriefedSql`) juge comme la réservation. Un match effacé puis
  recréé (retour arrière `rollback.ts`, manche régénérée) perd ses
  réservations, pas sa **marque durable** : `bg_lobby_brief_marks`, posée
  par `markBriefSent` dès qu'un envoi a pu partir, tient l'engagée par la
  place du match (tournoi, phase, tableau, manche, numéro) ; réservation
  (`briefMarkSql`) et balayage la lisent — le check-in ne repart jamais deux
  fois (décision de l'utilisateur du 2026-11-05). Elle part avec le tournoi
  ou l'engagée, et quand un tableau périmé est reconstruit (`discardStaleBracket`
  → `forgetLobbyBriefMarks`) : ses rencontres sont nouvelles.
- Les sections ci-dessous qui parlent d'arbitre désigné, de « tous les
  joueurs » ou d'une réservation rendue à la réouverture du salon décrivent
  l'état du 2026-11-04, remplacé par ces règles.

**Un match sans horaire n'a pas de repère H-15** : son check-in part à
l'ouverture du salon, comme avant la fusion (`LOBBY_BRIEF_LEAD_MINUTES`,
`lib/shared/lobby-brief.ts`). Les deux repères partagent la **même
réservation** : un match programmé puis ouvert n'est briefé qu'une fois.
Le repère du salon ne vaut que si l'horaire n'est **pas à venir**, ou si le
match est **lancé** (`m.start_at IS NULL OR m.start_at <= NOW() OR
m.launched_at IS NOT NULL`) : un salon ouvert tôt sans lancement attend son
quart d'heure ; un match **lancé tôt** (lancement forcé à 18 h pour 21 h) se
joue tout de suite, son check-in part donc à l'ouverture, sous-titré « match
lancé », **sans** la ligne du salon de check-in ni celle du vocal — tous deux
n'ouvrent qu'au quart d'heure de l'horaire (`kickoff_state` vaut
`UNSCHEDULED` au-delà de `LOBBY_BRIEF_LEAD_MINUTES`, `voice_tracked` est borné
de même) — et rien ne repart à H-15 (même réservation).

**Destinataires relus juste avant l'envoi** (REFEREE-LOT-1) : chaque côté
relit ses membres actifs (`loadEntrantManagerIds`) après sa réservation — un
membre retiré depuis la lecture du balayage ne reçoit plus le lien du match ni
l'ordre des bans. Un compte membre actif **des deux** engagées ne reçoit que le
check-in du premier côté (jamais « crée la partie » puis « vérifie les
paramètres ») : règle fixe, lue des appartenances (`slotManagers`), la même à
chaque balayage ; un second côté qui n'a que de tels gérants est réservé sans
envoi, comme une fantôme. La coupe de dernier recours d'un message trop long se fait par
points de code, jamais au milieu d'un émoji.

## Contenu

Le message privé est **stylisé** : un titre (`#`), des sections (`##`), des
puces et du gras — notre propre mise en forme, écrite dans
`lobby-brief-dm.ts` ; seuls les noms (équipes, cartes, tournoi) passent par
`discordInline`, qui échappe la leur, si bien qu'un nom d'équipe ne peut pas
ouvrir de fausse section.

```
# Check-in du match « A » Vs « B »
*Manche 2 · « Coupe » — coup d'envoi dans moins de 15 minutes.*

**Ton match est en autogestion.** Voici les éléments importants à savoir.
*Les contacts et les BattleTags à inviter sont sur la page du match : <lien>*

## Avant le coup d'envoi
* Le salon de check-in est ouvert sur Discord — <invitation>
* Tous les joueurs doivent rejoindre le salon vocal de leur équipe, ouvert par le bot — <invitation>
* Gauche (hôte) : « A » · Droite : « B »
* **C'est à ton équipe de créer la partie.**

## Paramètres de partie
* Mode compétitif
* Pas de killcam
* Pause à la déconnexion

## Déroulé des maps
* Map 1 : « Ilios »
* Map 2 : à choisir parmi « Busan », « Nepal »
* Bans de la carte 1 : « B » d'abord, puis « A ».
* Cartes suivantes : …

## Match casté
* Diffusion : <lien du stream>
* Invite les casters inscrits (leurs contacts sont sur la page du match).
* Trie les joueurs par rôle dans le salon.

N'oublie pas de rentrer les scores du match **au plus vite après la fin de ton match**.
Un problème ? Signale-le depuis la page du match, ou pingue le rôle @Arbitre sur Discord.

GL HF :)
```

Le message **tutoie** d'un bout à l'autre (REFEREE-LOT-1), comme les autres
messages Discord. Vu de l'engagée du destinataire :

- **Titre** : « Check-in du match « A » Vs « B » » ; en tournoi individuel,
  « Check-in de ton match » (un nom d'engagé y est un pseudo).
- **Sous-titre** : manche, tournoi, et l'état, **selon le déclencheur**
  (`LobbyBriefSide.kickoff`, jugé sur l'horloge de la base) — « coup d'envoi
  dans moins de 15 minutes » (horaire à venir, nombre tiré de
  `LOBBY_BRIEF_LEAD_MINUTES`), « l'heure du coup d'envoi est arrivée » (match
  devenu jouable après son horaire), « le salon du match est ouvert » (match
  sans horaire) —, ou « match lancé » pour un match déjà lancé (lancement
  forcé, tous « Prêt » avant le balayage ; les réglages restent, ils servent à
  créer la partie), **seulement si ce lancement est celui de l'appariement
  courant** (`launch_pairing`) : un `launched_at` resté d'un appariement
  remplacé ne le dit pas.
- **Ouverture** : ce que dit la décision d'arbitrage — « **Ton match est en
  autogestion.** », « **Un arbitre est désigné pour votre match.** », ou, sans
  décision, « Voici les éléments importants à savoir avant le coup d'envoi. »
  (le staff est averti à part). Contre une **fantôme**, l'autogestion n'est pas
  annoncée : personne en face.
- **Lien de la page du match** (`matchPageHref`, sous `/en` pour un compte
  anglais), en italique et **entre chevrons** (`discordUrl` : nu, l'autolien
  de Discord pouvait avaler l'astérisque qui ferme l'italique) : seule page à
  montrer les BattleTags à inviter — bâti
  par `siteUrl`, et **tu** sans racine du site connue (`APP_URL`) plutôt que de
  pointer vers une adresse inventée.
- **Avant le coup d'envoi** : le salon de **check-in** (ouvert, puisque le
  message part dans son quart d'heure — `CHECK_IN_INVITE_URL` ; **tu pour un
  match sans horaire**, dont le check-in part à l'ouverture du salon du match :
  ce salon n'y a pas de fenêtre) ; le **salon
  vocal** d'équipe, **seulement si le match est suivi** (`side.voice` : option
  « Salons vocaux d'équipe » du tournoi, ni entrée solo, ni fantôme —
  `MATCH_VOICE.md` ; sinon le bot n'ouvrira aucun salon et l'annoncer serait
  faux) ; **gauche (hôte) et droite** (`matchHostTeamId` : choisi par le staff,
  sinon la meilleure tête de série en BlueGenji Survie, phase finale, sinon
  l'équipe 1) ; puis **qui crée la partie** — en autogestion, l'hôte la crée et
  l'autre **vérifie les paramètres** ; avec un arbitre désigné (encore
  éligible, `loadEligibleRefereeIds`), c'est lui qui invite ; **sans décision,
  aucune ligne** (charger l'hôte trancherait à la place du staff). Un arbitre
  devenu membre actif (ou joueur solo) d'une des deux engagées n'est pas
  annoncé (`referee_plays`, bâti par `playsMatchSql` comme l'éligibilité).
- **Paramètres de partie** : mode compétitif, pas de killcam, pause à la
  déconnexion — **les mêmes pour tous les jeux** (décision du 2026-11-04).
  Liste **unique** : `GAME_SETTINGS` (`lib/shared/match-page.ts`) en donne
  l'ordre, `GAME_SETTINGS_TEXT` (`lib/shared/lobby-brief.ts`) les mots du
  check-in, et la page du match ses clés `matchPage.gameSettings.*` — un test
  tient les deux rendus ensemble.
- **Déroulé des maps** : une puce par créneau de la manche (`ROUND_MAPS.md`,
  `resolveMatchMaps` : imposée, ou « à choisir parmi … »), sinon la seule
  première carte (« pas encore fixée » à défaut) ; puis l'ordre des bans de la
  carte 1 (l'équipe qui n'héberge pas d'abord, règle du tournoi), la règle des
  cartes suivantes, et la map de départage s'il y en a une. Le bloc est borné
  par `MAPS_LINE_MAX` (420) : au-delà, il s'arrête à un créneau entier et
  renvoie à la page du match — un message de plus de 2 000 caractères ne
  serait pas remis par Discord. Si des noms longs (équipes, tournoi, lien de
  diffusion) font malgré tout passer le message au-delà de
  `DISCORD_MESSAGE_MAX` (2 000), le bloc des cartes cède par paliers de 30
  jusqu'au seul renvoi ; aux longueurs maximales, le message est coupé (« … »).
- **Match casté**, dès qu'un caster encore éligible est inscrit
  (`readMatchCasters`) : le **lien de diffusion** (« Diffusion : » / « Stream: », jamais « En direct » : rien n'est encore à l'antenne) quand il est public
  (`firstStreamUrlSql`, `bg_match_streams`, tu tant que `live_trigger` est vide comme sur la page, repassé par `liveAnnouncementUrl` — pages de redirection refusées comme en #live —
  tu sinon ; signes de mise en forme Discord encodés et lien entre chevrons, `discordUrl` de `discord-text.ts`, pour qu'un chemin ne fasse pas de lien masqué), l'invitation des casters, et le rappel de trier les joueurs par
  rôle. Hors Overwatch, où l'on ne s'invite pas par BattleTag, on « prévient »
  les casters au lieu de les « inviter » (décision 35, 2026-10-28 ;
  `battletagRelevantFor`), et le lien de la page ne parle plus de BattleTags.
- **Pied** : le rappel de saisir les scores « au plus vite après la fin de
  votre match », la ligne « un problème ? » (page du match, ou le rôle
  **@Arbitre** sur Discord — en texte simple : le site ne connaît pas
  l'identifiant du rôle, posé côté bot par `/set-referee-role`, et une mention
  de rôle ne notifierait personne depuis un message privé), puis « GL HF :) ».

**Jamais** de BattleTag, de tag Discord ni de pseudo de joueur (décision du
2026-10-27). Noms d'équipe neutralisés (`discordInline`, une ligne). En
tournoi individuel, le nom d'un engagé est un pseudo : le message dit « toi » /
« ton adversaire » (« you » / « your opponent »).

Rédacteurs : `formatLobbyBriefDm` (`lib/server/tournaments/lobby-brief-dm.ts`,
serveur seulement — il atteint `push-messages.ts` et ses deux langues ; FR/EN
en dur comme les autres messages privés) et `lobbyBriefPush`
(`lib/shared/push-messages.ts`, clés `pushMessages.lobbyBrief`, titre
« Check-in du match : réglages »), étiquette
`rencontre-<id>-salon` : le brief ne remplace pas l'appel aux « Prêt ». Les
deux lisent les places et l'ordre des bans dans `lobbyBriefNames`
(`lib/shared/lobby-brief.ts`, avec le type `LobbyBriefSide`, sans dépendance
lourde). Le push cite les noms d'équipe (« » / “ ”, comme le message privé :
un nom contenant « · » ne se confond pas avec le séparateur), passés par
`withoutInvisibles` (un ancien nom gardant U+202E ne retourne pas la ligne — de même
dans `matchStartPush` ; la carte aussi), et ôte la ponctuation finale de la carte (le gabarit
pose son point). Il tient sous `PUSH_BODY_MAX` : « Droite (1er ban) » (aucun nom
répété), carte en dernier ; le rappel du tri par rôle, en tête, **cède sa
place** quand le corps dépasserait la borne (le message privé et la page le
portent) — la carte n'est jamais coupée sans le dire.

## Envoi

`dispatchLobbyBriefs` (`lib/server/tournaments/lobby-brief.ts`), balayage
étranglé à dix secondes avec relève (`throttledSweep`, `lib/server/throttled-sweep.ts`,
partagé avec les départs de match), appelé aux mêmes endroits que les départs
de match (publication d'un évènement de tournoi, entretien de l'instantané qui
ouvre un lancement, lecture de la liste des tournois, et `GET /api/me/match-launches`,
interrogée par les joueurs proches de leur match, comme les salons vocaux).

- Candidats (`BRIEF_DUE_SQL`) : tournoi `RUNNING` **et publié**
  (`start_visibility_at` passé, comme les salons vocaux : un tournoi masqué de
  nouveau ne fait sortir ni son nom ni ses équipes), match `READY` non exempt et
  **sans score** (un match noté que le staff replanifie est tenu pour lancé,
  sans salon), et **dû** — soit par son horaire (`start_at` dans les
  15 minutes qui viennent, et pas plus vieux que `LOBBY_BRIEF_LATE_MINUTES`,
  la même fenêtre de 20 min que le salon : un match devenu jouable en retard
  reçoit encore son check-in, un match commencé depuis longtemps — au
  déploiement, après un réappariement — n'en reçoit pas en pleine partie),
  soit par `lobby_opened_at` des 20 dernières minutes (délai du lancement
  d'office + 5) **pour l'appariement courant** (`launch_pairing`), le repli des
  matchs sans horaire.
  Toutes les bornes sont des instants de la base (`NOW()`), comme les fenêtres
  de l'appel aux « Prêt ».
- **Par l'horaire, l'appariement n'est pas comparé à `launch_pairing`** : cette empreinte est
  vide tant qu'aucun lancement n'a été adopté (`adoptCurrentPairing`), et le
  check-in part avant l'ouverture du salon. La réservation porte donc
  l'**appariement courant** (`CONCAT(team1_id, ':', team2_id)`, colonne
  `brief_pairing`) : un réappariement change la clé, et `adoptCurrentPairing`
  efface de son côté les réservations du match quand il remplace une empreinte
  déjà posée, **sauf le check-in de l'appariement qui arrive** (déjà parti à
  H-15, il ne repart pas à l'ouverture du salon ; la première adoption,
  empreinte vide, n'efface rien). Une **nouvelle heure** sans salon ouvert
  (`match-schedule`) rend le check-in réservé : il repart 15 minutes avant la
  nouvelle. Le vocal n'est annoncé qu'à un match qui a son horaire (le bot n'en
  ouvre pas d'autre).
- **Réservation** `bg_match_start_notices` phases `LOBBY_BRIEF_1` /
  `LOBBY_BRIEF_2`, une par engagée et par appariement (`INSERT IGNORE …
  SELECT` qui relit le match **et son tournoi** : encore dû, sans score, même
  appariement courant, `READY`, tournoi `RUNNING` — un lancement défait ou un
  réappariement entre la lecture et la réservation ne laisse ni brief périmé,
  ni brief aux anciennes équipes, ni réservation qui ferait taire la
  réouverture), **côté par côté** : réservation, relecture des réglages du
  match **pour ce côté** (hôte, cartes, arbitre, autogestion — un changement
  entre la lecture des candidats et la réservation, ou entre deux côtés, est
  repris ; relecture en panne : la réservation est rendue, le match rejoué au
  balayage suivant ; salon refermé depuis la réservation : rien de plus ne
  part, les réservations du match **sans envoi** (fantôme, brief non rédigé)
  sont rendues sans relance — un côté déjà briefé garde la sienne —, pm2
  disant « salon refermé avant l'envoi » ; salon ouvert mais réservation
  effacée entre-temps — lancement défait puis rouvert, autre processus : rien
  ne part de ce côté, rien à rendre, le balayage suivant le reprend), envoi,
  puis le côté suivant — un arrêt du processus
  ne laisse au plus qu'une réservation sans envoi. Un match reste candidat tant
  qu'un côté est libre. Un réappariement est un autre appariement (nouveau
  brief) ; un lancement défait (horaire changé, retour à planifier) **ou un
  appariement réécrit sur place** (`adoptCurrentPairing`, A:B → A:C → A:B)
  efface les réservations du match (le réappariement sur place garde le
  check-in de l'appariement qui arrive) : le salon rouvert est briefé de nouveau.
  Le balayage des départs ne compte que ses phases `LOBBY` / `LAUNCHED`, et
  comme le brief ignore un match qui porte déjà un score (candidats et
  réservation).
- Destinataires, lus **une fois pour tous les côtés et avant toute
  réservation** (une panne ne réserve rien) : `loadEntrantPlayerIds` — **tous
  les membres actifs** d'une équipe, ou le joueur d'une entrée solo (décision
  du 2026-11-04 : le check-in demande à chacun de rejoindre le vocal de son
  équipe, pas seulement à qui la gère) — puis
  `loadNotificationRecipients(…, "certified", { matchDm: true })` :
  message privé au seul tag certifié, coupé par « Messages privés Discord de
  mes matchs » ; le push garde son sujet. Une **fantôme** (`is_ghost`) est
  réservée sans envoi ; une vraie équipe **sans joueur actif** (compte
  supprimé compris : il garde son appartenance mais n'est plus destinataire)
  n'est pas réservée (pm2 le dit une fois par appariement) : un joueur ajouté dans la
  fenêtre est briefé au balayage suivant. Un match dont aucun côté n'a de quoi
  partir (sans joueur, sans fantôme) ne déclenche ni lecture des casteurs
  ni des arbitres.
- **Indépendant du push** (pas de garde `webPushConfig`). Bot injoignable : le
  push part, pm2 dit combien de comptes n'ont pas reçu le message
  (`[lobby-brief] bot injoignable`), **sans nouvel essai**. Une panne de lecture
  des casters ou des arbitres envoie le brief sans ces lignes. Les textes (deux
  langues) sont rédigés **avant** l'envoi : un rédacteur qui lève n'envoie
  rien, la réservation du côté est rendue — **par son id** (avec deux
  processus, jamais celle que l'autre a reprise), en un lot après la boucle,
  pm2 ne disant « remis au balayage suivant » qu'une fois le rendu fait — et
  le balayage suivant est armé (trois relances d'affilée **par match** au plus,
  puis le prochain évènement du tournoi ; un match qui échoue toujours
  n'épuise pas celles des autres). Une panne après la réservation (réglages,
  lien) rend de même la réservation, et une lecture des destinataires en
  panne arme aussi la relance (compteur remis à zéro par le premier balayage
  dont la lecture des candidats réussit, même sans candidat). Une réservation dont l'instruction lève (la
  connexion a pu tomber après l'écriture) est rendue par sa clé ; dans les deux cas, les
  matchs suivants du balayage partent quand même. Un envoi qui lève garde la sienne (le push et le message
  privé partent ensemble, une partie a pu partir) : jamais deux fois. Un côté
  que **personne** n'a reçu (messages privés coupés, tag non certifié, push
  éteint : `report.discord.sent` + `report.pushed` nuls) n'est pas compté comme
  briefé, et pm2 le dit ; la réservation reste.
- L'appel aux « Prêt » (`claimStartNotice`, `player-pushes.ts`) réserve de même
  par `INSERT IGNORE … SELECT` conditionné à l'état du match (salon ouvert non
  lancé pour `LOBBY`, lancé pour `LAUNCHED`) : un lancement défait entre la
  lecture et la réservation ne fait plus taire la réouverture.

## Les paramètres de partie sur la page du match

Demande de l'utilisateur du 2026-11-04 : les paramètres figurent **aussi** sur
la page du match. Section « Paramètres de partie » (`GameSettingsSection`,
`MatchPage.tsx`, colonne de gauche après « Maps et bans »), lue par **tout le
monde** — sans compte compris : ce sont les règles de la partie, pas une
consigne d'organisation.

Trois conséquences sur l'existant :

- la liste n'est plus **propre à Overwatch** : `OW_SELF_MANAGEMENT_SETTINGS`
  devient `GAME_SETTINGS`, et la garde `game === "OW"` disparaît ;
- les clés de traduction passent de `matchPage.owSettings.*` à
  `matchPage.gameSettings.*` (FR et EN), et le titre de section vit dans
  `matchPage.sections.gameSettings` ;
- l'aide-mémoire de l'autogestion **ne répète plus** la sous-liste : l'étape
  « Réglez les paramètres de la partie. » renvoie à la section, qui les porte
  une seule fois (la classe `.stepSettings` disparaît avec elle). La prop
  `game` de `OfficiatingSection` n'est plus lue et part aussi.

## RGPD

CAST-FOLLOWUP : destinataires restreints (autogestion, gérants) et trace
gardée avec le match — registre T04 (sous-finalité, garde, push), T08, T12,
`/rgpd` FR/EN, politique du bot (LegalTerms régénérés dans la PR du bot) et
une entrée `2026-11-check-in-aux-gerants` (FR/EN) qui complète, sans la
réécrire, `2026-11-check-in-du-match`.

Message de match : registre T04 (sous-finalité, intérêt légitime opposable par
l'interrupteur de « Mon profil ») et T12 (sujet push), `/rgpd` FR/EN
§ « Messages privés Discord de match », politique de confidentialité du bot
(`bot-legal-content.ts` : messages remis, tag certifié, interrupteur, base
légale), conditions du bot (article 01 : le « check-in du match » parmi les
messages de match remis, depuis TERMS v7, copie LegalTerms du bot régénérée
dans le même lot), garde des réservations (T04). Le check-in repart quand le
salon rouvre (horaire changé, retour à planifier, nouvel appariement).
Conditions d'utilisation du site inchangées.

**Fusion du 2026-11-04** : le moment change (H-15) et les destinataires
s'élargissent (tous les joueurs), donc deux entrées de `PRIVACY_CHANGES` —
l'ancienne `2026-10-reglages-du-salon-aux-managers`, laissée telle quelle
(une entrée publiée ne se retouche pas), et la nouvelle
`2026-11-check-in-du-match` (FR/EN) qui dit ce qui change et ce qui ne change
pas. `REGISTER_UPDATED_AT` avance, et la référence du français
(`tests/fixtures/legal-fr/rgpd.txt`, `rgpd-registre.txt`) est régénérée dans
la même PR.

## Tests

CAST-FOLLOWUP : `dueSql_refereedOrUndecidedMatch_notDue`,
`dispatchLobbyBriefs_claim_requiresSelfManagedInTheSameStatement`,
réservation par engagée et anciennes réservations honorées
(`tests/lib/server/lobby-brief.test.ts`), heure changée sans rendu
(`match-schedule-service.test.ts`), réappariement qui garde les check-ins
(`match-launch.test.ts`, `referee-scheduling.test.ts`), message sans arbitre
(`tests/lib/shared/lobby-brief.test.ts`).

`tests/lib/shared/lobby-brief.test.ts` (message complet FR et EN au caractère
près, vocal écrit ou tu, section du cast et lien du live, pas de ligne de
création sans décision, match lancé, autogestion contre une fantôme, lien tu,
solo sans pseudo, neutralisation, bloc des maps borné, paramètres de partie :
une seule liste pour le check-in et la page ; push : noms cités, U+202E,
ponctuation de la carte, rappel du tri qui cède sa place ; sujet, registre,
entrée de `PRIVACY_CHANGES`),
`tests/lib/server/lobby-brief.test.ts` (requête, destinataires lus une fois,
réservation par côté puis envoi avant le côté suivant, relecture des réglages
et de l'arbitre, relecture en panne, fantôme, équipe sans joueur actif dite une
fois, arbitre qui joue, solo, hôte/tête de série, cast, arbitre inéligible, lien
tu, personne joint, bot injoignable, envoi qui lève, réservation interrompue
rendue par sa clé, rendu par id **puis second balayage où seul ce côté est
rebriefé**, relances plafonnées, étranglement), `throttled-sweep.test.ts`,
`player-pushes.test.ts` (réservation conditionnée), `match-launch.test.ts`
(`adoptCurrentPairing` efface les réservations), `notify.test.ts`
(`loadEntrantPlayerIds`), `match-page-render.test.tsx` (la section
« Paramètres de partie » de la page, pour tout lecteur et tous jeux, et
l'étape d'autogestion qui ne la répète pas), `match-page.test.ts`
(`GAME_SETTINGS`).

## Cartes par manche

Une manche peut imposer ses cartes ou ouvrir des pools, et le tournoi porte ses règles de ban (ordre, perdant de la carte précédente) : `ROUND_MAPS.md`.
