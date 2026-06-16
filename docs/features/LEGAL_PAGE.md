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
| Hébergement | Même serveur que `celine-houssin.fr` (Keryan Houssin, auto-entrepreneur) |
| Propriété intellectuelle | Droits réservés à l'association |
| Données personnelles (RGPD) | Bulletin d'adhésion + Règlement UE 2016/679 |
| Cookies | Cookie de session `bg_session` uniquement, aucun traceur tiers |
| Documents officiels | Liens téléchargeables / consultables |

## Documents et liens

Les fichiers statiques sont servis depuis `public/` :

| Document | Cible | Type |
|---|---|---|
| Statuts | `/statuts.pdf` | PDF (nouvel onglet) |
| Bulletin d'adhésion | `/bulletin_adhesion.docx` | DOCX (nouvel onglet) |
| Règlement intérieur | Google Docs (lien externe) | Doc (nouvel onglet) |

L'URL du règlement est centralisée dans une constante `REGLEMENT_URL` dans chaque
fichier qui l'utilise (`app/association/page.tsx`, `app/mentions-legales/page.tsx`,
`components/cyber/landing/PublicFooter.tsx`).

## Boutons connectés

- **Footer** (`PublicFooter`) — colonne LÉGAL : « Mentions légales », « Statuts » ;
  colonne COMPÉTITIONS : « Règlement ».
- **`/association`** — section Documents officiels : Statuts, Règlement intérieur,
  Bulletin d'adhésion.
- **`/mentions-legales`** — section Documents officiels : Statuts, Règlement
  intérieur, Bulletin d'adhésion.

Les liens vers des fichiers statiques et le Google Doc utilisent
`<a target="_blank" rel="noreferrer">` (et non `next/link`), adapté aux fichiers
non routés par Next et aux liens externes.
