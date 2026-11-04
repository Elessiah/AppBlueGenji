# Salons vocaux d'équipe (MATCH-VOICE)

Option de tournoi **« Salons vocaux d'équipe »** (`bg_tournaments.team_voice_channels`,
éteinte par défaut) : 15 minutes avant l'heure d'un match, le bot Discord ouvre un
salon vocal de 5 places par équipe, et le match ne se lance qu'une fois les deux
salons pleins.

## Où vit quoi

| Fichier | Rôle |
| --- | --- |
| `lib/shared/match-voice.ts` | Pur : constantes (`VOICE_CHANNEL_LEAD_MINUTES` = 15, `VOICE_CHANNEL_CAPACITY` = 5, `VOICE_ROW_RETENTION_DAYS` = 7), clé `match:<matchId>:team:<teamId>`, échéance, verrou (`voiceGatePending`), forme publique (`matchVoiceInfo`, `shownVoiceSide`, `voiceSideFull`, `parseMatchVoiceInfo`) |
| `app/(secured)/tournois/[id]/_lib/match-voice-view.ts` | Page du match : source qui fait foi entre instantané et relecture REST (`currentMatchVoice`, `voiceStreamKey`), relecture flux coupé seulement (`voicePollActive`, `useMatchVoice`) |
| `lib/server/tournaments/match-voice.ts` | Balayage (`dispatchMatchVoiceChannels`), verrou lu en transaction (`voiceGateBlocksLaunch`), bascule (`setTeamVoiceChannels`), lectures (`loadMatchVoiceInfos`, `readMatchVoice`) |
| `lib/server/bot-integration.ts` | `ensureVoiceChannel`, `countVoiceChannel`, `releaseVoiceChannel` (`VoiceCallOutcome` : `ok` / `gone` / `failed`) |
| `PUT /api/admin/tournaments/[id]/voice-channels` | Bascule de l'option, permission `tournaments`, jusqu'à la fin du tournoi (y compris en cours ; tournoi terminé : 409 `TOURNAMENT_FINISHED`, comme le formulaire) ; limite par compte (`TEAM_VOICE_TOGGLE_RULE`, 30 par 5 min) ; journalisée comme geste du staff sur un tournoi (`TEAM_VOICE_ON` / `TEAM_VOICE_OFF`, `STAFF_ACTION_LOGS.md` : auteur anonyme, rien dans pm2) quand elle change |
| `GET /api/matches/[matchId]/voice` | Porte REST de secours du compteur (connecté, tournoi publié ; `MATCH_VOICE_READ_RULE`) |
| `bg_match_voice_channels` | Une ligne par (match, équipe) : `channel_id`, `members`, `counted_at`, `failed_at`, `released_at` |

## Règles

- **Jamais** pour une entrée solo (son nom serait un pseudo) ni une équipe fantôme :
  un match qui en a une n'est pas suivi, et son lancement ne l'attend pas.
- Nom du salon = nom de l'équipe seul ; aucun pseudo n'est envoyé au bot.
- **Verrou du lancement** : avec la phase de lancement, « Prêt » et le lancement
  d'office attendent les deux salons à 5/5 ; sans elle, le match se lance quand
  l'heure est passée **et** les deux salons pleins (affiché `SCHEDULED` d'ici là).
  Sans phase, un match retenu n'ouvre aucun lancement (`lobby_opened_at` reste vide :
  ni appel aux « Prêt », ni brief du salon).
  Le lancement forcé par l'arbitrage passe toujours.
- **Panne du bot** : le verrou se lève (`failed_at`), une ligne pm2 sans donnée de
  joueur (`[match-voice] match <id> : bot indisponible (<code>) — verrou du lancement levé`),
  une seule par panne. Le contournement n'est pas définitif : un comptage réussi
  remet le verrou. Une panne sur une ligne déjà rendue (match sorti du programme puis
  revenu) la rouvre sans salon, pour que le verrou la voie.
- **Comptage** : le verrou ne lit que l'état stocké ; seul le balayage (au plus
  toutes les 10 s, déclenché par le trafic — listes de tournois et
  `/api/me/match-launches`) parle au bot, hors transaction. Un compte `gone`
  (`VOICE_CHANNEL_NOT_FOUND`) redemande le salon par sa clé, une fois.
