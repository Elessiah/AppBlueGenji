# GETI Info — annonces de recrutement Overwatch

Page publique à venir (`/geti-info`, `/en/geti-info`) : le miroir des annonces de
recrutement Overwatch relayées dans six salons de notre serveur Discord, avec
filtres, copie du pseudo de l'auteur et alertes. La fonctionnalité se livre en
cinq lots ; ce document grandit avec eux.

| Lot | Contenu | État |
| --- | --- | --- |
| 1. GETI-PARSER | Analyse d'une annonce et filtre (`lib/shared/geti/`), jeu d'annonces anonymisées | **fait** |
| 2. GETI-INGEST | Bot → site : création, modification, suppression, rattrapage de 14 jours ; table, purge, mentions légales | à venir |
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
  d'auteur (`pseudo`, `pseudo#1234`, `Nom (@pseudo)`), mention derrière un libellé
  net (`by`/`par`/`Contact` en tête de ligne, `Auteur :`, `posté par`…) ; une
  mention sans libellé, dans une phrase (« remplaçant de <@id> ») ou dans une
  citation (`> …`), ne désigne personne : elle peut viser un tiers ; titre, description et
  champs de l'encart forment le texte. La dernière ligne des relais de **notre**
  bot (`*Sent from : [Serveur](invitation)* by <@id>`, `buildServiceMessage`) est
  retirée du texte et donne `originServer` et `authorId`.

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
- **Âge** : publiée depuis `maxAgeHours` au plus ; une annonce sans date est
  écartée.
- **Champ non lu** (rang, rôle, région, plateforme, langue) : l'annonce est
  écartée, sauf `includeUnknown: true` — le lot 3 décide du réglage par défaut de
  la page.

## Questions ouvertes pour les lots suivants

- Format réel des messages : l'en-tête du relais GETI et les messages directs
  de joueurs sont lus ; le lot 2 ajoute des annonces réelles anonymisées et mesure
  le taux de reconnaissance.
- Accès du bot de production aux six salons (`Voir le salon`, `Lire l'historique`)
  à vérifier avant le rattrapage de 14 jours.
- « Top 500 » et l'ancien SR sont des approximations assumées.

## Tests

`tests/lib/shared/geti/` — `ranks.test.ts`, `fields.test.ts`,
`parse-post.test.ts`, `filter.test.ts`, `fixtures.test.ts` (jeu
`tests/fixtures/geti/posts.json`) ; fabriques dans `tests/helpers/geti.ts`.
