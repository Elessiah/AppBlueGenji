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
- **`/association`** — section Documents officiels : Statuts, Règlement intérieur,
  Bulletin d'adhésion.
- **`/mentions-legales`** — section Documents officiels : Statuts, Règlement
  intérieur, Bulletin d'adhésion.

Les liens RGPD / Cookies du footer pointent vers les sections ancrées de
`/mentions-legales` (`id="donnees-personnelles"`, `id="cookies"`), avec un
`scroll-margin-top` pour dégager le header sticky.

Les liens vers fichiers statiques et le Google Doc utilisent `<a>` (et non
`next/link`) : `target="_blank" rel="noreferrer"` pour le PDF et le Google Doc,
`download` pour le `.docx` (que les navigateurs téléchargent au lieu de l'afficher).
