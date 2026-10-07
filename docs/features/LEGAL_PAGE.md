# ⚖️ Page Mentions légales & liens documents

## Overview

La plateforme expose une page publique **Mentions légales** (`/mentions-legales`) et
relie les documents officiels de l'association (statuts, règlement intérieur,
bulletin d'adhésion) aux boutons qui les demandent à travers le site.

La page suit le design system « Cyber minimal » : `PublicHeader` / `PublicFooter`,
hero avec faits clés et sections numérotées (`SECTION 0X`).

**En anglais** (`/en/mentions-legales`, lot 7b-1) : `MentionsLegalesEn`, traduction des mêmes
sections et ancres, coordonnées toujours par `ProtectedContact`, avis « the French version
prevails » en tête. Le français, qui fait foi, est inchangé. Toute modification se fait dans les
deux langues (`I18N.md` § Textes légaux du site).

## Contenu de la page

| Section | Source |
|---|---|
| Éditeur du site | Statuts de l'association (loi 1901, siège social, objet) |
| Directeur de la publication | Président de l'association |
| Éditeur — courriel et téléphone | Coordonnées de l'association, révélées au clic (`ProtectedContact`, valeurs encodées dans `lib/shared/obfuscated-contact.ts`) |
| Hébergement technique | `lib/shared/site-host.ts` : Keryan Houssin, particulier bénévole de l'association, site et bot sur un Raspberry Pi à Caen — aucun SIREN : la LCEN ne demande à l'hébergeur que nom, adresse et téléphone ; le téléphone se révèle au clic. Distinct de l'association, « hébergeur des contenus de ses utilisateurs » au sens du DSA |
| Propriété intellectuelle (`#propriete-intellectuelle`) | `lib/shared/source-code.ts` : code sous AGPL-3.0 seulement (`LICENSE`, `NOTICE`), droits d'auteur de Keryan Houssin, lien vers le dépôt public. Les autres éléments (textes, nom, logo, identité visuelle, documents officiels) sont **hors licence**, sans titulaire nommé : leur titularité n'est pas documentée (`ERREUR.txt`, décision requise) — le site n'affirme pas ce qu'il ne sait pas |
| Données personnelles (RGPD) | Responsable du traitement, droits, **personne à contacter pour les demandes relatives aux données** (`DATA_CONTACT_NAME`, `lib/shared/legal-contact.ts` : l'hébergeur technique, courriel et téléphone révélés au clic — `DATA_CONTACT_EMAIL_ENCODED` / `DATA_CONTACT_PHONE_ENCODED`, ce dernier étant le numéro de l'hébergeur, encodé une seule fois ; jamais appelée « DPO » ni « délégué », fonction de l'art. 37 RGPD qui n'est pas la sienne), et **renvoi aux destinataires** de `/rgpd#destinataires` et du registre — jamais « exclusivement à l'association » : les joueurs, le public et des services tiers (Discord, Google, Blizzard, services de push, Microsoft) en reçoivent |
| Cookies (`#cookies`) | Cookies **techniques** seulement — session, connexion en cours (état OAuth), réglages d'accessibilité, annonces de recrutement déjà vues —, aucun traceur publicitaire ni cookie tiers ; la liste complète et les durées vivent sur `/rgpd#cookies`, vers laquelle la section renvoie |
| Documents officiels | Liens téléchargeables / consultables |

## Documents et liens

Les fichiers statiques sont servis depuis `public/` :

| Document | Cible | Comportement |
|---|---|---|
| Statuts | `/statuts.pdf` | nouvel onglet (`target="_blank"`, viewer PDF) |
| Bulletin d'adhésion | `/bulletin_adhesion.docx` | téléchargement (`download`) |
| Règlement intérieur | Google Docs `…/preview` | nouvel onglet, vue lecture seule |

Le règlement pointe vers l'URL `…/preview` (vue embarquée en lecture seule) et non
`…/edit`, pour ne pas exposer la surface d'édition du document au public. L'URL
n'est **pas** centralisée : la constante `REGLEMENT_URL` est recopiée dans les
trois fichiers qui l'utilisent (`app/association/page.tsx`,
`app/mentions-legales/page.tsx`, `components/cyber/landing/PublicFooter.tsx`) —
un changement d'adresse se fait aux trois endroits.

