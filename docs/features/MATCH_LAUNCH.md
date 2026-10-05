# Lancement d'un match — état « LANCEMENT », trois « Prêt », modale globale

## Ce que ça change

Un match jouable ne se joue plus d'emblée. À son **heure de début** — ou dès
qu'il devient jouable s'il n'a pas d'horaire — il entre en **lancement** :

- une **modale** s'ouvre d'elle-même, sur **n'importe quelle page du site**,
  pour les joueurs des deux engagées et le caster inscrit ;
- elle présente la rencontre (« Équipe 1 VS Équipe 2 », nom du tournoi),
  **met en avant l'équipe qui héberge la partie**, et donne les contacts d'un ou
  deux joueurs par équipe et ceux du caster ;
- chaque partie — les deux équipes, et le caster s'il y en a un — clique
  **« Prêt »** (avec confirmation ; un second clic l'annule) ;
- le match est **lancé** quand toutes les parties attendues sont prêtes, quand
  l'arbitrage le force, ou d'office après **15 minutes**.

Tant qu'il n'est pas lancé, les engagés ne peuvent pas y reporter de score
(`MATCH_NOT_LAUNCHED` → 409). L'arbitrage garde la main (forfait d'une partie
absente, correction) : son chemin n'est pas concerné.

## L'état n'est pas un statut

`bg_matches.status` garde ses quatre valeurs (`PENDING → READY →
AWAITING_CONFIRMATION → COMPLETED`). Une douzaine de chemins du moteur écrivent
`READY` ; un statut de plus les aurait tous obligés à choisir entre deux valeurs
pour « jouable ». La phase de lancement se **dérive**, comme l'état d'antenne
d'une diffusion (`matchLaunchPhase`, `lib/shared/match-launch.ts`) :

| Phase | Condition |
|---|---|
| `NONE` | `PENDING`, `COMPLETED`, ou une case vide (exemption) |
| `TO_PLAN` (« À planifier ») | `READY`, **aucune** heure, et le tournoi fait planifier ses matchs par l'arbitrage (`referee_scheduling`, voir `MATCH_PLANNING.md`) |
| `SCHEDULED` (« En attente de départ ») | `READY`, heure de début dans le futur |
| `LOBBY` (« Lancement ») | `READY`, heure atteinte ou absente (option éteinte), `launched_at` vide |
| `LAUNCHED` | `launched_at` posé, ou report déjà en attente (`AWAITING_CONFIRMATION`) |

Le passage `SCHEDULED → LOBBY` ne tient qu'à l'horloge : `useMatchLaunchPhase`
pose un unique `setTimeout` sur l'heure de début, et la modale globale se relit à
la seconde dite. Toutes les autres bascules sont des écritures, que le flux SSE
annonce — la sortie de `TO_PLAN` comprise, qui n'arrive que par la date que
l'arbitrage pose.

**Aucun score avant le lancement**, arbitrage compris : `TO_PLAN` et `SCHEDULED`
ferment la saisie d'un score (`isScoreEntryOpen`, `MATCH_NOT_IN_LAUNCH` → 409
côté arbitrage) ; le forfait reste ouvert. Voir `MATCH_PLANNING.md`.

## Colonnes

`bg_matches` : `host_team_id`, `caster_user_id`, `lobby_opened_at`,
`launch_pairing`, `launched_at`, `team1_ready_at`, `team2_ready_at`,
`caster_ready_at`.

- **`launch_pairing` rattache l'état à un appariement** (`"team1:team2"`,
  `launchPairingKey`). Le moteur réécrit parfois les équipes d'un match **sur
  place** — arbre de play-offs d'une BG Survie réparé après une correction,
  créneau d'élimination vidé puis regarni. Sans empreinte, la nouvelle équipe
  héritait du « Prêt » de l'ancienne, et un match lancé d'office sans saisie
  restait lancé pour un appariement qui n'avait jamais été appelé. À la lecture,
  `currentLaunchState` ignore tout état posé pour une autre paire ; à l'écriture,
  `adoptCurrentPairing` l'efface en base avant d'écrire l'empreinte neuve. Le
  caster, lui, reste : il s'est inscrit sur le match, pas sur un appariement.

- `host_team_id` `NULL` = équipe 1 ; une valeur qui ne désigne plus une des deux
  engagées (appariement corrigé) retombe aussi sur l'équipe 1
  (`resolveHostTeamId`).
- `lobby_opened_at` est posé à la **première observation** du lancement
  (entretien du tournoi, premier « Prêt », ou lecture de la modale) : c'est
  l'origine du délai de lancement d'office.
