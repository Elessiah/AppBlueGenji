# Diffusion en direct

Lier une chaîne de diffusion à un tournoi et à ses matchs, et n'exposer le
bouton « Regarder le live » de la page d'accueil que lorsqu'un direct est
réellement en cours.

## Deux niveaux, volontairement indépendants

| | Porté par | Rôle |
|---|---|---|
| **Chaîne officielle** | `bg_tournaments.live_url` | L'antenne permanente de l'organisation, affichée en tête de la page du tournoi. |
| **Diffusion d'un match** | `bg_matches.live_trigger` / `live_url` / `live_started_at` | Ce match est-il casté, par quelle chaîne, et est-il à l'antenne ? |

Un troisième mode d'antenne s'appuie sur le **calendrier** du match plutôt que
sur le tableau ou sur un clic : voir `docs/features/MATCH_START_DATES.md`.

**Un match n'hérite jamais de la chaîne officielle.** Un match peut être diffusé
par un streamer indépendant : un lien hérité renverrait le spectateur vers une
antenne qui ne montre pas ce match. Un match sans lien propre affiche donc son
badge sans lien cliquable, et le spectateur passe par la chaîne officielle.

## L'état de diffusion n'est pas stocké

Comme le verrouillage de score (`lib/shared/match-lock.ts`) ou le rejeu de la
Survie, l'état est **dérivé** à chaque lecture par `resolveMatchLiveState`
(`lib/shared/live-streams.ts`). Trois entrées seulement sont persistées : le
mode de déclenchement, le lien, et l'horodatage d'ouverture d'antenne.

```
liveTrigger === null                          → OFF        (match non casté)
status ∈ {AWAITING_CONFIRMATION, COMPLETED}   → OFF        (un score a été saisi)
status === PENDING                            → SCHEDULED  (annoncé, pas jouable)
liveTrigger === "AUTO" && launchedAt          → LIVE
liveTrigger === "AUTO"                        → SCHEDULED  (À planifier, Planifié, Lancement)
liveTrigger === "START_TIME" && now >= startAt → LIVE
liveTrigger === "START_TIME"                  → SCHEDULED  (heure pas atteinte, ou pas de date)
liveTrigger === "MANUAL" && liveStartedAt     → LIVE
liveTrigger === "MANUAL"                      → SCHEDULED
```

`resolveMatchLiveState` prend `now` en second argument (défaut `Date.now()`) :
serveur, client et tests se placent ainsi au même instant. Seul `START_TIME`
produit une bascule **sans écriture** — `nextMatchLiveChangeAt` en donne
l'horaire, que le client transforme en un unique `setTimeout`
(`useMatchLiveState`).

Deux conséquences voulues :

- **L'arrêt du direct à la saisie du score ne demande aucune écriture.** Le
  match quitte `READY`, l'état bascule seul.
- **Une correction de score défait le direct qu'elle avait éteint.** Rien à
  réconcilier, rien à rattraper.

C'est aussi la raison pour laquelle aucune requête SQL ne réimplémente cette
règle : `findBroadcastingTournament` charge les seuls matchs castés (leur nombre
est marginal) et filtre en mémoire avec `isMatchLive`, pour qu'il n'existe qu'une
définition de « ce match est à l'antenne ».

### L'exception : le ré-appariement

Une seule chose ne se dérive pas — l'antenne ouverte à la main survivrait à un
changement d'affiche. Quand une correction de score en amont remplace un engagé
d'un match aval par **un autre**, `pushTeamToTarget`
(`lib/server/tournaments/scoring.ts`) referme donc son antenne : la ligne a
changé de rencontre, et la laisser ouverte rallumerait le bouton d'accueil vers
une chaîne qui ne montre pas cette affiche.

Remplir un créneau **encore vide** ne déclenche rien : c'est le cas nominal où le
match prévu se matérialise, et une diffusion programmée à l'avance doit lui
survivre. Le mode de déclenchement et le lien sont eux aussi conservés — ils
disent « ce créneau du tableau est couvert par cette chaîne », ce qui reste vrai
après un ré-appariement ; seule l'antenne, qui affirme « maintenant », tombe.

## Deux modes de passage à l'antenne

Choisis **par match**, au moment où on le marque comme casté :

