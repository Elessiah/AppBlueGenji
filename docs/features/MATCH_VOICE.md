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
  oublié bien après son heure n'ouvre plus de salon.
- **Balayage** : au plus toutes les 10 s, déclenché par le trafic (listes de
  tournois et `/api/me/match-launches`), sur le pool, **sans connexion tenue pendant
  un appel au bot**. Une passe vérifie d'abord qu'il y a quelque chose à faire
  (`SWEEP_NEEDED_SQL`). Une bascule pendant une passe en demande une de plus
  (`dispatchMatchVoiceChannels(true)`), jouée à la fin de la passe en cours.
- **Panne du bot** : `failed_at` noté, une ligne pm2 sans donnée de joueur, une
  seule par panne ; création comme rendu réessayés au plus une fois par
  `VOICE_RETRY_SECONDS` (60 s), en fin de file.
- **Rendu** : le balayage rend les salons d'un match terminé, forfait, annulé,
  sorti du programme (heure retirée), d'un match où entre une entrée solo ou une
  équipe fantôme, d'un tournoi terminé ou qui a éteint l'option ; un match
  simplement reporté garde les siens. `VOICE_CHANNEL_NOT_TRACKED` = déjà fait. Une
  ligne rendue est effacée 7 jours après (purge au plus une fois par heure).
- **Lecture** : `loadMatchVoiceInfos` ne lit que les lignes non rendues des matchs
  demandés, et seulement quand l'option est allumée **et** le tournoi en cours.
- **Relecture de la page du match** : **flux coupé seulement** (`isLive` de la fiche),
  toutes les 10 s, tant que la source qui fait foi porte `voice` ; la relecture lue à
  l'instant où le flux se coupe est sautée (`voicePollDue`). Une réponse REST `null`
  fait taire la section jusqu'au prochain instantané ; une réponse sans clé `voice`
  est ignorée.
- **Affichage** : par équipe sur la page du match, pour ses parties et le staff, un
  état (`team1State` / `team2State`) : « bientôt ouvert » (`WAITING`), « ouvert »
  (`OPEN`), « indisponible » (`FAILED`). Une ancienne charge (`COUNTED`/`UNCOUNTED`,
  nombres, `pending`) se lit `OPEN`, sans le reste. La vue spectateur ne garde rien
  (`voice: null`).

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

Les conditions d'utilisation v9 (publiées) décrivent encore l'attente et le comptage :
une version 10 relève d'une décision de l'utilisateur.

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
