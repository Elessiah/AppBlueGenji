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
| `referee_ready_at` | son « Prêt », remis à zéro à chaque désignation et quand un report (ou la planification par arbitre) fait quitter le lancement au match |
| `self_managed` | autogestion (`0`/`1`), exclusive de l'arbitre |
| `first_map` | première carte saisie par le staff (64 caractères, `visibleText`) |

## Qui peut arbitrer

`refereeBlockReason(permission, identité, jeu)` : la permission `tournaments`
(`NOT_REFEREE`), un tag Discord certifié **et, en Overwatch seulement**, un
compte Battle.net rattaché (`REFEREE_IDENTITY_REQUIRED`, `identityComplete` ; en
Marvel Rivals, le seul tag Discord manquant se refuse par `REFEREE_DISCORD_REQUIRED` —
`CASTER_DISCORD_REQUIRED` pour caster —, dont le texte ne parle pas de Battle.net) —
en Overwatch, les équipes l'ajoutent en jeu par son BattleTag ; hors Overwatch,
ni BattleTag ni « ajoute-le en jeu » (décision 35) et **aucun Battle.net
demandé** (décision de l'utilisateur, 2026-11-03 : même règle pour caster,
`castBlockReason`). Le jeu est celui du tournoi du match
(`LaunchMatchBaseRow.tournament_game`, `MatchCastExtras.game`) ; les lectures
par lot (`readMatchCasters`, check-in du match) se font par jeu. Conditions
relues en base à chaque geste (`loadRefereeEligibility`, jamais les rôles d'une
session). Il **peut caster** le match, il **ne peut pas le jouer**
(`REFEREE_IS_PLAYER`) : l'inscription comme caster ne refuse que qui joue le
match (`claimMatchCast` → `resolveTeamParty`, jamais `resolveMatchParty`, qui
rendrait l'arbitre `MATCH_REFEREE` — refus `CASTER_IS_PLAYER` corrigé le
2026-11-04) ; il s'inscrit sans « Prêt » de caster (un « Prêt » d'arbitre peut
dater d'un cycle révolu) et son clic suivant, en caster, donne les deux.

Le retrait de l'arbitre (volontaire/staff, d'office, opposition retenue) passe
par un seul assistant, `clearMatchReferee` (`match-launch.ts`) : arbitre et
« Prêt » remis à `NULL`, puis, tournoi en cours, départ d'un match qui ne
l'attendait plus.

La fiche porte `contactsShown` (contacts de l'arbitre ouverts à ce lecteur,
`refereeContactsOpen`) : ouverts mais vides (champ Discord présent et `null`,
pas de BattleTag lisible), `RefereeCard` écrit « Aucun contact disponible. »,
comme la fiche d'un caster. `battletagVerified` ne part qu'avec le BattleTag
lisible, jamais seul ; hors Overwatch, ni l'un ni l'autre n'est même calculé
(`withGameBattletag` reçoit une fonction).

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
| `PUT /api/admin/matches/[id]/referee` | désigner `{ userId }` ou retirer `{ userId: null }` ; `expectedUserId` (l'arbitre que la fenêtre affichait, `null` : aucun) refuse en 409 `REFEREE_CHANGED` un match changé entre-temps — la fenêtre se relit | `tournaments` |
| `PUT /api/admin/matches/[id]/self-management` | autogestion du match `{ enabled }` | `tournaments` |
| `PUT /api/admin/tournaments/[id]/self-management` | autogestion d'une manche entière `{ phaseId, roundNumber, bracket, enabled }` (`INVALID_ROUND`) | `tournaments` |
| `PUT /api/admin/referees/[userId]/objection` | retenir `{ upheld: true }` ou lever `{ upheld: false }` l'opposition d'un arbitre (`INVALID_REFEREE_OBJECTION` ; à la retenue seulement : 404 `USER_NOT_FOUND`, 409 `NOT_REFEREE`) — voir « Opposition retenue » | `tournaments` |
| `PUT /api/admin/matches/[id]/first-map` | première carte `{ map }`, vide = retirer (`INVALID_FIRST_MAP`, rattaché au champ ; 409 `MATCH_NOT_LAUNCHABLE` sur une exemption ; 409 `ROUND_MAPS_SET` quand le tour a des cartes — la fenêtre les montre alors en lecture seule, `ROUND_MAPS.md`) | `tournaments` |

Désigner un arbitre éteint l'autogestion ; l'allumer retire l'arbitre (prévenu,
motif `SELF_MANAGED`). Les erreurs ne portent qu'un code (`fail`), traduites en
toast par `launchErrorText`.

