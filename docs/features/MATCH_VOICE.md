# Salons vocaux d'équipe (MATCH-VOICE)

Option de tournoi **« Salons vocaux d'équipe »** (`bg_tournaments.team_voice_channels`,
éteinte par défaut) : 15 minutes avant l'heure d'un match, le bot Discord ouvre un
salon vocal de 5 places par équipe. **Le lancement du match n'en dépend pas**
(décision 22 de l'utilisateur, EF-43) : il se lance comme dans tout autre tournoi,
et rien n'est compté.

## Où vit quoi

| Fichier | Rôle |
| --- | --- |
| `lib/shared/match-voice.ts` | Pur : constantes (`VOICE_CHANNEL_LEAD_MINUTES` = 15, `VOICE_CHANNEL_CAPACITY` = 5, `VOICE_ROW_RETENTION_DAYS` = 7, `VOICE_RETRY_SECONDS` = 60, `VOICE_CHANNEL_LATE_HOURS` = 24, durées du bot `VOICE_BOT_*`), clé `match:<matchId>:team:<teamId>`, échéance (`voiceChannelsDue`), suivi (`voiceTracked`), forme publique (`matchVoiceInfo`, `shownVoiceSide`, `parseMatchVoiceInfo`) |
| `app/(secured)/tournois/[id]/_lib/match-voice-view.ts` | Page du match : source qui fait foi entre instantané et relecture REST (`currentMatchVoice`, `voiceStreamKey`), relecture flux coupé seulement (`voicePollActive`, `useMatchVoice`) |
| `lib/server/tournaments/match-voice.ts` | Balayage (`dispatchMatchVoiceChannels`, `DUE_CHANNELS_SQL`, `RELEASABLE_SQL`), bascule (`setTeamVoiceChannels`), lectures (`loadMatchVoiceInfos`, `readMatchVoice`) |
| `lib/server/bot-integration.ts` | `ensureVoiceChannel`, `releaseVoiceChannel` (`VoiceCallOutcome` : `ok` / `gone` / `failed`) |
| `PUT /api/admin/tournaments/[id]/voice-channels` | Bascule de l'option, permission `tournaments`, jusqu'à la fin du tournoi (y compris en cours ; tournoi terminé : 409 `TOURNAMENT_FINISHED`, comme le formulaire) ; limite par compte (`TEAM_VOICE_TOGGLE_RULE`, 30 par 5 min) ; journalisée comme geste du staff sur un tournoi (`TEAM_VOICE_ON` / `TEAM_VOICE_OFF`, `STAFF_ACTION_LOGS.md` : auteur anonyme, rien dans pm2) quand elle change |
| `GET /api/matches/[matchId]/voice` | Porte REST de secours de `TournamentMatch.voice` (connecté ; tournoi visible selon `canViewTournament`, la règle de sa fiche ; `MATCH_VOICE_READ_RULE`) |
| `bg_match_voice_channels` | Une ligne par (match, équipe) : `channel_id`, `failed_at`, `released_at` — ni qui est présent, ni combien (`members` et `counted_at` retirés, EF-43) |

## Règles

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
  annonces), la ligne reste ouverte. Un rendu refusé pour `INVALID_CHANNEL_ID` clôt la
  ligne (le bot ne suivra jamais cet identifiant) au lieu d'être redemandé sans fin. Un code du bot
  n'est repris que s'il a la forme `[A-Z0-9_]{1,64}` — jamais une phrase.
  Coût borné : au plus 5 appels au bot en parallèle, 80 salons par passe (les
  plus anciennement vus d'abord, aucun n'est affamé), arrêt de la passe au premier
  échec du canal du bot (le salon en échec est redemandé après 10 s, derrière les
  salons plus anciennement vus : un salon lent n'ouvre pas chaque passe) ; un salon tout juste créé n'est pas redemandé dans la même passe.
  La création, la revérification et le rendu s'arrêtent chacun à la première panne du canal (la création en panne saute la revérification ; le rendu, indépendant, passe toujours), la suivante reprend ; les matchs dont un salon vient d'échouer passent après les autres dans le lot de création. Seule
  une panne du canal ou du bot entier (`BOT_CIRCUIT_OPEN`, `BOT_INTERNAL_UNREACHABLE`,
  `BOT_VOICE_TIMEOUT`, `INTERNAL_ERROR`, `INTERNAL_ROUTE_NOT_FOUND`, `BOT_INTERNAL_REQUEST_FAILED` —
  réponse sans code lisible —, `BOT_VOICE_BAD_RESPONSE` — 2xx au corps illisible —, `UNAUTHORIZED`, `INTERNAL_API_TOKEN_NOT_CONFIGURED`,
  `DISCORD_NOT_READY` : jeton refusé ou absent, bot pas connecté à Discord ;
  `VOICE_CATEGORY_UNAVAILABLE`, `VOICE_MISSING_PERMISSIONS`, `VOICE_STORAGE_ERROR`,
  `VOICE_INTERNAL_ERROR` : refus qui vaut pour tous les salons) arrête une passe ; le refus du bot pour un salon (autre
  code `VOICE_*`, dont `VOICE_DISCORD_ERROR`) ne retient que ce salon : les autres sont traités, et il garde son
  horodatage (redemandé après la minute, jamais en tête de file).
- **Panne du bot** : `failed_at` noté, une ligne pm2 sans donnée de joueur, une
  seule par panne ; création comme rendu réessayés au plus une fois par
  `VOICE_RETRY_SECONDS` (60 s), en fin de file — par équipe : une création échouée
  n'est pas redemandée avant ce délai même quand l'autre équipe ramène le match
  (`backing_off`, calculé par la base). Un rendu refusé par le bot donne une ligne
  pm2 `rendu du salon vocal refusé (CODE)` par salon et par code (mémoire du
  processus, oubliée à la clôture de la ligne) ; une panne du canal n'en donne pas.
- **Refus de rendu sans fin** : passé `VOICE_BOT_UNRELEASED_MAX_HOURS` depuis la création de la
  ligne (filet du bot), un rendu en échec (refus ou panne) clôt la ligne au lieu de la redemander
  chaque minute ; `created_at` repart quand la ligne est rouverte ou que le salon change.
- **Étapes indépendantes** : une création ou une revérification en erreur n'empêche pas le
  rendu de la même passe (l'erreur remonte ensuite) ; la revérification attend tous ses
  ouvriers avant de rendre la main, même si l'un échoue.
- **Tournoi pas encore publié** (`start_visibility_at` à venir) : aucun salon n'est
  créé ni redemandé (`DUE_CHANNELS_SQL`, `OPEN_DUE_CHANNELS_SQL`), et un salon déjà ouvert est
  rendu si le tournoi est de nouveau masqué (`RELEASABLE_SQL`) — les noms
  d'équipes d'un tournoi caché n'apparaissent pas sur Discord.
- **Rendu** : le balayage rend les salons d'un match terminé, forfait, annulé,
  sorti du programme (heure retirée), d'un match où entre une entrée solo ou une
  équipe fantôme, d'un tournoi qui n'est plus en cours (terminé, ou retombé avant
  son départ) ou qui a éteint l'option ; un match
  simplement reporté garde les siens. `VOICE_CHANNEL_NOT_TRACKED` = déjà fait. Une
  ligne rendue est effacée 7 jours après (purge au plus une fois par heure, par lots de 200 jusqu'à épuisement de l'arriéré, 10 lots au plus par passe ; tant qu'il en reste, reprise une minute plus tard ; faite après la publication et même si une étape du bot échoue).
- **Lecture** : `loadMatchVoiceInfos` ne lit que les lignes non rendues des matchs
  demandés, et seulement quand l'option est allumée **et** le tournoi en cours ; un
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
  (`voice: null`).

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
  (`{ released: true, deleted: true }`) : la ligne se clôt (PR du bot).

## Formulaire

Case « Salons vocaux d'équipe » (`TeamVoiceChannelsField`) dans le formulaire du
tournoi, modifiable jusqu'à la fin du tournoi (même règle que la planification par
l'arbitrage) ; à l'édition, elle passe par la route dédiée, pas par le `PATCH`.

## RGPD

Déclaré dans `PRIVACY_CHANGES` (`2026-11-salons-vocaux-equipe`, puis
`2026-11-salons-vocaux-sans-comptage` du 6 novembre 2026 : plus d'attente, plus de
comptage), `/rgpd#salons-vocaux` et le registre (T18), en FR et EN. Le site ne garde
que l'identifiant du salon, les numéros du match et de l'équipe et des heures ; le bot
tient en mémoire seulement l'état vocal des membres du serveur, pour savoir si un salon
est vide. Base : **intérêt légitime** (bon déroulement des tournois). La règle commune
« Salons vocaux d'équipe » de `/regles` (`messages/*/rules.json`) le dit aussi.

Les conditions d'utilisation v9, pas encore en ligne, ont été reformulées sur place par
EF-43 (ni attente ni comptage, aucune mention d'opposition) : `TERMS_VERSION` reste 9.

La politique de confidentialité du bot (`lib/shared/bot-legal-content.ts`, copiée dans
`LegalTerms/` du bot) décrit aussi ces salons (données, base, durées, destinataires) et
renvoie à `/rgpd#salons-vocaux` (T18).

## Côté bot

Le bot doit avoir **Gérer les salons** sur la catégorie des matchs
(`676735851119640577`) ; il supprime un salon vide une fois rendu (au plus tard
24 h après), et un salon jamais rendu resté vide 48 h. La route de comptage
(`/internal/voice/channels/:id/count`) est retirée (EF-43). Déployer le bot avant le site.

## Tests

`tests/lib/shared/match-voice.test.ts`, `tests/lib/server/match-voice-sweep.test.ts`,
`tests/lib/server/bot-integration-voice.test.ts`, `tests/app/api/match-voice-routes.test.ts`,
describe « salons vocaux d'équipe : le départ n'en dépend pas » de `tests/lib/server/match-launch.test.ts`,
`tests/tournois/match-voice-view.test.ts`, describe « salons vocaux d'équipe » de
`tests/tournois/match-page-render.test.tsx`.