- **`AUTO`** — le direct s'ouvre au **lancement** du match
  (`MATCH_LAUNCH.md`) : quand toutes les parties sont prêtes, que l'arbitrage
  force le départ ou que le délai d'office expire. Tant que le match est
  « À planifier », « Planifié » (heure pas atteinte) ou en lancement, il reste
  « programmé ». Seul compte un lancement **de l'appariement courant**
  (`currentLaunchState`) : les lectures serveur (`findBroadcastingTournament`,
  `getLandingLive`) chargent `launched_at` et `launch_pairing` pour l'écarter
  sinon. Avant cette règle, `AUTO` s'allumait dès `READY` — donc sur un match
  qui attendait encore sa date ou ses « Prêt ».
- **`MANUAL`** — le direct s'ouvre au clic (« Lancer le direct », menu « Plus d'actions » de la carte), et se referme au clic
  (« Couper le direct ») ou tout seul à la saisie du score. C'est le mode qui convient
  aux tournois étalés sur plusieurs jours, où un match peut être jouable des
  heures avant que le cast commence.

Passer un match en `AUTO` referme son antenne : `live_started_at` n'a plus de
sens dans ce mode. Démarquer un match efface aussi son lien et son antenne,
sinon une ouverture fantôme reprendrait effet à la moindre remise en `MANUAL`.

Les contrôles ne sont proposés que sur un match qui peut réellement passer à
l'antenne (`isMatchCastable`) : un match déjà noté — un bye compris, que le
moteur crée directement en `COMPLETED` — dérivera `OFF` quoi qu'on configure, et
lui offrir « ＋ Caster » serait une impasse. Un match **pas encore apparié**
reste castable : annoncer la finale avant de savoir qui la jouera est le cas
courant d'une diffusion préparée à l'avance, et c'est l'objet de l'état
`SCHEDULED`. `canConfigureLive` rouvre par ailleurs la configuration d'un match
déjà marqué, sans quoi une diffusion posée par erreur deviendrait ineffaçable.

## Le bouton « Regarder le live » de l'accueil

Il n'apparaît **que si** un tournoi `RUNNING` porte une chaîne officielle
exploitable **et** qu'au moins un de ses matchs est en état `LIVE`. Sinon il
n'est pas rendu du tout — pas de version grisée : un bouton qui mène vers une
chaîne hors ligne crée plus de confusion qu'il n'en lève.

Le lien s'ouvre dans un nouvel onglet (`rel="noopener noreferrer"`) et pointe
vers la **chaîne officielle** du tournoi, jamais vers un lien de match.

Quand plusieurs tournois diffusent en parallèle, celui au `start_at` le plus
récent l'emporte — le même ordre que `listTournamentBuckets`. `getLandingLive`
retient d'ailleurs ce tournoi-là pour sa carte live, faute de quoi la carte et le
bouton pourraient désigner deux tournois différents. La carte met également en
avant un match réellement à l'antenne plutôt que le premier match jouable.

Une seule boucle de sondage alimente les deux : `useLandingLive`, appelé par le
`Hero` (`components/cyber/landing/`). Deux sondages séparés les feraient diverger
le temps d'un tick — une carte annonçant un direct au-dessus d'un bouton absent.

## Annonce sur Discord (#live, `@everyone`)

Au **début** d'un match diffusé, le bot poste dans le salon #live du serveur
BlueGenji esport (constante `LIVE_ANNOUNCE_CHANNEL_ID` côté bot,
`src/notifications/liveAnnouncement.ts`) un message qui mentionne `@everyone`,
nomme les deux engagés et le tournoi, et donne le lien de la diffusion —
demande de l'association : deux matchs à la suite font donc deux annonces.

- **Début du match = passage à l'antenne**, tel que `isMatchLive` le dérive :
  lancement en `AUTO`, heure dite en `START_TIME`, clic « Lancer le direct » en
  `MANUAL`. Le lancement compte pour l'**affiche courante** seulement
  (`currentLaunchState`).
- **Un balayage** (`lib/server/tournaments/live-announcements.ts`), pas un
  crochet par écriture : cinq écritures posent `launched_at`, et `START_TIME`
  passe à l'antenne sans écriture. Mêmes déclencheurs que les notifications de
  départ (`PUSH_NOTIFICATIONS.md`) : chaque évènement de tournoi publié,
  l'entretien de l'instantané qui ouvre un lancement, la lecture de la liste
  des tournois — et, pour qu'un `START_TIME` parte **à l'heure**, le
  battement (25 s) de chaque flux SSE de tournoi ouvert, en production
  seulement. Étranglé à dix secondes pour tout le processus, avec relève ;
  jamais attendu.