- Au déploiement, les matchs déjà jouables — sans horaire ou à l'horaire
  passé, et ceux dont un report attend — sont posés **lancés** : une rencontre
  en cours ne doit pas se voir refuser son score. Un match programmé plus tard
  n'est pas touché et passera par son lancement à l'heure dite. Le remplissage ne
  suit que l'ajout effectif de la colonne (`docs/DATABASE_SCHEMA.md`).

## Qui clique « Prêt »

- **Équipe** : un membre en cours portant `CAPITAINE`, `MANAGER` ou `OWNER`
  (`canDeclareTeamReady`). Les autres joueurs voient la modale et l'attente.
- **Entrée solo** : le joueur lui-même.
- **Caster** : celui qui est inscrit sur le match.
- **Fantôme** : prête d'office — personne ne cliquerait pour elle.

Sans caster inscrit, les deux équipes suffisent. Le « Prêt » se retire tant que
le match n'est pas lancé ; une fois parti, il l'est.

## Lancement d'office

`maintainMatchLaunches` (appelé par `syncTournamentState` pour tout tournoi en
cours, et par la lecture de la modale) pose `lobby_opened_at`, lance les matchs
dont toutes les parties sont prêtes — deux fantômes le sont d'office — et ceux
dont le délai de 15 minutes (`LAUNCH_AUTO_DELAY_MINUTES`) est écoulé.
`sync-scope.ts` en fait une tâche due (`EXISTS` sur un lancement non ouvert ou
échu), si bien que le balayage passif le rattrape même sans lecteur — jamais un
match à planifier, qui n'a rien à entretenir. La salle du flux SSE se réveille
d'elle-même à l'heure de départ d'un match en attente et à son lancement
d'office (`nextRoomWakeAt`), au lieu d'attendre son filet de cinq minutes.

## S'inscrire pour caster

Bouton **« 🎙 Caster »** sur la carte d'un match, pour la permission `live`.
Trois conditions de plus que la permission :

- tag Discord **certifié** **et** compte Battle.net **rattaché**
  (`castBlockReason` — refus `CASTER_IDENTITY_REQUIRED`) : le caster se présente
  aux deux équipes, un tag saisi à la main ne dirait rien de qui l'on invite
  dans son salon. Le bouton reste visible mais annonce ce qui manque, plutôt que
  de mener à un 409 ;
- un joueur du match ne le caste pas (`CASTER_IS_PLAYER`). L'inscription se
  fait aussi sur un match aux créneaux encore vides, où rien ne peut être
  vérifié : quand l'appariement arrive et compte l'équipe du caster, son
  inscription est retirée (`adoptCurrentPairing`), et d'ici là le rôle de joueur
  prime partout (`resolveMatchParty`) ;
- un seul caster par match (`MATCH_ALREADY_CASTED`) — sauf si le titulaire ne
  remplit plus la condition du cast et que le match n'est pas lancé : sa place
  est alors reprise par le nouvel inscrit. L'instantané du plateau le tait
  déjà (`casterWithdrawn`, sur la condition relue par la même jointure que son
  pseudo), si bien que la carte rouvre « 🎙 Caster » — au prochain instantané :
  retirer un rôle ne publie aucun évènement de tournoi.