## Boutons connectés

- **Footer** (`PublicFooter`) — colonne LÉGAL : « Mentions légales »,
  « Conditions d'utilisation » (→ `/conditions-utilisation`), « RGPD » (→ `/rgpd`),
  « Statuts », « Règlement intérieur », « Cookies » (→ `/rgpd#cookies`), le lien du
  code source, « Réglages d'accessibilité » (ouvre le menu d'accessibilité) et la
  mention « Accessibilité : non conforme » (→ `/accessibilite`). Les règles des
  tournois n'y figurent plus (`PUBLIC_NAVIGATION.md`).
- **Code source** — lien vers le dépôt (`SOURCE_CODE_URL`) dans la colonne LÉGAL de
  `PublicFooter` **et** dans `SiteFooterBar` (espace connecté, `/connexion`) : l'article 13
  de l'AGPL oblige à offrir le code source à tout utilisateur du service en ligne, donc sur
  chaque page. Une instance modifiée fait pointer la constante vers son propre code.
- **`/association`** — section Documents officiels : Statuts, Règlement intérieur,
  Bulletin d'adhésion.
- **`/mentions-legales`** — section Documents officiels : Statuts, Règlement
  intérieur, Bulletin d'adhésion.

Les liens RGPD / Cookies du footer mènent à la politique de confidentialité
(`/rgpd`, `/rgpd#cookies`) ; les sections ancrées de `/mentions-legales`
(`id="donnees-personnelles"`, `id="cookies"`) résument et y renvoient. Une ancre
est dégagée de l'en-tête collant par un `html { scroll-padding-top }` calé sur
sa hauteur mesurée (`docs/features/ERROR_PAGES_AND_ANCHORS.md`).

Les liens vers fichiers statiques et le Google Doc utilisent `<a>` (et non
`next/link`) : `target="_blank" rel="noreferrer"` pour le PDF et le Google Doc,
`download` pour le `.docx` (que les navigateurs téléchargent au lieu de l'afficher).

## Notes reprises de CLAUDE.md

Texte déplacé tel quel depuis `CLAUDE.md` (allègement du fichier chargé à chaque session).

- **Coordonnées jamais en clair** (`lib/shared/obfuscated-contact.ts` pur + `components/ui/protected-contact.tsx`) : l'association publie son courriel et son téléphone (mentions légales, `/rgpd`, `/accessibilite`), l'hébergeur technique son téléphone — et, en tant que **personne à contacter pour les demandes relatives aux données** (`DATA_CONTACT_NAME`, `lib/shared/legal-contact.ts` ; jamais « DPO » ni « délégué », fonction de l'art. 37 RGPD qui n'est pas la sienne), son courriel sur `/rgpd` et les mentions légales —, et le pied de page un courriel éditable (`bg_settings.contact_email`) — **aucun n'est écrit en clair**, ni dans le HTML rendu par le serveur, ni dans la charge utile d'un composant client, ni dans ce dépôt public, où les robots les moissonneraient. Les valeurs fixes sont stockées **encodées** (base64 du texte, inversé : `encodeContact` / `decodeContact`), la valeur éditable est encodée **à la sortie** (`toPublicContact`, pied de page et `GET /api/association/contact`), et `<ProtectedContact>` ne rend qu'un bouton « Afficher l'adresse » / « Afficher le numéro » (nom accessible qui commence par ce texte puis dit à qui appartient la coordonnée, `.tap-target`) : le clic décode et rend le lien `mailto:` / `tel:` (international), qui prend le focus. **Règle pour toute coordonnée future** : l'encoder, jamais l'écrire. Un balayage (`tests/lib/shared/legal-contact.test.ts`) refuse tout courriel ou numéro français en clair dans `app/`, `components/` et `lib/` (domaines d'exemple `.invalid`/`.example`/`.test` exceptés). Le registre des traitements et son export CSV, qui ne savent pas révéler au clic, **renvoient** aux mentions légales. Un faux courriel qu'un ancien défaut avait écrit en base est vidé au démarrage (`SUPERSEDED_CONTACT_EMAILS`, encodé lui aussi). Voir `docs/features/LEGAL_PAGE.md`.