- **Un message par diffusion, pas par match** : les matchs d'un même tournoi
  qu'un même balayage trouve à l'antenne sur le **même lien** (une ronde
  lancée d'un coup, repliée sur la chaîne officielle) partent en un seul
  message : « 🔴 En direct — Tournoi : » puis une affiche par ligne
  (« • A contre B ») — un nom d'équipe peut contenir « et » ou une virgule,
  jamais un saut de ligne ; passé 1 500 caractères
  (`LIVE_ANNOUNCEMENT_MAX_LENGTH`), une dernière ligne compte le reste
  (« • et 3 autres matchs ») plutôt que de laisser le bot couper un nom. En
  tournoi individuel, « 🔴 En direct : 2 matchs — Tournoi ». Chaque affiche
  garde sa réservation. Deux matchs **à la suite** restent deux annonces.
- **Une annonce par match et par affiche** : `bg_live_announcements`
  (clé unique `(match_id, pairing)`) est réservée **avant** l'appel au bot.
  Un balayage concurrent, un rafraîchissement, une relecture du flux, un direct
  coupé puis relancé, un lancement annulé puis refait (horaire changé) ne
  repostent jamais. La réservation n'est **rendue** que si rien n'est parti
  pour une cause passagère — bot injoignable ou d'une version antérieure,
  salon fermé ou mode lent (`503`), panne (`500`) — et le balayage suivant
  réessaie tant que le match a commencé depuis moins de deux heures ; un
  succès (même sans mention), un refus du corps (`400`) ou un refus de
  Discord lui-même (`503` `automod` / `send-rejected` : le même message serait
  refusé de nouveau, et chaque essai bloqué alerterait la modération) la
  garde, comme un `503` `discord-down` (Discord lâché pendant l'envoi : il a
  pu partir). Un **délai dépassé** (15 s) la garde aussi : le bot a
  pu publier quand même, et une annonce perdue vaut mieux qu'un second
  `@everyone` à tout le serveur (`timed-out`, `console.error` dans pm2, qui dit d'attendre quelques minutes avant de vérifier #live) ; il
  n'est pas compté comme une panne du bot. Le bot
  répond **avant** d'écrire au canal de logs : un canal lent ne fait pas
  croire au site que rien n'est parti. Ni le `404` ni le `503` n'ouvrent le coupe-circuit
  du bot : un salon fermé ne doit pas suspendre les rappels de fond ; côté
  bot, chaque incident n'est signalé au canal de logs qu'une fois par heure.
  Elle part avec la ligne du match (suppression du
  tournoi, retour en arrière, plateau régénéré) : un match recréé puis relancé
  est annoncé de nouveau. Une affiche changée par un ré-appariement est une
  autre rencontre, donc une autre annonce.
- **Fraîcheur : deux heures** (`LIVE_ANNOUNCE_MAX_AGE_MINUTES`). Seul un
  passage à l'antenne de moins de deux heures est annoncé, mesuré par l'horloge
  de la base (`NOW()`) sur la colonne du mode : `launched_at` (`AUTO`),
  `start_at` (`START_TIME`, ou son `launched_at` pour l'affiche courante quand
  le match est devenu jouable après son heure), `live_started_at` (`MANUAL`).
  Un déploiement, une table recréée ou une longue panne du bot ne réveillent
  donc jamais `@everyone` pour un match commencé depuis longtemps.
- **Pas de sujet `PUSH_TOPICS`** : c'est une publication de salon public, pas
  une notification personnelle — personne ne s'y abonne ni ne s'en désabonne
  sur le site ; la règle « toute notification = un sujet push » ne s'applique
  pas.
- **RGPD** : registre **T16** (finalité « annoncer le début d'un match
  diffusé », destinataires membres du serveur et Discord, transfert Discord
  sous DPF), `/rgpd#retransmission` et la liste Discord de `/rgpd#destinataires`
  (FR et EN), politique du bot (`bot-legal-content.ts`) et entrée
  `2026-10-annonce-des-matchs-diffuses` de `PRIVACY_CHANGES`.
- **Lien** : la diffusion du match, à défaut la chaîne officielle du tournoi —
  celle que le site désigne au spectateur d'un match sans lien propre (badge
  sans lien, bouton « Regarder le live » de l'accueil) ; un caster
  indépendant renseigne donc son lien, sans quoi l'annonce renvoie à la
  chaîne officielle comme le reste du site. Chacun
  repasse par `normalizeStreamUrl`, et le bot revalide la liste blanche. Sans
  lien exploitable, pas d'annonce.
- **Texte** (`lib/shared/live-announcements.ts`, en français comme tout
  Discord) : « 🔴 En direct : A contre B — Tournoi ». Noms par `entrantLabel`
  (`discordInline` ; une entrée individuelle s'écrit « un joueur », jamais un
  pseudo — décidé aussi par `bg_teams.solo_user_id`, pas seulement par le type
  du tournoi). Le bot préfixe `@everyone` et n'autorise que cette mention
  (`allowedMentions: { parse: ["everyone"] }`) pour ce seul message ; sans la
  permission de mentionner, il n'écrit pas la mention (un « @everyone » gris
  qui ne notifie personne aurait l'air d'une panne).
- **Production seulement** (`NODE_ENV=production`) : une base de
  développement ne fait jamais écrire `@everyone` au serveur, même devant un
  bot local branché par erreur sur le vrai serveur.
- **Traces** : pm2 `[live-announce] match N (tournoi T) annoncé dans #live`
  (`matchs N, M (tournoi T) annoncés` pour un groupe ; « sans notifier » quand
  la mention n'a pas pu partir — identifiants seuls, tournoi compris sur toutes
  les lignes, échecs et reports aussi) ; l'annonce naît d'un
  balayage, pas d'un geste du staff, donc aucune ligne `staff-audit`. Un report
  est averti dans pm2 au plus une fois par heure, par cause et par match (ou
  groupe), la cause distincte :
  « salon #live fermé au bot » (`503` de salon ou de permission), « le mode
  lent de #live retient l'annonce », « Discord n'a pas répondu au bot en
  lisant le salon » ou « bot injoignable, en panne ou d'une version sans
  annonces » ; passé deux heures, le match n'est plus réessayé. Un `503` qui
  ne concerne pas l'annonce (jeton interne du bot absent…) se lit « bot
  injoignable ». Les annonces abandonnées sont tracées en `console.error` :
  refus du corps (`400`), refus de Discord (« Discord a refusé l'annonce …
  abandonnée », cause au canal de logs du bot), « publication non
  confirmée » (`503` `discord-down` — vérifier #live) et délai dépassé
  (« son envoi peut encore aboutir » — parfois des heures après un
  redémarrage du bot, sous un mode lent). Aucune de ces lignes ne demande de
  poster l'annonce à la main : l'envoi du bot a pu partir, ou partir encore. Côté bot, un salon fermé, une panne ou une permission
  manquante est signalé dans le canal de logs, au plus une fois par heure par
  incident. Deux pannes de la base sont tracées (une fois par heure et par
  match) : une réservation refusée (`réservation impossible` — rien n'est
  réservé, chaque passage réessaie pendant les deux heures) et une
  réservation qui n'a pas pu
  être rendue (`réservation non rendue` — l'annonce est perdue, à reposter à
  la main). Un match à l'antenne sans aucun lien exploitable (ni le sien ni
  la chaîne officielle) n'est pas annoncé, et pm2 le dit, une fois par heure
  — un lien ajouté dans les deux heures fait partir l'annonce, d'où la
  consigne de ne pas la poster à la main. L'aide du champ de lien de la
  fenêtre de cast le rappelle : laissé vide, il fait renvoyer l'annonce à la
  chaîne officielle, ou ne la fait pas partir sans chaîne officielle.
- **Information à l'inscription** : la mention sous le bouton d'inscription
  (`register.streamNotice.TEAM`, `registrationStreamNotice`) dit aussi que le
  nom de l'équipe est annoncé sur le Discord de l'association ; en individuel,
  rien à ajouter — un joueur n'y est jamais nommé.
- **Production — permissions Discord** dans #live : « Voir le salon »,
  « Envoyer des messages », « Mentionner @everyone, @here et tous les rôles »
  et « Intégrer des liens ». Sans la mention, le message part sans notifier ;
  sans l'intégration, sans aperçu de la chaîne ; sans les deux premières, rien
  ne part et le site réessaie. Un mode lent sur #live retiendrait une annonce
  postée pendant son délai après la précédente (sauf si le bot a « Gérer les
  messages » ou « Gérer le salon ») : le bot la refuse alors, le site
  réessaie, et le canal de logs ne le signale que s'il reste plus d'une
  minute d'attente. Le bot ne connaît son dernier envoi que depuis son
  démarrage : juste après un redémarrage, l'envoi peut attendre la fin du
  mode lent (délai dépassé côté site, annonce non réessayée) — avec un mode
  lent sur #live, donner au bot « Gérer les messages » ; une règle AutoMod qui bloque l'annonce est signalée de même.

## Information des joueurs (RGPD)

La retransmission est un traitement (registre, **T16**) : intérêt légitime de
l'association, droit d'opposition. Elle ne montre que le **pseudo**, le **nom
d'équipe** et les **résultats et performances en jeu** — ni webcam ni chat
vocal des joueurs. Le site ne fait que **lier** les chaînes, sans lecteur
intégré : il ne transmet rien aux plateformes, qui traitent leurs spectateurs en
responsables de leur propre traitement. Seule l'annonce d'un match dans le
salon #live passe par Discord (T16 : transfert vers les États-Unis, Discord,
§ Annonce sur Discord).