Rien d'autre n'est exigé : tout porteur de `live` peut caster n'importe quel
match non terminé et en recevoir les contacts — droit de diffusion
confié par le staff, exposition déclarée (`PRIVACY_CHANGES`
`2026-09-lancement-des-matchs`, registre T04). La condition vaut **tant que
dure l'inscription**, pas seulement à l'inscription : un caster qui perd `live`,
décertifie son tag, détache Battle.net ou supprime son compte ne reçoit plus
aucun contact. `GET /api/me/match-launches` la rejoue à chaque lecture
(`castEligibilityBlock`, sur les rôles et l'identité **relus en base**) — qu'il
la fasse lui-même ou qu'un joueur du match la fasse : le caster disparaît de la
réponse, et son inscription est ensuite retirée (`releaseIneligibleCast`, sous
verrou et après relecture — un compte redevenu éligible entre-temps garde la
sienne), si bien que le lancement n'attend plus son « Prêt ». Sur un match
**déjà lancé**, rien n'attend plus : l'inscription reste (on ne retire pas un
caster en pleine diffusion pour un tag retouché), seuls ses contacts sont tus. Les deux autres
chemins d'un caster suivent la même règle (`lib/server/tournaments/cast-eligibility.ts`) :
son « Prêt » est refusé (`resolveMatchParty` → `NOT_MATCH_PARTY`) et le
balayage des notifications ne l'appelle plus au départ du match. Voir
`docs/AUTHORIZATION_RULES.md` §4.5.

Le motif voyage dans `TournamentViewerContext.castBlock`, par les deux portes
(flux et lecture REST). L'ancien libellé « ＋ Caster » du bandeau de diffusion,
qui ouvrait la configuration du stream, devient « ＋ Live » (aujourd'hui « Diffuser ce match ») : deux boutons
« Caster » sur la même carte auraient désigné deux gestes différents.

Un compte supprimé (anonymisé) perd son inscription sur les matchs non joués ;
l'effacement complet la retire par la clé étrangère (`SET NULL`).

## Les contacts présentés

`pickLaunchContacts` choisit, par équipe :

1. un joueur dont le tag Discord **ou** le BattleTag est vérifié passe devant
   tous les autres, **quel que soit le rôle** ;
2. puis le rôle : capitaine, manager, propriétaire, un joueur ;
3. si le premier n'a qu'**une** des deux vérifications, un second joueur porteur
   de l'autre est ajouté — pour avoir à la fois le contact et le profil de jeu ;
4. sans aucune vérification dans le roster, le premier par rôle est présenté
   avec son BattleTag marqué « non vérifié ». Un tag Discord **non certifié**
   n'est jamais montré (`canViewDiscordTag`).

Une fantôme n'a pas de contact. Un match `SCHEDULED` n'expose encore rien.

## Exposition

Les contacts ne sortent que par `GET /api/me/match-launches`, pour les seules
parties du match, et seulement **en lancement ou lancé** : c'est la clause
`sharesMatchLobby` de `canViewDiscordTag` (ajoutée pour l'occasion, après
« non certifié → personne ») et `sharesLiveMatch` de `canViewBattletag`, que
seul ce module établit. Rien n'entre dans `TournamentSnapshot`, diffusé à tous
les abonnés du flux : l'instantané ne porte que les « Prêt », l'hôte et le
**pseudo** du caster, publics comme tout pseudo du site.

Le caster compte parmi les parties : il reçoit le BattleTag **masqué** des
contacts, et les équipes le sien. `docs/AUTHORIZATION_RULES.md` §2.3 l'écrit
comme une ligne à part, distincte de la permission `casting`, qui n'ouvre
rien sur la fiche d'un joueur.

Changement déclaré dans `PRIVACY_CHANGES` (`2026-09-lancement-des-matchs`),
`/rgpd` et le registre des traitements (T04).

## Interface

- **Modale globale** — `components/match-launch/MatchLaunchCenter.tsx`, montée
  par `app/layout.tsx` pour tout compte connecté. Interrogation à 8 s pendant un
  lancement, 30 s pendant un match, 60 s sinon ; suspendue onglet caché
  (`useClientPower().clocks`). Sur la fiche d'un tournoi, elle n'attend pas sa
  relève : le flux signale chaque changement d'une rencontre du lecteur —
  joueur **ou** caster ; lobby, « Prêt », lancement — par
  `MATCH_LAUNCH_REFRESH_EVENT` (`viewerLaunchChanged`,
  `lib/shared/viewer-alerts.ts`), regroupé à 300 ms en une lecture. Une réponse
  plus ancienne que celle déjà affichée est ignorée (numéro de séquence), et un
  changement de cadence ne relance plus de lecture en double. Elle s'ouvre d'office au lancement puis au départ
  (annonce, dix minutes), une fois par phase et par session ; fermée, elle laisse
  une pastille pour la rouvrir. Au-dessus du recrutement (1200), sous les
  changements de confidentialité (1300) — et **elle attend** qu'un choix de
  confidentialité dû soit fait (`launchModalWaits`, signal
  `PRIVACY_CHANGES_ANSWERED_EVENT`) : ouvertes ensemble, la modale de lancement,
  empilée en dernier, prenait le piège de focus sous l'autre. Sur téléphone,
  la barre d'actions (« Prêt », « Voir le match », « Fermer ») et la
  confirmation restent **au bas** de la modale, hors de la zone qui défile (une
  `ScrollArea` porte en-tête, fiches et notifications) : les fiches contacts la
  poussaient sous la ligne de flottaison. Pas de `position: sticky` — collée,
  la barre masquait l'élément focalisé au clavier, et la compenser par un
  `scroll-padding` faisait défiler la modale à l'ouverture. Le focus d'ouverture va au « Prêt » qui **ouvre la confirmation**
  (`data-autofocus`) — jamais à « Prêt — annuler » ni à un lien : la modale
  s'ouvre d'elle-même, parfois pendant une saisie, et un Entrée égaré ne doit
  rien déclencher. Les noms d'équipe des fiches passent à la ligne au lieu
  d'être rognés.
- **Carte de match** — `MatchLaunchStrip` : « Lancement · N/M prêts », hôte,
  caster ; pour les parties, un bouton qui ouvre la modale
  (`MATCH_LAUNCH_OPEN_EVENT`) ; pour l'arbitrage, « Changer l'équipe hôte » et « Forcer le lancement » (menu « Plus d'actions », `MATCH_CARD_LAYOUT.md`).

## Routes

| Route | Qui | Effet |
|---|---|---|
| `GET /api/me/match-launches` | connecté | matchs du lecteur à présenter (voir coût ci-dessous) |
| `POST /api/matches/[id]/ready` | partie du match | `{ ready }` |
| `POST /api/matches/[id]/caster` | `live` + identité vérifiée | s'inscrire |
| `DELETE /api/matches/[id]/caster` | le caster, ou `tournaments` | se retirer / retirer |
| `POST /api/admin/matches/[id]/launch` | `tournaments` | lancer sans attendre |
| `PUT /api/admin/matches/[id]/host` | `tournaments` | `{ teamId \| null }` |

### Coût de l'interrogation

La modale interroge `GET /api/me/match-launches` toutes les minutes sur chaque
onglet visible d'un compte connecté. Chaque appel faisait trois lectures
(appartenances, entrée solo, matchs candidats), même quand aucun tournoi ne se
jouait sur le site. Désormais :

- **aucun tournoi en cours** → aucune lecture propre au lecteur : le drapeau
  « un tournoi est-il en cours ? » est mutualisé avec les listes de tournois
  (`cachedTournamentList("running-exists")`) et vidé avec elles à chaque
  écriture sur un tournoi — un tournoi qui démarre est donc vu aussitôt ;
- **tournois en cours, lecteur sans match** — le cas courant → **une** lecture :
  ses équipes sont lues dans la requête des matchs candidats, et ses rôles ne
  sont relus que s'il en a un.

La cadence d'interrogation, elle, n'a pas changé : l'espacer pour les non-engagés
retarderait la modale au moment précis où un tournoi démarre, et l'appel à vide
ne coûte plus qu'une lecture de session.

## Notes reprises de CLAUDE.md

Texte déplacé tel quel depuis `CLAUDE.md` (allègement du fichier chargé à chaque session).

- **Lancement d'un match — état « LANCEMENT » et trois « Prêt »** (`lib/shared/match-launch.ts` pur + `lib/server/tournaments/match-launch.ts` / `match-launch-info.ts` + `components/match-launch/MatchLaunchCenter.tsx`) : un match jouable ne se joue plus d'emblée. À son heure de début (dès qu'il est jouable s'il n'en a pas), il entre en **lancement** et une **modale s'ouvre sur n'importe quelle page du site** pour les joueurs des deux engagées et le caster inscrit — « Équipe 1 VS Équipe 2 », tournoi, **équipe hôte mise en avant** (`host_team_id`, `NULL` = équipe 1, modifiable par l'arbitrage), contacts d'un ou deux joueurs par équipe et du caster. Chaque partie clique **« Prêt »** (confirmation ; second clic = annulation) : capitaine, manager ou propriétaire pour une équipe, le joueur en individuel, le caster s'il y en a un ; une **fantôme est prête d'office**. Le match est **lancé** quand toutes les parties attendues le sont, quand l'arbitrage le force, ou d'office après 15 min (`maintainMatchLaunches`, branché sur `syncTournamentState` et `sync-scope.ts`) ; **avant, les engagés ne reportent aucun score** (`MATCH_NOT_LAUNCHED` → 409). **L'état n'est pas une valeur de `status`** — l'ENUM est écrit par une douzaine de chemins — mais se dérive (`matchLaunchPhase` : `NONE` / `SCHEDULED` / `LOBBY` / `LAUNCHED`) de `READY`, de l'horaire et de `launched_at` ; au déploiement, les matchs déjà jouables sont posés lancés (remplissage lié à l'ajout effectif de la colonne). Choix des contacts (`pickLaunchContacts`) : un joueur vérifié (Discord **ou** BattleTag) passe devant le rôle, puis capitaine > manager > propriétaire > joueur, et un second joueur est ajouté si le premier n'a qu'une des deux vérifications ; un tag Discord non certifié ne sort jamais, un BattleTag non vérifié sort marqué comme tel. Les contacts ne passent **que** par `GET /api/me/match-launches` (clause `sharesMatchLobby` de `canViewDiscordTag`), jamais par l'instantané. **S'inscrire pour caster** (bouton « 🎙 Caster » de la carte, permission `live`) exige un tag Discord certifié **et** un compte Battle.net rattaché (`castBlockReason`, `CASTER_IDENTITY_REQUIRED` → 409) ; le bouton de configuration de diffusion s'appelle désormais « ＋ Live ». Déclaré dans `PRIVACY_CHANGES`. Voir `docs/features/MATCH_LAUNCH.md`.
