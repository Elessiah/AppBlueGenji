# Signalements, contestations et panneau de modération

Le site héberge des contenus publiés par ses membres — logos et noms d'équipe,
avatars, descriptions. En tant qu'**hébergeur** (LCEN art. 6, règlement (UE)
2022/2065 « DSA » art. 6), l'association n'est responsable d'un contenu illicite
qu'à partir du moment où on le lui signale et qu'elle ne le retire pas
promptement. Il lui faut donc un moyen de recevoir ces notifications (DSA
art. 16), de les traiter vite, et de laisser les personnes visées répondre
(DSA art. 20). C'est l'objet de ce module.

## Parcours

1. **Signaler.** Le bouton « Signaler un problème » est dans le pied de page de
   **toutes** les pages : `PublicFooter` (vitrine), `SiteFooterBar` (espace
   connecté et `/connexion`). Il ouvre `ReportProblemDialog`, en deux étapes :
   la catégorie, puis le détail. Ouvert **à tous** — un titulaire de droits n'a
   pas de compte. **Désigner des cibles exige un compte**
   (`REPORT_TARGETS_REQUIRE_LOGIN`) : chaque cible reçoit un message privé, et
   ouvert aux anonymes le formulaire ferait écrire le bot à n'importe quel
   joueur dont on devine l'identifiant. Sans compte, on décrit ce qu'on signale.
2. **Prévenir.** L'enregistrement déclenche, sans être attendus :
   - une alerte à la **direction** (`POST /internal/notify/leadership` du bot :
     salon de logs + message privé à `OWNER_ID` et `PRESIDENT`) ;
   - un message privé aux **personnes visées** — joueurs désignés et membres
     actuels des équipes désignées, joignables par un moyen prouvé (identifiant
     Discord ou tag certifié) —, avec le lien de `/signalements/[id]`. Une
     cible déjà visée par un autre signalement depuis moins de
     `REPORT_TARGET_NOTICE_COOLDOWN_HOURS` (24 h) n'est **pas reprévenue** : le
     message part avant que l'association ait rien lu, et sans cette borne le
     formulaire servirait à faire écrire le bot en boucle à une équipe entière.
     Le signalement de plus reste contestable depuis le formulaire.
3. **Contester** (`canContestReport`). Une personne visée conteste à tout
   moment (`isConcernedByReport`), depuis `/signalements/[id]` ou par la
   catégorie « Contestation » du même formulaire. L'**auteur d'un signalement
   de contenu** (`NOTIFIER_CONTESTABLE_CATEGORIES` : droit d'auteur, modération)
   conteste la décision prise — y compris celle de ne pas agir (art. 20.1 DSA,
   réclamation de l'auteur d'une notification) — par la même catégorie, **une
   fois le dossier archivé** et s'il a signalé depuis son compte (seul moyen de
   le reconnaître) ; `/signalements/[id]` ne lui est pas ouverte, elle montre
   aux visés ce qui les concerne. Une contestation d'un signalement **archivé le
   rouvre**, et la direction est prévenue — l'alerte dit si elle vient d'une
   personne visée ou de l'auteur.
4. **Traiter.** `/admin/signalements` (permission `moderation`, réservée à
   `ADMIN`) : prise en charge, masquage ou suppression d'un logo, archivage avec
   une note, réouverture.

## Catégories (`REPORT_CATEGORY_DEFINITIONS`)

| Catégorie | Cibles | Exigences | Base légale |
|---|---|---|---|
| `COPYRIGHT` — Droit d'auteur | joueurs, équipes, tournois | `COPYRIGHT_NOTICE_ELEMENTS` : nom + adresse électronique, qualité (`RightsRelation`), description, déclaration de bonne foi | obligation légale (DSA, art. 16) |
| `MODERATION` — Modération | joueurs, équipes | — | obligation légale (DSA, art. 16) |
| `BUG` — Bug | aucune | case d'accord | consentement |
| `RGPD` — RGPD | aucune | adresse, sauf tag Discord certifié | obligation légale (RGPD, art. 6.1.c et 12) |
| `HOSTING` — Hébergeur | aucune | adresse, sauf tag Discord certifié | obligation légale (DSA, art. 11 et 16) |
| `OTHER` — Autre | joueurs, équipes, tournois | case d'accord | consentement |
| `CONTEST` — Contestation | aucune (rattachée à `parentReportId`) | être visé ; connecté ; adresse, sauf tag Discord certifié | obligation légale (DSA, art. 20) |

