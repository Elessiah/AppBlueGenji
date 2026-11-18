# Pastille du mode de synchronisation (fiche d'un tournoi)

L'en-tête de `/tournois/[id]` (et de `/suivre/tournois/[id]`) porte, à côté du témoin de flux, **une pastille** qui dit *comment* la page se tient à jour. Le témoin (« À jour » / « Reconnexion… » / « Hors ligne », `LiveIndicator`) dit seulement si la connexion tient : les deux ne se fusionnent pas.

## Les modes (lus à la source, rien de dupliqué)

`lib/shared/sync-mode.ts` (pur) ne décide aucune cadence ; il range, dans cet ordre, ce que décident `refresh-tiers.ts` (palier du flux) et `client-power.ts` (régime) :

| Ordre | Mode | Quand | Variante |
|---|---|---|---|
| 1 | aucun | échec définitif (`fatal`) — le témoin dit « Hors ligne » | — |
| 2 | `POLLING` « Mode secours » | page avec compte, flux non établi : sondage de secours (`detailFallbackMs`) | `warning` (ambre : dégradé) |
| 3 | `SLEEP` « Mode veille » | onglet caché | `accent` |
| 4 | `MATCH` « Mode match » | rencontre du lecteur en cours ou imminente (10 min avant l'horaire), dans cet onglet ou un autre (bail partagé) ; jamais sur la page sans compte, qui se dit alors `ECO` | `accent` |
| 5 | `ECO` « Mode éco » | page sans focus, machine à la peine ou mouvement réduit | `accent` |
| 6 | `PRIORITY` « Mode prioritaire » | palier `PRIORITY` : staff `tournaments`, cast, engagés **hors match** | `highlight` |
| 6 | `STANDARD` « Mode standard » | palier `STANDARD` : spectateurs, et toujours la page sans compte | `success` |

Écart avec la demande : « prioritaire » n'est pas un régime mais un **palier serveur** ; un joueur en match est lui aussi au palier prioritaire, mais la pastille affiche alors « match » (le régime l'emporte). Sous `MATCH` et `ECO`, qui ne touchent que la peinture, le texte rappelle le palier conservé (`syncModeTierNote`) et la liste des autres modes l'omet.

## Ce qui dit vrai selon la page

- **Palier accordé** : un flux calmé (`?quiet=1`, onglet caché depuis une minute) reçoit le palier spectateur ; `applyStreamMessage` (`_lib/live-state.ts`) garde alors dans l'état le palier du dernier flux **plein**. Une seule source : pastille, témoin et sondage de secours lisent ce même palier — au retour sur l'onglet, un prioritaire n'est ni dit ni relu « spectateur ».
- **Regroupement en match** : sur la page avec compte, le texte du mode `MATCH` ajoute `live.sync.matchBatched` (sans focus, affichage regroupé `MATCH_BACKGROUND_RENDER_DELAY_MS`, sauf le match du lecteur — `syncModeBatchNote`) ; la page sans compte n'a pas de flux, rien n'y est regroupé.
- **Clés écrites en toutes lettres** : `SYNC_MODE_NOW_KEYS` / `SYNC_MODE_OTHER_KEYS` (`SyncModeBadge.tsx`), vérifiées par le compilateur ; aucune clé construite par gabarit puis forcée.
- **Match d'un autre onglet** : `viewerMatch` (`viewerMatchFocus` de ce tournoi, via `TournamentSheetSource`) distingue le match du lecteur ici d'un régime `MATCH` venu d'un autre onglet (`nowElsewhere`).
- **Page sans compte** (`useSpectatorView`, source `POLL`) : pas de flux. Ni `PRIORITY` ni `POLLING`, ni `MATCH` : ce régime n'y viendrait que du bail d'un onglet connecté, et une page projetée ou diffusée ne doit rien dire du compte ouvert à côté — elle affiche `ECO` (animations figées, ce qu'elle fait alors) ; un échec de lecture ne change pas le mode (le témoin dit « Hors ligne ») ; `STANDARD` et `SLEEP` ont leur texte de relecture (`nowPoll`, `otherPoll` : onglet caché, la relecture s'arrête). L'aide n'énumère que `POLL_SYNC_MODES`.
- Durées citées (regroupement en match, calme de la veille, cadence prioritaire) : interpolées depuis `MATCH_BACKGROUND_RENDER_DELAY_MS`, `QUIET_STREAM_AFTER_MS`, `REFRESH_CADENCE`, jamais écrites dans le texte.

## Câblage

- `useSyncMode` (`_components/SyncModeBadge.tsx`) lit `useClientPower()` : seuls la pastille et le « i » se redessinent à un alt-tab, pas la fiche (qui s'abonne par `subscribeClientPower`). L'en-tête **ne s'abonne pas** : il rend `SyncModeBadge` et `SyncModeHint` (`memo`), qui appellent chacun `useSyncMode` (résultat mémoïsé : même identité tant que palier, régime, flux, source et match ne changent pas) — la pastille Spectateur aussi —, si bien qu'un alt-tab ne redessine ni l'en-tête ni ses outils. Les vues (`SyncModeBadgeView`, `SyncModeHintView`, `SyncModeExplanation`) sont `memo` : fermée, l'aide reste montée (`InfoHint`) mais ne se recompose qu'au changement de mode, pas à chaque message du flux. Les clés des textes sont des tables écrites en toutes lettres (`SYNC_MODE_LABEL_KEYS`, `SYNC_MODE_KEPT_KEYS`).
- Palier sous flux calmé : `onMessage(message, quiet)` reçoit le drapeau du flux **à son ouverture** (`live-connection.ts`), jamais celui du moment de l'arrivée — la dernière trame d'un flux calmé qu'on remplace ne dégrade plus le palier du lecteur.
- Pas de `aria-live` : le mode bascule à chaque changement de focus, ce serait du bruit ; le texte porte le sens.
- Le « i » (`InfoHint`) explique le mode courant avec sa cadence, puis liste brièvement les autres (demande de l'utilisateur, une phrase chacun). Page sans compte : ajouté au « i » de la pastille Spectateur (un seul « i ») ; la phrase du témoin n'y reste que hors lecture réussie, la cadence n'est pas dite deux fois.
- Textes : `messages/{fr,en}/tournament.json`, `live.sync.*`.
- Le témoin global en bas à droite (`ClientPowerBadge`) reste : il porte la case « Ignorer la détection de performances ». Ses textes sont dans `messages/{fr,en}/shell.json`, `clientPower.*`.

Tests : `tests/lib/shared/sync-mode.test.ts`, `tests/tournois/sync-mode-badge.test.tsx`, `tests/app/client-power-badge.test.tsx`.

Pastille : `white-space: nowrap` (`SyncModeBadge.module.css`), jamais coupée en deux lignes à 375 px. Ni bleu (le témoin de flux voisin l'est) ni gris : deux pastilles identiques côte à côte se liraient comme un seul état.
