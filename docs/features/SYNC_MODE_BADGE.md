# Pastille du mode de synchronisation (fiche d'un tournoi)

L'en-tête de `/tournois/[id]` (et de `/suivre/tournois/[id]`) porte, à côté du témoin de flux, **une pastille** qui dit *comment* la page se tient à jour. Le témoin (« À jour » / « Reconnexion… » / « Hors ligne », `LiveIndicator`) dit seulement si la connexion tient : les deux ne se fusionnent pas.

## Les modes (lus à la source, rien de dupliqué)

`lib/shared/sync-mode.ts` (pur) ne décide aucune cadence ; il range, dans cet ordre, ce que décident `refresh-tiers.ts` (palier du flux) et `client-power.ts` (régime) :

| Ordre | Mode | Quand | Variante |
|---|---|---|---|
| 1 | aucun | échec définitif (`fatal`) — le témoin dit « Hors ligne » | — |
| 2 | `POLLING` « Mode relecture » | page avec compte, flux non établi : sondage de secours (`detailFallbackMs`) | `warning` (ambre : dégradé) |
| 3 | `SLEEP` « Mode veille » | onglet caché | `neutral` |
| 4 | `MATCH` « Mode match » | rencontre du lecteur en cours ou imminente (10 min avant l'horaire), dans cet onglet ou un autre (bail partagé) | `accent` |
| 5 | `ECO` « Mode éco » | page sans focus, machine à la peine ou mouvement réduit | `success` |
| 6 | `PRIORITY` « Mode prioritaire » | palier `PRIORITY` : staff `tournaments`, cast, engagés **hors match** | `blue` |
| 6 | `STANDARD` « Mode standard » | palier `STANDARD` : spectateurs, et toujours la page sans compte | `info` |

Écart avec la demande : « prioritaire » n'est pas un régime mais un **palier serveur** ; un joueur en match est lui aussi au palier prioritaire, mais la pastille affiche alors « match » (le régime l'emporte). Sous `MATCH` et `ECO`, qui ne touchent que la peinture, le texte rappelle le palier conservé (`syncModeTierNote`) et la liste des autres modes l'omet.

## Ce qui dit vrai selon la page

- **Palier accordé** : `useTournamentLive` expose le palier du dernier instantané reçu sur un flux **plein**. Un flux calmé (`?quiet=1`, onglet caché depuis une minute) reçoit le palier spectateur : la pastille ne dit pas « spectateur » à un prioritaire au retour sur l'onglet.
- **Match d'un autre onglet** : `viewerMatch` (`viewerMatchFocus` de ce tournoi, via `TournamentSheetSource`) distingue le match du lecteur ici d'un régime `MATCH` venu d'un autre onglet (`nowElsewhere`).
- **Page sans compte** (`useSpectatorView`, source `POLL`) : pas de flux. Ni `PRIORITY` ni `POLLING` ; un échec de lecture ne change pas le mode (le témoin dit « Hors ligne ») ; `STANDARD` et `SLEEP` ont leur texte de relecture (`nowPoll`, `otherPoll` : onglet caché, la relecture s'arrête). L'aide n'énumère que `POLL_SYNC_MODES`.
- Durées citées (regroupement en match, calme de la veille, cadence prioritaire) : interpolées depuis `MATCH_BACKGROUND_RENDER_DELAY_MS`, `QUIET_STREAM_AFTER_MS`, `REFRESH_CADENCE`, jamais écrites dans le texte.

## Câblage

- `useSyncMode` (`_components/SyncModeBadge.tsx`) lit `useClientPower()` : seuls la pastille et le « i » se redessinent à un alt-tab, pas la fiche (qui s'abonne par `subscribeClientPower`). Le « i » calcule le mode une fois et le passe à `SyncModeExplanation`.
- Pas de `aria-live` : le mode bascule à chaque changement de focus, ce serait du bruit ; le texte porte le sens.
- Le « i » (`InfoHint`) explique le mode courant avec sa cadence, puis liste brièvement les autres (demande de l'utilisateur, une phrase chacun). Page sans compte : ajouté au « i » de la pastille Spectateur (un seul « i ») ; la phrase du témoin n'y reste que hors lecture réussie, la cadence n'est pas dite deux fois.
- Textes : `messages/{fr,en}/tournament.json`, `live.sync.*`.
- Le témoin global en bas à droite (`ClientPowerBadge`) reste : il porte la case « Ignorer la détection de performances ». Ses textes sont dans `messages/{fr,en}/shell.json`, `clientPower.*`.

Tests : `tests/lib/shared/sync-mode.test.ts`, `tests/tournois/sync-mode-badge.test.tsx`, `tests/app/client-power-badge.test.tsx`.