## Opposition retenue

Décision 42b (2026-10-28) : l'arbitre s'oppose (formulaire de signalement,
catégorie RGPD) à être présenté aux parties de ses matchs ; le staff la retient
dans la fenêtre « Arbitrage » (section « Opposition d'un arbitre » : liste des
oppositions retenues avec « Lever » — toutes, même sur un compte qui n'arbitre
plus, pour qu'elles restent levables —, choix d'un arbitre parmi les comptes
`tournaments` puis confirmation). `lib/server/tournaments/referee-objection.ts` :

- `bg_users.referee_objection_at` (date, `NULL` sinon ; `CREATE TABLE` +
  `RECENT_SCHEMA_CHANGES`) — rendu dans l'export (`refereeObjectionAt`), remis
  à `NULL` à l'anonymisation ;
- retenue seulement sur un compte qui a la permission `tournaments`, relue en
  base (409 `NOT_REFEREE` sinon — l'identifiant de la route ne suffit pas) ;
  la levée vaut pour tout compte qui en porte une ;
- retenue : l'arbitre est retiré de **tous** ses matchs non terminés (tout
  statut sauf `COMPLETED`, score en attente de confirmation compris), lancés
  compris (`releaseObjectingReferee`, un match par transaction sous
  `lockLaunchMatch`, un match qui n'attendait que lui part) ; avis push
  `REFEREE_RELEASED` motif `OBJECTION`, **aucune** ligne Discord par match
  (nommer les matchs juste avant la ligne de l'opposition désignerait leur
  arbitre) ; les matchs terminés gardent leur arbitre ; le staff en désigne un autre ;
- tant qu'elle tient : ni « Je prends ce match » ni désignation
  (`REFEREE_OBJECTION`, 409, contrôlé dans `writeReferee` et sur une
  re-désignation du même arbitre), absent des candidats, bouton « Arbitrer ce
  match » caché ; le verrou du lancement (`lockLaunchMatch`) ne le compte plus
  (le lancement ne l'attend pas, un autre peut prendre le match) ; le cast
  reste ouvert ;
- levée, à sa seule demande (même formulaire ; « Lever » passe par une
  confirmation qui le rappelle) : il peut de nouveau arbitrer, rien ne lui est
  rendu ;
- journal : `publishStaffAction`, une seule ligne Discord (« un arbitre »,
  « le staff », sans nombre de matchs) ; auteur, `#id` de l'arbitre et nombre
  de matchs retirés dans pm2, sur un vrai changement ou un
  balayage rejoué qui retire encore un match. La ligne dit « déjà retenue,
  balayage rejoué » quand l'opposition était déjà écrite, et « retrait
  incomplet, à rejouer » quand un match n'a pas pu être retiré ; l'échec d'un
  retrait s'écrit dans pm2 **sans numéro de match** (pm2 porte déjà le `#id`
  de l'arbitre). La levée répond 200 que le compte existe ou non (pas de
  sondage des identifiants) et l'identifiant de la route se lit en décimal
  strict.

Concurrence : l'écriture de l'opposition est une instruction seule (verrou
exclusif sur la ligne du compte) ; `writeReferee` lit l'opposition en
`LOCK IN SHARE MODE` sous le verrou du match. Une prise concurrente passe donc
avant (et le balayage, lancé après l'écriture, voit le match) ou après (et
elle est refusée). Une transaction par match plutôt qu'une pour tous : ses
matchs couvrent plusieurs tournois, et tenir tous leurs verrous le temps du
balayage bloquerait le maintien des lancements, qui en prend un à la fois. Le
balayage est rejouable : une opposition déjà retenue reste proposée au
formulaire, la retenir de nouveau refait le tour. Un échec sur un match
n'arrête pas les autres ; il est compté, et la route répond 500
(`REFEREE_OBJECTION_FAILED`) **après** le journal. `releaseObjectingReferee`
relit l'opposition sous le verrou du match (ordre match puis compte, celui de
`writeReferee`) : levée pendant le balayage, elle ne retire plus rien.
L'instantané (`refereeKept`, jointure `referee_objection_at`), la lecture de la
modale (`keepEligibleReferees`) et le check-in du match (`loadEligibleRefereeIds`)
relisent aussi l'opposition : un balayage resté incomplet ne laisse pas
l'arbitre visible d'un match à jouer — ni rôle `MATCH_REFEREE`, ni contacts
des casters, ni nom aux parties —, et la lecture de la modale rattrape le
retrait (`releaseObjectingReferee`, lancé compris). Une reprise du match par un
autre arbitre (« Je prends ce match ») ou ce rattrapage ne sont pas le balayage :
la ligne du match part dans `staff-removal`, au motif générique « condition
d'arbitrage » (`INELIGIBLE`, `takenOver`), qui ne dit pas l'opposition ; l'avis
à l'arbitre garde le motif `OBJECTION`. Un retrait en série ne remet ses matchs
partis sans arbitre (`undecided`) qu'une fois chaque transaction validée : une
tentative défaite n'est pas signalée.

