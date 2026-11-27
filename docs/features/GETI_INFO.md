# GETI Info — annonces de recrutement Overwatch

Page publique à venir (`/geti-info`, `/en/geti-info`) : le miroir des annonces de
recrutement Overwatch relayées dans six salons de notre serveur Discord, avec
filtres, copie du pseudo de l'auteur et alertes. La fonctionnalité se livre en
cinq lots ; ce document grandit avec eux.

| Lot | Contenu | État |
| --- | --- | --- |
| 1. GETI-PARSER | Analyse d'une annonce et filtre (`lib/shared/geti/`), jeu d'annonces anonymisées | **fait** |
| 2. GETI-INGEST | Bot → site : création, modification, suppression, rattrapage ; table, purge, mentions légales (§ Récupération) | **fait** |
| 3. GETI-PAGE | Page, six catégories, filtres, copie du pseudo, carte d'invitation, « Publier » | à venir |
| 4. GETI-NAV | Menu et mention sur l'accueil | à venir |
| 5. GETI-ALERTS | Alertes sur un filtre enregistré | à venir |

Le lot 1 ne stocke ni n'affiche rien : aucune donnée personnelle n'est encore
traitée par le site (rien à déclarer au registre avant le lot 2).

## Sources

Serveur Discord `676570513023172637` (`GETI_GUILD_ID`). Une catégorie par salon
(`GETI_CHANNEL_IDS`, `lib/shared/geti/types.ts`) :

| Catégorie | Salon | Identifiant |
| --- | --- | --- |
| `lfp` | Je cherche un joueur | `679323677874978826` |
| `lft` | Je cherche une équipe | `679323773559635999` |
| `lfsub` | Je cherche un remplaçant | `679323726717911090` |
| `lfstaff` | Je cherche un staff | `679323814106103819` |
| `lfs` | Je cherche un scrim | `930074663340605451` |
| `lfcast` | Je cherche un cast | `1085116755925536828` |

Ces annonces sont publiques : chaque message est relayé à tous les serveurs
abonnés au réseau.

### Format réel

L'échantillon en lecture seule prévu (`GET /channels/{id}/messages` avec le
jeton du bot local) a été refusé dès le premier salon (**403**) et arrêté là :
aucun message réel n'a été lu. Le format du relais GETI a été connu depuis
(annonces directes de joueurs et en-tête du relais) ; l'analyse lit :

- **message d'un joueur** — l'auteur Discord est l'auteur de l'annonce, le texte
  est le contenu ;
- **relais du bot GETI** — la description de l'encart s'ouvre sur l'en-tête
  `<@id>*(pseudo)* sur [Serveur](invitation)`, puis une ligne vide et le texte
  cité (`> …`). L'en-tête donne `authorId`, `authorTag` et `originServer`, passe
  avant toute mention du texte cité (« > contact <@id> » vise un tiers) et est
  retiré du texte : le nom du serveur n'apporte ni rôle, ni rang, ni région ;
- **autre relais d'un bot** (`author.bot`) — l'auteur est lu dans l'encart : ligne
  d'auteur si elle a la forme d'un pseudo (`pseudo`, `pseudo#1234` ; un nom
  d'affichage libre comme `Admin (@staff)` n'en donne aucun), mention derrière un
  libellé net (`by`/`par`/`Contact` en tête de ligne, `Auteur :`, `posté par`…) ;
  une mention sans libellé, dans une phrase (« remplaçant de <@id> ») ou sur une
  ligne citée (`> Contact : <@id>`), ne désigne personne : elle peut viser un
  tiers ; deux libellés qui nomment deux comptes différents non plus (le second
  peut être écrit par le joueur). L'identifiant lu d'une mention ne s'accompagne
  d'aucun pseudo : la ligne d'auteur pourrait nommer un autre compte. Titre,
  description et champs de l'encart forment le texte. La dernière ligne des
  relais de **notre** bot (`*Sent from : [Serveur](invitation)* by <@id>`,
  `buildServiceMessage`, en tête de ligne : jamais `> Sent from`) est retirée du
  texte et donne `originServer`, `authorId` et, par la ligne d'auteur de cet
  encart, `authorTag`.