Le joueur en est informé là où il s'engage, sans case à cocher — ce n'est pas
un consentement : sous le bouton d'inscription de la fiche du tournoi
(`TournamentHeader`, en équipe comme en individuel) et dans la confirmation
d'inscription (`registration-confirm.ts`). Les phrases viennent d'un module pur,
`lib/shared/stream-notice.ts`, partagé avec la section « Retransmission des
matchs » des conditions d'utilisation (une précision : `TERMS_VERSION` ne bouge
pas) ; le détail est sur `/rgpd#retransmission`. L'opposition se demande par
« Signaler un problème », catégorie RGPD : le joueur apparaît alors sous un nom
neutre, et un lien de rediffusion qui le montre est retiré.

## Liste blanche de plateformes

`normalizeStreamUrl` n'accepte que `twitch.tv`, `youtube.com`, `youtu.be` et
`kick.com` (préfixes `www.` et `m.` tolérés, et rien d'autre :
`twitch.tv.exemple.com` est refusé). Le champ est saisi par du staff mais
réaffiché à tous les visiteurs — un lien libre ferait du site un tremplin de
redirection.

Sont également refusés : les identifiants dans l'URL (`user:pass@`), un port
explicite, et toute URL dépassant 255 caractères une fois normalisée. Un schéma
manquant est en revanche toléré (`twitch.tv/bluegenji` devient
`https://twitch.tv/bluegenji`) : le staff colle volontiers l'adresse sans
`https://`. Le résultat est toujours ramené en `https`.