**`RGPD` et `HOSTING` trient les demandes à l'éditeur et à l'hébergeur.** Le
courriel de l'association est publié (mentions légales, `/rgpd`), mais **jamais en
clair** : une adresse écrite dans une page, ou dans ce dépôt public, est moissonnée
par les robots — elle se révèle au clic (`lib/shared/obfuscated-contact.ts`). Une
demande d'exercice des droits passe par la **personne à contacter pour les
demandes relatives aux données** (l'hébergeur technique, `DATA_CONTACT_NAME`,
courriel et téléphone révélés au clic), par le formulaire, ou par le courriel de
l'association ; un courrier à l'éditeur ou à l'hébergeur, par ce courriel ou le
formulaire. Le tag Discord `LEGAL_CONTACT_DISCORD` ne sert qu'aux questions
techniques. Ni l'une ni l'autre catégorie ne
désigne de cible : une demande sur ses propres données n'a personne à prévenir,
et un contenu illicite d'un membre se signale par « Droit d'auteur » ou
« Modération », qui savent le masquer et le faire contester. `/rgpd` ouvre le
formulaire directement sur « RGPD » (`ReportProblemButton initialCategory`), le
retour au choix de catégorie restant offert.

**La modération qui n'est pas propre au site part ailleurs.** Un comportement en
match, une insulte d'un joueur, de la triche ou un litige sur Discord ne sont pas
des contenus que le site héberge : ni masquage, ni contestation, ni prévenance des
personnes visées n'y ont prise. Ils se signalent sur le portail de support de
l'association (Spiceworks, `MODERATION_SUPPORT_PORTAL_URL`). Le choix de catégorie
y renvoie par une carte « Comportement d'un joueur » placée juste après
« Modération » — un **lien** (nouvel onglet), pas une catégorie : rien n'est
enregistré ni transmis —, et l'étape « Modération » le rappelle
(`OFF_SITE_CONDUCT_NOTICE`). La catégorie `MODERATION` ne couvre donc plus que
les contenus du site (pseudo, nom d'équipe, logo…).

La validation (`validateReportSubmission`) est **unique** et partagée par le
formulaire et `POST /api/reports`. Les phrases d'information
(`REPORT_PRIVACY_NOTICE`, `reportLegalBasisNotice`, `reportRightsNotice`) sont
celles qui engagent l'association.

**Pas de case d'accord là où l'association est tenue de traiter**
(`ReportCategoryDefinition.legalBasis`, `reportRequiresConsent`). Une demande
d'exercice des droits, une notification de contenu illicite (droit d'auteur, ou
modération d'un contenu du site), une demande à l'hébergeur ou une contestation
ne peuvent pas dépendre d'un « consentement » :
il ne serait pas libre, et son retrait ferait effacer une demande à traiter. Ces
catégories n'affichent que l'information, `consent_at` reste `NULL` ; la case
reste pour bug et autre. Pour ces catégories, `reportRightsNotice` ne promet
pas l'effacement avant la fin du traitement (RGPD, art. 17.3.b).

**Une réponse due a toujours un canal.** `RGPD`, `HOSTING` et `CONTEST`
(`requiresReplyChannel`) exigent une adresse électronique sauf d'un compte dont le
tag Discord est certifié (le seul que l'administration lise sur la fiche du
signalant ; un identifiant rattaché seul ne se voit nulle part) — le site n'envoie aucun
courriel et un signalant ne suit pas son signalement en ligne. La route le relit
en base (`isReplyReachable`) ; le formulaire, qui ne connaît que la session, pose
la question au plus large.

**Le retour au notifiant se fait à la main** (DSA, art. 16.4 et 16.5) :
accusé de réception, puis décision et voies de recours, à l'adresse indiquée
(`NOTIFIER_FOLLOW_UP`, lu par les mentions légales, les conditions et `/rgpd`).
Le dossier du panneau le rappelle (« Retour dû », `reportFollowUpDuty`) pour le
droit d'auteur, la modération, le RGPD, l'hébergeur et la contestation (décision
motivée, DSA art. 20.5). Le **point de contact des autorités**
(art. 11) est publié dans les mentions légales : courriel protégé et catégorie
« Hébergeur », langues `AUTHORITY_CONTACT_LANGUAGES`.

**Une seule liste des éléments d'une notification** (`COPYRIGHT_NOTICE_ELEMENTS`,
`copyrightNoticeElementsText`), celle du formulaire, lue par les mentions
légales, les conditions d'utilisation, `/rgpd` et la fiche T11 ; et « logo ou
avatar » partout où le masquage est décrit.