**Usurpation d'auteur.** Pseudo et identifiant viennent toujours de la même
source. Un bot ou un webhook peut écrire n'importe quel en-tête, et notre relais
s'ouvre sur le texte du joueur, qui peut y imiter l'en-tête GETI :
`parseGetiPost(raw, { getiBotIds, siteBotIds })` ne croit chaque bot que pour
son propre format. Un bot de `getiBotIds` nomme l'auteur par son en-tête (ou un
libellé hors citation, `>` et `>>>` compris — un `>>>` ne cite que la fin de son propre morceau : message, titre, description ou champ) ; un bot de `siteBotIds`, par sa
seule ligne « Sent from » — un en-tête ou un libellé dans son encart est le
texte du joueur, et une ligne sans « by <@id> » ne nomme personne (le pseudo de
la ligne d'auteur, écrite par le bot, reste). Un bot listé des deux côtés lit
les deux ; s'ils nomment deux comptes différents, personne n'est désigné. Un bot
absent des listes, ou toute annonce de bot **sans liste**, garde son texte, sans
auteur ni serveur d'origine. **Le lot 2 passe les deux listes** (bot GETI, notre
bot).

Le jeu `tests/fixtures/geti/posts.json` est **de synthèse** (tournures courantes
du recrutement Overwatch, en français et en anglais ; pseudos, identifiants,
équipes et serveurs factices). **Le lot 2 doit le compléter d'annonces réelles
anonymisées** dès que le bot de production transmet des messages, et mesurer le
taux de reconnaissance (rang, rôle, région) sur ce vrai flux.

## Décision d'architecture : le bot pousse vers le site (lot 2)

Le bot écoute les six salons et **pousse** chaque message brut au site —
création, modification, suppression (unitaire ou en masse) et rattrapage des
14 derniers jours au démarrage — par une route interne protégée par
`SITE_INTERNAL_TOKEN`. C'est la **seconde exception** à la règle « toujours
app → bot », après `/message-tournoi` (`TOURNAMENT_STAFF_MESSAGE.md`).

Le site stocke le message brut et l'analyse lui-même : la même fonction pure sert
à l'enregistrement, aux filtres de la page (côté client) et aux alertes. Le bot
n'analyse rien — une amélioration de l'analyse ne demande pas de le redéployer.
Forme attendue du message poussé : `GetiRawPost`.

## Analyse — `parseGetiPost(raw)`

`lib/shared/geti/` est pur (importable serveur et client), sans dépendance au
bot. Point d'entrée : `@/lib/shared/geti`.

| Champ | Contenu |
| --- | --- |
| `category` | Celle de l'appelant, sinon celle du salon (`getiCategoryOfChannel`), sinon le **seul** mot-clé du texte (`lfp`, `lft`…) ; `null` sinon |
| `authorTag`, `authorId` | Pseudo à copier (ancien suffixe `#1234` gardé) et identifiant Discord ; jamais ceux du bot relais |
| `relayed`, `originServer` | Relais d'un bot ; serveur d'origine s'il est nommé |
| `text` | Texte de l'annonce, multi-ligne, sans invisibles, 4 096 caractères au plus |
| `ranks` | `min`, `max` (fourchette globale) et `byRole` (fourchette par rôle) |
| `roles`, `subRoles` | `TANK`, `DPS`, `SUPPORT`, `FLEX` ; `MAIN_TANK`, `OFF_TANK`, `HITSCAN`, `FLEX_DPS`, `MAIN_SUPPORT`, `FLEX_SUPPORT` |
| `regions` | `EU`, `NA`, `LATAM`, `ASIA`, `OCE` |
| `platforms` | `PC`, `CONSOLE` |
| `languages` | `FR`, `EN`, `ES`, `DE`, `IT`, `PT`, `NL`, `PL`, `AR` |
| `availability` | `days` (`MON`…`SUN`), `times` (minutes depuis minuit, `to` nul pour une heure seule), `timezone` |
| `teamName` | Nom d'équipe, 40 caractères au plus |
| `staffRoles` | `COACH`, `MANAGER`, `ANALYST`, `CASTER`, `OBSERVER`, `GRAPHIC`, `COMMUNITY` |
| `minAge` | Âge minimal (13–25 ; « majeur » = 18) |
| `postedAt`, `edited` | Date ISO de publication ; message modifié |

