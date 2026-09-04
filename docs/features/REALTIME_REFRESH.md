# Rafraîchissement des données critiques

> Objectif : plus personne n'a de raison d'appuyer sur F5, et le serveur tient
> une centaine de joueurs simultanés sur un Raspberry Pi 5 (4 cœurs, 16 Go).

## Le problème de départ

L'application publiait déjà des événements de tournoi sur un flux SSE
(`lib/server/live.ts`), mais ces événements ne transportaient **qu'un signal** :
« quelque chose a changé ». Chaque client y répondait en rechargeant le détail
complet du tournoi.

Conséquences mesurables :

| Symptôme | Cause |
| --- | --- |
| Un score rapporté devant 100 spectateurs → 100 `GET /api/tournaments/:id` simultanés | Chaque client recalculait le même détail, la lecture la plus coûteuse du site (une dizaine de requêtes + une transaction d'entretien), avec un pool MySQL de 25 connexions |
| La liste `/tournois` ne bougeait jamais | Aucun rafraîchissement : un tournoi créé, ou dont les inscriptions venaient d'ouvrir, n'apparaissait qu'au rechargement |
| Une page de tournoi figée après une coupure réseau | La reconnexion SSE abandonnait après 5 essais, définitivement |
| L'accueil rendu à chaque visite (`force-dynamic`) | ~10 agrégations par chargement, plus un `GET /api/landing/live` **toutes les 10 s et par visiteur** — 100 visiteurs = 10 req/s sur une agrégation de tous les tournois |
| Aucun plafond de débit | Rien n'arrêtait un F5 en rafale ni un onglet parti en boucle |

## Le principe retenu : pousser, ne plus tirer

Le détail d'un tournoi est **presque entièrement le même pour tout le monde**.
Il est donc scindé en deux :

- **`TournamentSnapshot`** — plateau, inscrites, classements, phases. Identique
  pour tous, calculé **une seule fois**.
- **`TournamentViewerContext`** — ce que *ce* lecteur peut faire (son engagement,
  ses droits), **et ce qu'il a le droit de voir**. Ne change qu'à l'inscription.

  L'aperçu du plateau avant lancement (`TOURNAMENT_PREVIEW.md`) vit ici, et non
  dans l'instantané : celui-ci part tel quel à tous les abonnés du flux, alors
  que l'aperçu est réservé aux permissions `tournaments` et `casting`. C'est la
  règle générale de la scission — tout ce qui dépend d'un droit reste hors de ce
  qui est diffusé.

  Il est **gaté par une permission, pas propre à une personne** : son contenu
  est le même pour tous ceux qui y ont droit. Il est donc calculé une fois par
  tournoi (`tournaments/preview-cache.ts`, invalidé par `publishUpdatedEvent`)
  plutôt qu'à chaque connexion. Et parce qu'il se périme à chaque inscription
  alors que le flux ne le transporte pas, le client redemande son contexte quand
  l'ensemble des inscrites change — uniquement pour ceux qui ont un aperçu à
  tenir à jour (`shouldRefreshViewerContext`). La comparaison porte sur l'**ordre
  de tirage** — les engagées et leur rang — et non sur leur nombre : le staff
  réorganise ce tirage à effectif constant, et c'est le cas le plus fréquent.

  Même raison pour `canManageLive` (permission `live`,
  `docs/features/LIVE_STREAMS.md`) : les commandes d'antenne d'un match sont un
  droit du lecteur, pas un état du plateau. L'état de diffusion lui-même
  (`liveTrigger`, `liveUrl`, `liveStartedAt`) reste dans l'instantané — il est
  le même pour tout le monde, et c'est ce qui le fait arriver en direct.

`TournamentDetail = TournamentSnapshot & TournamentViewerContext` : les
appelants existants ne voient aucune différence.

Chaque droit doit voyager par **les deux** portes — la route du flux
(`stream/route.ts`) et la lecture REST de secours. Le flux étant le chemin
nominal, un droit câblé uniquement sur la seconde ne parviendrait à son porteur
qu'après une coupure du direct.

Le flux SSE envoie l'instantané complet à la connexion (avec le contexte du
lecteur), puis chaque nouvelle version. **Dans le cas nominal, la page de
tournoi ne fait aucune requête REST** — ni au chargement, ni pendant le tournoi.

```
                    ┌─────────────────────────┐
  score rapporté ──▶│  publish…Event()        │──▶ invalide les caches
                    └───────────┬─────────────┘
                                ▼
                    ┌─────────────────────────┐
                    │  salle du tournoi       │  1 calcul, 1 encodage
                    │  (tournament-broadcast) │
                    └───────────┬─────────────┘
                     ┌──────────┴──────────┐
                     ▼                     ▼
              PRIORITY (≤ 1 s)      STANDARD (≤ 20 s)
              staff + engagés          spectateurs
```

