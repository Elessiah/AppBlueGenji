# GETI Info — annonces de recrutement Overwatch

Page publique à venir (`/geti-info`, `/en/geti-info`) : le miroir des annonces de
recrutement Overwatch relayées dans six salons de notre serveur Discord, avec
filtres, copie du pseudo de l'auteur et alertes. La fonctionnalité se livre en
cinq lots ; ce document grandit avec eux.

| Lot | Contenu | État |
| --- | --- | --- |
| 1. GETI-PARSER | Analyse d'une annonce et filtre (`lib/shared/geti/`), jeu d'annonces anonymisées | **fait** |
| 2. GETI-INGEST | Bot → site : création, modification, suppression, rattrapage ; table, purge, mentions légales (§ Récupération) | **fait** |
| 2b. GETI-TUNE | Réglage de l'analyse sur les annonces réelles : Émeraude, SR de scrim, dates, niveaux, annonces closes (§ Réglage) | **fait** |
| 3. GETI-PAGE | Page, six catégories, filtres, copie du pseudo, carte d'invitation, « Publier » (§ Page publique) | **fait** |
| 4. GETI-NAV | Menu et mention sur l'accueil (§ Navigation) | **fait** |
| 5. GETI-ALERTS | Alertes sur une recherche gardée : push et message privé Discord (§ Alertes) | **fait** |

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
| `dates` | Dates visées, « AAAA-MM-JJ » à l'heure de Paris, triées (14 au plus) ; vide sans date de publication |
| `levels` | Niveaux de division cités : `OPEN`, `INTERMEDIATE`, `ADVANCED`, `EXPERT` |
| `closed` | `true` quand tout le texte est barré (`~~…~~`) : annonce close |
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
Overwatch. Neuf paliers — Bronze, Argent, Or, Platine, **Émeraude**, Diamant,
Master, Grand Maître, Champion. Échelle : Bronze 5 = 0 … Champion 1 = 44
(`getiRankValue`, `getiRankFromValue`).

- **Palier seul** (« diamant ») : ses cinq divisions. **Palier + division**
  (« Master 2 », « gm1 ») : un rang. Alias français, anglais et fautes courantes
  (« platinium », « diamand », « grand-maître »).
