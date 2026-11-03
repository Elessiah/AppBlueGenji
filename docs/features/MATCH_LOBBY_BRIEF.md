# Brief du salon (MATCH-REFEREE MR-4)

Quand le salon d'un match s'ouvre, ceux qui gèrent chaque engagée reçoivent
les réglages de la partie, en message privé Discord et en notification push
(sujet `MATCH_LOBBY_BRIEF`, « Réglages du salon »). Spécification : décisions
de l'utilisateur du 2026-10-26 et du 2026-10-27 (`MATCH_REFEREE.md`).

## Contenu

Vu de l'engagée du destinataire (« ton match « A » contre « B » ») :

- **Gauche (hôte)** et **droite** : l'hôte de `matchHostTeamId` (choisi par le
  staff, sinon la meilleure tête de série en BlueGenji Survie, phase finale,
  sinon l'équipe 1) ;
- **première carte** (texte du staff, « pas encore fixée » sinon) ;
- **premier ban** : l'équipe qui n'héberge pas (règle du tournoi), marqué sur
  la place comme dans le push (« Droite (1er ban) », « Gauche (hôte, 1er ban) ») ;
- **« Match casté : trie les joueurs par rôle »** dès qu'un caster encore
  éligible est inscrit (`readMatchCasters`) ;
- la décision d'arbitrage : arbitre désigné (encore éligible,
  `loadEligibleRefereeIds`) — « ajoute-le en jeu, il invitera les joueurs » —,
  ou autogestion — l'hôte crée la partie, les managers s'invitent puis invitent
  les casters ; rien sans décision (le staff en est averti à part). Un arbitre
  devenu membre actif (ou joueur solo) d'une des deux engagées n'est pas annoncé
  (`referee_plays`, bâti par `playsMatchSql` comme l'éligibilité). Contre une **fantôme**, la ligne d'autogestion n'est pas
  écrite (personne en face pour s'inviter) ;
- le lien de la **page du match** (`/tournois/[id]/matchs/[matchId]`,
  `matchPageHref`, sous `/en` pour un compte anglais une fois la route traduite
  par MR-3), seule à montrer les BattleTags à inviter — bâti par `siteUrl` :
  sans racine du site connue (`APP_URL`), la ligne du lien est tue plutôt que
  de pointer vers une adresse inventée.
- **Match déjà lancé** (lancement forcé, ou tous « Prêt » avant le balayage) :
  « Ton match … est lancé » / « Match lancé : réglages de la partie » au lieu
  de « Le salon … est ouvert », réglages gardés (utiles pour créer la partie).
- **Hors Overwatch** (Marvel Rivals, décision 35, 2026-10-28 ; `side.game`,
  `battletagRelevantFor`) : on ne s'y invite pas par BattleTag — la ligne de
  l'arbitre perd « ajoute-le en jeu » (« il invitera les joueurs dans le
  salon ») et le lien devient « Réglages à jour » / “Up-to-date settings”.

**Jamais** de BattleTag, de tag Discord ni de pseudo de joueur (décision du
2026-10-27). Noms d'équipe neutralisés (`discordInline`, une ligne). En
tournoi individuel, le nom d'un engagé est un pseudo : le message dit « toi » /
« ton adversaire » (« you » / « your opponent »).

Rédacteurs : `formatLobbyBriefDm` (`lib/server/tournaments/lobby-brief-dm.ts`,
serveur seulement — il atteint `push-messages.ts` et ses deux langues ; FR/EN
en dur comme les autres messages privés) et `lobbyBriefPush`
(`lib/shared/push-messages.ts`, clés `pushMessages.lobbyBrief`), étiquette
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
ouvre un lancement, lecture de la liste des tournois).