Dans une annonce « je cherche un joueur », `roles` et `ranks` sont ceux
**recherchés** ; dans « je cherche une équipe », ceux de l'auteur. Même champ,
même lecture : c'est la catégorie qui dit le sens.

### Texte non fiable

Rien de ce qui entre n'est fiable (texte libre d'un inconnu, relais d'un bot
tiers, JSON de forme quelconque). La sortie ne porte que des énumérations, des
nombres et quatre textes — `text`, `authorTag`, `teamName`, `originServer` —
nettoyés selon `UNTRUSTED_NAMES.md` (contrôles, invisibles et commandes de
direction retirés ; `visibleText` pour les noms) et bornés. Ils s'affichent **en
texte**, jamais comme du balisage ; un identifiant qui n'est pas un identifiant
Discord (15 à 22 chiffres) est rendu `null`.

- `teamName` et `originServer` ne gardent aucun caractère de balisage ni de
  mention (`withoutMarkup`) : une mention `<@id>` / `<#id>` est retirée en
  entier (l'identifiant d'un tiers ne sort pas), un émoji `<:nom:id>` garde son
  nom, puis astérisque, tiret bas, tilde, accent grave, barre verticale,
  chevrons, « @ » et barre oblique inverse sont retirés : « @everyone **Nitro** »
  devient « everyone Nitro ».
- `authorTag` : mentions, « @ » et chevrons retirés, émoji de serveur réduit à
  son nom ; le balisage n'est retiré qu'au bord d'un mot, tiret bas gardé (ils
  font partie de bien des pseudos : « Star*Lord#1234 » reste tel quel) : un
  en-tête `(**faux_nitro** @everyone)` donne « faux_nitro everyone ».
- Un en-tête GETI ou une ligne « Sent from » écrits par un autre bot que le
  leur restent dans `text` : c'est le texte du joueur, affiché tel quel.
- `text` garde le balisage de l'annonce mais aucune mention active
  (`getiSafeText`) : `<@id>` et `<@&id>` deviennent « @… » (l'identifiant d'un
  tiers ne sort pas), `<#id>` « #… », `@everyone` / `@here` perdent leur « @ ».
- Avant tout message Discord, ces textes passent encore par `discordInline` /
  `discordQuote`.

### Préparation du texte

Avant lecture : NFKC (lettres « de fantaisie »), liens, mentions, horodatages
Discord, balisage et pictogrammes remplacés par une espace ; le **nom** d'un
émoji de serveur est gardé (`<:Master:…>` → « Master ») ; accents et casse
retirés. Un mot n'est lu qu'entier (« peu » ne contient pas « eu »).

### Rangs

Porté d'`extractRanks` du bot (Marvel Rivals, paliers seuls) et étendu à
Overwatch. Échelle : Bronze 5 = 0 … Champion 1 = 39 (`getiRankValue`,
`getiRankFromValue`).

- **Palier seul** (« diamant ») : ses cinq divisions. **Palier + division**
  (« Master 2 », « gm1 ») : un rang. Alias français, anglais et fautes courantes
  (« platinium », « diamand », « grand-maître »).
