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
  `announceStaffTournamentAction(tournamentId, action, details?)` dans
  `lib/server/tournaments/staff-action-logs.ts` — relit le match
  (`match-log-subject.ts`, partagé avec `CAST_NOTICES.md`) ou le nom du tournoi,
  n'attend pas, ne lève jamais (base indisponible : une ligne `[staff-log]`
  en erreur dans pm2, avec le geste, le numéro du match ou du tournoi et le
  code de l'erreur (`failureReason`, `lib/server/failure-reason.ts` : code de l'erreur, sinon message qui est lui-même un code du site, sinon nom de l'erreur — jamais un texte libre) mais
  jamais l'auteur ; disjoncteur du bot ouvert (`isBotCircuitOpen`) : rien n'est relu — le registre et `/rgpd` le disent ; bot injoignable :
  `sendBotLog` abandonne en silence ; la réponse de la route ne change pas).
- Appel : dans chaque route, **après** le geste réussi ; un refus (401, 403,
  400) ou un échec du service n'écrit rien.

## Gestes

| Route | Geste | Ligne |
|---|---|---|
| `POST /api/admin/matches/[id]/resolve` | — (aucune ligne 🛠️) | La ligne « Match terminé » du moteur porte « — résultat validé par le staff » (`markResultValidatedByStaff`, lot `results` du tournoi, `LOG_BATCHING.md`) |
| `PATCH /api/admin/matches/[id]/scores` | `SCORES_SAVED` | Score enregistré |
| `POST /api/admin/matches/[id]/launch` | `FORCE_LAUNCHED` | Lancement forcé |
| `PUT /api/admin/matches/[id]/host` | `HOST_SET` / `HOST_CLEARED` | Hôte désigné / retiré (seulement quand l'hôte change) |
| `PUT /api/admin/matches/[id]/live` | `LIVE_CONFIGURED` / `LIVE_REMOVED` (déclencheur `null`) | Diffusion réglée / retirée — rien d'annoncé si la requête n'écrit rien (`changed`) |
| `POST /api/admin/matches/[id]/live` | `ON_AIR` / `OFF_AIR` | Mis à l'antenne / Retiré de l'antenne (seulement quand l'état change) |
| `PUT /api/admin/matches/[id]/replay` | `REPLAY_SET` / `REPLAY_REMOVED` | Rediffusion ajoutée / retirée (seulement quand le lien change) |
| `PATCH /api/tournaments/[id]/edit` | `EDITED` | Tournoi modifié (ancien nom entre parenthèses quand le nom change) |
| `PATCH /api/admin/tournaments/[id]/seeding` | `SEEDING_REORDERED` | Têtes de série réordonnées (une rafale = une ligne, voir plus bas) |
| `POST /api/admin/tournaments/[id]/advance` | `ADVANCED` | Étape suivante avancée (ouverture des inscriptions, clôture des inscriptions ou coup d'envoi) |
| `POST /api/admin/tournaments/[id]/ghost-registrations` | `GHOST_TEAMS_REGISTERED` (nombre) | Équipes fantômes inscrites (N) |
| `POST` / `PATCH` / `DELETE /api/admin/tournaments/[id]/image` | `IMAGE_SET` / `IMAGE_REPLACED` / `IMAGE_UPDATED` / `IMAGE_REMOVED` | Image ajoutée / remplacée / cadrage modifié / image retirée |
| `PUT /api/admin/tournaments/[id]/live` | `LIVE_URL_SET` / `LIVE_URL_REMOVED` | Lien de diffusion du tournoi posé / retiré |
| `PUT /api/admin/tournaments/[id]/voice-channels` | `TEAM_VOICE_ON` / `TEAM_VOICE_OFF` | Option « Salons vocaux d'équipe » allumée / éteinte (seulement quand elle change) |

Forme : `🛠️ <Geste> — « Tournoi » (#id) : <Manche> — A vs B (#match), par le staff.`
pour un match, `🛠️ <Geste> — « Tournoi » (#id), par le staff.` pour un tournoi
— et pour un score qui suspend la validation automatique (`withoutMatch`) :
l'alerte ⚠️ d'un arbitre qui joue ce match ne nomme que le tournoi, la ligne
🛠️ ne désigne donc pas le match à côté.
L'auteur est « le staff », ou « un caster » pour un geste de diffusion
(`live`, rediffusion) de qui détient `live` sans `tournaments`
(`staffActionAuthor`) : la ligne ne prête pas aux arbitres le geste d'un caster.
Les engagés passent par `entrantLabel` (« un joueur » en tournoi individuel,
« TBD » pour une place vide) ; ni score, ni lien, ni équipe hôte : la page du
match dit le détail.

Les têtes de série se réordonnent par glissements successifs : `SEEDING_REORDERED`
passe par un regroupeur (`lib/server/coalescer.ts`) par tournoi — une ligne
après 60 s sans nouveau geste, au plus tard 5 min après le premier. Un autre
geste sur le même tournoi fait d'abord partir la rafale en attente (le journal
garde l'ordre), et l'arrêt propre du serveur l'annonce avant les lots du journal
(`flushAllCoalescers`, `bot-log-shutdown.ts`), comme les lignes de tournoi et
de match déjà parties qui lisent encore la base (`trackAnnouncement`). Les
lignes d'un même tournoi, et celles d'un même match, s'enchaînent
(`createKeyedChain`) : la suivante attend la précédente, sans retenir les autres
— une rafale prend aussi son tour dans cette file, qu'elle parte à son échéance
ou vidée par un geste suivant (détachée au moment de ce geste : une rafale
ouverte après lui reste à venir). Le regroupeur y range la rafale dans le tour
même (`deliverQueues`), sans attendre la précédente : la file garde l'ordre. Un geste fait
coupe-circuit ouvert garde sa ligne : elle rejoint le lot, qui ne part que
minutes plus tard (`LOG_BATCHING.md`). Une modification nomme le
tournoi sous le nom qu'elle a écrit, un renommage cite aussi l'ancien, tous deux lus sous le verrou
(`updateTournament` rend `{ previousName, name }`) — un second renommage
rapproché ne fausse pas la première ligne. Le regroupeur vit en mémoire : un
seul processus sert le site.
« Changé » ne se lit jamais dans une lecture hors verrou : l'hôte se compare sous
le verrou du match, l'antenne et la rediffusion dans l'écriture elle-même
(condition sur l'état de départ, `changedRows`).

## Ce qui ne change pas

- Les équipes fantômes avaient déjà une ligne « inscription » par équipe
  (`registration`, par le staff) : la ligne 🛠️ les regroupe en un geste.
- Les gestes déjà tracés gardent leur ligne : horaires (`schedule-notices.ts`),
  pénalités, abandons, retrait d'un engagé, retour en arrière, suppression d'un
  tournoi, arbitrage des horaires (`publishStaffAction`, auteur nommé dans pm2).
  Les gestes lourds d'administration restent au seul journal (décision 5).
- Un arbitre qui joue le match qu'il tranche reçoit **en plus** l'alerte de
  `dispute-self-resolution.ts` (ligne ⚠️ et push `REFEREE_SELF_RESOLUTION`).
  Qu'il le joue ou non, « Valider le résultat » quand il clôt un litige ou
  corrige un résultat acquis, et un score qui suspend la validation automatique gardent leur
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
`tests/lib/server/staff-action-logs.test.ts`, `tests/lib/server/coalescer.test.ts`,
`tests/app/api/admin/staff-action-log-routes.test.ts`.
