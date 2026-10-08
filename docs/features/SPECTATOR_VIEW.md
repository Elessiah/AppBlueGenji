# Suivre un tournoi sans compte (`/suivre/tournois/[id]`)

Un spectateur qui reçoit le lien d'un tournoi (Discord, retransmission) doit
pouvoir le **suivre sans se connecter** : plateau, scores, classements, engagés.
La liste des tournois, les fiches d'équipe et de joueur et toutes les actions
restent dans l'espace connecté — le tableau des tournois de l'accueil tient lieu
de liste publique.

## Deux espaces séparés

| | Espace connecté | Page sans compte |
| --- | --- | --- |
| Adresse | `/tournois/[id]` | `/suivre/tournois/[id]` (`/en/…` traduite) |
| Gabarit | `ArenaShell` | `PublicPageShell` (vitrine) |
| Donnée | flux SSE `/api/tournaments/[id]/stream` + REST de secours | lecture publique `/api/spectator/tournaments/[id]` |
| Contexte du lecteur | calculé par le serveur | constant, sans aucun droit (`SPECTATOR_VIEWER_CONTEXT`) |
| Session | lue partout | **jamais lue** par la route publique |
| Indexation | `noindex` (espace sécurisé) | `noindex` |

**Redirections** — chacun arrive dans son espace, quel que soit le lien suivi :

- visiteur **sans session** sur `/tournois/[id]` → `/suivre/tournois/[id]`
  (`app/(secured)/layout.tsx`, sur le chemin posé par le middleware,
  `x-pathname`). Seule la **fiche** est concernée : `/tournois`,
  `/tournois/creer`, `/tournois/[id]/modifier` gardent la carte « Connexion
  requise ». Un **préchargement** de la fiche arrive sans `x-pathname` (le
  `matcher` du middleware les exclut) : `AuthGate` le relaie côté client
  (`router.replace`, ancre `#match-…` comprise) ;
- membre **connecté** sur `/suivre/tournois/[id]` → `/tournois/[id]`
  (`app/suivre/tournois/[id]/layout.tsx`), où sont ses actions.

La langue suit l'adresse (`localeHref`). L'ancre `#match-[id]` traverse la
redirection serveur (le navigateur la conserve).

## Une seule fiche

La fiche est **commune** : `TournamentSheet`
(`app/(secured)/tournois/[id]/_components/TournamentSheet.tsx`) reçoit sa
source (`TournamentSheetSource`) — `useTournamentLive` dans l'espace connecté,
`useSpectatorTournament` sur la page sans compte. Toutes ses actions se
décident déjà sur les droits du lecteur ; le contexte du visiteur sans compte
n'en ouvre aucun (ni inscription, ni score, ni signalement, ni outil du staff).

Ce qui ne dépend d'aucun droit se règle par `SpectatorViewProvider`
(`components/spectator-view.tsx`) :

- **noms d'équipe et de joueur sans lien** (`EntityLink` rend un
  `<span class="entity-name">`, marche du podium conservée) : leurs fiches sont
  dans l'espace connecté, un lien mènerait à la page de connexion ;
- **codes de replay masqués** (`MatchMapDetails`) — et retirés de la réponse
  publique (`spectatorSnapshot`) : la politique de confidentialité les réserve
  aux membres connectés ;
- **en-tête** : « Accueil » au lieu de « Tous les tournois », pastille
  « Spectateur » (qui dit pourquoi aucun bouton n'apparaît), témoin qui annonce
  la cadence accordée par le serveur. **Aucun bouton vers la connexion** n'est
  ajouté : la page est faite pour regarder.

## Le moins prioritaire du site

Le visiteur sans compte n'a **pas de flux SSE**. Il relit une route publique à
la cadence que le **serveur** choisit selon sa charge, annoncée par l'en-tête
`x-bg-poll-after-ms` (`lib/shared/spectator-view.ts`) :

| État du tournoi | Cadence au calme |
| --- | --- |
| `RUNNING` | 30 s (`SPECTATOR_RUNNING_POLL_MS`) — après les 20 s du palier spectateur connecté |
| `UPCOMING`, `REGISTRATION` | 2 min |
| `FINISHED` | plus de relecture (en-tête absent) |

**Niveau de charge** (`lib/server/spectator-load.ts`, tout en mémoire) — le plus
haut de trois signaux :

| Signal | Niveaux 1 / 2 / 3 |
| --- | --- |
| Retard de la boucle d'évènements (p99, fenêtre de 10 s) | 50 / 100 / 200 ms |
| Flux SSE ouverts (membres) | 100 / 200 / 300 |
| Lectures publiques par minute | 600 / 1 200 / 2 400 |

La cadence est multipliée par 1, 2, 4 puis 10, plafonnée à 10 min. Sous la
charge, ce sont donc les visiteurs sans compte qui reculent, jamais le staff ni
les engagés.

**Coût côté serveur** :

- la réponse publique est **mutualisée** par tournoi
  (`lib/server/spectator-snapshot.ts`, `cached`) : au plus une reconstruction
  par durée de vie (15 s au calme, ×1 à ×10 selon la charge), quel que soit le
  nombre de visiteurs, et sérialisée une fois. Aucune invalidation : une
  écriture ne réveille pas les visiteurs sans compte ;
- `ETag` = version de l'instantané ; une relecture sans nouveauté répond
  **`304` sans corps** ;
- plafond par IP (`SPECTATOR_READ_RULE`, 120/min : une salle de LAN derrière
  une même adresse passe) ; base injoignable → `503` + `Retry-After` de 10 min.

**Côté client** (`app/suivre/tournois/[id]/_lib/spectator-poller.ts`, hors
React, testé sans navigateur) : ±10 % de gigue, rien n'est relu **onglet
caché** (`useClientPower`), la lecture due part au retour ; après un échec, le
`Retry-After` du serveur ou le double de la dernière cadence. Un `404` arrête
tout (tournoi supprimé ou pas encore publié — même réponse, comme partout).

## Visibilité

La route publique passe par `getVisibleTournamentSnapshot` **sans aucun
droit** : un tournoi pas encore publié (`start_visibility_at`) n'existe pas
pour elle. L'encart (`tournamentPageMetadata`, `lib/server/tournament-metadata.ts`,
commun aux deux espaces) et l'image d'aperçu (réexport de
`app/(secured)/tournois/[id]/opengraph-image.tsx`) appliquent la même règle.
Un robot d'aperçu, sans session, suit la redirection et lit l'encart du
tournoi sur la page sans compte.

## RGPD

Changement de **qui lit** la fiche : entrée `2026-10-suivi-tournoi-sans-compte`
de `PRIVACY_CHANGES` (et son anglais), paragraphe « Suivre un tournoi sans
compte » de `/rgpd` (`#suivi-sans-compte`), sous-finalité ajoutée au registre
(T03). Les codes de replay restent aux membres ; l'adresse IP ne sert qu'au
plafond de débit, en mémoire.

## Tests

- `tests/lib/shared/spectator-view.test.ts` — chemins, niveaux, cadences,
  instantané allégé, contexte sans droit.
- `tests/lib/server/spectator-load.test.ts` — signaux de charge.
- `tests/app/api/spectator/tournament-route.test.ts` — route publique (`304`,
  mutualisation, plafond, `503`, aucune session lue).
- `tests/app/spectator-poller.test.ts` — relecteur (cadence, onglet caché,
  reculs, arrêt).
- `tests/app/spectator-view.test.tsx` — redirections, encart, fiche sous
  `SpectatorViewProvider`.
