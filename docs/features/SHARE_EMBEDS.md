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
- Règle pure `lib/shared/share-link.ts` : feuille de partage du système
  (`navigator.share`) si elle existe — la fermer (`AbortError`) ne notifie
  rien —, sinon copie dans le presse-papiers. Résultat en notification
  (`useToast`) : « Lien public partagé », « Lien public copié », ou l'échec.
- L'adresse est toujours `/suivre/tournois/<id>` ou
  `/suivre/tournois/<id>/matchs/<mid>`, absolue, dans la langue de la fiche
  (`/en/suivre/…` en anglais) — jamais celle de l'espace membre.
- Offert seulement pour un tournoi **publié** (`isTournamentPublished`) ; sur
  un match, pas sur une exemption. `LiveProvider` porte `publicShare`.

## L'aperçu

- Images : `/og/<langue>/tournament-<id>.png` et
  `/og/<langue>/tournament-<tid>-match-<mid>.png` (route unique `app/og/[locale]/[card]`,
  rendu `lib/server/embed-share-image.tsx`, carte de match
  `components/og/match-share-card.tsx`). Les anciens
  `opengraph-image.tsx` des fiches sont retirés : leur adresse ne changeait pas
  avec la langue.
- Tournoi : jeu, état, nom, équipe victorieuse (rang final 1) ou en tête
  (seule première d'un classement suisse / Survie / BlueGenji Survie après un
  match joué), à défaut la description ; faits format, effectif, échéance ; le
  logo de l'équipe en tête occupe le motif.
- Match : tournoi et place du match, logos et noms des deux engagés, score (ou
  forfait), une case par map jouée (nom de la carte s'il est fixé, score, code
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
  page sans compte).
- **Aucun pseudo** : un engagé solo est « Joueur 1 » / « Joueur 2 », sans
  avatar ; un tournoi individuel n'a pas de ligne « en tête ».
- Tournoi non publié, introuvable, match d'un autre tournoi, base injoignable :
  carte **neutre** du site (celle de l'accueil), jamais une erreur.
- **D74** : le code de replay d'une map jouée et retenue est public (fiche
  membre, `/suivre/`, aperçu) ; une proposition en attente reste vide dans la
  réponse publique. Déclaré : `/rgpd` (scores map par map, « Suivre un tournoi
  sans compte », FR et EN), registre T03, entrée
  `2026-11-apercus-partage-codes-replay` de `PRIVACY_CHANGES`.

## Cache

- PNG en mémoire, réserve `embed` de `share-image-cache.ts` (64 cartes), clé
  `<langue>:<clé>:<empreinte>` : l'empreinte (`shareVersion`, FNV-1a) couvre ce
  que la carte dessine, un score saisi donne donc une nouvelle clé.
- L'adresse publiée porte la même empreinte en `?v=` pour que Discord ou X ne
  resservent pas une ancienne image ; le paramètre reçu n'est jamais lu.
- `Cache-Control: public, max-age=300`.
