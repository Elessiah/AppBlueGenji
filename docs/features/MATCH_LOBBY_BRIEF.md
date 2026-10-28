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
- **premier ban** : l'équipe qui n'héberge pas ;
- **« Match casté : trie les joueurs par rôle »** dès qu'un caster encore
  éligible est inscrit (`readMatchCasters`) ;
- la décision d'arbitrage : arbitre désigné (encore éligible,
  `loadEligibleRefereeIds`) — « ajoute-le en jeu, il invitera les joueurs » —,
  ou autogestion — l'hôte crée la partie, les managers s'invitent puis invitent
  les casters ; rien sans décision (le staff en est averti à part) ;
- le lien de la **page du match** (`/tournois/[id]/matchs/[matchId]`,
  `matchPageHref`, sous `/en` pour un compte anglais une fois la route traduite
  par MR-3), seule à montrer les BattleTags à inviter.
- **Hors Overwatch** (Marvel Rivals, décision 35, 2026-10-28 ; `side.game`,
  `battletagRelevantFor`) : on ne s'y invite pas par BattleTag — la ligne de
  l'arbitre perd « ajoute-le en jeu » (« il invitera les joueurs dans le
  salon ») et le lien devient « Réglages à jour » / “Up-to-date settings”.

**Jamais** de BattleTag, de tag Discord ni de pseudo de joueur (décision du
2026-10-27). Noms d'équipe neutralisés (`discordInline`, une ligne). En
tournoi individuel, le nom d'un engagé est un pseudo : le message dit « toi » /
« ton adversaire » (« you » / « your opponent »).

Rédacteurs : `formatLobbyBriefDm` (`lib/shared/lobby-brief.ts`, FR/EN en dur
comme les autres messages privés) et `lobbyBriefPush`
(`lib/shared/push-messages.ts`, clés `pushMessages.lobbyBrief`), étiquette
`rencontre-<id>-salon` : le brief ne remplace pas l'appel aux « Prêt ».
Le push tient sous `PUSH_BODY_MAX` : rappel du tri par rôle en tête, « Droite
(1er ban) » (aucun nom répété), carte en dernier — la coupe ne retire qu'elle.

## Envoi

`dispatchLobbyBriefs` (`lib/server/tournaments/lobby-brief.ts`), balayage
étranglé à dix secondes avec relève, appelé aux mêmes endroits que les départs
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
  réouverture), **avant** les
  destinataires ; un match reste candidat tant qu'un côté est libre. Un
  réappariement est un autre appariement (nouveau brief) ; un lancement défait
  (horaire changé, retour à planifier) efface les réservations du match : le
  salon rouvert est briefé de nouveau.
  Le balayage des départs ne compte que ses phases `LOBBY` / `LAUNCHED`.
- Destinataires : `loadEntrantManagerIds` — `OWNER` et `MANAGER`
  (`hasTeamManagementRole`, pas le capitaine), joueur d'une entrée solo,
  personne pour une fantôme. `loadNotificationRecipients(…, "certified",
  { matchDm: true })` : message privé au seul tag certifié, coupé par
  « Messages privés Discord de mes matchs » ; le push garde son sujet.
- **Indépendant du push** (pas de garde `webPushConfig`). Bot injoignable : le
  push part, pm2 dit combien de comptes n'ont pas reçu le message
  (`[lobby-brief] bot injoignable`), **sans nouvel essai**. Une panne de lecture
  des casters ou des arbitres envoie le brief sans ces lignes. Une panne avant
  tout envoi (réservation, lecture des managers) **rend les réservations
  prises**, en une instruction ; un côté dont les destinataires sont
  illisibles rend **sa seule** réservation, sans gêner les autres : le
  balayage suivant réessaie. Un envoi qui lève garde la sienne (le push et le
  message privé partent ensemble, une partie a pu partir) : jamais deux fois.

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

`tests/lib/shared/lobby-brief.test.ts` (textes FR/EN, solo sans pseudo,
neutralisation, push, sujet, registre), `tests/lib/server/lobby-brief.test.ts`
(requête, réservation, destinataires, fantôme, solo, hôte/tête de série,
cast, arbitre inéligible, bot injoignable, pannes, étranglement),
`notify.test.ts` (`loadEntrantManagerIds`).

## Cartes par manche

Une manche peut imposer ses cartes ou ouvrir des pools, et le tournoi porte ses règles de ban (ordre, perdant de la carte précédente) : `ROUND_MAPS.md`.
