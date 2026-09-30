# ⚖️ Page Mentions légales & liens documents

## Overview

La plateforme expose une page publique **Mentions légales** (`/mentions-legales`) et
relie les documents officiels de l'association (statuts, règlement intérieur,
bulletin d'adhésion) aux boutons qui les demandent à travers le site.

La page suit le design system « Cyber minimal » : `PublicHeader` / `PublicFooter`,
hero avec faits clés et sections numérotées (`SECTION 0X`).

## Contenu de la page

| Section | Source |
|---|---|
| Éditeur du site | Statuts de l'association (loi 1901, siège social, objet) |
| Directeur de la publication | Président de l'association |
| Éditeur — courriel et téléphone | Coordonnées de l'association, révélées au clic (`ProtectedContact`, valeurs encodées dans `lib/shared/obfuscated-contact.ts`) |
| Hébergement technique | `lib/shared/site-host.ts` : Keryan Houssin, particulier bénévole de l'association, site et bot sur un Raspberry Pi à Caen — aucun SIREN : la LCEN ne demande à l'hébergeur que nom, adresse et téléphone ; le téléphone se révèle au clic. Distinct de l'association, « hébergeur des contenus de ses membres » au sens du DSA |
| Propriété intellectuelle (`#propriete-intellectuelle`) | `lib/shared/source-code.ts` : code sous AGPL-3.0 seulement (`LICENSE`, `NOTICE`), droits d'auteur de Keryan Houssin, lien vers le dépôt public. Les autres éléments (textes, nom, logo, identité visuelle, documents officiels) sont **hors licence**, sans titulaire nommé : leur titularité n'est pas documentée (`ERREUR.txt`, décision requise) — le site n'affirme pas ce qu'il ne sait pas |
| Données personnelles (RGPD) | Responsable du traitement, droits, et **renvoi aux destinataires** de `/rgpd#destinataires` et du registre — jamais « exclusivement à l'association » : les joueurs, le public et des services tiers (Discord, Google, Blizzard, services de push, Microsoft) en reçoivent |
| Cookies | Cookie de session `bg_session` uniquement, aucun traceur tiers |
| Documents officiels | Liens téléchargeables / consultables |

## Documents et liens

Les fichiers statiques sont servis depuis `public/` :

| Document | Cible | Comportement |
|---|---|---|
| Statuts | `/statuts.pdf` | nouvel onglet (`target="_blank"`, viewer PDF) |
| Bulletin d'adhésion | `/bulletin_adhesion.docx` | téléchargement (`download`) |
| Règlement intérieur | Google Docs `…/preview` | nouvel onglet, vue lecture seule |

Le règlement pointe vers l'URL `…/preview` (vue embarquée en lecture seule) et non
`…/edit`, pour ne pas exposer la surface d'édition du document au public. L'URL est
centralisée dans une constante `REGLEMENT_URL` dans chaque
fichier qui l'utilise (`app/association/page.tsx`, `app/mentions-legales/page.tsx`,
`components/cyber/landing/PublicFooter.tsx`).

## Boutons connectés

- **Footer** (`PublicFooter`) — colonne LÉGAL : « Mentions légales »,
  « RGPD » (→ `#donnees-personnelles`), « Statuts », « Cookies » (→ `#cookies`) ;
  colonne COMPÉTITIONS : « Règlement ».
- **Code source** — lien vers le dépôt (`SOURCE_CODE_URL`) dans la colonne LÉGAL de
  `PublicFooter` **et** dans `SiteFooterBar` (espace connecté, `/connexion`) : l'article 13
  de l'AGPL oblige à offrir le code source à tout utilisateur du service en ligne, donc sur
  chaque page. Une instance modifiée fait pointer la constante vers son propre code.
- **`/association`** — section Documents officiels : Statuts, Règlement intérieur,
  Bulletin d'adhésion.
- **`/mentions-legales`** — section Documents officiels : Statuts, Règlement
  intérieur, Bulletin d'adhésion.

Les liens RGPD / Cookies du footer pointent vers les sections ancrées de
`/mentions-legales` (`id="donnees-personnelles"`, `id="cookies"`), avec un
`html { scroll-padding-top }` calé sur la hauteur mesurée de l'en-tête collant
(`docs/features/ERROR_PAGES_AND_ANCHORS.md`) pour le dégager.

Les liens vers fichiers statiques et le Google Doc utilisent `<a>` (et non
`next/link`) : `target="_blank" rel="noreferrer"` pour le PDF et le Google Doc,
`download` pour le `.docx` (que les navigateurs téléchargent au lieu de l'afficher).
