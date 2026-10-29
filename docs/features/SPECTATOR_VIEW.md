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
| Gabarit | `SiteShell` | `PublicPageShell` (vitrine) |
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
  « Connexion requise » le temps du relais (un état « Ouverture du tournoi… »,
  `<output>`, à sa place) ;
- membre **connecté** sur `/suivre/tournois/[id]` → `/tournois/[id]`
  (`app/suivre/tournois/[id]/layout.tsx`), où sont ses actions — la page du
  match de son espace pour `/suivre/tournois/<id>/matchs/<match>`
  (`memberPathForSpectatorPath`). L'encart de la page sans compte ne lit alors
  pas la carte du tournoi (session mémoïsée pour la requête, la redirection la
  jetterait). Une mise en page **préchargée** est servie sans `x-pathname` : le
  renvoi serveur ne sait plus quelle page on visait, donc la mise en page rend
  `MemberRelay` (`router.replace` sur le chemin lu par `usePathname`, requête et
  ancre comprises), qui mène à la page du match quand c'en est une.

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
  pseudo s'affiche) sans savoir qui.
  Sur une sanction BlueGenji Survie, l'arbitre et le motif (texte libre du
  staff) partent, et la case du motif n'est pas rendue (engagé, manche et
  points restent, déclarés). Le lien de rediffusion passe par
  `visibleReplayUrl` : celui que l'interface masque (match rouvert) ne part pas ;
