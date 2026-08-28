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
  ses droits). Ne change qu'à l'inscription.

`TournamentDetail = TournamentSnapshot & TournamentViewerContext` : les
appelants existants ne voient aucune différence.

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

| | `PRIORITY` (staff `tournaments` + engagés du tournoi) | `STANDARD` (spectateurs, visiteurs) |
| --- | --- | --- |
| Regroupement des envois SSE | 1 s | 20 s |
| Sondage de secours du détail (flux coupé) | 15 s | 120 s |
| Liste `/tournois` | 60 s | 300 s |
| Bandeau « en direct » de l'accueil | 30 s | 300 s |

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

Celui qui vient d'agir ne la subit pas : sa page relit immédiatement de son
côté.

> Il n'existe pas encore de rôle « caster » sur la plateforme
> (`PlatformRole` = `ADMIN | ARBITRE | COMMUNITY_MANAGER | RECRUTEUR`). Le jour
> où il apparaît, il suffira de le faire entrer dans `isStaff` au point d'appel
> — `refresh-tiers.ts` n'a pas à le connaître.

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
   « Hors ligne » et une notification invite à se reconnecter — plutôt que
   d'afficher « Reconnexion… » pour l'éternité. 429 et 5xx restent retentés.
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
| `tournaments-list:public` | 15 s | toute publication d'événement |
| `landing:stats`, `landing:ticker`, `landing:leaderboard:<n>` | 60 s | — |
| `landing:live` | 5 s | — |

Toute écriture passe par `tournaments/notifications.ts`, qui est donc le point
unique où caches et abonnés sont prévenus ensemble. C'est ce qui permet des
durées de vie confortables sans jamais afficher un score périmé.

### Étranglement de la synchronisation d'états

`syncVisibleTournaments()` ouvre une transaction et repasse sur **tous** les
tournois non terminés. Son étranglement passe de **1 s à 15 s** : à une seconde,
une poignée de visiteurs suffisait à la faire tourner en continu. L'affichage ne
l'attend plus (points 3 et 5 ci-dessus), et la page d'un tournoi déclenche
désormais sa propre bascule à la lecture.

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
  une mise à jour dont la `version` est déjà connue.
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

## Pistes restantes

- `/api/bot/feed/stream` ouvre une connexion vers le bot **par spectateur** de
  la page `/bot`. Sans conséquence sur la base, mais une salle partagée y ferait
  le même bien. `BotLiveFeed` recrée par ailleurs son `EventSource` à chaque
  bascule de pause (`useEffect(..., [paused])`).
- La page d'accueil charge encore sponsors, bureau, piliers et textes éditables
  à chaque rendu. Requêtes légères, mais leur mise en cache demanderait une
  invalidation à l'édition — à faire si le besoin s'en fait sentir.
- Les compteurs vivent en mémoire d'un processus. C'est le bon choix pour un
  Raspberry Pi mono-processus ; passer à plusieurs instances demanderait un
  magasin partagé (et le cache d'instantanés deviendrait par instance).
