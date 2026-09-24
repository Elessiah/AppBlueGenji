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
| `SCHEDULED` | `READY`, heure de début dans le futur |
| `LOBBY` (« Lancement ») | `READY`, heure atteinte ou absente, `launched_at` vide |
| `LAUNCHED` | `launched_at` posé, ou report déjà en attente (`AWAITING_CONFIRMATION`) |

Le passage `SCHEDULED → LOBBY` ne tient qu'à l'horloge : `useMatchLaunchPhase`
pose un unique `setTimeout` sur l'heure de début, et la modale globale se relit à
la seconde dite. Toutes les autres bascules sont des écritures, que le flux SSE
annonce.

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
- Au déploiement, les matchs déjà jouables sont posés **lancés** — une
  rencontre en cours ne doit pas se voir refuser son score. Le remplissage ne
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
échu), si bien que le balayage passif le rattrape même sans lecteur.

## S'inscrire pour caster

Bouton **« 🎙 Caster »** sur la carte d'un match, pour la permission `live`.
Trois conditions de plus que la permission :

- tag Discord **certifié** **et** compte Battle.net **rattaché**
  (`castBlockReason` — refus `CASTER_IDENTITY_REQUIRED`) : le caster se présente
  aux deux équipes, un tag saisi à la main ne dirait rien de qui l'on invite
  dans son salon. Le bouton reste visible mais annonce ce qui manque, plutôt que
  de mener à un 409 ;
- un joueur du match ne le caste pas (`CASTER_IS_PLAYER`) ;
- un seul caster par match (`MATCH_ALREADY_CASTED`).

Le motif voyage dans `TournamentViewerContext.castBlock`, par les deux portes
(flux et lecture REST). L'ancien libellé « ＋ Caster » du bandeau de diffusion,
qui ouvrait la configuration du stream, devient « ＋ Live » : deux boutons
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

Changement déclaré dans `PRIVACY_CHANGES` (`2026-09-lancement-des-matchs`),
`/rgpd` et le registre des traitements (T04).

## Interface

- **Modale globale** — `components/match-launch/MatchLaunchCenter.tsx`, montée
  par `app/layout.tsx` pour tout compte connecté. Interrogation à 8 s pendant un
  lancement, 30 s pendant un match, 60 s sinon ; suspendue onglet caché
  (`useClientPower().clocks`). Elle s'ouvre d'office au lancement puis au départ
  (annonce, dix minutes), une fois par phase et par session ; fermée, elle laisse
  une pastille pour la rouvrir. Au-dessus du recrutement (1200), sous les
  changements de confidentialité (1300) — et **elle attend** qu'un choix de
  confidentialité dû soit fait (`launchModalWaits`, signal
  `PRIVACY_CHANGES_ANSWERED_EVENT`) : ouvertes ensemble, la modale de lancement,
  empilée en dernier, prenait le piège de focus sous l'autre.
- **Carte de match** — `MatchLaunchStrip` : « Lancement · N/M prêts », hôte,
  caster ; pour les parties, un bouton qui ouvre la modale
  (`MATCH_LAUNCH_OPEN_EVENT`) ; pour l'arbitrage, « ⇄ Hôte » et « ▶ Forcer ».

## Routes

| Route | Qui | Effet |
|---|---|---|
| `GET /api/me/match-launches` | connecté | matchs du lecteur à présenter |
| `POST /api/matches/[id]/ready` | partie du match | `{ ready }` |
| `POST /api/matches/[id]/caster` | `live` + identité vérifiée | s'inscrire |
| `DELETE /api/matches/[id]/caster` | le caster, ou `tournaments` | se retirer / retirer |
| `POST /api/admin/matches/[id]/launch` | `tournaments` | lancer sans attendre |
| `PUT /api/admin/matches/[id]/host` | `tournaments` | `{ teamId \| null }` |
