# Rediffusion d'un match terminé

Une fois une rencontre jouée, le staff de diffusion y pose le lien YouTube de sa
rediff. La carte du match l'annonce alors à tout le monde par un bandeau
**« ▶ Rediff disponible »**, qui est lui-même le lien (nouvel onglet).

## Qui peut poser le lien

La permission **`live`** — `ADMIN`, `ARBITRE`, `CASTER` —, le même public que la
diffusion en direct, dont la rediff est la suite. Un `COMMUNITY_MANAGER` ou un
joueur est refusé en `403`.

## Règles (`lib/shared/match-replay.ts`, pur)

| Fonction | Rôle |
| --- | --- |
| `normalizeReplayUrl` | Valide et normalise le lien. Hérite des garde-fous de `normalizeStreamUrl` (https forcé, hôte en minuscules, ni identifiants ni port, sous-domaines fermés, 255 caractères), puis n'accepte que **YouTube** et **une vidéo** : `youtube.com/watch?v=<id>`, `youtu.be/<id>`, `youtube.com/live/<id>`. La page d'une chaîne ne mène à aucune rediff ; Twitch et Kick sont refusés. Ne garde que `v` et un instant de départ `t` lisible : tout autre paramètre (l'identifiant de partage `si`, lié au compte qui partage, un texte libre) et le fragment tombent, à l'écriture comme à l'affichage d'un lien plus ancien. |
| `canHaveReplay` | Rencontre **réellement disputée** : `COMPLETED`, deux engagées, ni forfait ni double forfait. Un match nul en est une. |
| `visibleReplayUrl` | Ce que l'écran affiche : `canHaveReplay` **et** lien revalidé. |

La visibilité est **dérivée**, comme l'état de diffusion : le lien reste en base
(`bg_matches.replay_url`), mais un retour en arrière qui rouvre le match le fait
disparaître sans écriture — et le rejouer le fait revenir.

## Écriture

`PUT /api/admin/matches/[matchId]/replay`, corps `{ replayUrl: string | null }`.

- `null` ou chaîne vide **efface**, sans condition d'état : retirer un lien posé
  par erreur ne dépend de rien.
- Un corps illisible (JSON cassé : 400 `INVALID_REPLAY_URL` ; trop lourd : 413 ;
  autre type que JSON : 415), vide ou sans la clé `replayUrl` est **refusé** —
  jamais pris pour un effacement.
- Poser un lien exige `canHaveReplay` (`409 MATCH_NOT_REPLAYABLE`), et le statut
  est **relu dans l'`UPDATE`** (`AND status = 'COMPLETED'`) : un retour en
  arrière passé entre la lecture et l'écriture ne laisse pas un lien se poser
  sur un match rouvert.
- `400 INVALID_REPLAY_URL`, `404 MATCH_NOT_FOUND`.
- Journal d'arbitrage (`announceMatchReplayChange`, `staff-action-logs.ts`) :
  un lien **posé**, **changé** ou **retiré** — changement et nature lus sous le verrou du
  match (`replay_url` d'avant comparé au lien écrit, sans `changedRows` ; rendus par `setMatchReplayUrl` en `change`) —
  écrit une ligne 🎬 dans la catégorie `referees` (« Rediff ajoutée /
  modifiée / retirée », tournoi, manche, noms d'équipe — « un joueur » en
  tournoi individuel —, le lien par `discordUrl`, aucun pour un retrait), par
  « le staff » ou « un caster » ; la même ligne, avec l'auteur, dans pm2
  (`publishStaffAction`), précédée dès le commit d'une trace courte nominative
  (`auditStaffAction`, « Rediff du match #id (SET) ») : un arrêt du serveur
  avant la relecture du match ne laisse pas le geste sans auteur. Match disparu
  ou illisible : aucune ligne Discord, la trace courte reste. Les gestes sur un
  même match passent à tour de rôle dans la route (`createKeyedSerial`) : les
  lignes suivent l'ordre des commits. Rien pour un geste sans effet ni un
  refus ; aucun joueur ni caster n'est prévenu.
- `publishMatchUpdatedEvent` : le lien voyage ensuite dans l'instantané du flux
  SSE (`BracketMatch.replayUrl`), comme le reste du plateau — sans vider la
  liste publique, la vitrine ni le classement, qu'une rediff ne change pas
  (`REALTIME_REFRESH.md`).

## Interface

- `MatchReplayStrip` (sous `MatchLiveStrip`, dans `MatchRow` — passage unique de
  toutes les vues du plateau) : bandeau bleu glacier pour tous (le lien seul,
  noms nettoyés par `useShownEntrantName`). Le bouton « Ajouter / Modifier la
  rediff » vit dans le menu « Plus d'actions » de la carte (`MatchCardActions`),
  toujours offert sur un match joué au staff `tournaments` et `live` (« Retirer
  la rediff » sur un match rouvert ou forfait) ; le caster du match règle la
  sienne dans `CastSettingsDialog`, l'arbitre désigné qui caste dans
  `MatchLiveDialog` — toutes déduites de `mayEditReplay`, miroir de la route. Le rouge reste réservé à ce qui
  est réellement à l'antenne. Le nom accessible du lien **commence par son texte
  visible** (WCAG 2.5.3) et nomme le match.
- Sur un match rouvert qui porte encore un lien, le staff garde son bouton, pour
  le retirer.
- `MatchReplayDialog` : même validation que le serveur, bouton « Retirer la
  rediff » quand un lien existe.

## Jeu de test

Le tournoi « Live Auto (à l'antenne) » porte `replays: true` : une rencontre
jouée sur deux (par identifiant) reçoit une rediff, pour voir côte à côte des
cartes avec et sans bandeau.

## Notes reprises de CLAUDE.md

Texte déplacé tel quel depuis `CLAUDE.md` (allègement du fichier chargé à chaque session).

- **Rediff d'un match terminé** (`lib/shared/match-replay.ts` pur + `lib/server/tournaments/match-replay.ts` + `PUT /api/admin/matches/[matchId]/replay`) : la permission `live` (admin, arbitre, caster) pose sur un match joué le lien YouTube de sa rediff (`bg_matches.replay_url`), annoncé à tous par un bandeau « Rediff disponible » sous la carte (`MatchReplayStrip`). **YouTube seulement, et une vidéo** (`watch?v=`, `youtu.be/`, `live/`) — une chaîne Twitch ne garde pas de rediff. Posé seulement sur une rencontre **réellement disputée** (`canHaveReplay` : terminée, deux engagées, sans forfait), statut relu dans l'`UPDATE` ; l'effacement n'a aucune condition d'état. Sans `tournaments`, l'acteur doit caster le match **et y être montré** (`loadShownCasterIds`) : sur un match rouvert, un caster tu ne touche plus la rediff (`NOT_MATCH_CASTER`). Visibilité **dérivée** (`visibleReplayUrl`) : un retour en arrière tait le bandeau sans rien écrire. Voir `docs/features/MATCH_REPLAYS.md`.
