# Partage : aperçus riches des tournois et matchs

Un bouton « Partager » sur la fiche d'un tournoi et sur chaque match (carte et
page du match) donne le **lien public** (`/suivre/…`), qui s'ouvre sans compte ;
ce lien porte un **aperçu riche** (Open Graph + carte Twitter, image générée)
compact, « façon Spotify ». Décisions D73 (aperçus, aucun pseudo) et D74 (codes
de replay publics).

## Le bouton

- `components/share/ShareLinkButton.tsx` (en-tête du tournoi,
  `TournamentHeader`) et l'action `share` de la carte de match
  (`_lib/match-card-actions.ts`, rangée dans « Plus d'actions », offerte aussi
  sur la page du match qui reprend les mêmes gestes).
- Le geste est un seul crochet, `useShareLink()` (même fichier que le bouton),
  que l'action du match réutilise ; sa fonction reste la même d'un rendu à
  l'autre (`useCallback`).
- Règle pure `lib/shared/share-link.ts` : feuille de partage du système
  (`navigator.share`) si elle existe — la fermer (`AbortError`) ne notifie
  rien —, sinon copie dans le presse-papiers. Résultat en notification
  (`useToast`) : « Lien public partagé », « Lien public copié », ou l'échec.
- L'adresse est toujours `/suivre/tournois/<id>` ou
  `/suivre/tournois/<id>/matchs/<mid>`, absolue, dans la langue de la fiche
  (`/en/suivre/…` en anglais) — jamais celle de l'espace membre.
- Offert seulement pour un tournoi **publié** (`isTournamentPublished`) à
  l'**heure du serveur** : près de l'heure de publication, l'en-tête `Date`
  d'une ressource statique (`/favicon.png`, une lecture par page) donne
  l'écart du poste (`publishedForReader`, deux secondes de marge) ; sans lui,
  une marge de cinq minutes (`SHARE_PUBLISHED_MARGIN_MS`) — une horloge en
  avance ne fait pas partager un lien que le serveur dit encore introuvable,
  une horloge juste ne cache pas le bouton cinq minutes ; sur
  un match, pas sur une exemption. `LiveProvider` porte `publicShare`.
- Publication relue toutes les 30 s tant que le tournoi n'est pas publié
  (`useTournamentPublished`, `useClock` : l'horloge s'**arrête** une fois publié,
  la fiche passe `published` à l'en-tête — une seule horloge) : le bouton et
  l'action des matchs apparaissent à l'instant où le tournoi devient public. Le bouton de l'en-tête vient **après** l'inscription (l'action
  principale garde la tête de ligne). Sur une carte de match, « Partager » n'est
  jamais l'action visible quand une autre est offerte (décision : « Page du
  match » tient le pied) ; elle va au menu, ou reste ouverte si elle est seule.
  Sans feuille de partage ni presse-papiers, la notification d'échec contient
  l'adresse, à copier à la main.
- Carte de match : noms en retrait seulement quand un camp a gagné ; « Forfait :
  X » borné à 240 px et deux lignes ; libellé de map et sous-titre sur une ligne
  (points de suspension) ; un code de replay long (> 14 signes) passe à la ligne
  en corps 20, jamais rogné.

## L'aperçu

- Images : `/og/<langue>/tournament-<id>.png` et
  `/og/<langue>/tournament-<tid>-match-<mid>.png` (route unique `app/og/[locale]/[card]`,
  rendu `lib/server/embed-share-image.tsx`, carte de match
  `components/og/match-share-card.tsx`). Les anciens
  `opengraph-image.tsx` des fiches sont retirés : leur adresse ne changeait pas
  avec la langue. Leurs anciennes adresses (`/[en/][suivre/]tournois/<id>/opengraph-image[-<empreinte>]`)
  **redirigent** (307, `redirects` de `next.config.ts`) vers la nouvelle : un
  lien déjà collé ne perd pas son image.
- Tournoi : jeu, état, nom, équipe victorieuse (rang final 1) ou en tête
  (seule première d'un classement suisse / Survie / BlueGenji Survie après un
  match joué), à défaut la description ; faits format, effectif, échéance ; le
  logo de l'équipe en tête occupe le motif.
- Match : tournoi et place du match, logos et noms des deux engagés, score —
  un forfait se dit « Forfait : X » même s'il porte un score complet
  (`forfeitMatchScores`), « VS » (`share.embed.scoreboardVersus`) sans score —,
  pastille « À venir », « Match en cours » (un score ou une map retenue sur
  un match pas encore soumis), « Résultat en attente » (résultat soumis) ou
  « Match terminé », une case par map jouée (nom de la carte s'il est fixé, score, code
  de replay ou « Sans code »), neuf au plus, la suite comptée.
