# Salons vocaux d'équipe (MATCH-VOICE)

Option de tournoi **« Salons vocaux d'équipe »** (`bg_tournaments.team_voice_channels`,
éteinte par défaut) : 15 minutes avant l'heure d'un match, le bot Discord ouvre un
salon vocal de 5 places par équipe. **Le lancement du match n'en dépend pas**
(décision 22 de l'utilisateur, EF-43) : il se lance comme dans tout autre tournoi,
et rien n'est compté.

## Où vit quoi

| Fichier | Rôle |
| --- | --- |
| `lib/shared/match-voice.ts` | Pur : constantes (`VOICE_CHANNEL_LEAD_MINUTES` = 15, `VOICE_CHANNEL_CAPACITY` = 5, `VOICE_ROW_RETENTION_DAYS` = 7, `VOICE_RETRY_SECONDS` = 60, `VOICE_CHANNEL_LATE_HOURS` = 24, durées du bot `VOICE_BOT_*`), clé `match:<matchId>:team:<teamId>`, échéance (`voiceChannelsDue`), option active (`voiceOptionLive` : allumée, tournoi en cours **et** publié — même règle pour l'instantané et la porte REST), suivi (`voiceTracked`), forme publique (`matchVoiceInfo`, `shownVoiceSide`, `parseMatchVoiceInfo`) |
| `app/(secured)/tournois/[id]/_lib/match-voice-view.ts` | Page du match : source qui fait foi entre instantané et relecture REST (`currentMatchVoice`, `voiceStreamKey`), relecture flux coupé seulement (`voicePollActive`, `useMatchVoice`) |
| `lib/server/tournaments/match-voice.ts` | Balayage (`dispatchMatchVoiceChannels`, `DUE_CHANNELS_SQL`, `RELEASABLE_SQL`), bascule (`setTeamVoiceChannels`), lectures (`loadMatchVoiceInfos`, `readMatchVoice`) |
| `lib/server/bot-integration.ts` | `ensureVoiceChannel`, `releaseVoiceChannel`, `releaseVoiceChannelByKey` (`VoiceCallOutcome` : `ok` / `gone` / `failed` — refus propre au salon — / `unavailable` — bot indisponible pour tous les salons, `VOICE_UNAVAILABLE_CODES`, transport, coupe-circuit, réponse illisible) |
| `PUT /api/admin/tournaments/[id]/voice-channels` | Bascule de l'option, permission `tournaments`, jusqu'à la fin du tournoi (y compris en cours ; tournoi terminé : 409 `TOURNAMENT_FINISHED`, comme le formulaire) ; limite par compte (`TEAM_VOICE_TOGGLE_RULE`, 30 par 5 min) ; journalisée comme geste du staff sur un tournoi (`TEAM_VOICE_ON` / `TEAM_VOICE_OFF`, `STAFF_ACTION_LOGS.md` : auteur anonyme, rien dans pm2) quand elle change |
| `POST /api/admin/matches/[matchId]/voice/clear` | **Vider** le salon ouvert d'une équipe (corps `{ teamId }`, décision D13) : le bot en déconnecte tous les occupants, le salon reste ouvert. Permission `tournaments` (l'arbitre du match, et le staff des tournois), jamais pour qui joue ce match (`403 VOICE_CLEAR_IS_PLAYER`, `playsMatchSql` ; le bouton ne lui est pas montré), `VOICE_CLEAR_RULE` (20 par minute et par compte). Refus : `409 VOICE_CHANNEL_NOT_OPEN` (aucun salon ouvert, tournoi plus en cours ou masqué, option éteinte, match plus jouable ou hors de sa fenêtre — reporté, D14 —, équipe sortie du match — `CLEARABLE_CHANNEL_SQL` —, ou le bot ne le suit plus : une passe le redemande), `503 VOICE_CLEAR_UNAVAILABLE` (bot en panne ou refus, une ligne pm2 avec le match et le code ; le bot essaie tous les occupants avant de rendre un refus propre à l'un d'eux, mais s'arrête net sur une permission manquante ou un Discord saturé). Journal : geste du staff `VOICE_CLEARED` (« Salon vocal d'une équipe vidé, par le staff », anonyme sur Discord) ; un membre du staff qui n'est pas l'arbitre désigné du match (colonne `referee_user_id`, quel que soit l'état du match) est nommé dans pm2 (`auditStaffAction`) **avant** l'appel au bot, puis avec son issue (`cleared`, `notOpen`, `unavailable`, `failed` si l'appel lève) ; l'arbitre désigné jamais. Bouton « Vider » sur la page du match, par salon ouvert, confirmé par `ConfirmActionDialog`. Rien n'est écrit en base ; ni qui, ni combien n'est rendu au site |
| `POST /api/matches/[matchId]/voice/clear` | **Vider le salon de sa propre équipe** (décision D36, corps `{ teamId }`) : `OWNER`, `MANAGER` ou `CAPITAINE` (`canDeclareTeamReady`) de l'équipe `teamId` (membre en cours, jamais une entrée solo) — jamais le salon de l'adversaire. Rôle et salon se lisent **en une instruction** (`TEAM_CLEARABLE_CHANNEL_SQL`). Sinon `403 VOICE_CLEAR_NOT_TEAM_LEADER` (non-membre, membre sans ces rôles, équipe adverse, entrée solo), sans rien dire du salon. Puis les mêmes conditions que l'arbitrage (fenêtre de `CLEARABLE_CHANNEL_SQL`, `409 VOICE_CHANNEL_NOT_OPEN`, `503 VOICE_CLEAR_UNAVAILABLE`, `500 VOICE_CLEAR_FAILED`), même débit (`VOICE_CLEAR_RULE`, partagé par compte) ; corps lu par `readVoiceClearRequest`, commun aux deux portes (413 / 415 gardés). Ni journal du staff sur Discord, ni ligne pm2 nommant l'auteur (D15) ; aucune écriture en base, donc aucun verrou de tournoi |
| `GET /api/matches/[matchId]/voice` | Porte REST de secours de `TournamentMatch.voice` (connecté ; tournoi visible selon `canViewTournament`, la règle de sa fiche ; `MATCH_VOICE_READ_RULE`) |
| `bg_match_voice_channels` | Une ligne par (match, équipe) : `channel_id`, `failed_at`, `released_at` — ni qui est présent, ni combien (`members` et `counted_at` retirés, EF-43) |

## Bouton « Vider » (page du match)

`voiceClearRoute` (`match-voice-view.ts`) décide, par salon ouvert, de la porte : l'équipe
(`myTeamId` égal à l'équipe du salon et présent dans `canCreateReportsForTeamIds` — les rôles qui
mènent le match —, tournoi par équipes), sinon l'arbitrage qui ne joue pas ce match, sinon aucun
bouton. Un membre du staff qui joue le match ne voit le bouton que sur le salon de l'équipe qu'il
mène (correctif de #572 : il le voyait sur celui de l'adversaire, puis lisait un 403). Ces droits
viennent du contexte du lecteur, servi par le flux comme par la lecture REST
(`REALTIME_REFRESH.md`) ; fiche figée : aucun bouton.

## Règles

- **Accès aux salons** (décision D13) : les salons héritent des permissions de la catégorie des
  matchs — ouverts à qui la voit. Aucun identifiant Discord de joueur n'est envoyé au bot ; un
  occupant indésirable s'écarte par « Vider » (arbitrage, ou l'équipe pour son propre salon, D36).
- **Aucune donnée d'utilisateur** (décision D15) : ni le site (`bg_match_voice_channels` : match,
  équipe, salon, horodatages) ni le bot (`MatchVoiceChannel` : salon, clé, horodatages) ne
  gardent ni ne journalisent qui est dans un salon, ni combien ; le vidage lit les occupants
  pour les déconnecter, sans rien en garder.
- **Revérification par sondage** (décision D16) : le site redemande les salons ouverts au bot ;
  aucun signal du bot vers le site.

- **Jamais** pour une entrée solo (son nom serait un pseudo) ni une équipe fantôme :
  un match qui en a une n'est pas suivi ; si l'une y entre après coup, les salons
  déjà ouverts sont rendus.
- Nom du salon = nom de l'équipe seul ; aucun pseudo n'est envoyé au bot. Le nom
  passe par `visibleText` (`UNTRUSTED_NAMES.md`) ; si le bot le refuse
  (`INVALID_VOICE_CHANNEL_NAME`), le salon est redemandé sous « Salon d'équipe »
  (`VOICE_FALLBACK_CHANNEL_NAME`).
- **Échéance** : de T−15 min à T+24 h (`VOICE_CHANNEL_LATE_HOURS`) — un match
  oublié bien après son heure n'ouvre plus de salon. et ses salons déjà ouverts sont rendus au bot
  passé ce délai (`RELEASABLE_SQL`), pour que la passe revienne au garde-fou.
- **Balayage** : au plus toutes les 10 s, déclenché par le trafic (listes de
  tournois et `/api/me/match-launches`), sur le pool, **sans connexion tenue pendant
  un appel au bot**. Une passe vérifie d'abord qu'il y a quelque chose à faire
  (`SWEEP_NEEDED_SQL`). Une bascule pendant une passe en demande une de plus
  (`dispatchMatchVoiceChannels(true)`), jouée à la fin de la passe en cours.
- **Salon supprimé à la main** : les salons ouverts des matchs dus sont redemandés au
  bot par leur clé au plus une fois par minute et par salon (`OPEN_DUE_CHANNELS_SQL`) ;
  le bot rend le même, ou un neuf s'il a disparu — jamais qui s'y trouve.
  Un match où entre une entrée solo ou une fantôme n'est plus revérifié (il est rendu).
  Le salon neuf s'écrit par l'upsert de création, qui rouvre une ligne rendue
  entre-temps (autre processus, rechargement pm2) : le salon existe déjà sur
  Discord, la ligne le suit, et le rendu de la même passe (après la revérification)
  le rend au bot avec ses reprises — jamais un salon sans ligne.
- **404 du bot** : seul `VOICE_CHANNEL_NOT_TRACKED` vaut « déjà rendu » ; un autre
  `404` (route absente, `INTERNAL_ROUTE_NOT_FOUND` ; tout autre code, ou un service
  mal routé, devient `BOT_INTERNAL_REQUEST_FAILED`) est une panne du canal : elle
  arrête la passe sans compter au coupe-circuit (partagé par le journal et les
  annonces), la ligne reste ouverte. Un rendu refusé pour `INVALID_CHANNEL_ID` ou `INVALID_VOICE_KEY` clôt la
  ligne (le bot ne suivra jamais cet identifiant ni cette clé) au lieu d'être redemandé sans fin. Un code du bot
  n'est repris que s'il a la forme `[A-Z0-9_]{1,64}` — jamais une phrase.
  Coût borné : la lecture des salons ouverts est sautée tant qu'aucun n'est dû (une
  minute au plus, `nextRecheckAt` ; ses horodatages sont oubliés dès qu'aucun tournoi
  n'a de salon dû) ; un premier appel seul, puis au plus 5 en parallèle, 80 salons par passe (les
  plus anciennement vus d'abord, aucun n'est affamé), arrêt de la passe au premier
  échec du canal du bot (le salon en échec est redemandé après 10 s, derrière les
  salons plus anciennement vus : un salon lent n'ouvre pas chaque passe) ; un salon tout juste créé n'est pas redemandé dans la même passe.
  Fenêtre de 400 salons ouverts : la suivante ne commence après son dernier salon qu'une fois
  tous ses salons dus vérifiés ; une passe arrêtée avant (panne, budget, lot de 80) relit la même
  fenêtre, aucun salon n'est sauté.
  La création, la revérification et le rendu s'arrêtent chacun au premier `unavailable` (la création en panne saute la revérification ; le rendu, indépendant, passe toujours) ; les matchs dont un salon vient d'échouer à la création (ligne sans salon) passent après les autres dans le lot de création. Seul
  `unavailable` — panne du canal ou du bot entier : `BOT_CIRCUIT_OPEN`, `BOT_INTERNAL_UNREACHABLE`,
  `BOT_VOICE_TIMEOUT`, `BOT_INTERNAL_REQUEST_FAILED` (réponse sans code lisible),
  `BOT_VOICE_BAD_RESPONSE` (2xx au corps illisible), et les codes de `VOICE_UNAVAILABLE_CODES` :
  `INTERNAL_ERROR`, `INTERNAL_ROUTE_NOT_FOUND`, `UNAUTHORIZED`, `INTERNAL_API_TOKEN_NOT_CONFIGURED`,
  `DISCORD_NOT_READY`, `VOICE_CATEGORY_UNAVAILABLE`, `VOICE_MISSING_PERMISSIONS`, `VOICE_STORAGE_ERROR`,
  `VOICE_INTERNAL_ERROR`, `VOICE_DISCORD_UNAVAILABLE` (limite de débit 429 ou panne 5xx de Discord, sans code JSON :
  le suivant échouerait de même, d'où l'attente plutôt qu'un appel par salon) — arrête une
  passe, et **aucune passe ne rappelle le bot avant `VOICE_RETRY_SECONDS`** (`botDownUntil`, mémoire du
  processus ; les refus `VOICE_*` ne comptent pas au coupe-circuit partagé). Le refus du bot pour un
  salon (`failed` : autre code, dont `VOICE_DISCORD_ERROR`) ne retient que ce salon : les autres sont
  traités, et il garde son horodatage (redemandé après la minute, jamais en tête de file).
- **Budget d'une passe** : 20 s (`VOICE_PASS_BUDGET_MS`) pour la création et la revérification ;
  contre un bot lent (mais sous son délai), la passe s'arrête là, le rendu passe, la suivante reprend.
  Le budget est lu avant de prendre un salon dans la file : aucun n'en sort sans être vérifié.
- **Passe forcée pendant l'attente** : une bascule (`dispatchMatchVoiceChannels(true)`) pendant
  `botDownUntil` tente quand même le rendu (option éteinte : les noms d'équipes quittent Discord
  sans attendre), **une fois par panne** (`forcedDuringBackoff`) : des bascules répétées ne
  rappellent pas un bot en panne ; création et revérification attendent la fin du délai.
- **Coupe-circuit ouvert** (`BOT_CIRCUIT_OPEN`, journal ou annonces en panne) à la création : le bot
  n'a pas été appelé — ni « indisponible » sur la page, ni ligne pm2 ; la passe s'arrête.
- **Panne du bot** : `failed_at` noté, une ligne pm2 sans donnée de joueur, une
  seule par panne ; création comme rendu réessayés au plus une fois par
  `VOICE_RETRY_SECONDS` (60 s), en fin de file — par équipe : une création échouée
  n'est pas redemandée avant ce délai même quand l'autre équipe ramène le match
  (`team1_ask` / `team2_ask`, calculés par la base dans `DUE_CHANNELS_SQL`, avec
  `team1_failed` / `team2_failed` : panne déjà montrée, pas de seconde ligne pm2). Un rendu
  refusé par le bot donne une ligne pm2 `rendu du salon vocal refusé (CODE)` par salon et
  par code, une revérification refusée `revérification du salon vocal refusée (CODE)` par
  salon et par code, un refus du bot entier (code envoyé par le bot : `VOICE_*`, `UNAUTHORIZED`,
  `INTERNAL_API_TOKEN_NOT_CONFIGURED`… ; jamais un code `BOT_*` du transport ; rendu ou revérification)
  `bot vocal : refus pour tous les salons (CODE)` une seule fois par code, de nouveau dès que le
  bot a répondu pour un salon (mémoire du processus bornée à 1 000 entrées, oubliée à la clôture
  de la ligne) ; une panne du canal n'en donne pas. Une route par clé absente (bot plus ancien)
  ne compte pas comme une réponse du bot : le refus global n'est pas rejournalisé.
- **Refus de rendu sans fin** : une ligne n'est **jamais close** tant que son salon peut encore
  exister (refus ou bot indisponible). Passé `VOICE_BOT_UNRELEASED_MAX_HOURS` (48 h) depuis sa
  création, elle n'est plus redemandée que toutes les `VOICE_STUCK_RETRY_SECONDS` (1 h, attente
  bornée calculée par la base dans `RELEASABLE_SQL`) au lieu de chaque minute, avec une seule ligne
  pm2 `salon vocal toujours pas rendu après 48 h (nouvel essai toutes les 1 h)` par salon ; un bot
  indisponible arrête la passe (les lignes suivantes attendent). Seul un refus **propre au salon**
  mène à l'attente d'une heure : une panne du bot entier (`unavailable` : limite de débit,
  transport, stockage) garde l'attente courte (`failed_wide = 1`, jugé par `RELEASABLE_SQL` à la
  relecture : une ligne qui passe les 48 h entre-temps n'y perd rien ; `failed_at` reste l'heure
  vraie de l'échec) et ne donne pas la ligne pm2 « toujours pas rendu », et un coupe-circuit
  ouvert (`BOT_CIRCUIT_OPEN`, bot jamais appelé) n'écrit rien. `created_at`
  repart quand la ligne est rouverte ou que le salon change.
- **Une seule horloge** : l'option (publication du tournoi) et l'échéance des salons se jugent sur
  l'heure de la base (`NOW()` : lue par `loadTournamentVoiceInfos` dans la même requête que les
  salons des matchs jouables — aucun aller-retour de plus, aucune lecture sans match jouable ;
  `db_now` lu avec le match pour la porte REST, passé à `loadMatchVoiceInfos` qui n'a pas
  d'heure par défaut), comme les requêtes du balayage — une application
  en avance ne montre pas un salon que la base n'ouvre pas encore. Le **contrôle d'accès** de la
  porte REST reste à l'heure de l'application, comme la fiche et le flux (`canViewTournament`) :
  les deux portes rendent le même 404 à un tournoi pas encore publié.
- **Ligne sans salon** (création expirée ou réponse illisible, alors que le bot a pu créer le
  salon) : rendue par sa clé (`releaseVoiceChannelByKey`, `POST /internal/voice/keys/release`),
  jamais close sans appel au bot. Un bot plus ancien sans cette route (`INTERNAL_ROUTE_NOT_FOUND`
  au rendu par clé — tout 404 autre que `VOICE_CHANNEL_NOT_TRACKED` s'y lit ainsi, même
  illisible : mandataire, page HTML) ne vaut refus que de cette ligne : les rendus par identifiant passent, sans
  attente du bot ; la ligne attend sa mise à jour (redemandée toutes les heures passé 48 h) ; les autres lignes sans salon de la passe n'appellent plus cette route (un mandataire mal routé n'est pas appelé pour chacune) mais sont repoussées comme la première, en une instruction (elles n'occupent pas le lot de chaque passe).
- **Clôture gardée** : `released_at` et `failed_at` ne s'écrivent que si la ligne porte encore le
  salon rendu (`channel_id <=> ?`) — un salon neuf écrit entre-temps par un autre processus reste
  ouvert, rendu plus tard ; rien n'est publié si la ligne n'a pas changé. Une revérification qui
  retrouve le **même** salon sur une ligne rendue **avant** la demande au bot (`released_at` au plus
  tard à la seconde de la demande ; rendue après, le bot a reçu ce rendu après la reprise et le salon
  reste rendu) rouvre la ligne (rendu annulé par le bot),
  rendue de nouveau dans la même passe (une seule lecture par passe pour tous les salons
  retrouvés, une écriture seulement pour une ligne rendue).
- **Étapes indépendantes** : une création ou une revérification en erreur n'empêche pas le
  rendu de la même passe (l'erreur remonte ensuite ; si le rendu échoue aussi, celle de la
  création est journalisée avant) ; la revérification attend tous ses ouvriers avant de rendre
  la main, même si l'un échoue (le salon de l'ouvrier en erreur n'est pas « vu »).
- **Tournoi pas encore publié** (`start_visibility_at` à venir) : aucun salon n'est
  créé ni redemandé (`DUE_CHANNELS_SQL`, `OPEN_DUE_CHANNELS_SQL`), et un salon déjà ouvert est
  rendu si le tournoi est de nouveau masqué (`RELEASABLE_SQL`) — les noms
  d'équipes d'un tournoi caché n'apparaissent pas sur Discord.
- **Rendu** : le balayage rend les salons d'un match terminé, forfait, annulé,
  sorti du programme (heure retirée), d'un match où entre une entrée solo ou une
  équipe fantôme, d'un tournoi qui n'est plus en cours (terminé, ou retombé avant
  son départ) ou qui a éteint l'option, et ceux d'un match **reporté** dont l'heure repasse
  au-delà du quart d'heure (décision D14, `start_at > NOW() + 15 min`) : ils sont rouverts par
  la voie normale (`DUE_CHANNELS_SQL`) 15 minutes avant la nouvelle heure. `VOICE_CHANNEL_NOT_TRACKED` = déjà fait. Une
  ligne rendue est effacée 7 jours après (purge au plus une fois par heure, par lots de 200 jusqu'à épuisement de l'arriéré, 10 lots au plus par passe ; tant qu'il en reste, ou si elle échoue, reprise une minute plus tard ; faite après la publication et même si une étape du bot échoue).
- **Lecture** : `loadMatchVoiceInfos` ne lit que les lignes non rendues des matchs
  demandés, et seulement quand l'option vaut (`voiceOptionLive` : allumée, tournoi en cours
  **et** publié — un tournoi pas encore publié ne montre rien, même au staff, puisqu'aucun
  salon ne s'y ouvre) ; une équipe absente de `bg_teams` se lit comme une fantôme (rien
  n'est montré). La porte REST ne déclenche une passe qu'après le contrôle d'accès ; un
  match prêt ou au score en attente de confirmation les montre, lancé ou non. Un rendu
  refusé sur un salon encore ouvert le laisse « ouvert ».
- **Relecture de la page du match** : **flux coupé seulement** (`isLive` de la fiche),
  toutes les 10 s, tant que la source qui fait foi porte `voice` ; la relecture lue à
  l'instant où le flux se coupe est sautée (`voicePollDue`). Une réponse REST `null`
  fait taire la section jusqu'au prochain instantané ; une réponse sans clé `voice`
  est ignorée.
- **Affichage** : par équipe sur la page du match, pour ses parties et le staff, un
  état (`team1State` / `team2State`) : « bientôt ouvert » (`WAITING`), « ouvert »
  (`OPEN`), « indisponible, nouvelle tentative en cours » (`FAILED`). Une ancienne charge (`COUNTED`/`UNCOUNTED`,
  nombres, `pending`) se lit `OPEN`, sans le reste. La vue spectateur ne garde rien
  (`voice: null`). L'état (`WAITING` / `OPEN` / `FAILED`) n'est pas une donnée personnelle et se
  déduit de ce qui est public (option, heure du match) : il voyage dans l'instantané commun et la
  porte REST pour tout lecteur du tournoi ; seul l'affichage est réservé aux parties et au staff.
  L'état apparaît sur le flux avec la première écriture d'une passe (salon créé ou en échec) :
  le seul passage d'une heure (publication du tournoi, échéance d'un match) ne republie pas
  l'instantané ; la relecture REST, flux coupé, le lit à l'instant.

## Comportements gardés (CAST-FOLLOWUP)

La page du match ne montre **aucun lien** vers les salons (décision du
2026-11-05 : les conditions v9 restent exactes) — leur état seul.

Comportements gardés et documentés (décisions du 2026-11-05) :

- un rendu ou une revérification **refusés** par le bot pour ce salon
  laissent la ligne **ouverte** (`failed_at` noté), redemandée après
  la fenêtre de revérification (`OPEN_DUE_CHANNELS_SQL`, au plus une fois par minute) ;
- un salon **supprimé par la modération** est recréé à la revérification
  suivante, dans la fenêtre du match ;
- le bot répond **succès** au rendu d'un salon déjà disparu ou jamais suivi
  (`{ released: true }` — le champ `deleted` est retiré : le site n'apprend pas si
  le salon était vide) : la ligne se clôt (PR du bot).

## Formulaire

Case « Salons vocaux d'équipe » (`TeamVoiceChannelsField`) dans le formulaire du
tournoi, modifiable jusqu'à la fin du tournoi (même règle que la planification par
l'arbitrage) ; à l'édition, elle passe par la route dédiée, pas par le `PATCH`.

## RGPD

Déclaré dans `PRIVACY_CHANGES` (`2026-11-salons-vocaux-equipe`, puis
`2026-11-salons-vocaux-sans-comptage` du 6 novembre 2026 : plus d'attente, plus de
comptage ; puis `2026-11-salons-vocaux-vidage-et-report` du 11 novembre 2026 : vidage par l'arbitrage, match reporté, ligne jamais close tant que le salon peut exister ; puis `2026-11-salons-vocaux-vidage-par-l-equipe` du 11 novembre 2026 : vidage par l'équipe, D36), `/rgpd#salons-vocaux` et le registre (T18 ; le geste `VOICE_CLEARED` aussi à T05), en FR et EN. La mention « effacé avec sa colonne » de l'entrée du 6 novembre est retirée (décision D15). Le site ne garde
que l'identifiant du salon, les numéros du match et de l'équipe et des heures ; le bot
tient en mémoire seulement l'état vocal des membres du serveur, pour savoir si un salon
est vide. Base : **intérêt légitime** (bon déroulement des tournois). La règle commune
« Salons vocaux d'équipe » de `/regles` (`messages/*/rules.json`) le dit aussi.

Les conditions d'utilisation v9, pas encore en ligne, ont été reformulées sur place par
EF-43 (ni attente ni comptage, aucune mention d'opposition) : `TERMS_VERSION` reste 9.
La version 10 (11 novembre 2026, pas encore en ligne à sa rédaction) réécrit sur place ce
passage de « Contacts de match » : salons ouverts à qui voit la catégorie (D13), état vocal
lu en mémoire par le bot sans être enregistré, vidage par l'arbitrage ou par le
propriétaire, un manager ou le capitaine de l'équipe (D36), déconnexions gardées par le
journal d'audit de Discord — annoncée par l'entrée `2026-11-conditions-v10-avatar-et-succession`.

La politique de confidentialité du bot (`lib/shared/bot-legal-content.ts`, copiée dans
`LegalTerms/` du bot) décrit aussi ces salons (données, base, durées, destinataires) et
renvoie à `/rgpd#salons-vocaux` (T18).

## Côté bot

Le bot doit avoir **Gérer les salons** sur la catégorie des matchs
(`676735851119640577`). Les salons héritent des permissions de la catégorie (aucune
permission propre à une équipe : le bot ne reçoit aucun compte de joueur) — qui peut les
rejoindre se règle sur la catégorie (décision requise, `ERREUR.txt`) ; il supprime un salon vide une fois rendu (au plus tard
24 h après), et un salon jamais rendu resté vide 48 h. La route de comptage
(`/internal/voice/channels/:id/count`) est retirée (EF-43). Le rendu par clé
(`POST /internal/voice/keys/release`) arrive avec la PR du bot de ce lot. Déployer le bot avant
le site : un bot plus ancien répond `INTERNAL_ROUTE_NOT_FOUND` et les lignes sans
salon restent ouvertes jusqu'à sa mise à jour (les autres rendus passent).

## Tests

`tests/lib/shared/match-voice.test.ts`, `tests/lib/server/match-voice-sweep.test.ts`,
`tests/lib/server/bot-integration-voice.test.ts`, `tests/app/api/match-voice-routes.test.ts`,
describe « salons vocaux d'équipe : le départ n'en dépend pas » de `tests/lib/server/match-launch.test.ts`,
`tests/tournois/match-voice-view.test.ts`, describe « salons vocaux d'équipe » de
`tests/tournois/match-page-render.test.tsx`, `tests/app/api/match-voice-clear-team-route.test.ts`,
`tests/lib/server/match-voice-clear-team.test.ts`.