Ajouter une plateforme = ajouter une entrée à `LIVE_PLATFORMS`.

## Permissions

Une nouvelle permission **`live`**, portée par le rôle **`CASTER`**
(`lib/shared/permissions.ts`, voir `PERMISSION_ROLES.md`).

`CASTER` porte deux permissions aux portées bien distinctes : `casting` ne donne
que la **lecture** de l'aperçu du plateau (`TOURNAMENT_PREVIEW.md`), tandis que
`live` est le droit d'**écriture** sur l'état de diffusion décrit ici.

| Action | Permission |
|---|---|
| Renseigner la chaîne officielle du tournoi | `tournaments` |
| Marquer un match comme casté, son mode, sa chaîne | `live` |
| Ouvrir / fermer l'antenne d'un match | `live` |

`live` est volontairement séparée de `tournaments` : un streamer doit pouvoir
ouvrir l'antenne sans pouvoir toucher aux scores ni aux tournois. À l'inverse,
`ARBITRE` cumule les deux — sans quoi il faudrait deux personnes pour lancer un
match casté. `ADMIN` a tout.

## Fichiers

| Fichier | Rôle |
|---|---|
| `lib/shared/live-streams.ts` | Pur : liste blanche d'URL, dérivation de l'état, libellés. |
| `lib/server/tournaments/live-streams.ts` | Écritures + résolution de la cible du bouton d'accueil. |
| `app/api/admin/tournaments/[id]/live/route.ts` | `PUT` — chaîne officielle (`tournaments`). |
| `app/api/admin/matches/[matchId]/live/route.ts` | `PUT` — configuration ; `POST` — antenne (`live`). |
| `app/api/admin/matches/[matchId]/schedule/route.ts` | `PUT` — date de début du match (`tournaments`). |
| `components/cyber/landing/useLandingLive.ts` | Sondage unique de l'accueil. |
| `app/(secured)/tournois/[id]/_components/MatchLiveStrip.tsx` | Badge, lien et contrôles sous chaque match. |
| `app/(secured)/tournois/[id]/_components/MatchLiveDialog.tsx` | Configuration de diffusion d'un match. |
| `app/(secured)/tournois/[id]/_components/TournamentLiveLink.tsx` | Chaîne officielle en tête de page. |