- **Initiale + division** collées : « d3 », « m1 » (`b s g p d m c`). Une initiale
  seule n'est jamais un rang. « argent » n'est lu que suivi d'une division ; « or »
  n'est pas lu (mot trop courant) — « gold » l'est. Derrière « saison », « depuis
  la », « jouer à », collée à « ex- » (« depuis la s2 », « je joue à D2 »,
  « ex-G2 ») ou devant « esport », ce n'est pas un rang, ni « depuis s1 » (une
  saison) ; « ex d1 », « ancien m1 », « depuis d2 » en sont.
- **Abréviations** : « gm », « gm3 », « gm5+ », « diam », « dia », « plat »,
  « plat1 », « plat+ », « champ », « top500 », « t500 »… Celles qui sont aussi des
  mots courants ne sont écartées, sans division, que dans leur sens courant :
  « gm » de salut en tête de ligne (« gm tout le monde », « gm les gars » — mais
  « GM tous rôles », « GM, Master » sont des rangs), « un plat de pâtes », « à
  plat » (mais « jusqu'à plat », « gold à plat », « du silver au plat »), « champ
  de bataille ».
- **Fourchettes** : « diam 3-1 », « d3-m2 », « plat à diam », « d3 to m2 ».
  Plusieurs rangs dispersés : du plus bas au plus haut.
- **Bornes ouvertes** : « master+ », « min d2 », « au moins diamant » → jusqu'à
  Champion 1 ; « max m1 », « jusqu'à master » → depuis Bronze 5. Dans une liste,
  la borne vaut au bout où elle est écrite (« diam ou master+ » → Champion 1),
  sauf si l'autre bout est lui-même une borne (« min d3 max m1 »).
- **Top 500** : Grand Maître 5 → Champion 1.
- **Ancien SR** : « 4k » (≈ Grand Maître), « 3.5k », « 4k5 », « 3k+ »,
  « 3k-4k », « 3500 », « 4200 », « 2800-3200 », « 3500+ », « 3500 sr » — 500
  points par palier, 100 par division, plafonné à Grand Maître 1. Un nombre est
  un SR sauf contexte net : unité derrière (« 1500+ heures », « 4k 144hz »,
  « 1k abonnés », « 1200 followers », « 1200 personnes », « 3000 inscrits »,
  « 2000 balles », « 1k€ »), montant ou
  écran devant (« cashprize », « budget », « $ », « écran / résolution 4k »),
  identifiant (« code 3456 », « id 3500 »), numéro de téléphone (deux autres
  groupes de chiffres autour, un groupe collé par « - » ou « . », un indicatif :
  « 06 1234 5678 », « 555-1234 », « +33 4200 » — mais « 4200 20 ans » garde son
  SR), année (« 2025 », « 2025-2026 », et dès 1950 derrière un mot de date : « né
  en 2005 », « nés avant 2008 »). « sr » / « elo »
  collé l'emporte sur tout contexte.
- **Par rôle** : le rôle écrit contre le rang, sur la même ligne, devant
  (« tank m2 / dps d1 ») ou derrière (« M2 tank, D1 dps ») ; une liste de rôles
  partage la fourchette (« tank/dps : d3-m2 »). Un second rang qui suit le
  premier sans rôle à lui reste au même rôle (« tank peak gm, actuellement m1 » →
  Tank Master 1 – Grand Maître 1). « Flex » ne porte pas de rang.

### Autres champs

- **Rôles** : français, anglais, abrégés (« heal », « supp », « mt », « fdps »…).
  « flex dps » / « flex support » sont des sous-rôles, pas le rôle Flex. « ms »
  derrière un nombre est un ping ; « support » / « soutien » juste après un
  remerciement relié par « pour / for / de / du » (« merci pour tout votre
  soutien », « thanks a lot for the support », « thank you very much for your
  support ») n'est pas un rôle — « je serai ton support », « thx we need a
  support », « merci de jouer le support » en sont.
- **Région** : mêmes mots que le relais du bot, plus l'Océanie et le drapeau
  européen. « eu » derrière un auxiliaire ou un adverbe (« j'ai eu », « il a eu »,
  « jamais eu ») est le participe d'« avoir », pas l'Europe ; « a » ne compte que
  derrière son sujet (« de NA à EU », « ouvert à tout EU » restent l'Europe), et
  « bien / plus / tout / assez » que derrière une forme d'« avoir » (« j'ai bien
  eu » est le participe, « plus EU que NA » l'Europe).
- **Langues** : mots (« francophone », « english »), drapeaux, sigles **en liste**
  (« FR/EN ») ou derrière « langue : » — seuls, « EN », « ES » ou « DE » sont des
  mots courants.
- **Jours** : noms complets seulement (« mar », « jeu », « mon » sont des mots),
  fourchettes (« lundi au jeudi »), « week-end », « en semaine », « tous les
  soirs ».
- **Horaires** : « 21h-23h », « 20h30 », « 20-23h », « 8-11pm », « 20:30 » ; une
  durée (« 2h par jour », « 2-3h par soir », « 1h-2h par jour ») n'en est pas un ;
  au-delà de 6 h (« 20h-23h par soir », « 20-23h par soir », « 21h-23h per day »), c'est une
  plage, et « parfois » n'est pas « par ». Fuseau : « CET », « CEST », « UTC+1 »,
  « heure française » (= `Europe/Paris`).
- **Nom d'équipe** : derrière un libellé (« Équipe : … », « Team: … ») ou dans la
  phrase après « team / équipe / structure / roster », mots en capitale seulement,
  arrêté au premier mot du vocabulaire d'annonce (« Team Blue Phoenix EU ») ; sans
  capitale (« Roster : 5 joueurs »), ou derrière « team » un pronom ou un article
  (« Team Je cherche », « team La plus chill »), pas de nom — sauf un article en
  capitale devant un mot en capitale (« équipe The Owls », « team La Horde »). Un
  pronom en capitale peut finir un nom (« Team Game I », « Team Game On »), pas
  l'ouvrir, et pas quand un verbe de sa langue le suit (« Team Nova I need »,
  « team Phoenix On cherche » donnent « Nova », « Phoenix ») ; limite assumée :
  « Team Game On recrute » donne « Game ».
- **Âge minimal** : « 18+ », « +18 », « 17 ans minimum », « majeur ». « 18+ » ou
  « +18 » nu n'est un âge que suivi de la fin, d'une ponctuation, d'un mot d'âge
  ou d'un mot d'annonce (rôle, région, langue, plateforme : « 18+ dps », « +18
  FR ») ; suivi d'autre chose (« +20 joueurs », « +20 inscrits », « +15 min »)
  ou derrière un niveau ou un délai (« lvl 20+ », « top 20+ », « dans +15 »),
  c'est un nombre.

## Filtre — `matchesGetiFilter(post, filter, now?)`

Critères de `GetiFilter` : `category`, `ranks` (`min`, `max`), `roles`,
`regions`, `platforms`, `languages`, `maxAgeHours`, `includeUnknown`. Un critère
absent, nul ou vide ne filtre rien. Tous les critères renseignés doivent passer
(ET) ; dans un critère à plusieurs valeurs, une seule suffit (OU).

- **Rangs** : la fourchette de l'annonce **recoupe** celle du filtre, bornes
  comprises. Avec des rôles voulus et un rang par rôle dans l'annonce, seuls les
  rangs de ces rôles comptent ; sinon la fourchette globale.
- **Rôles** : un rôle voulu est dans l'annonce, ou l'annonce dit « Flex ».
- **Âge** : publiée depuis `maxAgeHours` au plus ; une annonce sans date, ou
  datée de plus de 5 minutes dans le futur, est écartée.
- **Filtre enregistré** (JSON relu pour les alertes) : rien n'y est une
  erreur. Un filtre `null` ne filtre rien ; une liste qui n'en est pas une
  (`"regions":"EU"`) est ignorée ; un rôle inconnu (« constructor ») aussi ; une
  borne de rang qui n'est pas un rang (palier inconnu, division hors de 1–5) est
  ouverte, et deux bornes invalides valent un critère absent ; une division
  écrite en texte (`"3"`) est lue comme un nombre ; un `maxAgeHours` écrit en
  texte (`"24"`) aussi, mais un texte illisible (`"24h"`, `""`) n'est jamais lu
  comme « sans limite » : rien ne passe ; `includeUnknown: "true"` vaut `true` ;
  une catégorie inconnue (`"LFP"`) est ignorée.
- **Champ non lu** (rang, rôle, région, plateforme, langue) : l'annonce est
  écartée, sauf `includeUnknown: true` — le lot 3 décide du réglage par défaut de
  la page.

## Questions ouvertes pour les lots suivants

- Format réel des messages : l'en-tête du relais GETI et les messages directs
  de joueurs sont lus ; le lot 2 ajoute des annonces réelles anonymisées et mesure
  le taux de reconnaissance.
- Accès du bot de production aux six salons (`Voir le salon`, `Lire l'historique`)
  à vérifier avant le rattrapage (14 jours, 7 pour les scrims).
- « Top 500 » et l'ancien SR sont des approximations assumées.

## Tests

`tests/lib/shared/geti/` — `ranks.test.ts`, `fields.test.ts`,
`parse-post.test.ts`, `filter.test.ts`, `fixtures.test.ts` (jeu
`tests/fixtures/geti/posts.json`) ; fabriques dans `tests/helpers/geti.ts`.

## Coût d'analyse (borné)

- Chaque texte brut (contenu, titre, description, champ) est coupé à `2 × GETI_TEXT_MAX` avant tout motif ; au plus 10 encarts et 25 champs par encart sont lus ; la ligne « Sent from » se cherche dans les 600 derniers caractères de la description ; la forme NFKC est recoupée (un « ﷺ » vaut 18 lettres).
- Les motifs n'ont aucune paire de `\s*` adjacents (« by <@id> », « by : <@id> »), donc pas de retour arrière quadratique.
- Rangs : une jonction « gold a plat » ne regarde que le rang qui finit juste avant ; les rôles voisins d'un groupe se trouvent par dichotomie.
- Une liste se filtre par `filterGetiPosts(posts, filter, now?)` : l'horloge est lue une seule fois.

## Récupération (lot 2) — le bot pousse, le site garde

### Format réel des annonces

Constaté sur le flux réel (échantillon en lecture seule du bot de production,
quatorze jours, jamais versé au dépôt — les jeux de test restent de synthèse).
Deux sortes d'annonces vivent dans les six salons, et **les deux sont gardées** :

| `source` | Qui écrit | Forme | Modification / suppression suivie |
| --- | --- | --- | --- |
| `direct` | un membre, dans notre salon | contenu du message ; l'auteur Discord est l'auteur de l'annonce | celles du message du membre |
| `relay` | GETI Bot (`GETI_BOT_USER_ID`), depuis un serveur abonné au réseau | contenu vide, **un** encart dont la description commence par `<@id>*(pseudo)* sur [Serveur](invitation)`, puis l'annonce citée (`> …`) ; ni titre ni champs | celles du **relais** par GETI Bot |

L'en-tête du relais donne l'identifiant de l'auteur, son pseudo (celui qui se
copie) et le serveur d'origine — dont le nom peut porter des crochets
(`[TAG] Nom`, la forme la plus courante : `GETI_SERVER_LINK`). `parseGetiPost`
le lit (`GETI_HEADER`) et le retire du texte, qui garde ses marques de citation
(`> …`) ; l'auteur de l'en-tête prime sur toute mention du texte. Le message de **tout autre bot** (le nôtre compris), un message système
ou un message sans texte n'est pas une annonce : ni poussé par le bot, ni gardé
par le site. Un message de GETI Bot dont le premier encart ne s'ouvre pas sur l'en-tête d'un
relais — mention de l'auteur, `(pseudo)`, puis `sur`/`on`/`from` (l'avis « Ton
annonce a été publié dans … », même s'il mentionne l'auteur) — n'en est pas une non plus
(`isGetiRelay`, `isGetiRelayMessage` côté bot ; dans le premier encart, cette garde est plus large que l'en-tête que lit l'analyse — tout en-tête lu dans ce premier encart la passe, ce que vérifie un test ; un en-tête placé dans un encart suivant, ou un auteur seulement mentionné dans le texte, ne la passe pas — : 671 des 672 relais de l'échantillon réel ont cette forme). L'analyse ne croit l'en-tête
que des bots listés (`getiTrustedBots` : GETI Bot seul — notre bot n'y est pas,
ses messages étant refusés avant l'analyse). Le réglage de l'analyse sur les textes réels est un lot à part
(GETI-TUNE).

### Durées de garde, par catégorie

`GETI_RETENTION_DAYS` (`lib/shared/geti/ingest.ts`) : **7 jours pour `lfs`**
(une recherche de scrim est vite périmée), **14 jours pour les cinq autres**,
comptés depuis la publication sur Discord. La même table borne l'écriture
(annonce trop ancienne : comptée `expired`, jamais gardée), la purge, la lecture
(une annonce échue n'est jamais rendue, même avant la purge), la fenêtre de
réconciliation et, côté bot, la profondeur du rattrapage (`GETI_CHANNELS`,
recopie à tenir alignée — le bot vit dans un autre dépôt).

### Table `bg_geti_posts`

Une ligne par message Discord (`message_id` unique) : `channel_id`, `category`,
`source`, `author_id`, `author_tag`, `raw_json` (le message brut poussé, borné à
60 000 octets), `parsed_json` (l'analyse `parseGetiPost` faite **à l'écriture**),
`posted_at`, `edited_at`, `received_at`. Index `(category, posted_at)`,
`(channel_id, posted_at)`, `(posted_at)`. Aucun lien avec un compte du site.
Créée par `lib/server/database/schema/geti.ts` ; table absente = routes en `503`.

Une modification repasse par la même écriture (`ON DUPLICATE KEY UPDATE`) et
ré-analyse le message ; la version reçue n'écrase la version gardée que si elle
est au moins aussi récente (`COALESCE(edited_at, posted_at)`) — un rattrapage
peut croiser une modification en direct. Le rattrapage du bot repoussant toute
la fenêtre, **un redémarrage du bot ré-analyse toutes les annonces gardées** :
c'est ainsi qu'une amélioration de l'analyse atteint les lignes déjà en base.

### Routes internes (bot → site)

Seconde exception au sens app → bot, après `/message-tournoi`. Même porte
(`rejectWithoutSiteInternalToken`) : boucle locale seulement (403 derrière nginx),
jeton `SITE_INTERNAL_TOKEN` comparé en temps constant (401), 503 sans jeton.
Plafond commun `GETI_INGEST_RULE` (1 200 appels par minute, 429 au-delà), corps
lu borné (413), réponses en **nombres** seulement, refus par **code**
(`GETI_INGEST_ERRORS`), panne de base = `503 GETI_UNAVAILABLE` (le bot réessaie).

| Route | Corps | Effet | Réponse |
| --- | --- | --- | --- |
| `POST /api/internal/geti/posts` | `{ posts: [{ id, channelId, content, author{id,username,discriminator,bot}, embeds[{authorName,title,description,fields,footerText}], postedAt, editedAt }] }` — 20 au plus, 512 Kio | crée ou remplace chaque annonce, analysée ici | `{ stored, emptied, expired, rejected }` |
| `POST /api/internal/geti/posts/delete` | `{ ids: [...] }` — 100 au plus | retire ces messages | `{ removed }` |
| `POST /api/internal/geti/reconcile` | `{ channelId, since, until, ids: [...] }` — 10 000 identifiants au plus | retire toute annonce gardée du salon, publiée entre `since` (ramené à la fenêtre de garde) et `until`, absente de `ids` | `{ removed }` |

Tout champ est tenu pour non fiable (`lib/server/geti/wire.ts`) : typé, borné,
écarté s'il n'a pas la forme attendue (`rejected`). Un message sans texte après
analyse (`emptied`) est retiré s'il était gardé.

### Purge

`purgeExpiredGetiPosts`, lancée par `startGetiPostsPurgeClock`
(`instrumentation.ts`, horloge `geti-posts-purge` : 3 minutes après le
démarrage, puis toutes les heures) : par catégorie selon sa durée, puis toute
ligne plus vieille que la plus longue. Suppression définitive — une horloge, pas
le trafic ni le bot : un site sans visite ou un bot arrêté ne garde rien au-delà
de la durée annoncée.

### Lecture — `listGetiPosts(filter, page, executor?, now?)`

`lib/server/geti/posts.ts`, pour la page du lot 3 et les alertes du lot 5 :
annonces de la plus récente à la plus ancienne, `GetiPostPage`
(`posts`, `total`, `page`, `pageSize` — 30 par défaut, 100 au plus). La
catégorie et l'âge se filtrent en SQL, le reste par `matchesGetiFilter` sur
l'analyse gardée. Une annonce rendue (`GetiStoredPost`) porte `messageId`,
`channelId`, `category`, `source`, `authorTag`, `authorId`, `parsed`,
`postedAt`, `editedAt` — jamais le message brut.

### Côté bot (dépôt `blueGenjiBot`, `src/geti/`)

- Écoute `messageCreate`, `messageUpdate`, `messageDelete`, `messageDeleteBulk`
  sur les six salons seulement ; partiel `Message` activé (sans lui, la
  modification ou la suppression d'un message hors cache n'est jamais annoncée) ;
  un message partiel est relu avant d'être poussé.
- Rattrapage au démarrage et à chaque nouvelle session Discord : historique de
  chaque salon sur sa fenêtre de garde (pages de 100, pause entre deux pages,
  5 000 messages au plus par salon), puis `reconcile` avec la liste des annonces
  encore présentes, plus celles poussées en direct pendant le rattrapage — ce qui a
  été supprimé, ou a cessé d'être une annonce, pendant l'arrêt du bot quitte le site.
  Un salon que Discord refuse (salon disparu, accès ou permission retirés) ne
  relance pas à lui seul de rattrapage ; un échec passager en relance un toutes les cinq minutes.
- Site injoignable : file bornée en mémoire, reprises espacées puis abandon ;
  un abandon déclenche un rattrapage complet, retenté toutes les cinq minutes.
  Le bot ne plante jamais et ne journalise (pm2) que des nombres et des
  identifiants de salon.
- Intentions `Guilds`, `GuildMessages`, `MessageContent` ; permissions
  **Voir le salon** et **Voir les anciens messages** sur les six salons. Sur
  Discord, le bot n'écrit **rien**.
- Déploiement : l'ordre ne casse rien (un bot plus récent que le site reçoit des
  404, réessaie puis rattrape ; un site sans bot à jour reste vide). Le site
  porte `SITE_INTERNAL_TOKEN`, le bot `SITE_INTERNAL_URL` et le même jeton —
  déjà posés pour `/message-tournoi`.

### Données personnelles

Registre T21 (et T08 pour la lecture par le bot), `/rgpd#annonces-geti` (FR et
EN), entrée `2026-11-annonces-de-recrutement-overwatch` de `PRIVACY_CHANGES`,
politique de confidentialité du bot. Le seed pose quatorze annonces de synthèse
(`lib/server/seed/geti.ts`, messages `1000000000000009NN`) dans les deux formes.

### Tests (lot 2)

`tests/lib/server/geti/` (`wire`, `posts`, `schema-and-clock`),
`tests/app/api/internal/geti/geti-routes.test.ts`,
`tests/lib/shared/geti/geti-bot-relay.test.ts` (en-tête du relais) ; fabriques
dans `tests/helpers/geti-ingest.ts`.