- **Initiale + division** collées : « d3 », « m1 » (`b s g p e d m c`). Une initiale
  seule n'est jamais un rang. « e3 » (Émeraude 3) n'est lu qu'en contexte de
  rang : derrière un libellé ou un rôle (« rank : e5 », « tank e2 ») ou relié à
  un autre rang (« e3-d5 », « p1 / e4 »). Émeraude s'écrit aussi « émeraude »,
  « emerald », « eme », « emer » (« 2eme » n'en est pas). « argent » n'est lu que suivi d'une division ; « or »
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
- **SR** (l'« elo » des équipes et des scrims) : « 4k » (≈ Grand Maître),
  « 3.5k », « 4k5 », « 3k+ », « 3k-4k », « 3500 », « 4200 », « 2800-3200 »,
  « 3500+ », « 3500 sr », « 5000 » ; fourchettes de centaines « 3k4-5 »,
  « 2k5/7 » ; seconde borne seule à porter le « k » : « 3.4-3.5k », « 3.5-6k »
  (3 500 à 3 600), « 3.2-3k », « 3.3/4k » (3 300 à 4 000) ; derrière son
  libellé sans « k » : « SR 3.6-3.7 », « elo : 3.2 » ; et, dans une recherche de
  scrim ou de remplaçant seulement, le décimal nu (« LFS EU PC 3.6 »,
  « adv 4.5+ »). Correspondance : la table ci-dessous. Un horaire voisin ne fait pas d'un SR
  un numéro (« 3500 21-23 », « 4k 20-22 CET »), « loi 1901 » n'est pas un SR,
  et « champion » en titre n'est pas un rang (« S10 Intermediate Champion »,
  « champion de France »). Un nombre est
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
- **Table SR → rang** (échelle 0–5 000, en vigueur depuis l'ajout d'Émeraude
  entre Platine et Diamant, qui a décalé de 500 points les paliers
  inférieurs) : Bronze 0–999 (environ 200 SR par division) ; Argent
  1 000–1 499 ; Or 1 500–1 999 ; Platine 2 000–2 499 ; Émeraude 2 500–2 999 ;
  Diamant 3 000–3 499 ; Master (« Maîtrise ») 3 500–3 999 ; Grand Maître
  (« Grande maîtrise ») 4 000–4 499 ; Champion (« Virtuose ») 4 500–5 000.
  D'Argent à Champion, 100 SR par division, la division 5 en bas de la tranche
  (Émeraude 5 = 2 500–2 599, Émeraude 1 = 2 900–2 999). Donc « 4k » = Grand
  Maître 5, « 3500 » = Master 5, « 2k » = Platine 5. « Top 500 » est une notion
  à part, sans tranche de SR.
- **Noms français du jeu** : « Maîtrise » (lu avec une division seulement —
  « maîtrise de soi » est un mot courant), « Grande maîtrise » (pas « une
  grande maîtrise du jeu »), « Virtuose » (= Champion ; pas « un virtuose
  de… »).
- **Par rôle** : le rôle écrit contre le rang, sur la même ligne, devant
  (« tank m2 / dps d1 ») ou derrière (« M2 tank, D1 dps ») ; une liste de rôles
  partage la fourchette (« tank/dps : d3-m2 »). Un second rang qui suit le
  premier sans rôle à lui reste au même rôle (« tank peak gm, actuellement m1 » →
  Tank Master 1 – Grand Maître 1). « Flex » ne porte pas de rang.

### Autres champs

- **Rôles** : français, anglais, abrégés (« heal », « supp », « mt », « fdps »,
  « hs » = hitscan…). « flex dps » / « flex support » sont des sous-rôles, pas le
  rôle Flex, rôle en tête aussi (« dps flex », « support main ») ; « tank flex »
  est un tank seul, « flex to / on / sur » un verbe. Une barre verticale sépare
  deux postes (« Tank | Flex DPS »), et un alias ne se lit jamais à cheval sur
  deux lignes. « ms »
  derrière un nombre est un ping ; « support » / « soutien » juste après un
  remerciement relié par « pour / for / de / du » (« merci pour tout votre
  soutien », « thanks a lot for the support », « thank you very much for your
  support ») n'est pas un rôle — « je serai ton support », « thx we need a
  support », « merci de jouer le support » en sont. « hs » seul derrière « être »
  ou un appareil (« mon micro est hs », « casque hs ») veut dire « hors service ».
- **Région** : mêmes mots que le relais du bot, plus l'Océanie et le drapeau
  européen. « eu » derrière un auxiliaire ou un adverbe (« j'ai eu », « il a eu »,
  « jamais eu ») est le participe d'« avoir », pas l'Europe ; « a » ne compte que
  derrière son sujet (« de NA à EU », « ouvert à tout EU » restent l'Europe), et
  « bien / plus / tout / assez » que derrière une forme d'« avoir » (« j'ai bien
  eu » est le participe, « plus EU que NA » l'Europe) ; « on a bien eu » est le
  participe, « de NA à tout EU » l'Europe.
- **Langues** : mots (« francophone », « english »), drapeaux, sigles **en liste**
  (« FR/EN ») ou derrière « langue : » — seuls, « EN », « ES » ou « DE » sont des
  mots courants.
- **Plateformes** : « hybrid(e) », « crossplay » — et « mixed » dans une recherche
  de scrim — valent PC **et** console ; « hybrid » près d'un mode de carte ou du
  mot « map » (« maps: control, hybrid, push ») est le mode, pas la plateforme.
- **Jours** : noms complets, fautes courantes comprises (« mecredi »,
  « wenesday ») ; les abréviations (« mar », « jeu », « mon » sont des mots) ne
  se lisent que devant une date ou une heure (« Tue 20-22 », « sam 28/11 ») ou
  en liste ponctuée (« lun/mer/ven », « lun-ven », « lun, mer, ven » — deux
  mots séparés d'une seule virgule, « ce jeu, mon rang », sont une phrase) ; fourchettes sur une ligne
  (« lundi au jeudi » — deux puces « - Mardi », « - Dimanche » sont deux
  jours), « week-end », « en semaine », « tous les soirs », « 7/7j ». Le jour de
  semaine de chaque date lue s'y ajoute.
- **Dates** (`dates`, `parseGetiDates`) : « 26/11 », « 22/11/26 », « Thursday
  26 » (le quantième doit tomber sur le jour nommé), « ce soir », « today »,
  « demain », résolues depuis la date de publication, à l'heure de Paris, dans
  une fenêtre de −1 à +60 jours (« 4/5 jours », « 9/10 » ne sont pas des
  dates). Une recherche de **scrim ou de remplaçant** (salon, ou mot-clé
  `lfs` / `lfsub` du texte) vise des soirées : un jour nommé sans date donne sa
  prochaine occurrence (six jours au plus), un horaire sans jour ou un « now »
  le jour même de la publication.
- **Niveaux** (`levels`, `parseGetiLevels`) : divisions de la ligue FACEIT —
  « open », « inter(mediate) », « adv(anced) », « expert », nuancés ou non
  (« high open », « HighOpen », « low-mid advanced »). « int » n'est lu que
  nuancé ou collé à un autre niveau, « exp » que collé (« adv/exp » ; « low exp »
  est l'expérience) ; « DMs open », « position open for trials », « open
  minded », « open d'esprit » ne sont pas un niveau.
- **Passages barrés** : `~~…~~` n'est pas lu (« ~~Mardi 24/11~~ Mercredi
  25/11 » ne cherche plus que mercredi). Texte entièrement barré : `closed`,
  et son contenu reste lu.
- **Horaires** : « 21h-23h », « 20h30 », « 20-23h », « 8-11pm », « 20:30 » ; une
  durée (« 2h par jour », « 2-3h par soir », « 1h-2h par jour ») n'en est pas un ;
  au-delà de 6 h (« 20h-23h par soir », « 20-23h par soir », « 21h-23h per day »), c'est une
  plage, et « parfois » n'est pas « par ». Sans unité, la forme des scrims :
  « 20-22 CET », « 21/23 CET », « 21.15-23 CET », « h21-23 », « 20 CET » ; sans
  fuseau derrière, seulement en soirée (« 20-22 » dès 13 h au tiret, « 21/23 »
  dès 19 h à la barre) — « 3-5 joueurs », « 18-25 ans », « 22/11 », « 15/20 »
  n'en sont pas. Fuseau : « CET », « CEST », « BST », « EET », « UTC+1 »,
  « heure française » (= `Europe/Paris`), et « cet » / « cest » en minuscules
  derrière une heure — pas le démonstratif (« 15h cet après-midi », « 18 cet été »).
- **Nom d'équipe** : derrière un libellé (« Équipe : … », « Team: … ») ou dans la
  phrase après « team / équipe / structure / roster », mots en capitale seulement,
  arrêté au premier mot du vocabulaire d'annonce (« Team Blue Phoenix EU ») ; sans
  capitale (« Roster : 5 joueurs »), ou derrière « team » un pronom ou un article
  (« Team Je cherche », « team La plus chill »), pas de nom — sauf un article en
  capitale devant un mot en capitale (« équipe The Owls », « team La Horde »). Un
  pronom en capitale peut finir un nom (« Team Game I », « Team Game On »), pas
  l'ouvrir, et pas quand un verbe de sa langue le suit (« Team Nova I need »,
  « team Phoenix On cherche » donnent « Nova », « Phoenix ») ; limite assumée :
  « Team Game On recrute » donne « Game ». À défaut : un nom devant un suffixe de
  structure (« Chroma Esport », « ELEVEN Academy », « Clay Family ») ou juste
  devant le verbe de l'annonce (« MTP RECRUTE », « Verdict Astral recherche »,
  « L'association Blue Sonate recherche »). Un SR (« Roster 3K »), un mot seul
  comme « E-sport » ou le nom d'un émoji de serveur ne nomment personne.
- **Âge minimal** : « 18+ », « +18 », « 17 ans minimum », « majeur ». « 18+ » ou
  « +18 » nu n'est un âge que suivi de la fin, d'une ponctuation, d'un mot d'âge
  ou d'un mot d'annonce (rôle, région, langue, plateforme : « 18+ dps », « +18
  FR ») ; suivi d'autre chose (« +20 joueurs », « +20 inscrits », « +15 min »)
  ou derrière un niveau ou un délai (« lvl 20+ », « top 20+ », « dans +15 »),
  c'est un nombre.

## Filtre — `matchesGetiFilter(post, filter, now?)`

Critères de `GetiFilter` : `category`, `ranks` (`min`, `max`), `roles`,
`regions`, `platforms`, `languages`, `levels`, `hideClosed`, `maxAgeHours`,
`includeUnknown`. Un critère
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
- **Annonces closes** : écartées avec `hideClosed: true` (ou `"true"`).
- **Champ non lu** (rang, rôle, région, plateforme, langue, niveau) : l'annonce est
  écartée, sauf `includeUnknown: true` — le lot 3 décide du réglage par défaut de
  la page.

## Questions ouvertes pour les lots suivants

- Format réel des messages : l'en-tête du relais GETI et les messages directs
  de joueurs sont lus ; le lot 2 ajoute des annonces réelles anonymisées et mesure
  le taux de reconnaissance.
- Accès du bot de production aux six salons (`Voir le salon`, `Lire l'historique`)
  à vérifier avant le rattrapage (14 jours, 7 pour les scrims).
- « Top 500 » et l'ancien SR sont des approximations assumées.

## Réglage sur les annonces réelles (lot 2b)

L'analyse a été mesurée puis réglée sur 695 messages réels des salons (14
jours ; `lfcast` n'en portait aucun). L'échantillon est une donnée personnelle :
il n'entre pas dans le dépôt, seules des annonces **réécrites** (faux pseudos,
identifiants, serveurs, équipes) rejoignent `tests/fixtures/geti/posts.json`.

- **Réponses de service** — `isGetiBotNotice(raw)` : la confirmation qu'un bot
  de relais adresse à celui qui publie (« Ton annonce a été publié dans 32
  autres channels. », lien d'invitation du bot) n'est pas une annonce ;
  `upsertGetiPosts` l'écarte comme un message vide (compté `emptied`, retiré
  s'il était gardé). Un relais à en-tête GETI n'en est jamais une.
- **Analyses déjà gardées** : chaque analyse est gardée avec sa version en
  dernière clé (`"analysisVersion":2}` — 2 : passages masqués non lus) ; une ligne
  d'une version antérieure est réanalysée à la lecture depuis son
  `raw_json` par `listGetiPosts` (seules ces lignes remontent leur message brut) ;
  message brut illisible : la ligne n'est pas rendue (son analyse ancienne a pu
  lire un passage masqué). Hors requête,
  l’horloge de purge horaire (`refreshStaleGetiPosts`, 5 000 lignes au plus par
  passage) réécrit ces lignes une fois, colonnes d'auteur comprises (ce que la
  page affiche et ce que vise une opposition ; une ligne dont l'auteur relu fait
  l'objet d'une opposition est retirée), puis vide le cache des listes (une ligne
  dont le message brut est illisible est retirée, comme une ligne sans texte ou
  un avis du bot) : la lecture ne les réanalyse plus (~0,3 ms chacune,
  jusqu’à 3 000 par page sinon). L’écriture comme le retrait ne touchent
  qu’une ligne encore ancienne. Avancer la version (`ANALYSIS_VERSION`) quand
  l'analyse change ce qu'elle lit : les lignes gardées sont alors refaites.