- **ni « Prêt », ni scores proposés, ni date d'inscription d'un joueur solo**
  (décision de l'auteur, 2026-10-27) : `spectatorSnapshot` met à `false` les
  « Prêt » des engagés, de l'arbitre et des casters, garde un rapport de score
  en attente ou en litige **sans ses chiffres** (scores à 0, maps vides), et
  vide `registeredAt` d'une entrée solo (celle d'une équipe reste ; le tiret qui
  la remplace est annoncé « Date non communiquée » aux lecteurs d'écran, et
  l'ordre du tableau est celui du tirage — le plateau le publie de toute façon).
  `updatedAt` (vidé) et `lobbyOpenedAt` (`null`) des matchs partent aussi :
  chaque bascule « prêt » les touche, et deux lectures rapprochées diraient à la
  seconde près qu'une équipe vient de se dire prête. La fiche
  en tient compte : le bandeau de lancement dit « Lancement » sans décompte ni
  « prêt / attendu » (`MatchLaunchStrip`), la carte dit « Score proposé par … ·
  à confirmer » (`cardActions.reportPendingSpectator`, FR et EN — l'échéance de
  validation d'office ou sa suspension restent dites, sans chiffres :
  `…SpectatorDeadline` / `…SpectatorPaused`), le volet des
  inscriptions affiche « - » ;
- **en-tête** : « Accueil » au lieu de « Tous les tournois », pastille
  « Spectateur » (qui dit pourquoi aucun bouton n'apparaît, explication aussi
  hors écran pour le toucher, le clavier et les lecteurs d'écran), témoin qui annonce
  la cadence accordée par le serveur — la même phrase est reprise dans le
  panneau du « i » (`useLiveIndicatorText`), le `title` du témoin ne
  s'atteignant ni au toucher ni au clavier. À 375 px, le groupe du témoin prend
  la place libre (`.viewer`, `flex: 1 1 0`) : ses pastilles passent à la ligne
  en son sein, le « i » reste sur la ligne du retour. **Aucun bouton vers la
  connexion** n'est ajouté : la page est faite pour regarder.

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
| Lectures publiques par minute (fenêtres d'une minute exacte, la précédente au prorata ; au plus 10 par réseau et par fenêtre, `SPECTATOR_READS_PER_CLIENT`, pour qu'une poignée d'adresses ne ralentisse pas tout le monde) | 600 / 1 200 / 2 400 |

La cadence est multipliée par 1, 2, 4 puis 10, plafonnée à 10 min. Sous la
charge, ce sont donc les visiteurs sans compte qui reculent, jamais le staff ni
les engagés. Le retard de boucle est relevé par une minuterie toutes les 10 s
tant que la sonde est armée (jamais une pause d'il y a cinq minutes). La sonde
n'est armée qu'avec les lectures publiques et se
désarme après 5 min sans activité publique (un seul minuteur, qui se relance
lui-même).

**Coût côté serveur** :

- **réseau, pas adresse** : plafonds, part dans la charge et jetons se
  comptent par `clientNetworkKey` (`lib/server/api-guard.ts`) — une IPv4 telle
  quelle, une IPv6 réduite à son `/64` (une IPv4 encapsulée redevient IPv4),
  **port retiré** (`1.2.3.4:51234`, `[v6]:port`) : un hôte qui tourne dans son
  préfixe, ou change de port à chaque connexion, reste un seul client. Le seau
  à jetons plein de clés (`maxKeys`) évince d'abord les seaux pleins, puis les
  **plus pleins** (jamais tout : vider le seau rendrait ses jetons à celui qui le
  sature) ;
- la réponse publique est **mutualisée** par tournoi
  (`lib/server/spectator-snapshot.ts`, `cached`) : au plus une reconstruction
  par durée de vie (15 s au calme, ×1 à ×10 selon la charge, plafonnée à
  150 s ; un tournoi **terminé** garde ses 150 s même au calme : il est relu
  toutes les 10 min, une durée plus courte le reconstruisait pour un `304`),
  quel que soit le nombre de visiteurs. Une écriture ne **réveille** pas les visiteurs sans
  compte et n'**invalide** pas cette réponse : sa durée de vie, allongée sous la
  charge, est ce qui protège la machine d'un tournoi animé (choix de l'auteur ;
  ce délai, 150 s au pire, est déclaré dans `/rgpd`). Seule la
  **suppression** du tournoi la retire (`invalidateSpectatorSnapshot`,
  `deletion.ts`). Une lecture froide lit d'abord la **carte** du tournoi (une
  requête indexée, `isSpectatorTournamentPublic`, mutualisée en vol entre les
  lectures simultanées et jamais gardée) : un identifiant inconnu ou pas encore
  publié s'arrête là, sans faire construire d'instantané. Si l'instantané des
  membres est **chaud** (salon SSE ouvert), la carte n'est pas lue : filtrage
  et sérialisation seulement, l'instantané repassant de toute façon par sa
  propre porte de visibilité. Un « introuvable » n'entre **pas** dans le
  cache (le chargeur lève une sentinelle, `cached` ne garde jamais un échec). Le
  corps est sérialisé **une fois** (version vide), et **compressé une fois**
  (gzip **asynchrone**, `gzippedSpectatorBody` : la promesse est rangée dans une
  `WeakMap`, la boucle d'événements des salons SSE n'est plus bloquée par un
  corps d'environ 1 Mo) pour tous les lecteurs qui l'acceptent
  (`Content-Encoding: gzip`, `Vary: Accept-Encoding` ; Next ne recompresse pas
  une réponse déjà encodée) ;
- le cache commun purge ses entrées échues toutes les 10 s au plus
  (`CACHE_SWEEP_INTERVAL_MS`, à l'écriture), et non plus seulement au plafond
  de 500 : un parcours de tournois ne laisse plus d'instantanés en mémoire
  après leur durée de vie. Une minuterie `unref`, née à la première écriture et
  éteinte quand le cache est vide, balaie aussi **sans trafic** ;
- la réponse ne garde en mémoire que la carte et les réglages
  (`PublicTournamentView`) de l'instantané, jamais ses matchs ni ses inscrites
  (déjà dans le corps sérialisé) ;
- en-tête `x-bg-fresh-within-ms` : l'âge maximal de l'affichage (attente entre
  deux lectures, gigue comprise, **plus** la durée de vie de la réponse servie,
  celle reçue à sa construction, peut-être sous une charge plus forte) — c'est
  lui que le témoin annonce, pour ne pas promettre mieux que le cache ;
- `ETag` = empreinte du **corps public** (et non la version des membres, qui
  bouge avec les champs retirés), qui ne voyage que dans l'en-tête ; **un par
  codage** (RFC 9110) : le corps gzip porte le suffixe `-gzip`. Une relecture
  sans nouveauté répond **`304` sans corps** ;
- seules les lectures d'un tournoi servi pèsent dans la charge : des
  identifiants au hasard ne ralentissent pas les vrais spectateurs ;
- plafond par réseau (`SPECTATOR_READ_RULE`, 360/min : une salle de LAN d'une
  centaine d'écrans derrière une même adresse passe, gigue, ouvertures et
  reprises comprises) et, à part, **prix d'une reconstruction** — décidé sur le
  chemin même où `cached` lance le chargeur (`beforeLoad`), jamais par un
  contrôle « chaud » fait à part :
  - **seau à jetons** par réseau (`SPECTATOR_REBUILD_RULE` : rafale de 10, un
    jeton rendu par seconde — un débit, pas une fenêtre fixe qui en laissait
    passer 120 en une seconde). Le jeton est pris avant toute lecture en base
    et **rendu** si rien n'a été construit (introuvable, panne, places
    prises) : des sondes au hasard ne privent pas une adresse partagée de ses
    relectures, une panne brève n'épuise pas une salle. Une lecture servie par
    le cache, ou qui rejoint un calcul en vol, ne paie rien ; une
    reconstruction dont l'instantané des membres est chaud non plus ;
  - au plus **4 constructions en vol**, tous réseaux confondus
    (`SPECTATOR_MAX_CONCURRENT_REBUILDS`) : quelques dizaines d'adresses ne
    font plus reconstruire tous les tournois publiés à chaque durée de vie ;
  - une reconstruction **refusée** pour **places prises** (toutes adresses
    confondues) sert la dernière réponse du tournoi **même échue**, tant
    qu'elle a moins de 150 s (`cached` … `retainMs`, `cachedStale`,
    `SPECTATOR_MAX_COPY_AGE_MS` — l'âge déclaré dans `/rgpd`), l'âge annoncé
    passant alors à ce maximum ; sans copie récente, `503`. Refusée pour
    **plafond du réseau** (plus de jeton), la réponse est le `429`, **que la
    copie existe ou non** : elle ne dit pas si quelqu'un d'autre vient de lire
    ce tournoi, et un réseau sans jeton ne tire plus de corps de la copie
    (bande passante plafonnée). Seul un client qui détient déjà la version de
    la copie (`If-None-Match`) reçoit un `304` ; l'instantané des membres
    chaud ne coûte rien et se sert donc toujours ;
  - le chargeur **revérifie** la chaleur de l'instantané des membres : si elle
    est tombée entre le contrôle de `beforeLoad` et la lecture, le jeton et la
    place sont pris à ce moment ;
- base injoignable → la **copie de moins de 150 s** si elle existe (l'âge annoncé
  passe à ce maximum), sinon `503` +
  `Retry-After` du double de la cadence au niveau du moment
  (`spectatorUnavailableRetryMs` : 1 min au calme, 10 au pire), puis recul
  doublé par le relecteur — le `Retry-After` n'est qu'un plancher : des `503`
  répétés à l'identique ne figent pas l'attente.

**Côté client** (`app/suivre/tournois/[id]/_lib/spectator-poller.ts`, hors
React, testé sans navigateur) : ±10 % de gigue, un `304` sans nouveauté ne republie
aucun état (la fiche ne se redessine pas) ; rien n'est lu **onglet
caché** (`useClientPower`), pas même la première lecture d'un lien ouvert en
arrière-plan : la lecture due part au retour ; le témoin dit « Hors ligne »
(jamais « Reconnexion… », il n'y a pas de flux) après un échec ; après un échec, le
`Retry-After` du serveur ou le **double de la dernière attente** (recul
cumulatif jusqu'à 10 min, jamais moins que le `Retry-After`, la cadence reprend
au premier succès). Si la toute
première lecture échoue, le squelette de chargement le dit (« La page réessaie
seule… ») au lieu de sembler figé. Un `404` (tournoi supprimé ou pas encore publié — la fiche déjà affichée part, la
carte « introuvable » la remplace — même réponse, comme partout)
ou un `400` (adresse fabriquée) n'est plus relu qu'au plafond
(`SPECTATOR_NOT_FOUND_RETRY_MS`, 10 min) : un lien partagé avant la publication
s'ouvre seul ensuite, et la page le dit (« revérifie seule toutes les 11
minutes au plus », gigue comprise) ; une revérification qui trouve le même
« introuvable » ne republie aucun état (`sameState`, comme un `304`). Un onglet
oublié sur un tournoi supprimé coûte une requête indexée toutes les dix
minutes, et rien onglet caché. Le démontage coupe la lecture en vol
(`AbortController`).

Quand la carte « introuvable » remplace la fiche (modale comprise), le focus
qui serait retombé sur `<body>` passe à son titre (`tabIndex=-1`, jamais volé
à un élément qui l'a) ; quand un introuvable redevient visible, une région
`<output>` (région d'état native) posée **hors** de ce qui se remplace (`TournamentSheet`)
annonce « Le tournoi est maintenant accessible. » / « The tournament is now
available. ». Le squelette d'une première lecture échouée ne miroite plus
(`data-retrying`) : rien n'est en cours.

## Visibilité

La route publique passe par `getVisibleTournamentSnapshot` **sans aucun
droit** : un tournoi pas encore publié (`start_visibility_at`) n'existe pas
pour elle. L'encart (`tournamentPageMetadata`, `lib/server/tournament-metadata.ts`,
commun aux deux espaces) et l'image d'aperçu (réexport de
`app/(secured)/tournois/[id]/opengraph-image.tsx`, identifiant lu par
`parseTournamentId` comme la page et la route) appliquent la même règle. Sur la
page sans compte, l'encart lit la **carte seule**
(`publicTournamentCardForRequest`, `lib/server/spectator-request.ts` →
`publicTournamentCard`) : la copie de la réponse publique si elle a moins de
150 s, sinon la carte (une requête indexée) gardée 10 s — jamais une
reconstruction de l'instantané entier payée par le réseau d'un robot d'aperçu.
L'état en est **recalculé depuis les dates** (la copie garde celui de sa
construction). Chaque rendu de page sans session compte dans
`SPECTATOR_READ_RULE` ; au plafond, encart ou page générale.

**Règles du mode** — le « ? » de la fiche (`RulesHelpFab`) mène à
`/regles/<mode>?tournoi=<id>`. Sans session aussi, les réglages du tournoi
publié y sont rendus, par la réponse publique mutualisée (décision de
l'auteur, 2026-10-27 ; `publicTournamentSnapshotForRequest`, plafonnée par
`SPECTATOR_READ_RULE`), et « Retour au tournoi » mène à la page sans compte ;
une session **illisible** n'est pas une visite sans compte : page générale ;
un membre lit l'instantané avec ses droits et revient à `/tournois/[id]`.
Un robot d'aperçu, sans session, suit la redirection et lit l'encart du
tournoi sur la page sans compte.

## RGPD

Changement de **qui lit** la fiche : entrée `2026-10-suivi-tournoi-sans-compte`
de `PRIVACY_CHANGES` (et son anglais), paragraphe « Suivre un tournoi sans
compte » de `/rgpd` (`#suivi-sans-compte`), sous-finalité ajoutée au registre
(T03, avec l'adresse IP du visiteur, gardée en mémoire le temps du plafond). Les codes de replay restent aux membres, comme l'arbitre et le motif d'une
sanction, l'identité du caster, les « Prêt », les scores proposés et la date
d'inscription d'un joueur solo — champs que `/rgpd` n'avait jamais déclarés
publics : leur retrait aligne la réponse sur le texte publié, sans le changer. Le numéro de compte interne d'un joueur engagé
en individuel est public (`soloUserIds`, il porte sa marque du podium, publique)
et déclaré comme tel, comme les logos des équipes et l'avatar d'un joueur solo
(copié dans son entrée, et absent s'il l'a masqué : `visibleAvatarUrl`).
La visite est comptée par la mesure d'audience comme sur toute page (sauf
opposition) ; l'adresse IP (réduite au `/64` en IPv6) ne sert par ailleurs
qu'aux plafonds de débit, en mémoire.

## Tests

- `tests/lib/shared/spectator-view.test.ts` — chemins, niveaux, cadences,
  instantané allégé, contexte sans droit, et **inventaire des champs** : chaque
  champ de `TournamentSnapshot`, `BracketMatch`, d'une map, d'un rapport de
  score, d'un caster, d'une sanction, d'une ligne d'inscription, et des types
  recopiés en bloc (carte, phases, classements de phase, Survie, Ronde suisse,
  BlueGenji Survie) y est classé (`public`, `retiré`, `parcouru`) par un
  `satisfies Record<keyof …>` — un champ ajouté à ces types casse le contrôle
  de types tant qu'on n'a pas décidé s'il part en public.
- `tests/lib/server/spectator-snapshot.test.ts` — prix d'une reconstruction
  (jeton pris, rendu, croisé, instantané chaud), places en vol, copie périmée,
  gzip.
- `tests/lib/server/spectator-load.test.ts` — signaux de charge.
- `tests/app/api/spectator/tournament-route.test.ts` — route publique (`304`,
  mutualisation, plafonds, jetons, copie périmée, places prises, gzip, `/64`,
  `503`, aucune session lue).
- `tests/lib/server/cache.test.ts`, `rate-limit.test.ts`, `api-guard.test.ts`,
  `tournament-broadcast.test.ts` — purge, `beforeLoad`, `retainMs`, seau à
  jetons, `clientNetworkKey`, compteur des flux ouverts.
- `tests/app/rules-tournament-settings.test.tsx` — réglages d'un tournoi sur la
  page des règles, avec et sans session.
- `tests/app/spectator-poller.test.ts` — relecteur (cadence, onglet caché,
  reculs, arrêt).
- `tests/app/spectator-view.test.tsx` — redirections, encart, fiche sous
  `SpectatorViewProvider`.
