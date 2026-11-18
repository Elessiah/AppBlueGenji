# Pastille du mode de synchronisation (fiche d'un tournoi)

L'en-tête de `/tournois/[id]` (et de `/suivre/tournois/[id]`) porte, à côté du témoin de flux, **une pastille** qui dit *comment* la page se tient à jour. Le témoin (« À jour » / « Reconnexion… » / « Hors ligne », `LiveIndicator`) dit seulement si la connexion tient : les deux ne se fusionnent pas.

## Les modes (lus à la source, rien de dupliqué)

`lib/shared/sync-mode.ts` (pur) ne décide aucune cadence ; il range, dans cet ordre, ce que décident `refresh-tiers.ts` (palier du flux) et `client-power.ts` (régime) :

| Ordre | Mode | Quand | Variante |
|---|---|---|---|
| 1 | aucun | échec définitif (`fatal`) — le témoin dit « Hors ligne » | — |
| 2 | `POLLING` « Mode relecture » | flux non établi : sondage de secours (`detailFallbackMs`) | `warning` (ambre : dégradé) |
| 3 | `SLEEP` « Mode veille » | onglet caché | `neutral` |
| 4 | `MATCH` « Mode match » | le lecteur a une rencontre en cours | `accent` |
| 5 | `ECO` « Mode éco » | page sans focus, machine à la peine ou mouvement réduit | `success` |
| 6 | `PRIORITY` « Mode prioritaire » | palier `PRIORITY` : staff `tournaments`, cast, engagés **hors match** | `blue` |
| 6 | `STANDARD` « Mode standard » | palier `STANDARD` : spectateurs | `info` |

Écart avec la demande : « prioritaire » n'est pas un régime mais un **palier serveur** ; un joueur en match est lui aussi au palier prioritaire, mais la pastille affiche alors « match » (le régime l'emporte). Le mode éco ne change pas la cadence reçue (seulement la peinture) : son texte énonce la cadence du palier.

## Câblage

- `useSyncMode` (`_components/SyncModeBadge.tsx`) lit `useClientPower()` : seuls la pastille et le « i » se redessinent à un alt-tab, pas la fiche (qui s'abonne par `subscribeClientPower`).
- Pas de `aria-live` : le mode bascule à chaque changement de focus, ce serait du bruit ; le texte porte le sens.
- Le « i » (`InfoHint`) explique le mode courant avec sa cadence, puis liste les autres. Page sans compte : ces paragraphes sont ajoutés au « i » existant de la pastille Spectateur (un seul « i »).
- Textes : `messages/{fr,en}/tournament.json`, `live.sync.*`.
- Le témoin global en bas à droite (`ClientPowerBadge`) reste : il porte la case « Ignorer la détection de performances ».

Tests : `tests/lib/shared/sync-mode.test.ts`, `tests/tournois/sync-mode-badge.test.tsx`.