- **Faux positifs écartés** (revue) : une tranche d'âge (« âge : 16-20 ») n'est
  pas un horaire ; « 2/3 joueurs », « 1/12 places », « 1/2 tanks » ne sont pas des dates, et
  « 31/12 » lu un 1er janvier l'est (année précédente) ; « recrutement /
  inscriptions / candidatures open » n'est pas le niveau Open ; « +18 de
  préférence », « 18+ ou mature » sont un âge ; dans une recherche d'équipe
  (`lft`, salon ou mot-clé), le mot devant « recherche » est le pseudo du joueur,
  pas une équipe, comme partout devant « cherche une équipe / team » (« Kevin
  cherche une équipe en tant que coach ») — sauf « X recrute une team » et une
  recherche de scrim. Un mot de nom compte 32 caractères au plus (coût borné).

Limites connues : le rôle d'une recherche de remplaçant donné par la seule
mention d'un rôle Discord (`<@&id>`) n'est pas lu ; le pool de héros, l'âge du
joueur (« 19 ans », non extrait à dessein), le format d'un scrim (« bo3 » —
absent de l'échantillon) et les postes d'administration ou de modération ne
sont pas des champs ; « 20 22 / 21 23 » (sans séparateur) n'est pas un horaire.

## Tests

`tests/lib/shared/geti/` — `ranks.test.ts`, `fields.test.ts`,
`parse-post.test.ts`, `filter.test.ts`, `tune.test.ts` (tournures réelles du
lot 2b), `fixtures.test.ts` (jeu
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
(`> …`) ; l'auteur de l'en-tête prime sur toute mention du texte. Le pseudo
peut porter une parenthèse fermante (`Bob :)`). Une première ligne de GETI Bot
qui s'ouvre sur une mention sans se lire en entier comme un en-tête est écartée,
texte et auteur compris (`GETI_HEADER_LIKE_LINE`) : son pseudo et son nom de
serveur sont choisis par d'autres, qui y écriraient « Contact : <@quelqu'un> »
pour se faire passer pour un tiers. Le message de **tout autre bot** (le nôtre compris), un message système
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
| `POST /api/internal/geti/posts` | `{ posts: [{ id, channelId, content, author{id,username,discriminator,bot}, embeds[{authorName,title,description,fields,footerText}], postedAt, editedAt }] }` — 20 au plus, 512 Kio | crée ou remplace chaque annonce, analysée ici | `{ stored, emptied, expired, withheld, rejected }` |
| `POST /api/internal/geti/posts/delete` | `{ ids: [...] }` — 100 au plus | retire ces messages | `{ removed }` |
| `POST /api/internal/geti/reconcile` | `{ channelId, since, until, ids: [...] }` — 10 000 identifiants au plus | retire toute annonce gardée du salon, publiée entre `since` (ramené à la fenêtre de garde) et `until`, absente de `ids` | `{ removed }` |

Tout champ est tenu pour non fiable (`lib/server/geti/wire.ts`) : typé, borné,
écarté s'il n'a pas la forme attendue (`rejected`). Un message sans texte après
analyse (`emptied`) est retiré s'il était gardé. Un lot s'écrit en **une seule
instruction** multi-lignes (atomique, un aller-retour) ; le plafond d'appels du
bot (1 200 par minute, 429 avec `Retry-After`, que le bot attend) est loin
au-dessus du débit d'un rattrapage (environ 400 par minute au pire).

### Purge

`purgeExpiredGetiPosts`, lancée par `startGetiPostsPurgeClock`
(`instrumentation.ts`, horloge `geti-posts-purge` : 3 minutes après le
démarrage, puis toutes les heures) : par catégorie selon sa durée, puis toute
ligne plus vieille que la plus longue, par lots de 500 lignes (`DELETE … LIMIT`,
100 passages au plus par condition : après une longue panne, le reste attend
l'heure suivante). Suppression définitive — une horloge, pas
le trafic ni le bot : un site sans visite ou un bot arrêté ne garde rien au-delà
de la durée annoncée.

### Opposition (RGPD, art. 21) — `lib/server/geti/objections.ts`

Retirer une ligne de `bg_geti_posts` ne suffit pas : le bot repousse l'annonce
à chaque rattrapage tant que le message est sur Discord. Une opposition
s'enregistre dans `bg_geti_objections` (`kind` = `author` + identifiant Discord
de l'auteur : toutes ses annonces, présentes et à venir ; `message` + identifiant
du message : une annonce). `POST /api/admin/geti/objections` (`{ authorId }` ou
`{ messageId }`, l'un des deux exactement ; permission `moderation` ; geste tracé
dans pm2 avec son auteur) l'enregistre et retire sur-le-champ ce qu'elle couvre
(`{ removed }`), puis réécrit les lignes d'analyse ancienne (`refreshStaleGetiPosts`) :
leur auteur relu, que leurs colonnes ignoraient encore, tombe sous l'opposition
(échec : `500`, l'opposition gardée se rejoue) ; `DELETE` sur la même route, même corps, la lève (`{ lifted }` —
les annonces encore sur Discord reviennent au prochain rattrapage). À chaque lot
poussé, `upsertGetiPosts` retire **après** l'écriture les messages couverts
(`withheld` dans le bilan) : une opposition enregistrée pendant l'écriture
l'emporte quel que soit l'ordre. Celle d'un auteur tient jusqu'à sa levée ;
celle d'un message est effacée par la purge horaire 14 jours après son
enregistrement (le message est alors trop vieux pour revenir). Pas encore
d'écran : le geste se fait par la route (le lot de la page pourra y brancher un
bouton). Table absente : l'écriture d'un lot échoue en `503`, le bot réessaie —
rien n'est recopié sans savoir si son auteur s'y est opposé. Une sauvegarde restaurée
ne connaît pas une opposition enregistrée après elle : il faut l'enregistrer de
nouveau (`/rgpd`, T21 et `PRIVACY_CHANGES` le disent ; le journal des
suppressions ne porte que les suppressions de compte).

### Lecture — `listGetiPosts(filter, page, executor?, now?)`

`lib/server/geti/posts.ts`, pour la page du lot 3 et les alertes du lot 5 :
annonces de la plus récente à la plus ancienne, `GetiPostPage`
(`posts`, `total`, `page`, `pageSize` — 30 par défaut, 100 au plus). La
catégorie et l'âge se filtrent en SQL (3 000 lignes lues au plus — au-delà,
un avertissement pm2 —, sans le message brut), la lecture sur le pool étant gardée
10 secondes par catégorie et âge (8 lectures au plus, oubliées à chaque
écriture, suppression ou purge ; une lecture partie avant un oubli n'est pas
gardée) ; le reste par `matchesGetiFilter` sur
l'analyse gardée. Une annonce rendue (`GetiStoredPost`) porte `messageId`,
`channelId`, `category`, `source`, `authorTag`, `authorId`, `parsed`,
`postedAt`, `editedAt` — jamais le message brut.

### Côté bot (dépôt `blueGenjiBot`, `src/geti/`)

- Écoute `messageCreate`, `messageUpdate`, `messageDelete`, `messageDeleteBulk`
  sur les six salons seulement ; partiel `Message` activé (sans lui, la
  modification ou la suppression d'un message hors cache n'est jamais annoncée) ;
  un message partiel est relu avant d'être poussé ; une relecture qui échoue
  autrement que par « message inconnu » (panne passagère de Discord) fait relire
  son salon au passage des cinq minutes.
