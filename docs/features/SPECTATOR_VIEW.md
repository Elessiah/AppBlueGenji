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
  (`router.replace`, ancre `#match-…` comprise), sans rendre la carte
  « Connexion requise » le temps du relais ;
- membre **connecté** sur `/suivre/tournois/[id]` → `/tournois/[id]`
  (`app/suivre/tournois/[id]/layout.tsx`), où sont ses actions. L'encart de la
  page sans compte ne lit alors pas la carte du tournoi (session mémoïsée pour
  la requête, la redirection la jetterait).

La langue suit l'adresse (`localeHref`). L'ancre `#match-[id]` traverse la
redirection serveur d'une navigation complète (le navigateur la conserve ; une
navigation client la perdrait, d'où les liens directs de la vitrine), la requête (`?utm=…`) aussi :
le middleware la pose à côté du chemin (`x-search`, toujours remplacé), et seule
une valeur qui commence par `?` est reprise (`forwardedSearch`), dans les deux
sens. Le relais client garde les deux.

**Liens qui évitent le détour** — la vitrine sait qui la lit : pour un
visiteur sans session, le tableau des tournois, la carte « en direct » et
l'agenda mènent directement à `/suivre/tournois/[id]`
(`tournamentHref(…, spectator)`, `tournamentMatchHref` pour l'ancre d'un match), sans passer par la carte « Connexion
requise » d'un préchargement. Les liens externes (Discord, ICS, push) passent
par la redirection serveur. Pour un visiteur sans session, la fiche
connectée ne lit même pas la carte du tournoi pour son encart : la redirection
jetterait la requête.

**Retour vers l'espace connecté, sans bouton de plus** — sur la page sans
compte, le « Rejoindre » de l'en-tête de la vitrine mène à
`/connexion?redirect=/tournois/[id]` (`joinHrefFor`), requête comprise, et
l'ancre `#match-…` s'y ajoute côté navigateur (`JoinLink`, `withRedirectAnchor`,
relue à `hashchange` et juste avant le geste — une navigation client ne
déclenche pas `hashchange`) :
un joueur dont la session a expiré, ou un arbitre déconnecté, retrouve ses
actions — et son match — après connexion.

## Une seule fiche

La fiche est **commune** : `TournamentSheet`
(`app/(secured)/tournois/[id]/_components/TournamentSheet.tsx`) reçoit sa
source (`TournamentSheetSource`) — `useTournamentLive` dans l'espace connecté,
`useSpectatorTournament` sur la page sans compte. Ses textes aussi :
`TournamentSheetText` (même dossier), posé par les deux mises en page — un
espace de textes ajouté à la fiche s'y ajoute, et les deux pages le reçoivent.
Toutes ses actions se
décident déjà sur les droits du lecteur ; le contexte du visiteur sans compte
n'en ouvre aucun (ni inscription, ni score, ni signalement, ni outil du staff).

Ce qui ne dépend d'aucun droit se règle par `SpectatorViewProvider`
(`components/spectator-view.tsx`) :

- **noms d'équipe et de joueur sans lien** (`EntityLink` rend un
  `<span class="entity-name">`, marche du podium conservée — celle des équipes
  comme celle, adoucie, des joueurs d'une entrée solo : le podium est public)
  : leurs fiches sont dans l'espace connecté, un lien mènerait à la page de
  connexion ;
- **codes de replay masqués** (`MatchMapDetails`) — et retirés de la réponse
  publique (`spectatorSnapshot`) : la politique de confidentialité les réserve
  aux membres connectés. L'identifiant du caster devient
  `SPECTATOR_HIDDEN_USER_ID` (−1) : la fiche sait qu'un caster est inscrit (son
  pseudo s'affiche, il compte dans les « prêts » du lancement) sans savoir qui.
  Sur une sanction BlueGenji Survie, l'arbitre et le motif (texte libre du
  staff) partent, et la case du motif n'est pas rendue ;
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
| `FINISHED` | 10 min — le staff peut encore le rouvrir (retour en arrière sur la finale) |

**Niveau de charge** (`lib/server/spectator-load.ts`, tout en mémoire) — le plus
haut de trois signaux :