Le coût en base devient **indépendant du nombre de spectateurs**.

## Les paliers de fraîcheur

`lib/shared/refresh-tiers.ts` — module pur, seul endroit où se décident les
cadences ; serveur et client y lisent les mêmes nombres.

| | `PRIORITY` (staff `tournaments`, cast `casting`, engagés du tournoi) | `STANDARD` (spectateurs, visiteurs) |
| --- | --- | --- |
| Regroupement des envois SSE | 1 s | 20 s |
| Sondage de secours du détail (flux coupé) | 15 s | 120 s |
| Liste `/tournois` | 60 s | 300 s |

Le bandeau « en direct » de l'accueil ne figure pas dans cette table : la page
est publique et anonyme, il n'y a personne dont résoudre le palier. Sa cadence
vit à part (`LANDING_LIVE_INTERVAL_MS`, 5 min) plutôt que d'annoncer une
distinction qui n'aurait aucun effet.

Le palier est décidé **par le serveur** à la connexion du flux et annoncé au
client : il ne se déclare pas.

### Budget de sortie

Le regroupement borne la *fréquence* des envois, pas leur *poids*. Mesure faite
sur le jeu de test : l'instantané d'un tournoi à 128 équipes en double
élimination (254 matchs) pèse **154 ko** — et dans un tournoi de cette taille,
les inscrits, tous prioritaires, sont 128. Un score rapporté écrirait donc près
de **20 Mo d'un coup**. Le lien du Raspberry Pi ne suit pas, et les tampons de
socket montent d'autant.

Chaque salle a donc un budget de sortie (`ROOM_BYTES_PER_SECOND`, 512 ko/s) :
la fenêtre effective est la plus large des deux, celle du palier et celle
qu'impose le poids à écrire. Une petite salle n'est jamais concernée (6 ko vers
20 abonnés = 0,2 s, absorbé par la fenêtre du palier) ; une grosse salle
ralentit au lieu de saturer. L'attente est plafonnée à 60 s pour qu'aucune salle
ne devienne muette.

Le budget se calcule sur **toute la salle**, jamais palier par palier, et
s'applique comme plancher commun. Par palier, il renversait l'ordre : dans un
tournoi à 128 équipes, les 128 inscrits — tous prioritaires — héritaient d'une
fenêtre de 38 s quand la vingtaine de spectateurs était servie toutes les 20 s.
Les équipes qui jouent recevaient leur plateau deux fois moins souvent que ceux
qui les regardent, et ce dans les tournois où la promesse compte le plus. Le
plancher commun garantit que le prioritaire n'attend jamais plus longtemps que
le spectateur.

Celui qui vient d'agir ne la subit pas : sa page relit immédiatement de son
côté.