- Annonces directes d'un utilisateur exclu du relais (table `Ban`, `checkBan`) :
  ni poussées, ni comptées présentes (la réconciliation les retire du site) ;
  `/ban` et `/unban` lancent un rattrapage complet (`requestGetiResync`), qui
  retire du site ses annonces déjà copiées ou les y remet.
- Bannissement Discord d'un membre : **non écouté** (`guildBanAdd` n'arrive qu'à
  un bot qui a « Bannir des membres » ou « Voir les logs du serveur », que le
  relais n'a pas à recevoir). Les messages qu'il efface, que Discord ne signale
  pas un à un, restent sur le site jusqu'au prochain rattrapage ou à la fin de
  leur durée de garde.
- Opposition sur un auteur : un en-tête GETI illisible (pseudo ou serveur hors
  forme) garde l'auteur par sa mention de tête, écrite par GETI Bot — sans
  pseudo ni serveur —, pour que l'opposition le couvre. Dans le premier encart
  du message seulement (position 0, même si un encart illisible la tient) : la
  mention de tête d'un en-tête illisible dans un encart suivant ne nomme
  personne. Un en-tête complet et les libellés hors citation (« Contact :
  <@id> ») se lisent, eux, dans tout encart — le texte du joueur y est cité.
- Une annonce vidée (pièce jointe seule, texte effacé) n'est retirée que si sa
  version est au moins aussi récente que la version gardée : un ancien envoi
  vide, retenté après la modification, ne retire pas l'annonce à jour.
- `stored` compte les annonces acceptées : une version plus ancienne que la
  version gardée y figure, sans rien écrire.
- Un lot qui porte deux versions d'un même message n'en garde que la plus
  récente (modification, sinon publication), avant l'analyse : une ancienne
  version vide ne retire pas la version récente du même lot.
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
`tests/lib/shared/geti/geti-bot-relay.test.ts` (en-tête du relais),
`tests/lib/server/geti/objections.test.ts`,
`tests/app/api/admin/geti-objections.test.ts` (oppositions) ; fabriques
dans `tests/helpers/geti-ingest.ts`.

## Page publique `/geti-info` (lot 3)

Page **publique** (aucune session), en français et en anglais (`/en/geti-info`),
rendue côté serveur à chaque demande (`force-dynamic`) : `components/geti/GetiInfoView.tsx`,
posée par `app/geti-info/page.tsx` et `app/geti-info/[category]/page.tsx`.

### Adresses

- Une adresse par catégorie : `/geti-info/lfp`, `lft`, `lfsub`, `lfstaff`, `lfs`,
  `lfcast` — le sigle du salon, le même dans les deux langues (`getiCategoryPath`).
  Toute autre écriture (casse comprise) répond 404.
- `/geti-info` rend la catégorie **par défaut — les scrims (`lfs`,
  `GETI_DEFAULT_CATEGORY`)** — **sans renvoi** ; son adresse canonique
  est `/geti-info/lfs` (`GETI_DEFAULT_LIST_PATH`, que visent aussi le menu et
  l'encart de l'accueil). `/geti-info/lfp` et les autres adresses de catégorie
  restent valides (le défaut est passé de `lfp` à `lfs`, sans renvoi : seul le nu
  `/geti-info` change de liste). L'adresse canonique ne porte jamais les filtres.
- **Non indexée** (`GETI_ROBOTS` : `noindex, follow`, `lib/shared/geti/page.ts`) et
  absente du sitemap : les annonces portent le pseudo Discord de tiers (relais GETI
  compris), et `data-nosnippet` ne cache que l'extrait — une recherche sur un pseudo
  mènerait sinon à la page (revue sécurité 1). Le texte garde `data-nosnippet` (sur
  une enveloppe `<div>`), au cas où un moteur passerait outre.

### Filtres — l'adresse est la seule mémoire

`lib/shared/geti/page.ts` (pur) : `parseGetiPageQuery` lit l'adresse,
`getiPageSearch` l'écrit, `getiPageFilter` en fait le `GetiFilter` du moteur. Une
valeur inconnue, hors borne ou non proposée par la catégorie est **ignorée** ;
des rangs inversés sont remis dans l'ordre. Des heures « inversées » ne le sont
pas : `hfrom=22&hto=2` est un créneau qui passe minuit.

| Paramètre | Sens | Exemple |
| --- | --- | --- |
| `rmin`, `rmax` | fourchette de rangs (`palier-division`) | `rmin=diamond-3` |
| `role`, `sub`, `staff` | rôles, sous-rôles, rôles de staff | `role=tank,dps` |
| `lvl`, `reg`, `plat`, `lang`, `day` | niveau d'équipe, région, plateforme, langue, jour | `lvl=advanced` |
| `hfrom`, `hto` | créneau horaire, heures entières (début 0–23, fin 1–24 ; début après la fin = passe minuit) | `hfrom=22&hto=2` |
| `age` | âge maximal en jours, sous la durée de garde (1, 3, et 7 hors scrims) | `age=3` |
| `closed=1` | montrer aussi les annonces closes (masquées par défaut) | |
| `strict=1` | écarter les annonces qui ne précisent pas un critère choisi | |
| `p` | page (30 annonces par page ; au-delà de la dernière, un message et un lien vers la dernière) | `p=2` |

- **Filtres par catégorie** (`GETI_CATEGORY_FILTERS`) : seulement ce que l'analyse
  lit dans ses annonces — pas de rôle pour un scrim, des rôles de staff pour
  `lfstaff` et `lfcast`, etc.
- **Annonces incomplètes** : gardées par défaut (`includeUnknown`), car la plupart
  des annonces réelles ne donnent ni région ni plateforme ; la case « Inclure les
  annonces qui ne précisent pas un critère » les écarte (`strict=1`).
- Le filtre du moteur a reçu quatre critères pour la page : `subRoles`,
  `staffRoles`, `days`, `time` (créneau en minutes ; un horaire de l'annonce doit
  le recouper, une heure seule y tomber ; horaire ou créneau qui passe minuit
  coupé en deux, `getiTimeSlotMatches` ; une fin à « 0h » après un début dans la
  journée, « 22h-0h », est la fin de journée) — `matchesGetiFilter`. Une analyse
  gardée à laquelle manque un champ, ou dont un horaire ou un rang est abîmé
  (`null`, borne hors domaine : `getiStoredTimeSlot`, `getiStoredRankRange`), est
  lue comme « critère non lu », jamais une erreur (de même pour `getiPostChips`).
- Heures écrites selon la langue (`getiClockLabel`) : « 21h », « 20h30 » ; en
  anglais « 21:00 ». La fin de journée s'écrit « 24h » / « 24:00 ».
