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
- Offert seulement pour un tournoi **publié** (`isTournamentPublished`, avec
  une marge de cinq minutes sur l'horloge du lecteur,
  `SHARE_PUBLISHED_MARGIN_MS` : une horloge en avance ne fait pas partager un
  lien que le serveur dit encore introuvable) ; sur
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
  posée par l'encart de repli — un `openGraph` de page remplace celui de la racine ; une page de match sans compte prend titre « A contre B ·
  Manche 2 · Match 3 — tournoi » et une description score + maps + codes.
- Textes : espace `share.embed` (FR et EN), rédaction pure
  `lib/shared/share-embed-cards.ts`, noms passés par `visibleText`.

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
  `2026-11-apercus-partage-codes-replay` de `PRIVACY_CHANGES`.

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
  prend un jeton du réseau (`SHARE_EMBED_RENDER_RULE` : vingt d'avance, un
  toutes les trois secondes) et n'entre pas dans une file de plus de
  `MAX_QUEUED_EMBED_RENDERS` (8) rendus en attente ; refusée, la carte neutre
  (`no-store`). Un client qui parcourt plus de couples (match, langue) que la
  réserve n'en garde n'occupe donc pas le Raspberry.
- Le résumé ne retient de chaque match que les champs qu'il relit
  (`shareMatchSource`) : la copie publique en cache ne garde pas en plus tout
  l'arbre objet de ses matchs.