- **Fraîcheur** : le verrou (au lancement comme `pending` dans l'instantané) ne croit
  qu'une observation du bot de moins de 5 minutes (`VOICE_OBSERVATION_FRESH_MINUTES`,
  `counted_at` / `failed_at`) : un « 5/5 » ancien (match reporté hors du quart d'heure
  puis revenu) ne lance rien et une panne ancienne ne lève plus le verrou — le
  balayage suivant tranche. L'affichage garde le dernier nombre compté. Un comptage
  redevenu frais compte comme un changement (publication + entretien rejoué).
- **Relecture de la page du match** : **flux coupé seulement** (`isLive` de la fiche),
  toutes les 10 s, tant que la source qui fait foi porte `voice` (match dû, pas encore
  lancé), verrou tenu ou non ; la relecture lue à l'instant où le flux se coupe (ouverture de la page, reconnexion) est sautée (`voicePollDue`, grâce d'une demi-période). Flux sain, chaque comptage est déjà publié dans
  l'instantané ; le balayage reste porté par le trafic (listes de tournois,
  `/api/me/match-launches`). Une réponse REST `null` (match lancé, option éteinte) fait
  taire la section jusqu'au prochain instantané ; une réponse sans clé `voice` est
  ignorée.
- **Côté client** : `useMatchLaunchPhase` relaie `voice.pending` à `matchLaunchPhase`,
  si bien qu'un match retenu sans phase de lancement reste « programmé » (pas de
  formulaire de score, bouton « Forcer le lancement » pour l'arbitrage).
- **Rendu** : le balayage rend les salons d'un match terminé, forfait, annulé, sorti
  du programme (heure retirée), d'un tournoi terminé ou qui a éteint l'option ; un
  match simplement reporté garde les siens. `VOICE_CHANNEL_NOT_TRACKED` = déjà fait.
  Une ligne rendue est effacée 7 jours après.
- **Bascule en cours de tournoi** : allumer ouvre les salons au balayage suivant
  (aussitôt si le match est à moins de 15 min) ; éteindre lève le verrou aussitôt
  (`maintainMatchLaunches` rejoué — par la bascule comme par le balayage, tournoi en
  cours seulement). Transaction par
  `inTransaction`, `lockTournamentRow` en première instruction.
- **Nom du salon** : le nom d'équipe passe par `visibleText` avant d'aller au bot
  (`UNTRUSTED_NAMES.md`), qui le nettoie encore.
- **Affichage** : par équipe sur la page du match, pour ses parties et le staff, un
  état (`team1State` / `team2State`) : « bientôt ouvert » (`WAITING`, pas de salon),
  « pas encore compté » (`UNCOUNTED`), « n/5 » puis « 5/5 · complet » (`COUNTED`),
  « indisponible » (`FAILED`, panne fraîche : une note dit que le match n'attend pas
  les salons). Tant que le verrou retient le match, le badge de lancement (carte et
  faits clés) ajoute « salons vocaux à remplir ». Le nombre voyage dans
  l'instantané commun : tout membre connecté qui suit le tournoi peut le lire (le
  RGPD le dit) ; la vue spectateur retire les compteurs et ne garde que `pending`.
  Un match dû dont aucun salon n'est encore créé se montre en attente, comme le
  verrou le lit.
- **File du balayage** : les matchs dus passent du moins récemment compté au plus
  récent (40 par passe) ; un rendu qui échoue repasse en fin de file (`failed_at`).
  Deux salons perdus d'affilée au comptage valent une panne.

## Formulaire

Case « Salons vocaux d'équipe » (`TeamVoiceChannelsField`) dans le formulaire du
tournoi, modifiable jusqu'à la fin du tournoi (même règle que la planification par
l'arbitrage) ; à l'édition, elle passe par la route dédiée, pas par le `PATCH`.

## RGPD

Déclaré dans `PRIVACY_CHANGES` (`2026-11-salons-vocaux-equipe`), `/rgpd#salons-vocaux`
et le registre (T18). Seul un nombre est gardé, jamais qui est présent.

## Côté bot

Le bot doit avoir **Gérer les salons** sur la catégorie des matchs
(`676735851119640577`) ; il supprime un salon vide une fois rendu (au plus tard
24 h après), et un salon jamais rendu resté vide 48 h. Déployer le bot avant le site.

## Tests

`tests/lib/shared/match-voice.test.ts`, `tests/lib/server/match-voice-sweep.test.ts`,
`tests/lib/server/bot-integration-voice.test.ts`, `tests/app/api/match-voice-routes.test.ts`,
describe « verrou des salons vocaux d'équipe » de `tests/lib/server/match-launch.test.ts`,
`tests/tournois/match-voice-view.test.ts`, describe « salons vocaux d'équipe » de
`tests/tournois/match-page-render.test.tsx`.