## « Prêt » : une quatrième partie

L'arbitre désigné est une partie du lancement (`LaunchViewerRole`
`MATCH_REFEREE`) : son « Prêt » est attendu avec ceux des deux équipes et de
chaque caster (`readyCount` / `allPartiesReady`, `referee: { ready } | null`).
Sans arbitre, rien n'est attendu de plus. L'auto-lancement à l'échéance du
lobby reste inchangé. Un arbitre qui caste aussi le match donne les deux
« Prêt » d'un clic et ne compte qu'**une** fois dans « N/M prêts » de la
fenêtre de lancement (`readyCount` reconnaît son `userId` parmi les casters) ; un caster déjà prêt qui devient arbitre garde ce « Prêt »
(`writeReferee`). Un match joué ou exempt garde son arbitre : ni retrait ni
remplacement (`assertRefereeable`, retrait compris).

## Hôte et premier ban

`matchHostTeamId` : l'hôte choisi par le staff s'il joue encore le match ;
sinon, en **BlueGenji Survie, phase finale**, la meilleure tête de série (rang
d'endurance, `match-host-seeds.ts`, jointures partagées par l'instantané et la
modale) ; sinon l'équipe 1. L'hôte joue à **gauche** ; l'autre équipe
**bannit la première** (`firstBanTeamId`, `null` tant qu'un adversaire manque).

**Quand un arbitre désigné crée la partie** (CAST-FOLLOWUP), l'équipe qui
n'est **pas** la meilleure tête de série bannit la première, quelle que soit
la règle de ban du tournoi (`refereeHostedFirstBanTeamId`,
`lib/shared/match-referee.ts`, posé dans l'instantané par `_internal.ts` ;
`applyMapRules` garde ce choix pour un match `refereeAssigned`). La page du
match l'explique derrière un `InfoHint` (`roundMaps.page.refereeHostBan`, FR/EN).
Un match arbitré **déjà joué** (`COMPLETED`) n'affirme aucun premier ban
(`firstBanTeamId` nul) : l'ordre réellement suivi n'est pas gardé, et la
règle a changé avec l'arbitre hôte.

## Ce que chacun voit

- **Instantané public** (`TournamentSnapshot`) : `refereeAssigned`,
  `selfManaged`, `firstMap`, `hostTeamId`, `firstBanTeamId` et une empreinte
  opaque `refereeKey` (HMAC à secret aléatoire du processus sur
  `matchId:userId`, 16 caractères, `referee-names.ts`), `null` sans arbitre
  éligible, pour un match terminé (`COMPLETED`) et pour tout match d'un
  tournoi terminé (`withoutRefereeKeys`, `snapshot.ts` — un match resté non
  joué ne nomme pas son arbitre indéfiniment). L'empreinte d'un score en
  attente de confirmation reste (relève de la fenêtre « Contacts » quand
  l'arbitre change), mais le pseudo aux membres ne se montre que pour
  `PENDING`/`READY` (`showsRefereeName`, client et `loadRefereeNames`) —
  textes RGPD « jusqu'à la déclaration de son score ou la fin du tournoi ».
  **Jamais de nom** dans l'instantané ;
  plus de `refereeReady` (décision 47) : le « Prêt » de l'arbitre ne se lit
  que dans `MatchLaunchInfo` (parties, staff). La fenêtre « Contacts » relit
  toutes les 10 s en lobby tant qu'un arbitre n'est pas prêt
  (`refereeReadyRereadDue`, `useClientPower().clocks`).
- **Membre connecté** : `TournamentViewerContext.refereeNames`
  (`{ matchId, refereeKey, pseudo }`, `loadRefereeNames`, cache 30 s par
  version, lecture des seuls matchs montrés) — le bandeau et la page du match lisent « Arbitre : <pseudo> »
  (`refereeNameOf`, pseudo par `visibleText`), sinon « Arbitre désigné ».
  Le contexte n'arrivant qu'à la connexion SSE ou par le GET REST, une
  empreinte sans nom (`missingRefereeNamesKey`) déclenche une seule relecture
  de `GET /api/tournaments/[id]/referee-names` (session requise, étalée sur
  2 s) ; `live-state.ts` garde les noms d'un instantané à l'autre, **élagués
  aux matchs qui les montrent** (`pruneRefereeNames` : le pseudo d'un match
  dont le score vient d'être déclaré quitte l'état du client sans attendre la
  reconnexion ; l'essai de relecture est oublié dès que plus rien ne manque,
  pour qu'un score rejeté — même empreinte — relise le pseudo). Les deux portes passent par `getTournamentViewerContext`, où
  une lecture des pseudos en panne rend une liste vide (journalisée) au lieu de
  faire échouer le flux ou la lecture REST. Jamais le pseudo d'un
  compte supprimé ni d'un arbitre dont l'opposition est retenue (filtre SQL
  de `loadRefereeNames`) : pendant le retrait de ses matchs, ou si ce
  balayage échoue en partie, le match reste « Arbitre désigné ».
- **Visiteur sans compte, `/suivre`** : `spectatorSnapshot` vide
  `refereeKey`, `SPECTATOR_VIEWER_CONTEXT.refereeNames = []` — « Arbitre
  désigné » seulement. Le bandeau dit « Autogestion » à tous, « Sans
  arbitre » au staff seul (`refereeStripState`).
- **Parties du match** (deux équipes, casters) : `MatchLaunchInfo.referee` —
  pseudo, « Prêt », et — **en Overwatch seulement**, champ absent ailleurs
  (`withGameBattletag`, décision 35) — BattleTag (même masqué, `sharesLiveMatch`) **seulement
  quand les contacts du match sont ouverts** (`ctx.exposes` : dès que les deux
  adversaires sont connus pour les équipes et le staff, le temps du match pour
  les casters ; un arbitre qui caste aussi le match attend le départ,
  `refereeContactsOpen`). Son tag Discord certifié, par la lecture d'**un** match
  seulement (fenêtre « Contacts », page du match) et aux seules parties du
  match — jamais au rôle `REFEREE` ni dans la modale de lancement
  (`MATCH_PAGE_CONNECT.md`). L'arbitre désigné (`MATCH_REFEREE`) lit les
  contacts des casters dès la phase de lancement, comme l'arbitre de plateforme
  (`exposesCasterContacts`). Carte `RefereeCard`
  (`LaunchContactCards.tsx`), dans la modale de lancement et la fenêtre
  « Contacts ».
- **Staff** : la fenêtre « Arbitrage » (action « Arbitrage » de la carte,
  `showReferee` = `canSchedule`, match à jouer, jamais un bye). Ses comptes
  désignables écartent les joueurs du match (membres en cours et entrée solo
  des deux engagés) ; l'arbitre en place qui le joue désormais, avant le
  départ, s'y lit « ne peut plus arbitrer » — la règle du bandeau
  (`refereeKept`). Champs habillés par `.field` ; la carte saisie survit aux
  autres gestes ; au retour d'un geste, le focus revient à son contrôle, ou à
  la phrase d'état quand le geste a retiré son bouton (`refereeFocusTarget`) ;
  à l'arrivée du panneau, le focus passe de « Fermer » à la phrase d'état.
  Le panneau (`loadRefereePanel(matchId, lecteur)`) dit aussi pourquoi
  l'arbitre en place ne peut plus arbitrer (`reason` : rôle retiré, identité
  à certifier, joueur du match, opposition retenue, compte supprimé —
  `RefereeIneligibility`, traduit FR/EN), ce qui empêche le **lecteur**
  d'arbitrer (`viewerBlock` : « Arbitrer ce match » n'est offert qu'à qui le
  peut, les autres lisent le message du refus) et l'état de la manche (matchs
  encore à jouer, en autogestion, arbitrés) : « Toute la manche en
  autogestion » et « Lever l'autogestion de la manche » ne s'offrent que s'ils
  changent quelque chose (sinon « Rien à changer », en notification neutre
  `showInfo`, sans rafraîchissement ni relecture du panneau). Sans autre compte
  désignable, une phrase le dit à la place de la liste ; le choix se vide
  après « Désigner ». Les confirmations ne prennent le ton `danger` que pour
  un geste qui retire quelqu'un (`refereeConfirmTone`) : une opposition ne
  l'a que si l'arbitre visé arbitre un match non terminé (`objectable[].busy`,
  lu tous tournois confondus). L'opposition ne part que pour un arbitre encore
  proposé par le panneau relu (`objectionOffered`), et le pseudo du titre
  d'une confirmation d'opposition est figé à son ouverture. La liste des
  cartes du tour porte le nom de son titre (`aria-labelledby`) ; le bouton
  « Enregistrer la carte » partage la ligne de la saisie, l'erreur de champ
  dessous.