| Signal | Niveaux 1 / 2 / 3 |
| --- | --- |
| Retard de la boucle d'évènements (p99 sur 10 s, pas de 20 ms de la sonde retranché) | 50 / 100 / 200 ms |
| Flux SSE ouverts (membres) | 100 / 200 / 300 |
| Lectures publiques par minute (fenêtres d'une minute exacte, la précédente au prorata) | 600 / 1 200 / 2 400 |

La cadence est multipliée par 1, 2, 4 puis 10, plafonnée à 10 min. Sous la
charge, ce sont donc les visiteurs sans compte qui reculent, jamais le staff ni
les engagés. Le retard de boucle est relevé par une minuterie toutes les 10 s
tant que la sonde est armée (jamais une pause d'il y a cinq minutes). La sonde
n'est armée qu'avec les lectures publiques et se
désarme après 5 min sans activité publique (un seul minuteur, qui se relance
lui-même).

**Coût côté serveur** :

- la réponse publique est **mutualisée** par tournoi
  (`lib/server/spectator-snapshot.ts`, `cached`) : au plus une reconstruction
  par durée de vie (15 s au calme, ×1 à ×10 selon la charge), quel que soit le
  nombre de visiteurs. Une écriture ne **réveille** pas les visiteurs sans
  compte et n'**invalide** pas cette réponse : sa durée de vie, allongée sous la
  charge, est ce qui protège la machine d'un tournoi animé (choix de l'auteur ;
  ce délai, 150 s au pire, est déclaré dans `/rgpd`). Seule la
  **suppression** du tournoi la retire (`invalidateSpectatorSnapshot`,
  `deletion.ts`). La reconstruction lit d'abord la **carte** du tournoi (une
  requête indexée) : un identifiant inconnu ou pas encore publié s'arrête là,
  sans faire construire d'instantané. Un « introuvable » n'entre **pas** dans le
  cache (le chargeur lève une sentinelle, `cached` ne garde jamais un échec). Le
  corps est sérialisé **une fois** (version vide) ;
- en-tête `x-bg-fresh-within-ms` : l'âge maximal de l'affichage (attente entre
  deux lectures, gigue comprise, **plus** la durée de vie de la réponse servie,
  celle reçue à sa construction, peut-être sous une charge plus forte) — c'est
  lui que le témoin annonce, pour ne pas promettre mieux que le cache ;
- `ETag` = empreinte du **corps public** (et non la version des membres, qui
  bouge avec les champs retirés), qui ne voyage que dans l'en-tête ; une relecture sans nouveauté répond **`304`
  sans corps** ;
- seules les lectures d'un tournoi servi pèsent dans la charge : des
  identifiants au hasard ne ralentissent pas les vrais spectateurs ;
- plafond par IP (`SPECTATOR_READ_RULE`, 360/min : une salle de LAN d'une
  centaine d'écrans derrière une même adresse passe, gigue, ouvertures et
  reprises comprises) ; base injoignable → `503` +
  `Retry-After` du double de la cadence au niveau du moment
  (`spectatorUnavailableRetryMs` : 1 min au calme, 10 au pire), puis recul
  doublé par le relecteur — le `Retry-After` n'est qu'un plancher : des `503`
  répétés à l'identique ne figent pas l'attente.

**Côté client** (`app/suivre/tournois/[id]/_lib/spectator-poller.ts`, hors
React, testé sans navigateur) : ±10 % de gigue, rien n'est relu **onglet
caché** (`useClientPower`), la lecture due part au retour ; après un échec, le
`Retry-After` du serveur ou le **double de la dernière attente** (recul
cumulatif jusqu'à 10 min, jamais moins que le `Retry-After`, la cadence reprend
au premier succès). Si la toute
première lecture échoue, le squelette de chargement le dit (« La page réessaie
seule… ») au lieu de sembler figé. Un `404` (tournoi supprimé ou pas encore publié — même réponse, comme partout)
ou un `400` (adresse fabriquée) n'est plus relu qu'au plafond
(`SPECTATOR_NOT_FOUND_RETRY_MS`, 10 min) : un lien partagé avant la publication
s'ouvre seul ensuite, et la page le dit (« revérifie seule toutes les 11
minutes au plus », gigue comprise). Un onglet oublié sur un tournoi supprimé
coûte une requête indexée toutes les dix minutes, et rien onglet caché. Le
démontage coupe la lecture en vol (`AbortController`).

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
(T03). Les codes de replay restent aux membres, comme l'arbitre et le motif d'une
sanction et l'identité du caster. Le numéro de compte interne d'un joueur engagé
en individuel est public (`soloUserIds`, il porte sa marque du podium, publique)
et déclaré comme tel, comme les logos des équipes et l'avatar d'un joueur solo
(copié dans son entrée, et absent s'il l'a masqué : `visibleAvatarUrl`).
La visite est comptée par la mesure d'audience comme sur toute page (sauf
opposition) ; l'adresse IP ne sert par ailleurs qu'au plafond de débit, en
mémoire.

## Tests

- `tests/lib/shared/spectator-view.test.ts` — chemins, niveaux, cadences,
  instantané allégé, contexte sans droit, et **inventaire des champs** : chaque
  champ de `TournamentSnapshot`, `BracketMatch`, d'une map, d'un rapport de
  score et d'une sanction y est classé (`public`, `retiré`, `parcouru`) par un
  `satisfies Record<keyof …>` — un champ ajouté à ces types casse le contrôle
  de types tant qu'on n'a pas décidé s'il part en public.
- `tests/lib/server/spectator-load.test.ts` — signaux de charge.
- `tests/app/api/spectator/tournament-route.test.ts` — route publique (`304`,
  mutualisation, plafond, `503`, aucune session lue).
- `tests/app/spectator-poller.test.ts` — relecteur (cadence, onglet caché,
  reculs, arrêt).
- `tests/app/spectator-view.test.tsx` — redirections, encart, fiche sous
  `SpectatorViewProvider`.
