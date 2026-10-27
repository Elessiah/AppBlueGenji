# Gestes du staff au journal

Les gestes du staff sur un match ou un tournoi qui ne laissaient aucune trace
de leur auteur partent au journal du staff sur Discord (`/internal/log`, `sendBotLog`), **sans
personne nommée** et **sans ligne dans pm2** (décision du 27 octobre 2026 :
gestes de staff anonymes partout). Aucun push, aucun message privé : ces gestes
n'appellent l'intervention de personne.

## Où

- Rédaction (pure) : `formatStaffMatchActionLog` / `formatStaffTournamentActionLog`
  dans `lib/shared/bot-logs.ts`, vocabulaire `StaffMatchAction` /
  `StaffTournamentAction`.
- Envoi : `announceStaffMatchAction(matchId, action)` /
  `announceStaffTournamentAction(tournamentId, action, count?)` dans
  `lib/server/tournaments/staff-action-logs.ts` — relit le match
  (`match-log-subject.ts`, partagé avec `CAST_NOTICES.md`) ou le nom du tournoi,
  n'attend pas, ne lève jamais (base indisponible : une ligne `[staff-log]`
  en erreur dans pm2, avec le geste et le numéro du match ou du tournoi mais
  jamais l'auteur — le registre et `/rgpd` le disent ; bot injoignable :
  `sendBotLog` abandonne en silence ; la réponse de la route ne change pas).
- Appel : dans chaque route, **après** le geste réussi ; un refus (401, 403,
  400) ou un échec du service n'écrit rien.

## Gestes

| Route | Geste | Ligne |
|---|---|---|
| `POST /api/admin/matches/[id]/resolve` | `RESULT_VALIDATED` | Résultat validé |
| `PATCH /api/admin/matches/[id]/scores` | `SCORES_SAVED` | Score enregistré |
| `POST /api/admin/matches/[id]/launch` | `FORCE_LAUNCHED` | Lancement forcé |
| `PUT /api/admin/matches/[id]/host` | `HOST_SET` / `HOST_CLEARED` | Hôte désigné / retiré |
| `PUT /api/admin/matches/[id]/live` | `LIVE_CONFIGURED` / `LIVE_REMOVED` (déclencheur `null`) | Diffusion réglée / retirée |
| `POST /api/admin/matches/[id]/live` | `ON_AIR` / `OFF_AIR` | Mis à l'antenne / Retiré de l'antenne |
| `PUT /api/admin/matches/[id]/replay` | `REPLAY_SET` / `REPLAY_REMOVED` | Rediffusion ajoutée / retirée |
| `PATCH /api/tournaments/[id]/edit` | `EDITED` | Tournoi modifié |
| `PATCH /api/admin/tournaments/[id]/seeding` | `SEEDING_REORDERED` | Têtes de série réordonnées |
| `POST /api/admin/tournaments/[id]/advance` | `ADVANCED` | Étape suivante avancée |
| `POST /api/admin/tournaments/[id]/ghost-registrations` | `GHOST_TEAMS_REGISTERED` (nombre) | Équipes fantômes inscrites (N) |
| `POST` / `PATCH` / `DELETE /api/admin/tournaments/[id]/image` | `IMAGE_SET` / `IMAGE_UPDATED` / `IMAGE_REMOVED` | Image ajoutée / cadrage modifié / image retirée |
| `PUT /api/admin/tournaments/[id]/live` | `LIVE_URL_SET` / `LIVE_URL_REMOVED` | Lien de diffusion du tournoi posé / retiré |

Forme : `🛠️ <Geste> — « Tournoi » (#id) : <Manche> — A vs B (#match), par le staff.`
pour un match, `🛠️ <Geste> — « Tournoi » (#id), par le staff.` pour un tournoi.
L'auteur est « le staff », ou « un caster » pour un geste de diffusion
(`live`, rediffusion) de qui détient `live` sans `tournaments`
(`staffActionAuthor`) : la ligne ne prête pas aux arbitres le geste d'un caster.
Les engagés passent par `entrantLabel` (« un joueur » en tournoi individuel,
« TBD » pour une place vide) ; ni score, ni lien, ni équipe hôte : la page du
match dit le détail.

## Ce qui ne change pas

- Les équipes fantômes avaient déjà une ligne « inscription » par équipe
  (`registration`, par le staff) : la ligne 🛠️ les regroupe en un geste.
- Les gestes déjà tracés gardent leur ligne : horaires (`schedule-notices.ts`),
  pénalités, abandons, retrait d'un engagé, retour en arrière, suppression d'un
  tournoi, arbitrage des horaires (`publishStaffAction`, auteur nommé dans pm2).
  Les gestes lourds d'administration restent au seul journal (décision 5).
- Un arbitre qui joue le match qu'il tranche reçoit **en plus** l'alerte de
  `dispute-self-resolution.ts` (ligne ⚠️ et push `REFEREE_SELF_RESOLUTION`).
  Qu'il le joue ou non, « Valider le résultat » (litige clos ou résultat
  corrigé) et un score qui suspend la validation automatique gardent leur
  trace courte **nominative** dans pm2 (`auditStaffAction`) : la ligne 🛠️
  n'ajoute rien à pm2, elle n'en retire rien non plus — `/rgpd` et le
  registre T05 le disent.
- « Valider le résultat » écrit aussi « Match terminé » (`match_finished`) : la
  ligne 🛠️ dit que c'est l'arbitrage qui a tranché.

## Légal

Registre T05 (FR et EN) : une sous-finalité « autres gestes du staff ». `/rgpd`
§ notifications (FR et EN) : une phrase. Pas d'entrée `PRIVACY_CHANGES` : ni
donnée nouvelle (noms d'équipe, tournoi, manche — déjà au journal), ni
destinataire nouveau, ni durée nouvelle, et l'auteur n'est pas identifié.

Tests : `tests/lib/shared/staff-action-logs.test.ts`,
`tests/lib/server/staff-action-logs.test.ts`,
`tests/app/api/admin/staff-action-log-routes.test.ts`.
