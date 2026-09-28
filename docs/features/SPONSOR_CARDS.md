# Cartes partenaires — bandeau, logo, nom et description

## Pourquoi

La section « Partenaires et soutiens » de l'accueil n'affichait qu'un **logo** par
partenaire, rogné au format 3:1 (`object-fit: cover`) : ni nom, ni description,
alors que la description était saisie et stockée. En production, quatre
miniatures carrées découpées en bandes — on ne savait ni qui elles désignaient,
ni pourquoi elles étaient là. Un partenaire sans site rendait en outre un lien
`href="#"` qui ne menait nulle part.

## Ce qu'affiche une carte

Comme une carte de tournoi, une carte partenaire porte une **image** puis un
**texte** :

| Zone | Contenu |
| --- | --- |
| Image (3:1) | le **bandeau** en fond s'il existe, le **logo** en pastille dans le coin ; sans bandeau, le logo **entier** (jamais rogné) sur le fond hachuré ; sans aucune image, l'initiale du nom |
| Pastille | le palier (Or, Argent, Bronze, Soutien) |
| Titre | le nom du partenaire, lien vers son site (étiré sur toute la carte) |
| Description | la **brève description** (200 caractères au plus) |
| Pied | le domaine du site (« youtube.com ↗ ») |

La section gagne aussi une **introduction** éditable en place par la permission
`showcase` (clé `home.sponsors.lede` du registre `lib/shared/site-copy.ts`).

## Règles, dans `lib/shared/sponsor-card.ts` (pur)

- `sponsorCardMedia(sponsor)` décide de la disposition (`BANNER` / `LOGO` /
  `PLACEHOLDER`) et rend des adresses **toujours du site** : le logo passe par
  `sponsorLogoSrc` (relais pour un logo collé, voir
  [SPONSOR_LOGO_PROXY.md](SPONSOR_LOGO_PROXY.md)), le bandeau par
  `sponsorBannerSrc`, qui refuse tout ce qui n'est pas un fichier du dossier
  `uploads/sponsors`.
- `sponsorWebsiteHref` ne laisse passer que `http:` et `https:` ; sans lien
  exploitable, le nom n'est pas un lien (plus de `href="#"`).
- `sponsorWebsiteLabel` affiche le domaine sans `www.`.

## Bandeau — téléversement seulement

- Colonne `bg_sponsors.banner_url VARCHAR(255) NULL` (dans le `CREATE TABLE` et
  dans `RECENT_SCHEMA_CHANGES`).
- `POST /api/landing/sponsors/banner` (multipart, permission `showcase`) stocke
  l'image avec le gabarit `sponsor-banner` : WebP **1200 × 400**, recadré au
  centre — l'aperçu de la modale montre donc ce que la vitrine affichera.
- Contrairement au logo, **aucune URL collée** : `validateSponsorInput` refuse
  toute autre adresse (`INVALID_BANNER_URL`), y compris un autre dossier
  d'upload, que le nettoyage d'un bandeau remplacé effacerait sinon.
- Un bandeau remplacé ou retiré, et celui d'un partenaire supprimé, est effacé
  du disque (même nettoyage que le logo).

## Logo — plus de gabarit 3:1

Le gabarit `sponsor-logo` passe de 600 × 200 `contain` (bordé de marges
transparentes) à **600 × 600 `inside`** : réduit seulement, ni recadré ni
bordé. Un logo carré n'était plus qu'une vignette au centre d'une bande
transparente, illisible en pastille. Les fichiers déjà importés restent valides.

## Description — brève, et refusée plutôt que tronquée

`SPONSOR_DESCRIPTION_MAX = 200`. Au-delà, l'enregistrement est refusé
(`DESCRIPTION_TOO_LONG`) : la tronquer en silence ferait perdre du texte que le
staff croit enregistré. Le champ de la modale est une zone multiligne bornée,
avec compteur.

## Jeu de test

`npm run seed` crée trois partenaires visibles couvrant les trois dispositions
(bandeau + logo, logo seul, bandeau seul), avec de **vrais fichiers** sous
`public/uploads/sponsors` — une URL étrangère serait refusée à l'affichage.
