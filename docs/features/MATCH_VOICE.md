# Salons vocaux d'équipe (MATCH-VOICE)

Option de tournoi **« Salons vocaux d'équipe »** (`bg_tournaments.team_voice_channels`,
éteinte par défaut) : 15 minutes avant l'heure d'un match, le bot Discord ouvre un
salon vocal de 5 places par équipe, et le match ne se lance qu'une fois les deux
salons pleins.

## Où vit quoi

| Fichier | Rôle |
| --- | --- |
| `lib/shared/match-voice.ts` | Pur : constantes (`VOICE_CHANNEL_LEAD_MINUTES` = 15, `VOICE_CHANNEL_CAPACITY` = 5, `VOICE_ROW_RETENTION_DAYS` = 7), clé `match:<matchId>:team:<teamId>`, échéance, verrou (`voiceGatePending`), forme publique (`matchVoiceInfo`, `parseMatchVoiceInfo`) |
| `lib/server/tournaments/match-voice.ts` | Balayage (`dispatchMatchVoiceChannels`), verrou lu en transaction (`voiceGateBlocksLaunch`), bascule (`setTeamVoiceChannels`), lectures (`loadMatchVoiceInfos`, `readMatchVoice`) |
| `lib/server/bot-integration.ts` | `ensureVoiceChannel`, `countVoiceChannel`, `releaseVoiceChannel` (`VoiceCallOutcome` : `ok` / `gone` / `failed`) |
| `PUT /api/admin/tournaments/[id]/voice-channels` | Bascule de l'option, permission `tournaments`, à tout état (y compris en cours) ; journalisée par `publishStaffAction` quand elle change |
| `GET /api/matches/[matchId]/voice` | Porte REST de secours du compteur (parties du match et staff) |
| `bg_match_voice_channels` | Une ligne par (match, équipe) : `channel_id`, `members`, `counted_at`, `failed_at`, `released_at` |

## Règles

- **Jamais** pour une entrée solo (son nom serait un pseudo) ni une équipe fantôme :
  un match qui en a une n'est pas suivi, et son lancement ne l'attend pas.
- Nom du salon = nom de l'équipe seul ; aucun pseudo n'est envoyé au bot.
- **Verrou du lancement** : avec la phase de lancement, « Prêt » et le lancement
  d'office attendent les deux salons à 5/5 ; sans elle, le match se lance quand
  l'heure est passée **et** les deux salons pleins (affiché `SCHEDULED` d'ici là).
  Le lancement forcé par l'arbitrage passe toujours.
- **Panne du bot** : le verrou se lève (`failed_at`), une ligne pm2 sans donnée de
  joueur (`[match-voice] match <id> : bot indisponible (<code>) — verrou du lancement levé`),
  une seule par panne. Le contournement n'est pas définitif : un comptage réussi
  remet le verrou.
- **Comptage** : le verrou ne lit que l'état stocké ; seul le balayage (au plus
  toutes les 10 s, déclenché par le trafic — listes de tournois et
  `/api/me/match-launches`) parle au bot, hors transaction. Un compte `gone`
  (`VOICE_CHANNEL_NOT_FOUND`) redemande le salon par sa clé, une fois.
- **Rendu** : le balayage rend les salons d'un match terminé, forfait, annulé, d'un
  tournoi terminé ou qui a éteint l'option. `VOICE_CHANNEL_NOT_TRACKED` = déjà fait.
  Une ligne rendue est effacée 7 jours après.
- **Bascule en cours de tournoi** : allumer ouvre les salons au balayage suivant
  (aussitôt si le match est à moins de 15 min) ; éteindre lève le verrou aussitôt
  (`maintainMatchLaunches` rejoué).
- **Affichage** : « Salon vocal : n/5 » par équipe sur la page du match, pour ses
  parties et le staff, par l'instantané (SSE) **et** la porte REST interrogée toutes
  les 10 s tant que le verrou attend (`useClock`). La vue spectateur retire les
  compteurs et ne garde que `pending`.

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
describe « verrou des salons vocaux d'équipe » de `tests/lib/server/match-launch.test.ts`.