## Ce qui part sur Discord — et ce qui n'y part pas

Règle du projet (`lib/shared/log-privacy.ts`) : **aucun pseudo de joueur**, ni du
signalant, ni d'un joueur visé. La ligne (`formatReportAlert`,
`formatContestAlert`) dit la catégorie, **compte** les joueurs, **nomme** les
équipes et les tournois, et donne le lien du panneau. La description, texte
libre, ne part jamais. Le message aux personnes visées (`formatTargetNotice`) ne
nomme personne non plus : la page qu'il ouvre, elle, ne se lit qu'en étant visé.

## Ce que lit une personne visée

`GET /api/reports/[id]` (`getConcernedReport`) : motif, date, état,
description, **seulement les cibles qui la concernent**, ses propres
contestations, les logos masqués de **ses** équipes et **son propre** avatar
masqué. **Jamais** l'identité du signalant. Un signalement qui n'existe pas et
un signalement qui ne la vise pas rendent le même 404 : les identifiants sont
consécutifs.

L'état s'y lit en pastille (`REPORT_STATUS_PILL`, `lib/shared/content-reports.ts`) :
`info` à traiter, `accent` en cours, `neutral` archivé — un archivage ne dit
pas qui avait raison, il ne prend donc ni le vert ni le rouge.

## Le panneau

- Onglets par catégorie (pastille = signalements actifs), vue « Actifs » /
  « Archivés », filtre « Contestés seulement ».
- Ordre de traitement (`filterReports`) : à traiter, puis en cours ; à état
  égal, un signalement contesté passe devant ; puis le plus ancien d'abord.
- Le dossier se lit à côté de la liste ; l'adresse porte `?id=` (lien des
  alertes Discord), et les filtres s'ouvrent sur le dossier visé s'il était
  caché par eux.
- Les contestations sont **rangées sous leur signalement d'origine**, jamais
  listées à part ; elles n'ont pas de cycle de vie propre.
- Gestes sur une équipe ou un joueur visé : **masquer** son image (logo ou
  avatar, voir `LOGO_QUARANTINE.md`), la **supprimer** tout de suite (contenu
  manifestement illicite — la décision est inscrite au signalement et la
  personne concernée prévenue, comme au masquage), puis rétablir ou supprimer
  une image masquée. Les gestes sans retour demandent un second clic
  (`ArmedButton`).
- La navigation de l'espace connecté porte un lien « Signalements » avec le
  nombre à traiter, pour la seule permission `moderation`.
- Teintes (`DESIGN_SYSTEM.md`) : chaque compteur de la vue d'ensemble a la
  sienne (`reportStatTone`, `data-tone`) ; « à traiter » et « contestés »
  passent à l'ambre dès qu'ils ne sont pas nuls — l'ambre ne dit
  qu'« avertissement ». L'état d'un dossier reprend `REPORT_STATUS_PILL`
  (`cy-tag-*`), comme la page de la personne visée.

## Conservation

Un signalement ouvert est gardé le temps de son traitement ; archivé, il est
effacé `REPORT_RETENTION_DAYS_AFTER_RESOLUTION` (30) jours plus tard, cibles et
contestations comprises (cascade) — **sauf** s'il tient encore une image
masquée (logo ou avatar), ou une image supprimée dont le délai de contestation
court : il est gardé jusqu'à cette échéance (la personne concernée doit
pouvoir contester). Une notification de contenu envoyée depuis un compte
(`notifierMayContest`) est gardée **six mois civils** après l'archivage, le
délai où son auteur peut contester la décision : effacée au trentième jour, elle
ne serait plus contestable. Ce délai se compte au calendrier de Paris, que SQL
ne connaît pas : `purgeExpiredReports` relit les candidates et les juge par
`reportRetainedUntil` — la même fonction que la date affichée au panneau —, puis
efface par lots en reposant les conditions (un dossier rouvert entre-temps
reste). La suppression d'un compte
visé efface le pseudo relevé sur ses cibles (`label_snapshot`) : le panneau
retombe sinon sur ce relevé dès que le compte n'est plus vivant. La purge est **datée**, donc une base restaurée d'une sauvegarde se
repurge d'elle-même. Elle tourne à chaque envoi, à chaque ouverture du panneau,
et au plus une fois par heure depuis la mise en page racine
(`schedulePurgeExpiredReports`).