## Annonces

- **Check-in du match** à tous les joueurs des deux engagées, 15 minutes avant
  le coup d'envoi (à défaut d'horaire, à l'ouverture du salon) : vocal d'équipe
  et salon de check-in, hôte à gauche, droite, qui crée la partie, paramètres
  de partie, déroulé des maps et bans, cast, saisie des scores
  (`MATCH_LOBBY_BRIEF.md`).

- **Journal du staff** (`formatRefereeChangeLog`) : prise, désignation,
  remplacement, retrait (par lui-même, par le staff, d'office), autogestion,
  première carte — **sans nommer l'arbitre ni le staff**, noms d'équipe (« un
  joueur » en tournoi individuel). L'autogestion d'une manche fait **une
  ligne** (`formatRoundSelfManagementLog`), pas une par match — « Manche N »
  sans tableau quand elle touche plusieurs tableaux. Elle verrouille le tournoi
  puis verrouille ses matchs par clé primaire (identifiants lus d'abord, sans
  verrou : aucun intervalle d'index pris aux autres manches), et ses avis
  partent l'un après l'autre (`announceRefereeChanges`). Un match listé déjà
  joué à l'envoi n'est ni listé ni compté.
- **Avis à l'arbitre retiré** par un autre que lui : sujet push
  `REFEREE_RELEASED` (audience `tournaments`), **push seul**, jamais de message
  privé, avec le motif (`STAFF`, `REPLACED`, `SELF_MANAGED`, `OBJECTION`, `INELIGIBLE`,
  `JOINED_TEAM`). L'auteur du geste n'est jamais prévenu de son propre
  retrait (`actorId` : un arbitre-staff qui se remplace ou passe son match en
  autogestion). Une reprise par « Je prends ce match » donne le vrai motif :
  `OBJECTION`, `JOINED_TEAM` ou `INELIGIBLE`. File d'après commit `queueRefereeChange` /
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
  - manche mixte : chaque match planifié a la sienne, les autres sont groupés ;
  - une alerte de suite qui ne réserve **qu'un** match prend le texte et
    l'étiquette push d'un match ; un match listé disparu entre la file et
    l'envoi — joué, arbitré ou passé en autogestion entre-temps — rend sa
    réservation, et le total « et N autres » ne compte que les matchs encore à
    jouer sans arbitre ni autogestion (les autres rendent aussi la leur) ;
  - jamais sans phase de lancement (le match part à la passe qui le verrait)
    ni contre une équipe fantôme ; les réservations déjà posées se lisent en
    une requête par passe (`withoutReservedAlerts`) ;
  - un match qui part sans arbitre parce qu'on vient de le retirer avertit de
    même (`launchIfAllReady`) ; un retrait en série (opposition retenue,
    lecture des contacts) recueille ces matchs et les signale ensemble à la
    fin, regroupés par manche (`queueDeferredNoRefereeAlerts`) ;
  - une lecture des réservations en échec (table absente, verrou dépassé) ne
    défait pas le geste : la réservation tranche.
  Noms d'équipe sur Discord, « un joueur » pour une entrée solo.

## Seed

`applyMatchLaunchCases` : la première manche castée de chaque tournoi à
lancement reçoit tour à tour `SEED_REFEREE_CASES` — `Test_Arbitre` désigné
avec la carte `SEED_FIRST_MAP`, autogestion, ou sans décision.

## RGPD

Registre T04 (présentation de l'arbitre aux parties, « Prêt », avis push),
T12 (avis push « Arbitrage retiré ») et T05 (journal), `/rgpd#arbitre-designe`
et la ligne BattleTag de `/rgpd` (finalité et portée « Exécution du contrat »
de l'arbitre), les listes « BattleTag masqué » (profil,
connexion, fiche joueur, clé `asReferee`) et la modale de masquage, entrée
`2026-10-arbitre-designe-des-matchs`. Base (TERMS v7, décision de
l'utilisateur du 2026-10-27) : **exécution du contrat** pour la présentation
de l'arbitre aux parties (pseudo et BattleTag, portée
`REFEREE_BATTLETAG_SCOPE` sur la ligne BattleTag de `/rgpd`) une fois que cet
arbitre a accepté la version 7 des conditions ou une suivante, dont la section « Contacts de
match » la prévoit ; **tant qu'il ne l'a pas acceptée**, intérêt légitime,
avec une opposition par le formulaire de signalement (portée
`REFEREE_BATTLETAG_BEFORE_V7_SCOPE`, droit d'opposition de `/rgpd`, T01 et
T04) — aucun interrupteur dans le code, le texte seul le dit. Il peut se
retirer d'un match à tout moment, le staff pouvant lui confier de nouveau ce
match, sans avis ; exécution du service (les arbitres agissant pour
l'association) pour son « Prêt » et l'avis du retrait. L'entrée
`2026-10-arbitre-designe-des-matchs` (intérêt légitime, opposition), datée du
2026-10-29, a été rectifiée en place avant sa publication (EF-19, #501). Une
opposition retenue le retire de tous ses matchs non terminés et lui ferme
l'arbitrage (« Opposition retenue », lot REFEREE-OBJECTION, décision 42b) :
T04, `/rgpd`, les portées `_BEFORE_V7_SCOPE` le disent, et l'entrée
rectificative `2026-10-opposition-arbitre-retrait-des-matchs` (2026-10-30)
remplace, sans les réécrire, les entrées publiées du 2026-10-29 qui disaient
« ceux que tu tiens déjà te restent » ; l'entrée
`2026-10-conditions-v7-casters-et-arbitre` annonce le passage au contrat à
l'acceptation de la version 7. Devenir joueur du match ne retire l'arbitre qu'avant le
lancement (`keepEligibleReferees`) : conditions, `/rgpd` et T04 le disent.
Le pseudo seul de l'arbitre se lit par **tout membre connecté** sur la carte
et la page d'un match non joué (lot MATCH-UI-NAMES, décision 52) : intérêt
légitime, même opposition, même effet ; T04, `/rgpd#arbitre-designe` et
l'entrée `2026-10-pseudo-arbitre-aux-membres` (2026-10-31) le disent, ainsi
que les conditions v8 (« Contacts de match » ; la v7 disait encore « Le
public et les autres joueurs ne lisent que « Arbitre désigné » »).

## Cartes par manche

Une manche peut imposer ses cartes ou ouvrir des pools, et le tournoi porte ses règles de ban (ordre, perdant de la carte précédente) : `ROUND_MAPS.md`.