> Le **cast** (`CASTER`, permission `casting`) est prioritaire au même titre que
> le staff : il commente le match pendant qu'il se joue, et le laisser au palier
> spectateur lui ferait décrire un plateau vieux de vingt secondes. C'est la
> route du flux qui l'y fait entrer — `resolveRefreshTier({ isStaff: canAny(user,
> ["tournaments", "casting"]), … })` —, jamais `refresh-tiers.ts`, qui ne connaît
> aucun rôle. Un palier propre au cast n'aurait rien à dire de plus.

## Ce qui remplace le F5

1. **Le flux pousse** la donnée : rien à recharger pendant qu'on regarde.
2. **Le retour sur l'onglet** rafraîchit (`useAutoRefresh`), étranglé à une fois
   toutes les 15 s. C'est le geste que le F5 remplaçait.
3. **Les bascules d'état sont calculées côté client**
   (`lib/shared/tournament-state.ts` + `useScheduledBuckets`) : une carte passe
   de « Prochainement » à « Inscriptions » **à la seconde dite**, sans aucune
   requête. L'horaire est public et déjà présent dans la carte ; le serveur
   reste seul juge de ce qu'il autorise.
4. **La reconnexion n'abandonne jamais** — sauf échec définitif : plafond
   exponentiel jusqu'à 60 s, avec une attente **tirée au hasard dans tout
   l'intervalle** (« full jitter ») et un plancher de 250 ms. Au redémarrage du
   serveur, toutes les pages ouvertes tombent à la même seconde : une gigue
   étroite les ferait revenir dans la même demi-seconde, et chaque reconnexion
   prend une connexion du pool.

   Une session expirée ou un tournoi supprimé, eux, ne passeront pas tout
   seuls : le flux SSE ne dit jamais pourquoi il tombe, mais la lecture REST de
   secours voit le 401/404. La boucle s'arrête alors, la pastille passe à
   « Hors ligne », une notification invite à se reconnecter, et **les actions
   sont retirées** — ce qui est affiché ne bouge plus, une équipe ne doit pas
   saisir un score en croyant son plateau à jour. Si l'échec précède la première
   donnée, la page affiche un écran dédié avec un lien vers `/connexion` plutôt
   qu'un « Chargement… » sans fin. 429 et 5xx restent retentés.
5. **La salle se réveille à l'heure exacte** de la prochaine bascule d'état,
   pour toute la salle d'un coup — plutôt que de laisser cent clients se
   réveiller chacun de leur côté à la même seconde.

## Ce qui protège le serveur

### Cache mémoire à vol unique — `lib/server/cache.ts`

Le point clé n'est pas la durée de vie mais le **vol unique** : cent appels
concurrents sur une clé froide partagent le même calcul au lieu d'en lancer un
chacun. Une rafale de F5 coûte une requête SQL.

Un `ttlMs` nul conserve le vol unique sans rien mémoriser — utile pour une
donnée qui doit rester exacte tout en supportant une pointe.

Une invalidation survenue *pendant* un calcul en vol empêche son résultat d'être
conservé (compteur de génération par clé) : pas de valeur périmée réinstallée
juste après l'écriture qui l'a rendue fausse.

| Clé | Durée de vie | Invalidée par |
| --- | --- | --- |
| `tournament-snapshot:<id>` | 3 s | toute publication d'événement du tournoi |
| `tournaments-list:public` | 15 s | `updated` (plateau, inscrites, état), la création d'un tournoi, et une clôture détectée autour d'un score |
| `landing:stats`, `landing:ticker`, `landing:leaderboard:<n>` | 60 s | — |
| `landing:live` | 5 s | — |
| `tournament-preview:<id>` | 3 s | toute publication d'événement du tournoi |
| `showcase:sponsors`, `:about-stats`, `:about-pillars`, `:site-copy` | 60 s | toute écriture du staff |
| `mini-bracket:<id>` | 15 s | — |

Toute écriture passe par `tournaments/notifications.ts`, qui est donc le point
unique où caches et abonnés sont prévenus ensemble. C'est ce qui permet des
durées de vie confortables sans jamais afficher un score périmé.

**Un score ne vide pas les listes.** Il ne touche ni les colonnes de
`bg_tournaments` ni le nombre d'inscrites : les invalider garderait froid le
cache le plus rentable du site pendant toute une soirée de tournois, quand les
scores tombent en rafales. Le seul cas où un score déplace un tournoi dans la
liste est celui qui le clôt : les écritures de score comparent donc l'état
autour de leur transaction (`invalidateListsIfStateChanged`) plutôt que de faire
remonter un « ça a fini » à travers les cinq orchestrations qui peuvent clore.
La bascule d'état déclenchée par une simple lecture (`snapshot.ts`) rafraîchit
les listes de la même façon.

### Étranglement de la synchronisation d'états

`syncVisibleTournaments()` entretient les tournois **qui ont quelque chose à
faire**, une transaction par tournoi (voir `TOURNAMENT_SYNC_SCOPE.md` : la passe
repassait auparavant sur tous les tournois non terminés, dans une transaction
unique, et une base de démonstration lui faisait dépasser les cinq minutes). Son
étranglement passe de **1 s à 15 s** : à une seconde, une poignée de visiteurs
suffisait à la faire tourner en continu. L'affichage ne l'attend plus (points 3
et 5 ci-dessus), et la page d'un tournoi déclenche désormais sa propre bascule à
la lecture.

Elle est appelée **hors** du chargeur mis en cache — dedans, les événements
qu'elle publie invalideraient la liste qu'elle vient de rendre correcte — et son
échec est avalé : c'est un entretien d'arrière-plan, pas une condition pour
servir une liste que le cache tient peut-être déjà prête.

### Plafonds de débit — `lib/server/rate-limit.ts` + `lib/server/api-guard.ts`

Fenêtre fixe, en mémoire, volontairement approximative. Les plafonds sont
**larges** : ils bornent l'anormal, ils ne disciplinent pas l'usage.

| Route | Plafond | Clé |
| --- | --- | --- |
| `GET /api/tournaments`, `GET /api/tournaments/:id` | 90 / min | utilisateur |
| `GET /api/landing/*` | 180 / min | IP (via le proxy de confiance) |
| `POST /api/visits` | 60 / min | IP |
| `GET /api/tournaments/:id/stream` (ouvertures) | 30 / min | utilisateur |
| Flux SSE simultanés | 4 | utilisateur |

Le plafond d'**ouvertures** du flux est distinct de celui des flux
*simultanés* : une fermeture libère aussitôt la place, si bien qu'une boucle
ouverture/fermeture échapperait au second tout en refaisant à chaque tour le
travail le plus cher de la route.

L'IP retenue est celle **ajoutée par le proxy** (`X-Forwarded-For` lu depuis la
droite sur `TRUSTED_PROXY_HOPS` relais) : un en-tête forgé ne permet pas de se
fabriquer une identité neuve à chaque requête.

**Une identité absente n'est pas plafonnée.** Sans en-tête de proxy — `next
start` exposé directement, reverse-proxy déployé sans `proxy_set_header
X-Forwarded-For`, banc d'essai local — *tous* les visiteurs partageraient sinon
le même seau, et cent joueurs se verraient refuser la page d'accueil au bout de
180 requêtes cumulées : le garde-fou provoquerait la panne qu'il doit éviter. On
préfère ne pas compter que compter faux ; la croissance de la table de
fréquentation, elle, reste bornée par le plafond d'**insertions** du service.

Le limiteur d'insertions du compteur de fréquentation, jusqu'ici écrit à la
main dans `site-visits-service.ts`, s'appuie maintenant sur le même module.

### Moins de requêtes à la source

- `<VisitTracker />` déduplique son ping **dans l'onglet** sur la même fenêtre
  que le serveur : le comptage ne change pas (le serveur regroupait déjà ces
  chargements), mais un visiteur qui recharge en boucle ne fait plus payer à
  chaque fois une résolution de session et une lecture en base.
- Le bandeau « en direct » de l'accueil passe de **10 s** à la cadence du palier
  spectateur (5 min), et **ne demande rien quand l'onglet est caché**.
- `export const revalidate` était mort à côté de `force-dynamic` sur les routes
  de la vitrine : supprimé, la mutualisation se fait en amont.

## Carte des fichiers

### Purs (`lib/shared`, testables sans base ni navigateur)

| Fichier | Rôle |
| --- | --- |
| `refresh-tiers.ts` | Paliers et cadences. Source unique. |
| `tournament-state.ts` | État d'un tournoi d'après ses dates + instant du prochain changement. |
| `tournament-schedule.ts` | Reclassement local des paniers de la liste. |
| `hooks/useAutoRefresh.ts` | Rafraîchissement de fond : onglet, réseau, période. |
| `hooks/useScheduledBuckets.ts` | Paniers reclassés, remis à jour à la seconde dite. |

### Serveur

| Fichier | Rôle |
| --- | --- |
| `cache.ts` | Cache mémoire à vol unique. |
| `rate-limit.ts` | Seaux à fenêtre fixe (contrôle et débit séparés). |
| `api-guard.ts` | Plafonds des routes + IP client. |
| `tournament-broadcast.ts` | Salles SSE : un calcul par tournoi, regroupement par palier, budget de sortie, battement d'entretien. |
| `tournaments/snapshot.ts` | Construction et mise en cache de l'instantané. |
| `tournaments/list-cache.ts` | Cache de la liste publique. |
| `tournaments/notifications.ts` | Publication d'événement **et** invalidation des caches. |

### Client

| Fichier | Rôle |
| --- | --- |
| `tournois/[id]/_lib/live-state.ts` | Logique pure du flux : analyse, fusion, reconnexion, signal sonore. |
| `tournois/[id]/_hooks/useTournamentLive.ts` | Le hook, réduit au câblage. |

## Détails qui comptent

- **Le signal sonore** ne se déclenche plus sur n'importe quel événement, mais
  quand un match **du lecteur** entre en attente de confirmation — comparaison
  des deux instantanés. Les spectateurs, qui n'ont rien à confirmer, ne
  l'entendent plus.
- **`canRegister` est recalculé à chaque instantané** avec la règle du serveur :
  l'ouverture comme la fermeture des inscriptions se voient dans les deux sens
  sans recharger.
- **Après une action de l'utilisateur** (score, inscription, abandon), la page
  relit immédiatement : celui qui agit mérite un retour instantané quel que soit
  son palier. Le flux n'est rouvert que si son contexte a changé — s'inscrire
  fait passer prioritaire, ce que seul le serveur peut acter.
- **`router.refresh()`** était appelé après le réordonnancement du seeding et
  l'inscription d'une équipe fantôme : sans effet sur une page cliente dont les
  données viennent du hook. Remplacé par le vrai rafraîchissement.
- **Le battement de cœur SSE** est une ligne de commentaire (`: ping`) et non un
  message JSON : elle traverse les proxys sans réveiller le client.
- **Un tournoi disparu ferme les flux.** Un instantané introuvable ne veut pas
  dire « rien de neuf » : il veut dire qu'il n'y a plus rien à suivre. La salle
  distingue ce cas d'un simple incident de lecture (où se taire et retenter est
  correct) et termine les connexions — sans quoi chaque spectateur garderait une
  pastille « Direct » devant un plateau figé, son chemin d'échec définitif ne se
  déclenchant que si le flux tombe.
- **La place de flux est rendue par trois portes** : l'abandon détecté avant
  construction, le signal de la requête, et l'annulation du corps de la réponse
  (`cancel`). N'en brancher que certaines laissait la place prise — et quatre
  occurrences valent un 429 permanent sur son propre tournoi.
- **Un signal déjà avorté ne déclenche jamais son écouteur** : la route de flux
  teste `req.signal.aborted` avant de s'y abonner. Sans ce contrôle, un client
  qui abandonne pendant les attentes qui précèdent (session, instantané,
  contexte du lecteur) laisserait sa place de flux prise pour la durée de vie du
  processus — et au bout de quatre F5 rapides, se verrait refuser son propre
  tournoi.
- **La trame SSE est assemblée sans re-sérialiser l'instantané** : l'empreinte
  et l'enveloppe partagent le même JSON. Le raccourci n'assemble que des valeurs
  passées par `JSON.stringify`, et `tests/lib/server/tournament-snapshot-frame.test.ts`
  vérifie que la trame se relit bien en l'instantané de départ.
- **Le retour sur l'onglet ne relit que si le flux est coupé.** Relire par-dessus
  un flux vivant relancerait, à la fin d'une manche, la centaine de requêtes que
  ce flux existe pour éviter. Les deux chemins (SSE et REST) sautent par ailleurs
  une mise à jour dont la `version` est déjà connue — et la liste, qui n'a pas de
  version, compare la réponse à la précédente (`sameBuckets`) pour ne pas
  redessiner 68 cartes toutes les minutes pour rien.
- **`X-Accel-Buffering: no`** neutralise la mise en tampon d'un reverse proxy,
  qui retiendrait les messages et ferait croire à un flux mort.

## Ce qui n'a pas été retenu

**Le pair-à-pair.** L'idée de faire relayer les mises à jour entre clients a été
écartée après examen :

- WebRTC exige une **signalisation** que le serveur devrait porter — plus de
  travail que ce qu'on économise, pour un flux SSE qui coûte déjà presque rien ;
- la traversée de NAT réclame un serveur **TURN** (le trafic repasse alors par
  un serveur, ailleurs et payant) ;
- le modèle de confiance s'effondre : un client ne peut pas faire autorité sur
  un score, et vérifier ce qu'il annonce revient à le recalculer côté serveur ;
- **RGPD** : mettre deux joueurs en relation directe expose leurs adresses IP
  l'un à l'autre. C'est une donnée personnelle, sans nécessité ni base légale
  évidente ici.

Le calcul client de l'avancement du tournoi a en revanche été retenu **là où il
est sans risque** : la bascule d'état à partir de dates publiques (point 3).

## La page d'accueil

C'est la porte d'entrée du site, et la seule surface où un plafond de débit ne
peut rien : ce n'est pas une route API mais le rendu d'un Server Component, qui
ne peut pas répondre 429. La mutualisation y est donc le seul garde-fou.

Les agrégats de tournois passaient déjà par le cache ; les cinq lectures qui
restaient — sponsors, statistiques et piliers de l'association, textes
éditables, mini-arbre — le font désormais aussi
(`lib/server/showcase-cache.ts`). Cent visiteurs arrivant ensemble ne coûtent
plus qu'une lecture de chaque, et une modification du staff se voit tout de
suite : chaque écriture invalide.

## Pistes restantes

- `/api/bot/feed/stream` ouvre une connexion vers le bot **par spectateur** de
  la page `/bot`. Sans conséquence sur la base, mais une salle partagée y ferait
  le même bien. `BotLiveFeed` recrée par ailleurs son `EventSource` à chaque
  bascule de pause (`useEffect(..., [paused])`).
- `/api/recruitment/highlight`, appelé depuis l'accueil, n'a ni cache ni
  plafond.
- Les compteurs vivent en mémoire d'un processus. C'est le bon choix pour un
  Raspberry Pi mono-processus ; passer à plusieurs instances demanderait un
  magasin partagé (et le cache d'instantanés deviendrait par instance).