## Plafonds

- `REPORT_SUBMIT_RULE` : 5 envois par 30 min, par compte ou par IP.
- `REPORTS_HOURLY_CAP` : 60 signalements par heure **tous auteurs confondus**,
  en base — la seule borne qui tienne sans identité, et chaque envoi écrit en
  privé à deux personnes. Elle borne l'**alerte**, jamais le dépôt : elle a
  d'abord refusé l'envoi (429), et six IP suffisaient alors à fermer le seul
  canal que le site publie — notification d'un contenu illicite, demande RGPD,
  question d'hébergeur. Au-delà, le signalement est enregistré et visible au
  panneau ; la direction reçoit **une** alerte qui annonce l'afflux, au plus une
  par heure (`reportAlertMode` : `ALERT`, puis `SATURATION_NOTICE` au premier
  signalement au-delà du plafond depuis la dernière annonce, puis `SILENT`). Pas
  « au 61ᵉ » : le compte de l'heure est lu sans verrou, deux envois simultanés
  peuvent lire 59 et le suivant 61, et l'annonce ne partirait jamais. Un
  signalement de nouveau alerté (rythme retombé) réarme l'annonce : un second
  pic dans l'heure est annoncé à son tour.
- `REPORTS_HOURLY_HARD_CAP` : 600 par heure, au-delà desquels le dépôt est
  refusé (`REPORTS_SATURATED` → 429) — une borne sur la croissance de la table,
  qu'il faut une soixantaine d'IP pour tenir pleine.
- `REPORT_TARGET_NOTICES_DAILY_CAP` et `REPORT_TARGET_NOTICE_MIN_ACCOUNT_AGE_HOURS` :
  un compte fait prévenir les personnes visées par au plus **3** signalements
  désignant un joueur ou une équipe par 24 h (un tournoi désigné ne prévient
  personne, il ne compte pas), et seulement s'il a au moins **48 h**. Désigner une équipe
  fait écrire le bot à chacun de ses membres : sans borne par auteur, quelques
  comptes gratuits écrivaient chaque jour à tout le site, et Discord pouvait
  classer le bot comme spammeur — ce qui couperait aussi la connexion par code.
  Au-delà, le signalement est enregistré et reste consultable par les personnes
  visées (`/signalements/[id]`, formulaire de contestation) ; seul le message est
  retenu (`reporterMayWarnTargets`). Les deux bornes — reprévenance d'une cible
  et plafond de l'auteur — se **réservent** sous un verrou nommé
  (`reserveTargetNotices`) : cinq signalements simultanés sur une équipe
  liraient sinon tous « personne n'a été prévenu ». L'envoi se fait **hors** du
  verrou — tenu pendant l'appel au bot, il gardait une connexion du pool par
  signalement en attente. Seules les cibles qui ont
  donné un destinataire sont marquées (`notified_at`), et la marque est rendue,
  **cible par cible** (un envoi par cible), si rien ne lui est parvenu (bot
  injoignable, aucun appareil abonné).
- `REPORT_TARGET_SEARCH_RULE` : la recherche de cibles est réservée aux comptes
  connectés (l'annuaire l'est) et plafonnée.

## Données