- `GetiFilters` (client) : groupes nommés (`<fieldset>` + légende), cases et listes
  natives, « i » (`InfoHint`) pour le rang, le rôle, le niveau, l'horaire et les
  deux réglages d'affichage. Chaque changement réécrit l'adresse
  (`router.replace`, sans défilement, retour à la page 1) ; le compteur de
  résultats est une région `aria-live`. Sous 900 px le panneau se replie derrière
  un bouton (`aria-expanded`). Tant qu'un changement attend son rendu, le rendu
  d'un changement plus ancien ne remet pas les contrôles en arrière
  (`getiFilterSync`) ; l'attente porte l'adresse **normalisée** comme le serveur
  la rendra (`getiNormalizedSearch` : rangs inversés remis dans l'ordre), se lève
  à chaque rendu qui l'atteint — même s'il redonne l'adresse précédente — et
  sur un retour arrière, quand toutes les navigations de filtre sont rendues
  (`useTransition`), ou sur un lien qui remplace cette page (pagination,
  réinitialisation ; `getiLinkNavigatesTab` écarte nouvel onglet, téléchargement,
  autre site et ancre de la même page).
- Étiquette de rang mise en avant comme le filtre la juge : avec des rôles voulus,
  seul le rang de ces rôles, sauf si la carte n'en donne aucun ou qu'aucun rôle
  n'est voulu : le filtre compare alors la fourchette globale de l'annonce, que
  chaque étiquette de rang par rôle porte (`overall`) et sur laquelle elle est jugée.
  Une fourchette gardée est relue en vrais rangs, bornes remises dans l'ordre
  (`getiStoredRankRange`).
- Au-delà de la dernière page (liste vide comprise), pas de pagination
  (« Page 5 sur 1 ») : seuls le message et son lien restent.

### Carte d'une annonce (`GetiPostCard`)

- Pseudo Discord (`visibleText`), sélectionnable, et bouton **Copier** : presse-papiers,
  repli `execCommand`, notification `showSuccess` (ou `showError`).
- Âge relatif (« il y a 3 h »), date absolue (heure de Paris) en `title` ; marque
  « modifiée » ; pastille « Close » ; provenance discrète (relais de GETI ou
  message direct, serveur d'origine).
- **Étiquettes** des données lues (`getiPostChips`), teintées par nature ; celles
  qui répondent à un critère actif (`getiChipMatches`) sont mises en avant — plus
  vives, cochées, et préfixées pour un lecteur d'écran (jamais la couleur seule).
- **Texte** : toujours un nœud de texte (`getiPostBodyText`) — **une** marque de
  citation suivie d'une espace ou seule sur sa ligne (celle du relais ; « >4000 » reste), balisage par
  paires au bord d'un mot (« xX__Sniper__Xx » reste ; `**` / `~~` restés seuls retirés quand ils collent
  un mot ou finissent le texte, gardés entre deux chiffres « 5**2 », deux espaces ou seuls sur leur ligne),
  code rendu tel quel (aucune marque retirée dedans, citation et titre compris ; langue d'un bloc ```` ```txt ```` ôtée), passage masqué `||…||` (lu de gauche à droite comme Discord : `||||x||` masque `||x` ; un `||` dans un code ouvert avant lui est du texte ; un passage ouvert avant un code se ferme au premier `||` qui suit, même dans un accent grave ; code sans borne de longueur, motif neuf par usage — `getiCodeSpan()`), quelle que soit sa longueur →
  « [masqué] » / « [hidden] » (jamais son contenu ; l'analyse ne le lit pas non plus : aucune étiquette n'en vient — `getiWithoutSpoilers`), mention → mot neutre (jamais un
  identifiant), émoji de serveur → son nom, horodatage `<t:…>` → date ou heure à
  l'heure de Paris (`getiTimestampLabel`, `R` écrit comme `f`), lien laissé en texte. Replié au-delà
  de 420 caractères ou 7 lignes (« Lire la suite ») ; une fois la page chargée, le
  bouton ne reste que si le texte replié dépasse réellement.

### Carte du serveur officiel de GETI, fenêtre « Publier »

- `GetiOfficialCard` en tête de chaque catégorie : **notre** carte (la CSP interdit
  tout cadre, aucune image n'est chargée de chez Discord), bouton « Rejoindre »
  vers l'invitation. La fréquentation (`lib/server/geti/community.ts`, invitation
  publique de Discord, 0,8 s au plus, succès gardé 30 min, échec une minute seulement et journalisé par code) est rendue
  sous `Suspense` : elle ne retient jamais la page et disparaît si Discord se tait.
- « Publier une annonce » (`GetiPublishButton`, fenêtre `GetiPublishDialog` portée
  dans `body`, `useDialogBehavior`, `useBackdropDismiss`) : on ne publie pas sur le
  site mais sur Discord, par l'une de **deux options présentées dans deux cadres de
  même poids** (`<section>` nommée par son `<h3>`, même gabarit : emblème, surtitre,
  titre, une phrase, un bouton principal, un pied) :
  1. **« Publier sur notre serveur » / « Post on our server »** (teinte glacier) :
     bouton vers le salon de la catégorie (`getiChannelUrl`), et en pied
     l'invitation de notre serveur pour qui n'en est pas membre.
  2. **« Publier via GETI Bot » / « Post via GETI Bot »** (violet du réseau,
     loyauté envers lui) : le serveur officiel de GETI fait **partie du cadre** —
     plus de carte posée au milieu de la fenêtre —, bouton « Rejoindre » (nom
     accessible « Rejoindre le serveur Discord GETI… ») et en pied le nom du
     serveur et sa fréquentation quand Discord la donne (`count`, le
     `GetiOfficialCount` rendu par le serveur sous `Suspense` : même cache que la
     carte de la page, aucun appel de plus).
  L'introduction tient en une phrase ; la règle « une annonce modifiée ou supprimée
  sur Discord l'est aussi ici » est derrière son `InfoHint`.
  Côte à côte (rangées partagées par `subgrid` : les deux boutons restent à la même
  hauteur), empilés sous 700 px ; cibles de 44 px (boutons, fermeture, lien
  d'invitation). La fenêtre ne charge rien de chez Discord.

### Sélecteur de catégorie (`GetiCategoryNav`)

« Je cherche : » puis **six cases égales** — icône (la même que la carte d'aperçu de
la catégorie), libellé (« Un scrim », « Un joueur »…), nombre d'annonces. Des
**liens** (une adresse par catégorie, `aria-current="page"` sur la courante), pas un
`tablist` : chaque case recharge la page. La catégorie par défaut vient en premier
(`GETI_CATEGORY_ORDER`, aussi l'ordre des raccourcis de l'accueil). Six de front,
3 × 2 sous 1100 px, **2 × 3 au téléphone** plutôt qu'une bande défilante : les six
restent visibles d'un coup. La courante se voit autrement que par la couleur
(bordure pleine, barre basse, icône sur fond plein, graisse) ; cases de 56 px.

Le nombre est celui des annonces **affichées par défaut** (sans filtre, closes
cachées) : `countGetiPostsShared` le compte sur les lectures partagées de la liste
(mêmes règles : fenêtre de garde, oppositions), gardé 5 s (`GETI_COUNT_CACHE_TTL_MS`, bâti sur
des lectures de 10 s : une annonce sortie de la garde quitte le nombre au plus 15 s
après, la case courante sans filtre prenant le total de la liste) sous le préfixe
`geti:scan:`, **une lecture après l'autre** (pas six ensemble sur le pool), oublié
à toute écriture comme la liste ; la case courante sans filtre reprend le total de la
liste affichée. Rendu **à part**, sous `Suspense` (`GetiCategoryNavCounted`) : la page
n'attend jamais ces six lectures, le sélecteur s'affiche d'abord sans nombre. Lu à voix
haute en entier (« Un scrim, 4 annonces » ; filtres actifs, la case courante dit « 14
annonces sans filtre »). Illisible (`countGetiPostsForNav`) : aucun nombre, l'échec
consigné par code comme celui de la liste (`logGetiListFailure`), et 10 s d'abstention
avant de relire (levée aussi par toute écriture réussie : la base est revenue). Finitions : pastille vide de même emprise pendant l'attente des nombres
(`pending`, aucun décalage à leur arrivée), libellé coupé aux mots (`overflow-wrap:
break-word`, `hyphens: auto`), survol de l'icône et de la pastille, barre basse animée,
repli `forced-colors` (bordure de 3 px, icône `Highlight`) ; dans la fenêtre « Publier »,
repli sans sous-grille (`@supports not`) : les deux cadres s'empilent, et le lien
« Rejoindre » garde son texte visible avec un suffixe lu seulement (serveur, nouvel onglet).

### Aperçu d'un lien collé (Discord)

La page est `noindex, follow`, ce qui n'empêche pas l'aperçu : `getiCategoryMetadata`
passe par `pageMetadata` (`SHARE_METADATA.md`) et écrit, par catégorie et par langue,
`og:title` « Annonces GETI — Je cherche un scrim · BlueGenji Esport » (« GETI posts —
… »), `og:description` = la phrase de la catégorie, `og:site_name`, `og:url`
canonique (celle de la catégorie, `/geti-info` compris), `og:locale` (`fr_FR` /
`en_US`, la valeur du site pour l'anglais), la carte Twitter large et `og:image`
= **une carte par catégorie**, `/og/<langue>/geti-<catégorie>.png` (1200 × 630,
rendue par le site, texte de `messages/*/share.json` § `geti`, motif et teinte de
`GETI_SHARE_CARD_STYLES`). `theme-color` vient de la mise en page racine. Aucune
annonce ni pseudo dans l'aperçu : titre, phrase et carte sont fixes.

Le bouton « Créer une alerte » est le premier enfant d'une rangée `InfoHintRow
inline`, qui met son premier enfant « en ligne » : il y perdait sa boîte flexible
(cloche sur la ligne de base, sans écart). `.headActions button.alertOpen` la lui
rend, et `.headActions` centre ses boutons.

### Fraîcheur

Aucun flux : `GetiRefresher` relit la page (`router.refresh()`) au retour sur
l'onglet (étranglé) et toutes les 5 minutes en régime plein seulement (la lecture SQL des annonces est mutualisée 10 s par catégorie et âge — `listGetiPostsShared`, `cached` à vol unique, oubliée après toute écriture : enregistrement, suppression, réconciliation, purge, réanalyse ; une annonce supprimée sur Discord disparaît donc aussitôt, comme le dit `/rgpd` —, le filtre et la page restent par demande ; un geste de filtre attend 300 ms de calme avant de naviguer, « Réinitialiser » part tout de suite ; la fenêtre « Publier » rend ses deux cadres elle-même à l'ouverture)
(`getiRefreshIntervalMs`, `CLIENT_POWER_MODES.md`) ; un onglet caché ne demande rien.

### Textes, tests, seed

- Messages `messages/<langue>/geti.json` ; les composants clients reçoivent leurs
  textes en props (aucun dictionnaire de plus dans le paquet). Noms de rangs
  officiels en français (Maîtrise, Grande maîtrise, Virtuose).
- Tests : `tests/lib/shared/geti/page.test.ts`, `page-text.test.ts`,
  `page-filter.test.ts`, `tests/lib/server/geti/community.test.ts`,
  `e2e/geti-info.spec.ts`.
- Seed : 18 annonces `Test_` — chaque catégorie, relais et messages directs, une
  annonce modifiée, une close, un niveau de division, un rang Émeraude, une autre
  région, un texte long, un horaire qui passe minuit ; un scrim de plus de 7 jours n'est jamais gardé.
- Données personnelles : rien de plus que ce que décrivent déjà le registre (T21),
  `/rgpd#annonces-geti` et `PRIVACY_CHANGES` (texte, pseudo, serveur d'origine,
  dates, critères lus). L'appel à Discord pour la fréquentation part du serveur,
  sans rien du visiteur.

## Retouches UX (cycle ui 1)

- `GetiLayout` (client) enveloppe filtres et résultats : pendant un changement de filtre, la grille porte `aria-busy` + `data-pending` (liseré pointillé, jamais d'opacité : contraste 4,5:1) et le panneau annonce « Mise à jour… » (`<output>`).
- « Réinitialiser » rend le focus au bouton Filtres (mobile) ou au titre du panneau avant de disparaître ; sur mobile, un bouton « Voir les N annonces » referme le panneau.
- Liste indisponible : filtres masqués, « Annonces non chargées » / « Posts not loaded » en ligne (jamais un « aucune annonce », qui se lirait comme une recherche vide), la panne en notification (`showError`, redite si « Réessayer » revient encore sans liste) et bouton « Réessayer » (`GetiRetry`, `router.refresh()`) ; pm2 reçoit `[geti] post list unavailable: <code>` (code, à défaut nom de la classe d'erreur ; une ligne par minute au plus, avec le nombre d'échecs tus — `logGetiListFailure`). Une écriture qui échoue en cours de route oublie aussi la lecture partagée.
- La date exacte de publication / modification est un texte du pied de carte (plus d'infobulle) ; le repli de copie rend le focus au bouton.
- Onglets anglais au pluriel (Players, Teams, Subs, Staff, Scrims, Casters).

## Navigation (lot 4)

La page est une **fonction principale** du site : on y arrive de deux endroits, sur
chaque page vitrine et dès l'accueil.

- **Menu burger** (`PublicNavMenu`, `PUBLIC_NAVIGATION.md`) : « Annonces GETI » /
  « GETI posts » ouvre la liste, mise en avant, vers l'adresse canonique `/geti-info/lfs`
  (`GETI_DEFAULT_LIST_PATH`), page courante sur toute la rubrique ; les entrées de la
  partie compétitive (Tournois, Équipes, Classement, Joueurs) en sont sorties. La
  barre des connectés (`SiteNav`) ne change pas.
- **Accueil** (`components/cyber/landing/GetiSpotlight.tsx`, juste après le bandeau
  défilant) : une carte avec une accroche courte (les types d'annonces ; ce que la page
  réunit et la marche à suivre — filtrer, puis contacter l'auteur sur Discord —
  derrière un `<InfoHint>`), le bouton « Voir les
  annonces GETI » et un raccourci par catégorie (« Parcourir : Scrims, Équipes qui recrutent,
  Joueurs sans équipe, Remplaçants recherchés, Staff, Casts » →
  `/geti-info/<catégorie>`, scrims d'abord). Le bouton vise l'adresse canonique `/geti-info/lfs`
  (celle que déclare `/geti-info`), comme l'entrée du menu : une seule adresse par liste. Les raccourcis
  nomment **ce que la liste contient**, pas l'intention de l'auteur comme les
  onglets de la page (« Je cherche un joueur » = annonces d'équipes qui recrutent) :
  un capitaine qui cherche un joueur n'y est pas envoyé vers d'autres équipes. Composant
  serveur **sans lecture de données** : il ne dépend ni de la base ni de Discord.
  Textes dans l'espace `geti` de `messages/<langue>/landing.json` (serveur seulement,
  hors `LANDING_CLIENT_NAMESPACES`). Liens par `LocaleLink` ; la liste des raccourcis
  est nommée par son libellé (`aria-labelledby`). Sous 900 px la carte passe en
  colonne ; à 375 px les raccourcis passent à la ligne, sans défilement horizontal.
- Tests : `tests/app/navigation-a11y.test.tsx`, `tests/app/geti-spotlight.test.tsx`,
  `e2e/landing.spec.ts`.

## Alertes sur une recherche (lot 5)

Sur `/geti-info`, « Créer une alerte » garde **la catégorie affichée et ses
filtres**. Quand le bot pousse une nouvelle annonce qui y correspond, le
propriétaire de l'alerte est prévenu.

### Décisions

- **Compte requis.** Les notifications push du site sont rattachées à un compte
  de bout en bout (`bg_push_subscriptions.user_id`, sujets coupés, langue,
  export, effacement). Un abonnement anonyme, tenu par la seule adresse de
  l'appareil, ouvrirait une écriture sans session (adresses d'abonnement
  arbitraires, plafonds par IP seulement) et une seconde gestion des droits
  (lister, supprimer, exporter sans compte) : écarté pour ce lot. Sans session,
  la fenêtre mène à `/connexion`.
- **Aucun changement côté bot.** L'envoi passe par `notifyUsers`
  (`lib/server/notify.ts`) : push sur les appareils abonnés du compte, message
  privé Discord au compte Discord **certifié** (`certified`), par l'appel
  app → bot existant — bot injoignable, le push part seul. Sujet
  `GETI_ALERT` de `PUSH_TOPICS` ; coupé dans « Mon profil », il coupe aussi le
  message privé (`dmFollowsTopic`).
- **Ce que dit le message.** Push : « Nouvelle annonce GETI » / « Elle
  correspond à ton alerte « nom ». » ; message privé : « Nouvelle annonce GETI
  qui correspond à ton alerte « nom » : lien ». Ni pseudo, ni texte de
  l'annonce ; le nom est celui que le compte a donné (rendu sûr par
  `discordQuoted`), sinon le titre de la catégorie. Langue du compte
  (`getiAlertPush`, `getiAlertDm` dans `lib/shared/push-messages.ts`). Le lien
  ouvre la page filtrée comme l'alerte, sur la carte de l'annonce
  (`#post-<id du message>`).

### Ce qu'une alerte garde

`lib/shared/geti/alerts.ts` (module pur). La recherche est gardée sous la
**forme canonique de l'adresse** (`getiPageSearch`), relue par
`parseGetiPageQuery` : une alerte ne peut pas porter un filtre que la page ne
sait pas écrire, et deux recherches égales s'écrivent pareil (refus du
doublon). La page, l'âge et « montrer les annonces closes » ne sont pas
gardés : une alerte ne regarde que ce qui vient d'arriver, et une annonce
close ne prévient jamais.

| Constante | Valeur | Rôle |
| --- | --- | --- |
| `GETI_ALERT_MAX_PER_USER` | 10 | Alertes par compte |
| `GETI_ALERT_NAME_MAX` | 60 | Nom facultatif (contrôles et caractères de direction retirés) |
| `GETI_ALERT_COOLDOWN_MINUTES` | 10 | Au plus une notification par alerte sur cette durée |
| `GETI_ALERT_FRESH_MINUTES` | 30 | Âge maximal (publication ou modification) d'une annonce qui prévient |
| `GETI_ALERT_SCAN_MAX` | 2000 | Alertes actives lues par catégorie et par lot reçu |
| `GETI_ALERT_QUEUE_MAX` | 100 | Passes d'alertes en attente de leur tour (au-delà : lot abandonné, avertissement pm2) |
| `GETI_ALERT_HIT_RETENTION_DAYS` | 15 | Garde des traces « déjà signalée » |

### Tables

- `bg_geti_alerts` : `user_id` (clé étrangère, `ON DELETE CASCADE`),
  `category`, `name`, `search`, `paused`, `created_at`, `last_notified_at` ;
  index `(user_id)` et `(category, paused)`.
- `bg_geti_alert_hits` : clé primaire `(alert_id, message_id)`, `created_at` —
  une ligne par annonce déjà vue par une alerte ; deux clés étrangères
  `ON DELETE CASCADE` : vers l'alerte, et vers l'annonce
  (`bg_geti_posts.message_id`, `fk_bg_geti_alert_hits_post`) — une annonce
  retirée (supprimée du salon, vidée, opposition, échue, réanalyse impossible)
  emporte ses traces dans la même instruction : rien n'en reste (T21). Une
  annonce qui revient ensuite (texte rétabli après avoir été vidé) compte comme
  nouvelle et peut prévenir encore si elle est récente (publiée ou modifiée
  depuis moins de 30 min, `isFreshGetiPost` — y compris quand c'est le
  rattrapage du bot qui la pousse ; son arriéré plus ancien ne prévient
  personne et ne pose aucune trace) : la promesse « jamais deux
  fois » vaut tant que l'annonce reste sur le site (textes légaux).
  Une trace ne se pose que sur une annonce gardée (`INSERT IGNORE` écarte celle
  retirée entre-temps).

Tables neuves : leur `CREATE TABLE` (`schema/geti.ts`) suffit ; seule la clé
vers l'annonce est dans `RECENT_SCHEMA_CHANGES` (groupe de deux pas, pour les
bases de développement qui avaient déjà la table : traces orphelines retirées,
puis la clé), joué seulement tant que `information_schema` ne montre pas la clé
(table présente, `fk_bg_geti_alert_hits_post` absente) : ni balayage des traces
à chaque démarrage, ni erreur quand la table manque. Table absente : la page se rend sans alertes, la passe
d'alertes ne fait rien.

### Routes (`/api/geti/alerts`)

Session requise (401 `UNAUTHORIZED`), écritures plafonnées par compte
(`GETI_ALERT_WRITE_RULE`, 40 par 10 minutes), réponses d'erreur à code seul.

| Route | Effet | Refus |
| --- | --- | --- |
| `GET /api/geti/alerts` | `{ alerts, max }` du compte | 503 `GETI_ALERT_UNAVAILABLE` |
| `POST /api/geti/alerts` `{ category, search, name? }` | 201 `{ alert }` | 400 `GETI_ALERT_INVALID`, 400 `GETI_ALERT_NAME_TOO_LONG`, 409 `GETI_ALERT_LIMIT`, 409 `GETI_ALERT_DUPLICATE` |
| `PATCH /api/geti/alerts/[id]` `{ name?, paused? }` | `{ alert }` | 404 `GETI_ALERT_NOT_FOUND` (alerte d'un autre compte comprise), 400 |
| `DELETE /api/geti/alerts/[id]` | `{ deleted: true }` | 404 `GETI_ALERT_NOT_FOUND` |

Le plafond et le doublon se jouent dans une transaction dont la **première
instruction** verrouille la ligne du compte (`SELECT id FROM bg_users WHERE
id = ? FOR UPDATE`, une table, sans jointure — MariaDB) : deux créations
simultanées ne dépassent pas dix alertes.

### Passe d'alertes — `notifyGetiAlerts(posts, now?, executor?, send?)`

Appelée par `POST /api/internal/geti/posts` après l'enregistrement, **sans être
attendue** (le bot n'attend ni push ni message privé) ; elle ne lève jamais.

1. Ne restent que les annonces **ouvertes** et **récentes** (`isFreshGetiPost`,
   30 minutes) : le rattrapage du bot, qui repousse deux semaines d'annonces à
   chaque démarrage, ne prévient personne. Une annonce ancienne **modifiée**
   à l'instant compte comme récente : si elle correspond désormais à une
   alerte qui ne l'avait jamais vue, elle prévient une fois. Ce tri se refait
   sur la **version gardée**, relue dans `bg_geti_posts` comme la page la lit
   (`readStoredGetiPosts` : une analyse d'une version antérieure est
   réanalysée depuis le message brut) : une version plus
   ancienne arrivée après une modification (l'enregistrement la laisse de
   côté) est jugée sur la version gardée — fermée, elle ne prévient pas — et
   une annonce retirée entre-temps ne prévient pas.
2. Une lecture **par catégorie** du lot des alertes actives (`paused = 0`,
   comptes ni effacés ni suspendus — ils ne seraient pas prévenus et ne
   prennent pas la borne —, suit l'index `(category, paused)` sans tri, au plus
   `GETI_ALERT_SCAN_MAX` par catégorie, lue avec une ligne de plus : seule
   cette ligne en trop — des alertes restent non lues — déclenche
   l'avertissement chiffré dans pm2 et pose un **curseur** par catégorie
   (dernier identifiant lu) : la passe suivante lit la suite, puis repart du
   début, si bien que les alertes les plus récentes ne sont jamais
   durablement privées de lecture), avec l'identifiant Discord du compte :
   **sa propre annonce ne prévient pas son auteur** quand l'annonce porte
   l'identifiant de son auteur (un relais qui ne donne que le pseudo,
   `authorId` nul, n'est pas reconnu : textes légaux formulés ainsi).
3. Correspondance en mémoire par `matchingGetiAlerts` → `matchesGetiFilter`,
   le filtre de chaque alerte construit une seule fois par lot.
4. **Jamais deux fois pour la même annonce** (tant qu'elle est gardée) : par annonce, une lecture des
   traces déjà là puis un seul `INSERT IGNORE INTO bg_geti_alert_hits` à
   plusieurs lignes pour les autres (par paquets de 500) ; une insertion qui
   ne pose rien (passe simultanée) ne prévient pas (modification, second
   rattrapage, envoi en double : rien) ; une insertion qui en pose une partie
   seulement relit les traces datées de cette passe (date à la seconde) et ne
   compte que celles-là.
5. **Délai par alerte** : une alerte déjà dans son délai à la lecture est
   écartée en mémoire (aucune écriture) ; sinon il se réserve en une instruction : `UPDATE bg_geti_alerts
   SET last_notified_at = ? WHERE id = ? AND paused = 0 AND (last_notified_at
   IS NULL OR last_notified_at <= ?)` + `affectedRows`. Une annonce arrivée
   pendant le délai garde sa trace et ne sera pas signalée plus tard : elle se
   lit sur la page. Une seule notification **réussie** par compte et par lot :
   les autres alertes touchées du même compte dans le lot **rendent** leurs
   traces (une modification récente de ces annonces pourra encore les faire
   partir). Une réservation en échec (base) rend aussi les traces de l'alerte,
   et la passe juge les suivantes.
6. Envoi (`notifyUsers`) au compte, s'il existe encore et n'est pas suspendu :
   les destinataires de tous les comptes à prévenir se lisent ensemble (par
   paquets de 500), pas une requête par alerte, et les envois partent l'un
   après l'autre.
   Un envoi qui ne joint personne (compte suspendu ou effacé) ou qui échoue
   **rend** le délai (date précédente remise, si personne ne l'a reprise) et
   retire les traces que la passe a posées pour cette alerte (toutes ses
   annonces du lot) : une autre alerte du compte peut prévenir, et une
   modification récente de ces annonces aussi.
   Une écriture de traces en échec (ou sa relecture) retire au mieux les
   traces posées par la passe pour cette annonce et passe à la suivante :
   aucune trace ne reste sans envoi derrière elle.

**Passes en file** : `scheduleGetiAlerts` (route d'enregistrement) met la passe
d'un lot en file, **une à la fois** (au plus `GETI_ALERT_QUEUE_MAX` en attente) :
sans cela deux lots rapprochés enverraient en même temps des appels au bot qui
s'additionnent (coupe-circuit). Seules les annonces encore récentes entrent en
file ; le rattrapage n'en met aucune.

**Borne du coût** : par lot (20 annonces au plus), une relecture des annonces
récentes, une lecture d'au plus 2 000 alertes, deux instructions par annonce
touchée pour les traces, puis au plus `annonces récentes × alertes de la catégorie`
comparaisons en mémoire (40 000 dans le pire cas, chacune sur une annonce déjà
analysée) ; les écritures ne portent que sur les couples qui correspondent.
Hors rattrapage, un lot porte une annonce. Au-delà de 2 000 alertes actives
dans une catégorie, chaque passe en lit 2 000 à partir du curseur (rotation) :
une alerte peut manquer les annonces d'une passe où elle n'est pas lue — à
revoir (index par critère) si ce nombre approche.

**Croissance des traces** : une trace par couple (alerte, annonce) qui
correspond, y compris pour une alerte alors dans son délai — la trace **est** ce
qui empêche une modification tardive de prévenir une seconde fois, elle vit donc
aussi longtemps que l'annonce gardée (elle part avec elle ; 15 jours au plus, purge par
lots). Borne : alertes
d'une catégorie (≤ 2 000 lues) × annonces récentes de cette catégorie sur 15
jours ; seules les annonces **récentes** posent des traces (le rattrapage n'en
pose aucune). À surveiller si le nombre d'alertes « sans filtre » grossit.

**Fenêtre côté client** : `GetiAlerts` ne rend que le bouton ; la fenêtre
(`GetiAlertsDialog`, formulaire, liste, confirmation) est un morceau chargé au
premier clic, au survol ou au focus du bouton (`onceLoader`, un échec se retente
et se dit par un toast). La liste des alertes du compte est lue côté serveur au
rendu de la page, en parallèle de la liste d'annonces pour la session.

### Durée de garde, effacement, export

- Une alerte vit jusqu'à sa suppression par le compte ; la pause la garde sans
  prévenir. Pas d'expiration automatique : elle ne coûte rien tant qu'aucune
  annonce n'y correspond, et son propriétaire la voit dans sa liste.
- Les traces `bg_geti_alert_hits` partent avec l'annonce (clé étrangère) ou
  avec l'alerte, et sont purgées au plus tard au bout de 15 jours par
  l'horloge `geti-posts-purge` (`purgeGetiAlertHits`, par lots de 5 000 lignes,
  100 passages au plus par heure). Chaque étape du
  passage horaire (`runGetiPostsPurge` : annonces, traces, réanalyse) a sa
  garde : une panne de l'une ne bloque pas les autres, la première erreur est
  signalée par l'horloge.
- **Effacement du compte** : l'anonymisation garde la ligne `bg_users`, la
  cascade ne joue donc pas — `anonymizeAccount` appelle
  `deleteGetiAlertsOfUser` (traces puis alertes, chaque instruction avec sa
  garde de table absente).
- **Export des données** : `getiAlerts` dans `PersonalDataExport` — tout ce
  que la ligne garde (dont `lastNotifiedAt`) et les annonces déjà signalées
  (`reportedPosts` : identifiant du message, date de la trace).
- Mentions : registre T22 (et sous-finalité de T12, message remis cité à T08),
  politique et conditions du bot (`bot-legal-content.ts`, messages remis), entrée
  `2026-11-alertes-d-annonces-geti` de `PRIVACY_CHANGES` (FR et EN),
  `/rgpd#alertes-geti` (FR et EN).

### Interface (`components/geti/GetiAlerts.tsx`, fenêtre `GetiAlertsDialog.tsx`)

Bouton « Créer une alerte » dans l'en-tête de la catégorie, avec son
`InfoHint`. Sa fenêtre (portée dans `body`, `useDialogBehavior`) montre, pour un
compte connecté : ce que l'alerte gardera (catégorie et nombre de filtres), un
nom facultatif, puis « Mes alertes (n/10) » — état, lien vers la recherche,
« Mettre en pause » / « Relancer », « Renommer », « Supprimer »
(`ConfirmActionDialog`). Les alertes du compte sont lues par le serveur au rendu
de la page. Succès et refus en notification (`useToast`) ; un nom refusé est
aussi rattaché à son champ (`useFieldErrors`). Boutons d'envoi en
`BusyButton`. Textes : `alerts` de `messages/<langue>/geti.json`.

### Tests (lot 5)

`tests/lib/shared/geti/alerts.test.ts`, `tests/lib/server/geti/alerts.test.ts`,
`tests/app/api/geti/alerts-routes.test.ts`,
`tests/lib/shared/geti-alert-messages.test.ts`, `tests/app/geti-alerts.test.tsx`,
`tests/lib/server/account-erasure-geti-alerts.test.ts`, `e2e/geti-info.spec.ts` ;
le seed (`createGetiAlerts`) joue la création, le doublon, la pause et la passe
d'alertes sur la vraie base, sans rien envoyer.
