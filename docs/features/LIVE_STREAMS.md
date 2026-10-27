# Diffusion en direct

Lier une chaîne de diffusion à un tournoi et à ses matchs, et n'exposer le
bouton « Regarder le live » de la page d'accueil que lorsqu'un direct est
réellement en cours.

## Deux niveaux, volontairement indépendants

| | Porté par | Rôle |
|---|---|---|
| **Chaîne officielle** | `bg_tournaments.live_url` | L'antenne permanente de l'organisation, affichée en tête de la page du tournoi. |
| **Diffusion d'un match** | `bg_matches.live_trigger` / `live_started_at` + `bg_match_streams.live_url` | Ce match est-il casté, par quelles chaînes, et est-il à l'antenne ? |

**Plusieurs streams par match.** Les liens d'un match vivent dans
`bg_match_streams` (un par stream : celui que règle le staff, et celui que
chaque caster ouvre à part). Partout où un seul lien tient — carte, ticker de
l'accueil, annonce #live, détection « à l'antenne » — c'est le **premier lien**
(`firstStreamUrlSql` : le lien du staff, à défaut le plus petit stream qui a un
lien) : le comportement d'avant, pour le premier stream. Avant le lancement, le stream d'un caster qui ne remplit
plus la condition du cast est tu, lien compris. Le bandeau de diffusion du match montre tous les liens,
le premier en tête. La configuration du direct par le staff règle le lien de
son propre stream (`staff_owned`), jamais celui qu'un caster a ouvert ; « pas
de cast » n'efface que ce lien du staff. Le stream d'un caster part, avec son
lien, quand plus aucun caster ne le tient ; le lien qu'un caster a fourni
(`link_user_id` : en ouvrant son stream, ou dans la configuration du direct
sans la permission `tournaments` — ou avec elle, en castant déjà ce match quand le lien est posé) part aussi à la suppression de son compte,
matchs joués compris, même d'un stream qu'un co-caster tient encore. Seul le
lien qu'y pose un membre de l'organisation qui ne caste pas ce match est celui
de l'organisation (`link_user_id` nul), gardé ; un lien posé avant
`link_user_id` (ancien `live_url`) n'a pas de fournisseur connu et compte comme
tel. Voir
`docs/features/MATCH_LAUNCH.md` § Casters et streams.

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

## Annonce sur Discord (#live, par soirée)

Au **début** d'un match diffusé, le bot poste dans le salon #live du serveur
BlueGenji esport (constante `LIVE_ANNOUNCE_CHANNEL_ID` côté bot,
`src/notifications/liveAnnouncement.ts`) le **message de la soirée** : il
nomme les engagés et le tournoi de chaque match, son heure, et donne le lien
de chaque diffusion. Les matchs suivants de la soirée **modifient** ce message
au lieu d'en poster un autre (demande de l'association, 2026-10-19).

- **Qui est notifié** : seule une diffusion sur la chaîne officielle
  (`OFFICIAL_LIVE_CHANNEL_URL`, `https://www.twitch.tv/bluegenjiesport` —
  hôte et chemin comparés sans casse, `www.`/`m.` et barre finale ignorés,
  `liveMentionTarget`) mentionne `@everyone`. Toute autre chaîne (caster,
  Kick, YouTube) mentionne le seul rôle **StreamViewer**
  (`STREAM_VIEWER_ROLE_ID` côté bot, `1210173681771479060`) :
  `allowedMentions` n'autorise que `everyone` pour l'une, que ce rôle pour
  l'autre. Les deux publics ont chacun leur message de soirée.