- Encart : `tournamentPageMetadata` / `matchPageMetadata` posent
  `openGraph.images` et `twitter.images` (adresse versionnée, 1200×630, texte
  alternatif) ; un tournoi illisible garde l'image du site (`/og/<langue>/home.png`),
  posée par l'encart de repli — un `openGraph` de page remplace celui de la racine ; une page de match prend un titre d'encart court (voir « Titre d'un match ») et une
  description score + maps + codes (voir « Nom de la manche » et « Match à venir »).
- Textes : espace `share.embed` (FR et EN), rédaction pure
  `lib/shared/share-embed-cards.ts`, noms passés par `visibleText`.

## Titre d'un match

Discord coupe d'une ellipse le titre d'un aperçu de lien qui dépasse une ligne (vers
70 caractères) : « Choco Pops contre Sl solearis · Manche 1000 · Match 2 — BlueGen… ».
`og:title` / `twitter:title` d'une page de match (`matchEmbedTitle`) sont donc compacts :
- joué : « Choco Pops 0–3 Sl solearis · Quart de finale 2 » (score à la place de « contre ») ;
- à venir : « A contre B · Quart de finale 2 · mar. 17 nov. 21:00 » / « A vs B · … » ;
- sinon (forfait, en saisie, sans horaire) : « A contre B · Finale » ;
- ni nom de site ni nom de tournoi (`og:site_name`, l'image et la description les portent) ;
- budget `EMBED_MATCH_TITLE_BUDGET` = 70 caractères : seuls les **noms d'équipe** cèdent
  (ellipse, le plus court gardé entier, 4 caractères au moins chacun) — jamais le tour,
  le score ni l'horaire.
L'onglet (`<title>`) garde « … — tournoi ». Repli sans résumé public : « Manche 2 · Match 3
— tournoi », le nom du tournoi borné au même budget.

## Nom de la manche

Le match se place par **le nom de sa manche tel que la fiche le donne**, non
plus « Manche n · Match m » (`lib/shared/share-round.ts`) : « Quart de finale 2 »,
« Demi-finale 1 », « Finale », « Finale perdants », « Tableau perdants · Demi-finale 1 »,
« Grande Finale », « Petite finale » (mêmes clés `bracket.stage` / `bracket.matchLabel`
de `tournament.json`, même `stageKey` — déplacé dans `lib/shared/bracket-stage.ts`).
- `buildShareRounds` (dans le résumé, donc dans l'empreinte `?v=` de l'image) nomme
  chaque tableau (par phase et par `bracket`) depuis son dernier tour ; l'arbre final
  de BlueGenji Survie sur le même compte que la fiche (`endurancePlayoffRoundCount`
  avec les cases à pourvoir `endurancePlayoffGhostSlots` tant que le tournoi vit —
  une paire vidée par double forfait raccourcit l'arbre —, tous deux dans
  `lib/shared/bg-survie/playoff-rounds.ts`), et sa finale y est « Grande Finale »
  comme sur la fiche (`grandFinalLabel`).
- Premiers tours d'un grand tableau : « Manche 1 · Match 7 », le numéro étant le **rang
  du tour dans son tableau** (celui de la colonne de la fiche), jamais le numéro brut
  du moteur (1000 et plus dans l'arbre final de BlueGenji Survie) ; modes à classement :
  « Ronde 3 · Match 2 » (suisse, `bracket.swissRoundN`, tenu égal à `swiss.roundNoun`
  par un test : la page d'un match n'a pas les textes des vues), « Manche 4 · Match 1 » (Survie,
  qualification de BlueGenji Survie) — « Round » en anglais. Le numéro du match n'est
  écrit que si le nom seul est ambigu (jamais pour une finale).
- L'en-tête de la page du match (ligne de situation) porte le même nom
  (`buildShareRounds` sur les seuls matchs de sa phase).
- Les mots d'un stade (« Quarts de finale », « Demi-finale 2 », « Manche 2 ») sont rédigés
  une seule fois, pour l'arbre (`BracketTree`) et pour ce nom : `lib/shared/bracket-stage-text.ts`.
  « Petite finale » en minuscule partout (`bracket.stage.thirdPlace`, comme le plateau d'Endurance).
- Match absent du résumé (encart de repli) : « Manche n · Match m » (`fallbackRoundLabel`),
  « Phase finale · Match m » dans l'arbre final de BlueGenji Survie (jamais « Manche 1001 »). Ce repli ne sert
  que quand la réponse publique n'est pas lue (tournoi non publié, lecture en échec ou
  refusée par le plafond) : nommer le tour demande tous les matchs du tournoi, soit
  précisément la lecture qui manque — la refaire à part contournerait le plafond.
- Non changé : la carte du direct de l'accueil (`landing.json` → `round`,
  `phase.round`) n'est pas un aperçu partagé.
- Image : le sous-titre (nom du tour, « +N maps ») a 640 px (`MATCH_SUBTITLE_MAX_WIDTH`) ; c'est le nom
  du tournoi qui cède, pas le numéro du match, en gardant au moins 360 px (`MATCH_TITLE_MIN_WIDTH`, testé).

## Match à venir : horaire en avant

Un match **programmé** (`startAt`) sans score, map ni forfait (`matchScheduledAt`) met
son horaire en tête, à l'heure de Paris, dans les deux langues :
- image : ligne principale en 52 px sous les équipes, « Mardi 17 novembre · 21:00 » /
  « Tuesday, November 17 · 21:00 », fuseau en dessous (« heure de Paris » / « Paris time »,
  `share.embed.timeZone`) ;
- titre : « A contre B · Quart de finale 2 · mar. 17 nov. 21:00 » ;
- description : « Mardi 17 novembre · 21:00 (heure de Paris) ».
Un match joué, en saisie ou sans horaire n'affiche rien de plus qu'avant. Un créneau
**passé** non plus (match en retard) : `matchScheduledAt(match, now)` ne rend l'horaire
qu'à venir, et ce basculement entre dans l'empreinte (`matchShareVersion`), calculée au
même instant que l'image, le titre et la description.

## Confidentialité

- **Source unique : la réponse publique** (`spectatorSnapshot`, résumée par
  `buildTournamentShareSummary`, `lib/shared/share-embeds.ts`) — une carte ne
  montre rien que `/suivre/` ne montre déjà. Lue par
  `publicTournamentShareForRequest` (plafond de lecture et copie périmée de la
  page sans compte). L'image d'un tournoi passe par
  `publicTournamentImageView` (`spectator-snapshot.ts`) : réponse publique
  fraîche en mémoire si elle existe (sans jeton), sinon **la carte fraîche**
  (cache de carte ou base, jamais la copie échue), et, pour un tournoi qui peut
  nommer une équipe en tête (`tournamentMayHaveLeader`), la réponse publique —
  un seul jeton du plafond par requête (`publicTournamentImageViewForRequest`).
  Lecture de carte refusée au plafond : la copie échue, servie `no-store`.
  Toute carte gardée (copie, cache de carte de 10 s) est relue **à l'instant** :
  état recalculé depuis les dates, et plus rien si la date de visibilité a été
  repoussée (`publicCardNow`).
  L'image d'un match lit la réponse publique.
- **Aucun pseudo** : un engagé solo est « Joueur 1 » / « Joueur 2 », sans
  avatar ; un tournoi individuel n'a pas de ligne « en tête ».
- Tournoi non publié, introuvable, match d'un autre tournoi, base injoignable,
  lecture refusée par le plafond : carte **neutre** du site (celle de
  l'accueil), jamais une erreur, servie en `Cache-Control: no-store` — un refus
  passager ne doit pas rester sous l'adresse versionnée.
- **D74** : le code de replay d'une map jouée et retenue est public (fiche
  membre, `/suivre/`, aperçu) ; une proposition en attente reste vide dans la
  réponse publique. Déclaré : `/rgpd` (scores map par map, « Suivre un tournoi
  sans compte », FR et EN), registre T03, entrée
  `2026-11-apercus-partage-codes-replay` de `PRIVACY_CHANGES`. Les codes déjà
  enregistrés deviennent publics eux aussi (dit dans l'entrée et /rgpd, avec
  l'opposition art. 21 : l'association peut retirer le code d'un résultat).
  Le score de chaque map était déjà public sur `/suivre/` avant ce lot.
- **Description** : sans équipe en tête, l'image reprend la description du
  tournoi publiée par l'organisation (déclarée) ; aucun pseudo n'est tiré d'un
  compte.
- **Adresse IP** : les plafonds (lecture, reconstruction, rendu d'aperçu)
  sont tenus par réseau, pour tout lecteur (connecté ou non, `/suivre/`,
  `/regles/…?tournoi=`, `/og`), en mémoire seulement. `rate-limit.ts` efface
  toute clé épuisée (fenêtre close, seau plein) toutes les 30 s
  (`RATE_LIMIT_SWEEP_INTERVAL_MS`, minuteur détaché hors tests, balayage
  paresseux sous les tests). La part par réseau du signal de charge
  (`spectator-load.ts`, `readsByClient`) est oubliée à la fin de sa fenêtre
  d'une minute par son propre minuteur. Pour **ces** plafonds, une adresse ne
  reste pas plus de deux minutes après sa dernière requête — durée déclarée au
  registre T03 et dans /rgpd. Les autres plafonds par IP (accueil, page du bot,
  rapports CSP : deux minutes ; signalement sans compte : 30 min, soit 31 min
  avec le balayage ; code Discord : 15 min, soit 16 ; direct de `/bot` : tant
  que le flux est ouvert) sont déclarés au registre T17 (et T02, T11 pour les
  deux longs) et dans /rgpd ; changer une de ces fenêtres doit faire revoir ces
  textes (`rate-limit-sweep.test.ts` les vérifie, `SPECTATOR_READ_WINDOW_MS`
  compris). La file d'attente des rendus (`share-image-cache.ts`) garde la clé
  réseau d'une requête en attente au plus `MAX_RENDER_WAIT_CLIENT_MS` (30 s) :
  passé ce délai (rendu bloqué), l'attente continue sans clé réseau.

## Cache

- PNG en mémoire, réserve `embed` de `share-image-cache.ts` (192 cartes : un tableau de 63
  matchs en deux langues), clé `<langue>:<clé>:<empreinte>` : l'empreinte
  (`shareVersion`, FNV-1a) couvre ce que la carte dessine, un score saisi donne
  donc une nouvelle clé. Une carte inchangée reste **6 h** en mémoire
  (`EMBED_CARD_TTL_MS`), seule l'éviction LRU la chasse : pas de rendu Satori
  de plus toutes les cinq minutes.
- L'adresse publiée porte la même empreinte en `?v=` pour que Discord ou X ne
  resservent pas une ancienne image. Le paramètre reçu ne choisit jamais ce qui
  est rendu ; il ne décide que de l'en-tête : une empreinte qui n'est pas celle
  de l'image servie (match : l'exacte ; tournoi :
  `acceptedTournamentShareVersions`, l'exacte ou celle de la fenêtre courante ou
  précédente) part en `no-store` — une adresse calculée d'avance (vainqueur
  prédit, fenêtre future) ne garde jamais l'image d'aujourd'hui chez un robot.
  L'encart d'un tournoi lit la copie publique **déjà en mémoire** (jamais une
  reconstruction payée par un robot). Titre et texte alternatif viennent de la
  carte lue ; l'équipe en tête vient de la copie, seulement si elle dit la même
  carte (sinon, copie d'avant un renommage, elle est ignorée). Sans copie
  conforme, l'équipe en tête est inconnue, et l'empreinte d'un tournoi par
  équipes change par fenêtre : cinq minutes en cours, un jour terminé
  (`tournamentShareVersionWithoutSummary`).
  Une page de match lit la réponse publique une seule fois pour ses deux
  encarts ; sans compte, sa carte en vient aussi (un seul jeton du plafond).
- Le résumé d'aperçu est calculé avec la copie publique, depuis l'objet déjà
  construit (sans relire le corps) : l'équipe en tête tout de suite (la fiche
  des membres la lit à chaque vue), le résumé des **matchs** à la première
  lecture seulement (page ou image d'un match), puis gardé.
- `Cache-Control: public, max-age=300` (carte neutre : `no-store`). Une image
  dessinée depuis une copie **échue** (plafond de lecture atteint, 150 s au
  plus : `PublicTournamentShare.stale`) part aussi en `no-store` : un robot ne la
  garde pas sous l'adresse `?v=` d'un score plus récent.
- **Rendus bornés** : une image absente de la mémoire (ni rendue, ni en vol)
  prend un jeton du réseau (`SHARE_EMBED_RENDER_RULE` : quarante d'avance, un
  toutes les deux secondes — large, les robots de Discord et de X viennent de
  peu de réseaux ; une requête sans réseau lisible partage le seau
  `unknown-network`, jamais hors plafond) et n'entre pas dans une file de plus
  de `MAX_QUEUED_EMBED_RENDERS` (8) rendus **de la réserve `embed`** en
  attente, dont deux au plus par réseau
  (`MAX_QUEUED_EMBED_RENDERS_PER_CLIENT`) ; refusée, la carte neutre
  (`no-store`), gardée en mémoire une fois rendue pour qu'un refus n'attende
  jamais dans la file. Un rendu qui ne dessine rien rend son jeton ; un rendu
  qui échoue le garde. Un client qui parcourt plus de couples (match, langue)
  que la réserve n'en garde n'occupe donc pas le Raspberry, ni seul la file.
- Le résumé ne retient de chaque match que les champs qu'il relit
  (`shareMatchSource`) : la copie publique en cache ne garde pas en plus tout
  l'arbre objet de ses matchs.
