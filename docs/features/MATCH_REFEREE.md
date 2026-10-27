# Arbitre désigné d'un match (MATCH-REFEREE MR-2)

Un match peut avoir **un arbitre désigné** — un membre du staff qui le suit en
jeu — ou être passé en **autogestion** par le staff. Sans l'un ni l'autre, il
reste « sans décision » : **rien ne bascule d'office**, le staff est seulement
averti quand le match entre en lancement. Bâti sur le modèle co-casters /
streams de MR-1 (`LIVE_STREAMS.md`, `MATCH_LAUNCH.md`).

Règles pures : `lib/shared/match-referee.ts`. Écritures :
`lib/server/tournaments/match-launch.ts` (bloc « Arbitre désigné »). Avis après
commit : `lib/server/tournaments/referee-notices.ts`. Fenêtre du staff :
`lib/server/tournaments/referee-panel.ts` +
`app/(secured)/tournois/[id]/_components/RefereeDialog.tsx`.

## Schéma

`bg_matches` (dans le `CREATE TABLE` et dans `RECENT_SCHEMA_CHANGES`) :

| Colonne | Rôle |
| --- | --- |
| `referee_user_id` | arbitre désigné, `NULL` sinon ; clé étrangère `ON DELETE SET NULL`, index `idx_bg_matches_referee` |
| `referee_ready_at` | son « Prêt », remis à zéro à chaque désignation |
| `self_managed` | autogestion (`0`/`1`), exclusive de l'arbitre |
| `first_map` | première carte saisie par le staff (64 caractères, `visibleText`) |

## Qui peut arbitrer

`refereeBlockReason` : la permission `tournaments` (`NOT_REFEREE`), un tag
Discord certifié **et** un compte Battle.net rattaché
(`REFEREE_IDENTITY_REQUIRED`) — les équipes l'ajoutent en jeu. Conditions
relues en base à chaque geste (`loadRefereeEligibility`, jamais les rôles d'une
session). Il **peut caster** le match, il **ne peut pas le jouer**
(`REFEREE_IS_PLAYER`).

Un arbitre qui ne remplit plus ces conditions ou qui, avant le départ, joue
désormais le match (roster rejoint, même sans changer d'appariement — le verrou
`lockLaunchMatch` et l'instantané, `referee_plays_match`, appliquent la même
règle) n'est plus montré ni attendu (`refereeEligible`, comme les casters —
`cast-eligibility.ts`) ; s'il est constaté **avant le lancement**, il est
retiré (`releaseIneligibleReferee`, motif `INELIGIBLE` / `JOINED_TEAM`). À
l'anonymisation d'un compte, il est retiré de **tous** ses matchs, joués
compris (`account-erasure.ts`) ; à l'effacement, la clé étrangère s'en charge.

## Gestes

Toutes les écritures prennent le verrou du match (`lockLaunchMatch`) en
première instruction ; un match joué (`MATCH_ALREADY_COMPLETED`) ou exempt
(`MATCH_NOT_LAUNCHABLE`) est refusé.

| Route | Geste | Droit |
| --- | --- | --- |
| `POST /api/matches/[id]/referee` | « Je prends ce match » (`MATCH_ALREADY_REFEREED` si un arbitre éligible le tient ; celui d'un arbitre devenu inéligible est repris) | arbitre éligible |
| `DELETE /api/matches/[id]/referee` | se retirer (`NOT_MATCH_REFEREE`) | l'arbitre lui-même |
| `GET /api/admin/matches/[id]/referee` | fenêtre « Arbitrage » : arbitre nommé, candidats, autogestion, carte, manche | `can(user, "tournaments")` |
| `PUT /api/admin/matches/[id]/referee` | désigner `{ userId }` ou retirer `{ userId: null }` | `tournaments` |
| `PUT /api/admin/matches/[id]/self-management` | autogestion du match `{ enabled }` | `tournaments` |
| `PUT /api/admin/tournaments/[id]/self-management` | autogestion d'une manche entière `{ phaseId, roundNumber, bracket, enabled }` (`INVALID_ROUND`) | `tournaments` |
| `PUT /api/admin/matches/[id]/first-map` | première carte `{ map }`, vide = retirer (`INVALID_FIRST_MAP`, rattaché au champ) | `tournaments` |

Désigner un arbitre éteint l'autogestion ; l'allumer retire l'arbitre (prévenu,
motif `SELF_MANAGED`). Les erreurs ne portent qu'un code (`fail`), traduites en
toast par `launchErrorText`.

## « Prêt » : une quatrième partie

L'arbitre désigné est une partie du lancement (`LaunchViewerRole`
`MATCH_REFEREE`) : son « Prêt » est attendu avec ceux des deux équipes et de
chaque caster (`readyCount` / `allPartiesReady`, `referee: { ready } | null`).
Sans arbitre, rien n'est attendu de plus. L'auto-lancement à l'échéance du
lobby reste inchangé. Un arbitre qui caste aussi le match donne les deux
« Prêt » d'un clic ; un caster déjà prêt qui devient arbitre garde ce « Prêt »
(`writeReferee`). Un match joué ou exempt garde son arbitre : ni retrait ni
remplacement (`assertRefereeable`, retrait compris).

## Hôte et premier ban