- **Soirée** : `LIVE_EVENING_WINDOW_HOURS` = **4 h**, comptées depuis le
  premier direct annoncé pour ce public (`bg_live_evenings` : public, ouverture,
  fin de fenêtre, identifiant du message Discord, `silent` si ce message est
  parti sans mention, `notified` si un envoi qui notifie est parti vers le
  bot ; pas son texte, effacée un jour après la fin de la
  fenêtre par `purgeEndedEvenings`, au plus une fois par heure à chaque appel
  de `dispatchLiveAnnouncements` — annonces désactivées comprises : la durée
  annoncée par `/rgpd` tient même sans annonce pendant des semaines). Quatre heures couvrent une soirée de tournoi (19 h – 23 h) sans
  fondre deux soirées. La fenêtre repart du **premier envoi qui notifie** (posé
  juste avant l'appel au bot, quelle qu'en soit l'issue) et du premier message
  gardé : des essais reportés avant lui (bot injoignable) ne la raccourcissent
  pas — un premier envoi incertain juste avant la fin de la fenêtre ne laisse
  pas une nouvelle soirée notifier une minute plus tard —, et ce premier
  message liste déjà les matchs programmés jusqu'à cette nouvelle fin. Un
  match qui passe à l'antenne après la fin de la fenêtre — même programmé et
  listé par le message de la soirée, puis lancé en retard — ouvre une nouvelle
  soirée, qui notifie : la soirée est la fenêtre de quatre heures, rien de
  plus.
- **Texte** (français, `formatLiveEvening`) : « 🔴 **Les lives de la
  soirée** », puis un bloc par match séparé par une ligne vide — l'heure de
  Paris en gras (`**21:00**`), suivie de « · En direct » pour un match à
  l'antenne, de « · Terminé · 2-1 » pour un match **terminé** (score lu sur
  le match, dans l'ordre de l'affiche) ou de « · Terminé » seul sans score
  (forfait, score en attente de confirmation) ; un match `MANUAL` annoncé dont
  l'antenne est fermée sans score (coupure, pause) n'a ni « En direct » ni
  « Terminé », à l'heure de son annonce (`live_started_at` effacé, l'heure
  vient de sa réservation — jamais celle de la relecture, qui changerait le
  texte à chaque minute) ;
  l'affiche et le tournoi ; le lien seul sur sa ligne. Les directs d'abord,
  puis les matchs **programmés** (`START_TIME`, castés, d'ici la fin de la
  fenêtre) par heure, puis les matchs terminés par heure : l'heure des streams
  à venir se lit d'un coup d'œil, et une soirée trop longue compte ses matchs
  finis avant ceux à venir. Un match annoncé **reste** au message une fois
  terminé (décision de l'utilisateur, 2026-10-19), même si son tournoi s'est
  clos avec lui (les matchs annoncés se lisent sur un tournoi `RUNNING` ou
  `FINISHED`, les programmés sur un tournoi `RUNNING` seulement). Un match
  rouvert pour une autre affiche, ou revenu en attente, n'est plus listé :
  seul un match `START_TIME` figure avant son direct, à son heure — jamais un
  match à une heure inventée. Une annonce ne fait relire un match que pour son
  affiche **courante** (`pairing`) : un match rouvert pour d'autres engagés n'y
  revient que par l'annonce de sa nouvelle affiche. Les liens partent
  à part (`streamUrls`, dix au plus) et le texte les place par des jetons
  `{{lien:N}}` que le bot remplace après ses neutralisations ; un nom ne peut
  pas forger de jeton (une espace de largeur nulle suit chaque accolade suivie
  d'une autre : `{{{lien:1}}` n'en forge pas non plus).
- **Modifier plutôt que reposter** : le bot rend l'identifiant du message
  (`messageId`), gardé dans `bg_live_evenings`. Le match suivant de la soirée
  envoie `editMessageId` : le bot **modifie** le message — aucune nouvelle
  notification (Discord ne notifie jamais sur une modification ; la mention de
  tête reste autorisée pour garder son surlignage) —, en un seul appel à Discord (aucune
  lecture préalable du message). Message pas du bot, ou
  qui ne se modifie plus (plafond de modifications de Discord sur un message
  vieux d'une heure, code `30046`) : une **suite** part, sans mention ni
  notification, et son identifiant remplace l'ancien. Message **supprimé** de
  #live (`10008`, souvent par le staff sur demande, par exemple d'un joueur
  nommé) : rien ne le republie — le bot répond `503` `message-deleted`
  (issue `evening-deleted`), le site ferme la soirée de ce public
  (`bg_live_evenings.closed`) jusqu'à la fin de sa fenêtre, réservations
  gardées et marquées refusées ; pm2 le dit pour chaque match non publié. Un message parti sans
  mention (suite, envoi `notify: false`, permission absente) est gardé
  `silent` : ses modifications envoient `notify: false` et n'écrivent pas de
  mention de tête — une mention grise qui n'a notifié personne aurait l'air
  d'une panne. Un bot d'une version antérieure ignore `mention`,
  `streamUrls`, `editMessageId` et `notify`, et ne rend pas d'identifiant :
  chaque direct et chaque fin de match (mise à jour) repartent dans un nouveau
  message **`@everyone`**, public
  StreamViewer compris, jetons `{{lien:N}}` laissés bruts. D'où l'ordre de
  déploiement : **bot d'abord**, et jamais de retour à un bot antérieur tant
  que `LIVE_ANNOUNCEMENTS_ENABLED` est posé. Une publication incertaine
  (`uncertain`, `timed-out`, `interrupted`) ne laisse pas d'identifiant : un
  match suivant de la même soirée repart dans un nouveau message.
- **Mise à jour aux fins de match** (`requestLiveEveningRefresh`,
  `refreshLiveEvenings`) : un score rendu ou arbitré, un match ou un tournoi
  changé (antenne fermée, forfait) — les évènements `score_reported`,
  `score_resolved`, `match_updated` et `updated` de
  `lib/server/tournaments/notifications.ts` — demandent la mise à jour des
  soirées ouvertes, sans rien lire sur le moment (aucune requête ajoutée à une
  lecture de page) et rien si les annonces sont désactivées. La première
  demande programme **une** mise à jour une minute plus tard
  (`LIVE_EVENING_REFRESH_DELAY_MS`) ; toutes celles de la minute la
  rejoignent : une ronde qui se termine d'un coup donne une modification par
  public. La mise à jour lit les soirées qui ont un message gardé, ne sont pas
  closes et dont la fenêtre court ou s'est fermée depuis moins de
  `LIVE_EVENING_WINDOW_HOURS` heures (`window_end > NOW() - INTERVAL 4 HOUR`,
  `closed = 0`) : un match lancé en fin de fenêtre se termine souvent après.
  Une soirée finie n'est modifiée que si ce processus a publié son texte
  (après un redémarrage, rien ne dit ce qui y manque — une modification pour
  rien d'un vieux message pourrait poster une suite) ; ses matchs sont ceux
  réservés **dans** sa fenêtre (`a.sent_at < window_end`, strict : une réservation datée de la seconde
  d'ouverture de la soirée suivante n'est qu'à celle-ci), jamais ceux de la
  soirée suivante. Elle rédige leur texte et ne
  l'envoie que s'il diffère du **dernier texte publié** (retenu par
  processus, annonces de direct comprises ; perdu au redémarrage, au pire une
  modification à l'identique). Toujours une **modification**
  (`editMessageId`, `refresh: true`, étiquette `live-refresh soiree-N …`) :
  jamais de notification, mention de tête gardée comme le message l'a publiée
  (`notify: false` pour un message `silent`). Mêmes chemins que la
  modification d'une annonce : suite sans mention si le message ne se modifie
  plus (`30046`, `50005`, identifiant remplacé), soirée close si le message a
  été supprimé (`10008`). Un refus (bot, AutoMod) ne renvoie pas le même
  texte ; une issue incertaine (`uncertain`, `timed-out`, `interrupted`) ne le
  retient pas : la mise à jour suivante le renvoie (une modification ne
  notifie jamais ; une soirée finie n'aurait sinon plus de quoi se corriger),
  sans relance immédiate ; un report (bot injoignable, salon fermé, Discord réticent, soirée
  en pause, coupe-circuit du bot ouvert — rien n'est alors lu —, lecture en
  échec) est relancé une minute plus tard, trente fois au plus depuis la
  dernière fin de match (`LIVE_EVENING_REFRESH_MAX_RETRIES` : une demi-heure,
  qui couvre un redémarrage ou un déploiement du bot ; chaque nouvel évènement
  en redonne autant, toujours une mise à jour par minute au plus). Un
  report qui tient au bot ou au salon arrête le passage : l'autre public
  n'essuie pas le même refus ; une soirée illisible n'empêche pas l'autre. Balayage et mise à
  jour passent par une **file unique** : une mise à jour ne rédige jamais en
  même temps qu'une annonce (elle effacerait son match du message).
- **Jamais deux notifications par public et par soirée** : le premier envoi
  qui notifie **prend** la marque `notified` juste avant l'appel au bot, en une
  instruction (`UPDATE … SET notified = 1 … WHERE id = ? AND notified = 0` +
  `affectedRows`). Soirée sans identifiant gardé mais déjà marquée (premier
  envoi d'issue incertaine, bot trop ancien, identifiant non enregistré — même
  si le tournoi de ce match est fini depuis, ou si son lien a changé de public)
  — le site envoie `notify: false` et le bot poste un nouveau message **sans
  mention écrite ni notification**. Les réservations d'un passage, prises
  avant l'ouverture de la soirée (parfois de plusieurs secondes, quand l'envoi
  de l'autre public passe d'abord), sont datées dans la soirée
  (`sent_at = GREATEST(sent_at, started_at)`) avant la lecture de ses matchs :
  sinon le match sortirait du message à la modification suivante, et ce
  garde-fou ne le verrait pas. Un envoi **refusé** (`rejected`, AutoMod) ou
  **reporté** n'a rien publié : la marque `notified` qu'il avait posée est
  retirée, et un refus (réservation gardée, jamais réessayé) sort de la soirée
  (`bg_live_announcements.refused`, sa date `sent_at` — donnée à l'export
  RGPD — restant vraie) — sinon chaque match suivant
  reprendrait le nom bloqué et serait refusé à son tour, et la soirée se
  croirait notifiée.
- **Longueur** : le texte, liens comptés en entier, tient dans
  `LIVE_ANNOUNCEMENT_MAX_LENGTH` (1 500) ; au-delà, la liste s'arrête **à la
  fin d'un bloc** et une dernière ligne compte le reste (« … et 3 autres matchs
  ce soir ») — pas de second message : un seul message par soirée se modifie.
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
  battement (25 s) de chaque flux SSE ouvert sur un tournoi **en cours** — lu
  sur la fiche que la salle tient à jour (`tournamentRoomCard`) et d'après
  ses dates : un onglet oublié sur un tournoi terminé ne réveille rien —, en production
  seulement. Étranglé à dix secondes pour tout le processus, avec relève ;
  jamais attendu. Coût : une lecture indexée (`idx_bg_matches_live`) toutes
  les dix secondes au plus, quel que soit le nombre de spectateurs ; aucune
  tant que le coupe-circuit du bot est ouvert. Un `START_TIME` dont l'heure
  n'est pas venue n'est pas lu.
- **Un message par soirée et par public, pas par match** : les matchs qu'un
  même balayage trouve à l'antenne pour un même public (chaîne officielle ou
  non), quels que soient leur tournoi et leur lien, partent dans le message de
  la soirée, une seule notification. Chaque affiche garde sa réservation. Une
  pause après un refus de Discord vaut pour la soirée de ce public seulement.
  Une soirée **illisible** (`bg_live_evenings` absente ou lecture en échec)
  rend les réservations du groupe et ne met en pause que ce public : l'autre
  part quand même, et pm2 le dit (« soirée … illisible ») sans accuser le bot.
  Les traces pm2 et l'étiquette envoyée au bot nomment **tous** les tournois
  du groupe (`tournoi-4,5`).
- **Une annonce par match et par affiche** : `bg_live_announcements`
  (clé unique `(match_id, pairing)`, `pairing` = les deux engagés **sans
  ordre**, `5:7` pour `7:5` : un plateau réécrit qui inverse les deux mêmes
  engagés ne réannonce pas) est réservée **avant** l'appel au bot.
  Un balayage concurrent, un rafraîchissement, une relecture du flux, un direct
  coupé puis relancé, un lancement annulé puis refait (horaire changé) ne
  repostent jamais. La réservation n'est **rendue** que si rien n'est parti
  pour une cause passagère — bot injoignable ou d'une version antérieure,
  salon fermé, refus lié à l'état du salon ou Discord sans réponse en lisant
  le salon (`503` `send-rejected`, `discord-unreachable`), panne du bot avant
  l'envoi (`500`) — et
  le balayage réessaie **une minute plus tard** (`LIVE_ANNOUNCE_RETRY_DELAY_MS` :
  la même cause renverrait le même refus). Après un bot indisponible, un salon
  fermé ou Discord muet en lisant le salon (`discord-unreachable`), la pause
  vaut pour tout le processus et les groupes suivants du même passage sont
  rendus sans appel au bot ; après un refus de Discord (`discord-held`, qui
  peut tenir au message), elle ne vaut que pour ce public (sa soirée) — un
  match qui la rejoint pendant la pause attend avec elle, un seul message
  part — et l'autre public part sans attendre. Une relève
  tombe au terme de la pause, sans attendre un nouvel évènement. Le tout tant que
  le match a commencé depuis moins de deux heures ; un
  succès (même sans mention), un refus du corps (`400`) ou un blocage par
  AutoMod (`503` `automod` : le même message serait bloqué de nouveau, et
  chaque essai alerterait la modération) la
  garde, comme un `503` `discord-down` (Discord lâché pendant l'envoi : il a
  pu partir). Un **délai dépassé** (15 s) la garde aussi : le bot a
  pu publier quand même, et une annonce perdue vaut mieux qu'un second
  `@everyone` à tout le serveur (`timed-out`, `console.error` dans pm2 :
  « son envoi peut encore aboutir », sans consigne d'action) ; il
  n'est pas compté comme une panne du bot. Un bot **tombé en route** la garde
  de même (`interrupted` : connexion coupée après l'envoi de la requête —
  `ECONNRESET`, redémarrage pm2 d'un déploiement) : il a pu publier avant ;
  une connexion qui n'a pas abouti (`ECONNREFUSED`, hôte inconnu) rend la
  réservation. Un `503` au corps illisible la garde aussi (il pouvait dire
  `discord-down`). Un jeton interne refusé (`401`) ou absent du bot (`503`
  `INTERNAL_API_TOKEN_NOT_CONFIGURED` : la route exige le jeton même en boucle
  locale) vaut `unauthorized` : réservation rendue, pause d'une minute pour tout
  le processus, pm2 désigne `BOT_INTERNAL_TOKEN` / `INTERNAL_API_TOKEN`, sans
  ouvrir le coupe-circuit. Le bot
  répond **avant** d'écrire au canal de logs : un canal lent ne fait pas
  croire au site que rien n'est parti. Ni le `404` ni le `503` n'ouvrent le coupe-circuit
  du bot : un salon fermé ne doit pas suspendre les rappels de fond. Côté
  bot, une cause que le site réessaie n'est signalée au canal de logs qu'une
  fois par heure ; une annonce qu'il ne réessaie pas (blocage par AutoMod,
  envoi incertain, requête déjà coupée par le site) l'est chacune.
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
  repasse par `normalizeStreamUrl`, et le bot revalide la liste blanche. Une
  page de redirection d'un hôte autorisé (`youtube.com/redirect`,
  `/attribution_link`) ou un lien qui porte une autre adresse dans son chemin
  ou sa requête (en clair, encodée une ou plusieurs fois, `https:\` ou
  `//hôte` sans schéma ; chemin décodé et barres doublées fusionnées) est
  refusé : le lien d'un `@everyone` ne mène qu'à la diffusion. Sans lien exploitable, pas d'annonce.
- **Texte** (`lib/shared/live-announcements.ts`, en français comme tout
  Discord) : « 🔴 En direct : A contre B — Tournoi ». Noms par `discordInline`
  (mentions, balisage et liens neutralisés). Une affiche d'équipes ne nomme que
  les équipes ; une entrée individuelle (`bg_teams.solo_user_id`, pas le type du
  tournoi) porte le **pseudo public** du compte (`bg_users.pseudo`, jamais le nom
  de l'entrée solo, qui peut porter un suffixe ; `liveEntrantName`) — **seule
  exception** à la règle « aucun pseudo sur Discord », décidée par l'utilisateur
  le 2026-10-14 (`RGPD_LOGS_AND_VISITS.md`). Compte supprimé ou pseudo vide :
  « un joueur » ; de même, en tournoi `SOLO`, une entrée sans compte (invité
  fantôme nommé par le staff) — seul un pseudo de compte part. Plusieurs affiches d'un tournoi individuel s'énumèrent comme
  celles d'équipes. Si aucune ne porte de nom publiable, le texte compte les
  matchs (« N matchs »). Une entrée individuelle dans le groupe fait lire le
  tournoi comme individuel, même au type illisible — dans l'annonce de soirée,
  toute entrée individuelle d'un match lu du même tournoi : un match entre deux
  invités y reste « un joueur contre un joueur ». **Inscriptions d'avant** :
  le pseudo n'est lu que pour une inscription (`bg_tournament_registrations.registered_at`)
  faite depuis la publication du changement de confidentialité qui l'annonce
  (`soloPseudoRegisteredSince`, `publishedAt` de `2026-10-pseudo-live-et-messages-de-match`) :
  un joueur inscrit sous l'ancienne mention reste « un joueur ». Le seuil vaut
  ce que vaut `publishedAt` (lendemain de la mise en ligne, `PRIVACY_CHANGES_CONSENT.md`) :
  si le déploiement glisse, avancer `publishedAt` **et** la date « 16 octobre 2026 »
  du registre T16, de `/rgpd` et de la politique du bot (FR + EN, test `live-announcements.test.ts`).
  Seuil à minuit, heure de Paris, comparé à `UNIX_TIMESTAMP(registered_at)` : il
  ne dépend pas du fuseau du serveur de base.
  L'exception s'arrête à
  #live : quand le texte nomme un joueur, le site joint `logMessage`, le même
  texte **sans pseudo** (« un joueur »), que le bot cite à la place de
  `message` dans son canal de logs quand l'annonce échoue (version du bot qui
  le lit requise : sans elle, la citation porterait les pseudos). **Conservation** : le message reste dans #live tant que le
  salon existe ; supprimé sur demande de l'équipe ou du joueur concerné
  (« Signaler un problème », catégorie RGPD) — registre T16 (pseudo publié déclaré
  en catégorie de données), `/rgpd`, et la fenêtre de suppression du compte
  (`deletion.residual`), qui le rappelle au joueur ; les conditions d'utilisation
  (section « Retransmission des matchs », `STREAM_NOTICE_LIVE` / `_EN`) disent que
  le nom neutre ne couvre pas cette annonce. Le bot préfixe la mention du public (`@everyone` ou le rôle StreamViewer) et n'autorise qu'elle
  (`{ parse: ["everyone"] }` ou `{ roles: [StreamViewer] }`) pour ce seul message ; sans la
  permission de mentionner, il n'écrit pas la mention (un « @everyone » gris
  qui ne notifie personne aurait l'air d'une panne).
- **Production seulement, activée explicitement, sur le site public**
  (`NODE_ENV=production`, **`LIVE_ANNOUNCEMENTS_ENABLED=1`** — posée par le
  seul `.env` de production, un tunnel https donnant un vrai nom de domaine à
  un poste —, **et**
  `APP_URL` en `https` sur un nom de domaine — ni adresse IP, boucle locale ou
  réseau privé, ni nom d'un seul mot, ni suffixe local ou de test : `.localhost`,
  `.test`, `.local`, `.internal`, `.lan`, `.home.arpa`, `.invalid`, `.example`) : une base de développement ne fait jamais écrire
  `@everyone` au serveur, même devant un bot local branché par erreur sur le
  vrai serveur — `npm start` sur un poste pose aussi `NODE_ENV=production`.
- **Adresses dans les noms** : un nom d'équipe ou de tournoi qui ressemble à
  une adresse (`https://…`, `exemple.gg/…`) ne devient ni lien ni aperçu sous
  l'annonce — `discordInline` glisse une espace de largeur nulle dans `://` et
  après un point suivi d'une lettre ou d'un chiffre. Le seul lien est celui du
  bot, validé par la liste blanche.
- **Traces** : pm2 `[live-announce] match N (tournoi T) annoncé dans #live`
  (`matchs N, M (tournoi T) annoncés` pour un groupe ; « sans notifier » quand
  la mention n'a pas pu partir — identifiants seuls, tournoi compris sur toutes
  les lignes, échecs et reports aussi) ; l'annonce naît d'un
  balayage, pas d'un geste du staff, donc aucune ligne `staff-audit`. Un report
  est averti dans pm2 au plus une fois par heure, par cause et par match (ou
  groupe), la cause distincte :
  « salon #live fermé au bot » (`503` de salon ou de permission), « Discord a
  refusé l'annonce (état du salon) ou n'a pas répondu au bot » ou « bot
  injoignable, en panne ou d'une version sans
  annonces » ou « jeton interne refusé ou absent » (`401`, ou `503`
  `INTERNAL_API_TOKEN_NOT_CONFIGURED`) ; passé deux heures, le match n'est
  plus réessayé. Un autre `503` qui ne concerne pas l'annonce se lit « bot
  injoignable ». Les annonces abandonnées sont tracées en `console.error` :
  refus du corps (`400`), blocage par AutoMod (« une règle AutoMod du serveur
  a bloqué l'annonce … abandonnée »), « publication non confirmée » (`503`
  `discord-down` — vérifier #live) et délai dépassé (« son envoi peut encore
  aboutir »). Les deux dernières ne demandent pas de poster l'annonce à la
  main : l'envoi du bot a pu partir, ou partir encore. Après un `400` ou un
  blocage par AutoMod, rien n'est parti : la poster à la main (règle
  corrigée) ne fait pas de doublon — **sans aucune mention** pour une
  annonce de soirée (le signalement du bot le dit) : une modification ou un
  envoi `notify: false` suivent un message qui a pu notifier, et après un
  premier message refusé le site rend la marque `notified` — le prochain
  direct de la soirée notifiera. Si le site avait déjà cessé d'attendre la
  réponse (`timed-out`), il garde la marque et reprend le match au direct
  suivant : un premier message se poste alors à la main **avec** la mention de
  son public, une modification ou un envoi muet ne se postent pas. Côté bot, voir ci-dessus (une fois par
  heure par cause réessayée ; chaque blocage AutoMod, envoi incertain ou
  requête coupée par le site ; un `400` n'est pas signalé au canal de logs). Deux pannes de la base sont tracées (une fois par heure et par
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
  nom de l'équipe est annoncé sur le Discord de l'association ; en individuel
  (`register.streamNotice.SOLO`), que le pseudo du joueur l'est.
- **Production — permissions Discord** dans #live : « Voir le salon »,
  « Envoyer des messages », « Mentionner @everyone, @here et tous les rôles »
  et « Intégrer des liens ». Sans la mention, le message part sans notifier ;
  sans l'intégration, sans aperçu de la chaîne ; sans les deux premières, rien
  ne part et le site réessaie. Le mode lent du salon ne gêne pas : Discord
  n'y soumet pas les bots. Une règle AutoMod qui
  bloque l'annonce est signalée au canal de logs, mais l'annonce n'est **pas**
  réessayée (le même message serait bloqué de nouveau) : la règle corrigée
  vaut pour les annonces suivantes.

## Information des joueurs (RGPD)

La retransmission est un traitement (registre, **T16**) : intérêt légitime de
l'association, droit d'opposition. **Exception** (décision du 2026-10-14) : le
pseudo d'un joueur dans l'annonce #live d'un tournoi individuel repose sur
l'**exécution du service** (art. 6.1.b — l'annonce fait partie du tournoi auquel
il s'inscrit), pas sur l'intérêt légitime : pas de nom neutre, ne pas y être
nommé = ne pas s'inscrire, une annonce passée est supprimée sur demande. Dit par
T16, `/rgpd#retransmission`, `DONNEES_PROFIL` (« Pseudo site »), le droit
d'opposition, la mention d'inscription solo, `STREAM_NOTICE_LIVE` (conditions,
version 4) et la politique du bot. **AutoMod** : si une règle AutoMod de Discord
bloque **ou signale** une annonce, son texte (pseudo compris en individuel) peut
parvenir au salon d'alertes des modérateurs du serveur. T16 en fait une finalité
(modérer le serveur), sur l'**intérêt légitime** de l'association ; l'alerte reste
jusqu'à sa suppression par les modérateurs, ou sur demande (c'est l'opposition) —
**décision requise** : aucune durée fixe. Textes à tenir ensemble : T16
(finalité, base, destinataire, conservation, transfert), T08, T01 (suppression),
`/rgpd` (#retransmission, tableau `AUTOMOD_ALERT_SCOPE`, suppression du compte,
transfert Discord), `DROITS` (effacement, opposition), la confirmation de
suppression (`account-deletion.ts`, `profile.json`), l'entrée `PRIVACY_CHANGES`
et la politique du bot. La configuration réelle d'AutoMod sur le
serveur (salon d'alertes posé ou non) n'est pas connue du code : **décision
requise** pour la préciser, la déclaration dit « peut ». Elle ne montre que le **pseudo**, le **nom
d'équipe** et les **résultats et performances en jeu** — ni webcam ni chat
vocal des joueurs. Le site ne fait que **lier** les chaînes, sans lecteur
intégré : il ne transmet rien aux plateformes, qui traitent leurs spectateurs en
responsables de leur propre traitement. Seule l'annonce d'un match dans le
salon #live passe par Discord (T16 : transfert vers les États-Unis, Discord,
§ Annonce sur Discord).

Le joueur en est informé là où il s'engage, sans case à cocher — ce n'est pas
un consentement : sous le bouton d'inscription de la fiche du tournoi
(`TournamentHeader`, en équipe comme en individuel) et dans la confirmation
d'inscription (`registration-confirm.ts`). Sur la fiche, l'information est **en
couches** (`INFO_HINTS.md`) : une ligne visible dit l'essentiel et le droit
d'opposition (`REGISTRATION_STREAM_NOTICE_SHORT`, `register.streamNoticeShort`),
le bouton « i » porte la mention entière et le lien vers `/rgpd#retransmission` ;
la confirmation, elle, relit la mention entière. Les phrases viennent d'un module pur,
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

Les comptes `Test_Caster` et `Test_CoCaster` portent la permission `live` seule ;
sur les tournois à phase de lancement, la première manche castée reçoit tour à
tour un caster seul, deux co-casters sur un même stream, et deux casters sur
deux streams, le second avec son propre lien (`SEED_CAST_CASES`).

## Notes reprises de CLAUDE.md

Texte déplacé tel quel depuis `CLAUDE.md` (allègement du fichier chargé à chaque session).

- **« Live » / « Direct » — trois sens à ne jamais confondre dans les libellés** : le projet emploie le mot pour (1) l'**état d'un tournoi** `RUNNING`, (2) une **diffusion** (stream Twitch/YouTube/Kick d'un tournoi ou d'un match), (3) la **connexion au flux SSE** qui tient la page à jour. Les trois se côtoyaient sur la même ligne de pastilles de `/tournois/[id]`, où « ● DIRECT » (connexion) voisinait « ● EN COURS » (état) sur un tournoi sans la moindre chaîne — on y lisait un stream qui n'existait pas. Règle de vocabulaire, sans effet sur le code interne (les valeurs `MatchLiveState`, les noms de fichiers `*live*` et les classes `pill-live` restent) : **« En cours »** pour l'état d'un tournoi (jamais « Live » ni « En direct »), **« En direct » / « le live »** réservé à une vraie diffusion, **« À jour » / « Reconnexion… » / « Hors ligne »** pour le témoin de flux (`LiveIndicator`). Le **rouge** (`pill-live`, `--red-live`) n'habille que ce qui est réellement à l'antenne : un état de tournoi ou un témoin de connexion se met en bleu. Avant d'écrire « Live » ou « Direct » dans une interface, se demander lequel des trois on désigne.
- **Diffusion en direct** (`lib/shared/live-streams.ts` pur + `lib/server/tournaments/live-streams.ts`) : le tournoi porte sa **chaîne officielle** (`bg_tournaments.live_url`), chaque match porte sa propre diffusion (`live_trigger` `AUTO`/`MANUAL`, `live_started_at`, et ses liens dans `bg_match_streams` — le premier fait foi) — **un match n'hérite jamais** de la chaîne du tournoi, parce qu'un streamer indépendant peut le caster. L'état (`OFF`/`SCHEDULED`/`LIVE`) n'est **pas stocké** : `resolveMatchLiveState` le dérive, si bien que l'arrêt du direct à la saisie du score ne demande aucune écriture et qu'une correction de score le défait seule. Aucune requête ne réimplémente la règle en SQL — `findBroadcastingTournament` filtre en mémoire avec `isMatchLive`. Le bouton « Regarder le live » de l'accueil n'est rendu **que si** un tournoi `RUNNING` a une chaîne officielle et au moins un match `LIVE` ; sinon il disparaît. URLs bornées par une liste blanche (`twitch.tv`, `youtube.com`, `youtu.be`, `kick.com`). Voir `docs/features/LIVE_STREAMS.md`.