- Candidats : tournoi `RUNNING`, match `READY` non exempt et **sans score**
  (un match noté que le staff replanifie est tenu pour lancé, sans salon),
  appariement courant, `lobby_opened_at` des 20 dernières minutes (délai du
  lancement d'office + 5).
- **Réservation** `bg_match_start_notices` phases `LOBBY_BRIEF_1` /
  `LOBBY_BRIEF_2`, une par engagée et par appariement (`INSERT IGNORE …
  SELECT` qui relit le match : salon encore ouvert, sans score, même appariement, qui est
  toujours celui de ses équipes, `READY` — un lancement défait ou un
  réappariement entre la lecture et la réservation ne laisse ni brief périmé,
  ni brief aux anciennes équipes, ni réservation qui ferait taire la
  réouverture), **côté par côté** : réservation, relecture des réglages du
  match (hôte, cartes, arbitre, autogestion — un changement entre la lecture
  des candidats et la réservation est repris ; relecture en panne : la
  lecture des candidats ; relecture vide — salon refermé depuis la
  réservation, ou réservation effacée entre-temps (lancement défait puis
  rouvert) : rien ne part, les réservations du match, fantôme comprise, sont
  rendues sans relance, pm2 disant « salon refermé avant l'envoi »), envoi, puis le côté suivant — un arrêt du processus
  ne laisse au plus qu'une réservation sans envoi. Un match reste candidat tant
  qu'un côté est libre. Un réappariement est un autre appariement (nouveau
  brief) ; un lancement défait (horaire changé, retour à planifier) **ou un
  appariement réécrit sur place** (`adoptCurrentPairing`, A:B → A:C → A:B)
  efface les réservations du match : le salon rouvert est briefé de nouveau.
  Le balayage des départs ne compte que ses phases `LOBBY` / `LAUNCHED`.
- Destinataires, lus **une fois pour tous les côtés et avant toute
  réservation** (une panne ne réserve rien) : `loadEntrantManagerIds` — `OWNER`
  et `MANAGER` (`hasTeamManagementRole`, pas le capitaine), joueur d'une entrée
  solo — puis `loadNotificationRecipients(…, "certified", { matchDm: true })` :
  message privé au seul tag certifié, coupé par « Messages privés Discord de
  mes matchs » ; le push garde son sujet. Une **fantôme** (`is_ghost`) est
  réservée sans envoi ; une vraie équipe **sans gestionnaire actif** (compte
  supprimé compris : il garde son appartenance mais n'est plus destinataire)
  n'est pas réservée (pm2 le dit une fois par appariement) : un manager ajouté dans la
  fenêtre est briefé au balayage suivant. Un match dont aucun côté n'a de quoi
  partir (sans gestionnaire, sans fantôme) ne déclenche ni lecture des casteurs
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

## RGPD

Nouveau message de match : registre T04 (sous-finalité, intérêt légitime
opposable par l'interrupteur de « Mon profil ») et T12 (sujet push), `/rgpd`
FR/EN § « Messages privés Discord de match », entrée
`2026-10-reglages-du-salon-aux-managers` (FR/EN), politique de confidentialité
du bot (`bot-legal-content.ts` : messages remis, tag certifié, interrupteur,
base légale), conditions du bot (article 01 : « réglages du salon » parmi
les messages de match remis, depuis TERMS v7, copie LegalTerms du bot
régénérée dans le même lot), garde
des réservations (T04). Le brief repart quand le salon rouvre (horaire changé,
retour à planifier, nouvel appariement). Conditions d'utilisation du site
inchangées.

## Tests

`tests/lib/shared/lobby-brief.test.ts` (textes FR/EN, marques de ban des deux
canaux, match lancé, autogestion contre une fantôme, lien tu, solo sans
pseudo, neutralisation, push : noms cités, U+202E, ponctuation de la carte,
rappel du tri qui cède sa place ; sujet, registre),
`tests/lib/server/lobby-brief.test.ts` (requête, destinataires lus une fois,
réservation par côté puis envoi avant le côté suivant, relecture des réglages
et de l'arbitre, relecture en panne, fantôme, équipe sans gestionnaire dite une
fois, arbitre qui joue, solo, hôte/tête de série, cast, arbitre inéligible, lien
tu, personne joint, bot injoignable, envoi qui lève, réservation interrompue
rendue par sa clé, rendu par id **puis second balayage où seul ce côté est
rebriefé**, relances plafonnées, étranglement), `throttled-sweep.test.ts`,
`player-pushes.test.ts` (réservation conditionnée), `match-launch.test.ts`
(`adoptCurrentPairing` efface les réservations), `notify.test.ts`
(`loadEntrantManagerIds`).

## Cartes par manche

Une manche peut imposer ses cartes ou ouvrir des pools, et le tournoi porte ses règles de ban (ordre, perdant de la carte précédente) : `ROUND_MAPS.md`.