`matchHostTeamId` : l'hôte choisi par le staff s'il joue encore le match ;
sinon, en **BlueGenji Survie, phase finale**, la meilleure tête de série (rang
d'endurance, `match-host-seeds.ts`, jointures partagées par l'instantané et la
modale) ; sinon l'équipe 1. L'hôte joue à **gauche** ; l'autre équipe
**bannit la première** (`firstBanTeamId`, `null` tant qu'un adversaire manque).

## Ce que chacun voit

- **Instantané public** (`TournamentSnapshot`) : des booléens seulement —
  `refereeAssigned`, `refereeReady`, `selfManaged`, plus `firstMap`, `hostTeamId`,
  `firstBanTeamId`. Le bandeau de la carte dit « Arbitre désigné » ou
  « Autogestion » à tous, « Sans arbitre » au staff seul (`refereeStripState`).
  **Jamais de nom** dans l'instantané ni dans `TournamentViewerContext`.
- **Parties du match** (deux équipes, casters) : `MatchLaunchInfo.referee` —
  pseudo, « Prêt », et BattleTag (même masqué, `sharesLiveMatch`) **seulement
  quand les contacts du match sont ouverts** (`ctx.exposes` : dès que les deux
  adversaires sont connus pour les équipes et le staff, le temps du match pour
  les casters). Jamais son tag Discord. Carte `RefereeCard`
  (`LaunchContactCards.tsx`), dans la modale de lancement et la fenêtre
  « Contacts ».
- **Staff** : la fenêtre « Arbitrage » (action « Arbitrage » de la carte,
  `showReferee` = `canSchedule`, match à jouer, jamais un bye). Ses comptes
  désignables écartent les joueurs du match (membres en cours et entrée solo
  des deux engagés) ; l'arbitre en place qui le joue désormais, avant le
  départ, s'y lit « ne peut plus arbitrer » — la règle du bandeau
  (`refereeKept`). Champs habillés par `.field` ; la carte saisie survit aux
  autres gestes ; au retour d'un geste, le focus revient à son contrôle, ou à
  la phrase d'état quand le geste a retiré son bouton (`refereeFocusTarget`).

## Annonces

- **Journal du staff** (`formatRefereeChangeLog`) : prise, désignation,
  remplacement, retrait (par lui-même, par le staff, d'office), autogestion,
  première carte — **sans nommer l'arbitre ni le staff**, noms d'équipe (« un
  joueur » en tournoi individuel). L'autogestion d'une manche fait **une
  ligne** (`formatRoundSelfManagementLog`), pas une par match.
- **Avis à l'arbitre retiré** par un autre que lui : sujet push
  `REFEREE_RELEASED` (audience `tournaments`), **push seul**, jamais de message
  privé, avec le motif (`STAFF`, `REPLACED`, `SELF_MANAGED`, `INELIGIBLE`,
  `JOINED_TEAM`). File d'après commit `queueRefereeChange` /
  `flushRefereeChanges`, vidée par `flushBotLogs` et jetée par `discardBotLogs`.
- **Sans arbitre ni autogestion** à l'entrée en lancement : alerte
  `match_no_referee` au canal des arbitres et en push `REFEREE_ALERT`
  (`queueNoRefereeAlerts`, regroupement pur `groupNoRefereeAlerts`) —
  décision du 2026-10-27, les matchs ne se jouant pas tous le même jour :
  - chaque match est réservé **une fois par appariement**, sur sa propre
    ligne (`NO_REFEREE:<appariement>`, `bg_referee_alerts`), qu'il ait une
    heure ou non : poser ou retirer l'heure ne le signale pas deux fois, un
    réappariement le signale de nouveau ;
  - match **planifié** (heure posée) : une alerte par match ;
  - matchs **sans horaire** : **une alerte par manche** (phase, tableau,
    numéro) qui liste ceux qui entrent en lancement ensemble
    (`queueRoundNoRefereeAlert`, `formatRoundNoRefereeAlert`, douze nommés au
    plus puis « et N autres »), une ligne de journal et un push — un match de
    la manche entré en lancement plus tard (tableau à élimination) part dans
    une alerte de suite qui ne liste que lui, jamais ceux déjà signalés ;
  - manche mixte : chaque match planifié a la sienne, les autres sont groupés.
  Noms d'équipe sur Discord, « un joueur » pour une entrée solo.

## Seed

`applyMatchLaunchCases` : la première manche castée de chaque tournoi à
lancement reçoit tour à tour `SEED_REFEREE_CASES` — `Test_Arbitre` désigné
avec la carte `SEED_FIRST_MAP`, autogestion, ou sans décision.

## RGPD

Registre T04 (présentation de l'arbitre aux parties, « Prêt », avis push),
T12 (avis push « Arbitrage retiré ») et T05 (journal), `/rgpd#arbitre-designe`
et la ligne BattleTag de `/rgpd` (finalité et portée « Intérêt légitime »
de l'arbitre), les listes « BattleTag masqué » (profil,
connexion, fiche joueur, clé `asReferee`) et la modale de masquage, entrée
`2026-10-arbitre-designe-des-matchs`. Base : intérêt légitime pour la
présentation de l'arbitre aux parties (pseudo et BattleTag, portée
`REFEREE_BATTLETAG_SCOPE` sur la ligne BattleTag de `/rgpd`), avec une
opposition par le formulaire de signalement (se retirer d'un match l'en retire, le staff pouvant le lui confier de nouveau, sans avis) — le staff peut le désigner
sans qu'il l'ait demandé ; exécution du service (les arbitres agissant pour
l'association) pour son « Prêt » et l'avis du retrait. Les conditions d'utilisation ne changent
pas (version 6) : le registre ne rattache donc pas l'arbitre désigné à une
clause des conditions ; la clause « Contacts de match » le reprendra à la
version 7.