`bg_reports` (dont `parent_report_id` pour une contestation, et `contest_role` —
`TARGET` ou `NOTIFIER`, écrit à la contestation, `NULL` pour celles d'avant la
colonne, toutes de personnes visées : seule une contestation `TARGET` retient
une image masquée à l'échéance) et
`bg_report_targets` (sans clé étrangère vers la cible : une équipe dissoute
n'emporte pas le signalement ; `label_snapshot` garde le nom ; `notified_at`
dit si la cible a réellement été prévenue — c'est lui, et non la seule
désignation, que relisent le délai de reprévenance et le plafond de l'auteur). L'export RGPD
d'un compte rend ses signalements et contestations, **coordonnées saisies
comprises** (nom, adresse, qualité, page) ; l'anonymisation les
détache de lui. Fiche `T11` du registre des traitements ; section
« Signalements » de `/rgpd`.

## Notes reprises de CLAUDE.md

Texte déplacé tel quel depuis `CLAUDE.md` (allègement du fichier chargé à chaque session).

- **Signalements, contestations et quarantaine des logos** (`lib/shared/content-reports.ts` + `lib/shared/logo-quarantine.ts`, purs, + `lib/server/content-reports.ts` / `logo-quarantine.ts`) : l'association est **hébergeur** des contenus de ses membres (LCEN art. 6, DSA art. 6) — elle ne répond d'un contenu illicite qu'une fois prévenue, d'où un moyen de la prévenir **ouvert à tous**, sur **toutes** les pages : « Signaler un problème » dans `PublicFooter` et dans `SiteFooterBar` (espace connecté, `/connexion`). Sept catégories (`COPYRIGHT`, `MODERATION`, `BUG`, `RGPD`, `HOSTING`, `OTHER`, `CONTEST` — `RGPD` et `HOSTING` reçoivent ce qu'une adresse de contact recevait : le site publie le courriel et le téléphone de l'association et ceux de la personne à contacter pour les demandes relatives aux données, mais **jamais en clair** — voir `docs/features/LEGAL_PAGE.md` —, plus ce formulaire ; le tag Discord `LEGAL_CONTACT_DISCORD` ne sert qu'aux questions techniques, `lib/shared/legal-contact.ts`) — `MODERATION` ne couvre que les **contenus du site** : un comportement en match, une insulte, de la triche ou un litige Discord se signalent sur le **portail de support Spiceworks** (`MODERATION_SUPPORT_PORTAL_URL`), vers lequel le choix de catégorie et l'étape « Modération » renvoient par un simple lien ; **désigner des cibles exige un compte** (chacune reçoit un message privé : ouvert aux anonymes, le bot écrirait à qui l'on veut) ; une validation **unique** partagée par le formulaire et `POST /api/reports` ; une case de consentement pour bug et autre seulement — RGPD, droit d'auteur, modération, hébergeur et contestation reposent sur l'**obligation légale** (`legalBasis`, `reportRequiresConsent`), sans case, et une réponse due (RGPD, hébergeur, contestation) exige une adresse sauf d'un compte au tag Discord certifié ; retour au notifiant (accusé, décision, recours) fait à la main et rappelé au panneau (`reportFollowUpDuty`), point de contact des autorités aux mentions légales, éléments d'une notification tirés d'une seule liste (`COPYRIGHT_NOTICE_ELEMENTS`). Chaque signalement alerte la **direction** par le bot (`/internal/notify/leadership` : salon de logs + message privé à `OWNER_ID` et `PRESIDENT`) et prévient en message privé les **personnes visées** (joueurs désignés, membres actuels des équipes désignées, joignables par un moyen prouvé — une cible déjà visée depuis moins de 24 h n'est pas reprévenue, sans quoi le formulaire ferait écrire le bot en boucle à une équipe), qui lisent le dossier sur `/signalements/[id]` — motif, description, leurs seules cibles, **jamais** l'identité du signalant — et peuvent le **contester** (`isConcernedByReport`) — l'auteur d'un signalement de droit d'auteur ou de modération aussi, par le formulaire, une fois le dossier archivé (`canContestReport`, art. 20.1 DSA) ; contester un dossier archivé le **rouvre**. Aucun pseudo de joueur ni description ne part sur Discord. Panneau `/admin/signalements`, permission **`moderation`** (réservée `ADMIN`) : onglets par catégorie, contestés en tête, contestations **rangées sous leur signalement d'origine**, prise en charge, archivage avec note. Un logo signalé se **masque** (fichier déplacé de `public/uploads` vers `data/quarantine`, qu'aucune route publique ne sert) pendant **six mois civils**, comptés au calendrier de Paris — le délai de l'art. 20.1 DSA, que l'association applique —, l'équipe prévenue par un message qui expose motif, faits, fondement (clause des CGU) et recours, juge compris (art. 17.3), avec la date de suppression définitive ; puis rétabli, ou supprimé à l'échéance **sauf s'il est contesté** et non tranché. Retrait immédiat possible — depuis le panneau par le signalement (`/api/admin/reports/[id]/logo-removal`, inscrit au dossier comme une quarantaine close sur-le-champ, équipe prévenue avec le lien pour contester), depuis la fiche d'équipe par `DELETE /api/admin/teams/[id]/logo` (équipe prévenue aussi) ; ni lui ni le masquage n'effacent un fichier que d'autres équipes désignent. Conservation : 30 jours après l'archivage, prolongée tant qu'un logo masqué tient au dossier, et portée à six mois civils pour une notification de contenu dont l'auteur peut contester la décision ; purge **datée**, entraînée par le trafic. Voir `docs/features/CONTENT_REPORTS.md` et `docs/features/LOGO_QUARANTINE.md`.
