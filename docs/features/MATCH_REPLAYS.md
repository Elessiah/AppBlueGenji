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
| `normalizeReplayUrl` | Valide et normalise le lien. Hérite des garde-fous de `normalizeStreamUrl` (https forcé, hôte en minuscules, ni identifiants ni port, sous-domaines fermés, 255 caractères), puis n'accepte que **YouTube** et **une vidéo** : `youtube.com/watch?v=<id>`, `youtu.be/<id>`, `youtube.com/live/<id>`. La page d'une chaîne ne mène à aucune rediff ; Twitch et Kick sont refusés. |
| `canHaveReplay` | Rencontre **réellement disputée** : `COMPLETED`, deux engagées, ni forfait ni double forfait. Un match nul en est une. |
| `visibleReplayUrl` | Ce que l'écran affiche : `canHaveReplay` **et** lien revalidé. |

La visibilité est **dérivée**, comme l'état de diffusion : le lien reste en base
(`bg_matches.replay_url`), mais un retour en arrière qui rouvre le match le fait
disparaître sans écriture — et le rejouer le fait revenir.

## Écriture

`PUT /api/admin/matches/[matchId]/replay`, corps `{ replayUrl: string | null }`.

- `null` ou chaîne vide **efface**, sans condition d'état : retirer un lien posé
  par erreur ne dépend de rien.
- Poser un lien exige `canHaveReplay` (`409 MATCH_NOT_REPLAYABLE`), et le statut
  est **relu dans l'`UPDATE`** (`AND status = 'COMPLETED'`) : un retour en
  arrière passé entre la lecture et l'écriture ne laisse pas un lien se poser
  sur un match rouvert.
- `400 INVALID_REPLAY_URL`, `404 MATCH_NOT_FOUND`.
- `publishMatchUpdatedEvent` : le lien voyage ensuite dans l'instantané du flux
  SSE (`BracketMatch.replayUrl`), comme le reste du plateau — sans vider la
  liste publique, la vitrine ni le classement, qu'une rediff ne change pas
  (`REALTIME_REFRESH.md`).

## Interface

- `MatchReplayStrip` (sous `MatchLiveStrip`, dans `MatchRow` — passage unique de
  toutes les vues du plateau) : bandeau bleu glacier pour tous, bouton
  « ＋ Rediff » / « ✎ » pour la permission `live`. Le rouge reste réservé à ce qui
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