## Codes d'erreur

| Code | HTTP | Sens |
|---|---|---|
| `INVALID_STREAM_URL` | 400 | Lien hors liste blanche, ou inexploitable. |
| `INVALID_LIVE_TRIGGER` | 400 | Mode autre que `AUTO` / `START_TIME` / `MANUAL`. |
| `INVALID_ON_AIR` | 400 | `onAir` absent ou non booléen. |
| `LIVE_TRIGGER_NOT_MANUAL` | 409 | Antenne basculée sur un match en `AUTO` (rien à basculer). |
| `MATCH_NOT_LIVE_READY` | 409 | Antenne ouverte sur un match non jouable ou déjà noté. |
| `MATCH_START_AT_REQUIRED` | 409 | Mode `START_TIME` demandé sur un match sans date de début. |

## Jeu de test

`npm run seed` produit cinq cas (`lib/server/seed/cases.ts`, champ `live`) :

- **Live Auto (à l'antenne)** — chaîne officielle + matchs en `AUTO`, lancés
  sauf le premier (resté en lancement avec le caster, donc « programmé ») : le
  cas nominal du bouton d'accueil.
- **Live Manuel (hors antenne)** — chaîne renseignée, antenne fermée : les matchs
  sont « programmés » et ce tournoi **ne doit pas** faire apparaître le bouton.
- **Live Manuel (antenne ouverte)** — antenne ouverte sans lien sur les matchs :
  badge « en direct » seul, le spectateur passe par la chaîne officielle.
- **Live Horaire (heure passée)** — mode `START_TIME` dont l'horaire est déjà
  franchi : à l'antenne sans que personne n'ait cliqué.
- **Live Horaire (heure à venir)** — même configuration, horaire futur : le match
  reste « programmé » et bascule tout seul à l'heure dite.

Le compte `Test_Caster` porte la permission `live` seule.

## Notes reprises de CLAUDE.md

Texte déplacé tel quel depuis `CLAUDE.md` (allègement du fichier chargé à chaque session).

- **« Live » / « Direct » — trois sens à ne jamais confondre dans les libellés** : le projet emploie le mot pour (1) l'**état d'un tournoi** `RUNNING`, (2) une **diffusion** (stream Twitch/YouTube/Kick d'un tournoi ou d'un match), (3) la **connexion au flux SSE** qui tient la page à jour. Les trois se côtoyaient sur la même ligne de pastilles de `/tournois/[id]`, où « ● DIRECT » (connexion) voisinait « ● EN COURS » (état) sur un tournoi sans la moindre chaîne — on y lisait un stream qui n'existait pas. Règle de vocabulaire, sans effet sur le code interne (les valeurs `MatchLiveState`, les noms de fichiers `*live*` et les classes `pill-live` restent) : **« En cours »** pour l'état d'un tournoi (jamais « Live » ni « En direct »), **« En direct » / « le live »** réservé à une vraie diffusion, **« À jour » / « Reconnexion… » / « Hors ligne »** pour le témoin de flux (`LiveIndicator`). Le **rouge** (`pill-live`, `--red-live`) n'habille que ce qui est réellement à l'antenne : un état de tournoi ou un témoin de connexion se met en bleu. Avant d'écrire « Live » ou « Direct » dans une interface, se demander lequel des trois on désigne.
- **Diffusion en direct** (`lib/shared/live-streams.ts` pur + `lib/server/tournaments/live-streams.ts`) : le tournoi porte sa **chaîne officielle** (`bg_tournaments.live_url`), chaque match porte sa propre diffusion (`live_trigger` `AUTO`/`MANUAL`, `live_url`, `live_started_at`) — **un match n'hérite jamais** de la chaîne du tournoi, parce qu'un streamer indépendant peut le caster. L'état (`OFF`/`SCHEDULED`/`LIVE`) n'est **pas stocké** : `resolveMatchLiveState` le dérive, si bien que l'arrêt du direct à la saisie du score ne demande aucune écriture et qu'une correction de score le défait seule. Aucune requête ne réimplémente la règle en SQL — `findBroadcastingTournament` filtre en mémoire avec `isMatchLive`. Le bouton « Regarder le live » de l'accueil n'est rendu **que si** un tournoi `RUNNING` a une chaîne officielle et au moins un match `LIVE` ; sinon il disparaît. URLs bornées par une liste blanche (`twitch.tv`, `youtube.com`, `youtu.be`, `kick.com`). Voir `docs/features/LIVE_STREAMS.md`.
