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
3. **Contester.** Seule une personne visée peut contester
   (`isConcernedByReport`), depuis `/signalements/[id]` ou par la catégorie
   « Contestation » du même formulaire. Une contestation d'un signalement
   **archivé le rouvre**, et la direction est prévenue.
4. **Traiter.** `/admin/signalements` (permission `moderation`, réservée à
   `ADMIN`) : prise en charge, masquage ou suppression d'un logo, archivage avec
   une note, réouverture.

## Catégories (`REPORT_CATEGORY_DEFINITIONS`)

| Catégorie | Cibles | Exigences |
|---|---|---|
| `COPYRIGHT` — Droit d'auteur | joueurs, équipes, tournois | nom + adresse, qualité (`RightsRelation`), déclaration de bonne foi |
| `MODERATION` — Modération | joueurs, équipes | — |
| `BUG` — Bug | aucune | — |
| `OTHER` — Autre | joueurs, équipes, tournois | — |
| `CONTEST` — Contestation | aucune (rattachée à `parentReportId`) | être visé ; connecté |

La validation (`validateReportSubmission`) est **unique** et partagée par le
formulaire et `POST /api/reports`. Le consentement RGPD est une case obligatoire
du formulaire ; les phrases qui l'accompagnent (`REPORT_PRIVACY_NOTICE`) sont
celles qui engagent l'association.

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
contestations et les logos masqués de **ses** équipes. **Jamais** l'identité du
signalant. Un signalement qui n'existe pas et un signalement qui ne la vise pas
rendent le même 404 : les identifiants sont consécutifs.

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
- Gestes sur une équipe visée : **masquer le logo** (voir
  `LOGO_QUARANTINE.md`), **supprimer le logo** tout de suite (contenu
  manifestement illicite — la décision est inscrite au signalement et l'équipe
  prévenue, comme au masquage), puis rétablir ou supprimer un logo masqué. Les gestes
  sans retour demandent un second clic (`ArmedButton`).
- La navigation de l'espace connecté porte un lien « Signalements » avec le
  nombre à traiter, pour la seule permission `moderation`.

## Conservation

Un signalement ouvert est gardé le temps de son traitement ; archivé, il est
effacé `REPORT_RETENTION_DAYS_AFTER_RESOLUTION` (30) jours plus tard, cibles et
contestations comprises (cascade) — **sauf** s'il tient encore un logo masqué,
ou un logo supprimé dont le délai de contestation court : il est gardé jusqu'à
cette échéance (l'équipe doit pouvoir contester). La suppression d'un compte
visé efface le pseudo relevé sur ses cibles (`label_snapshot`) : le panneau
retombe sinon sur ce relevé dès que le compte n'est plus vivant. La purge est **datée**, donc une base restaurée d'une sauvegarde se
repurge d'elle-même. Elle tourne à chaque envoi, à chaque ouverture du panneau,
et au plus une fois par heure depuis la mise en page racine
(`schedulePurgeExpiredReports`).

## Plafonds

- `REPORT_SUBMIT_RULE` : 5 envois par 30 min, par compte ou par IP.
- `REPORTS_HOURLY_CAP` : 60 signalements par heure **tous auteurs confondus**,
  en base — la seule borne qui tienne sans identité, et chaque envoi écrit en
  privé à deux personnes.
- `REPORT_TARGET_SEARCH_RULE` : la recherche de cibles est réservée aux comptes
  connectés (l'annuaire l'est) et plafonnée.

## Données

`bg_reports` (dont `parent_report_id` pour une contestation) et
`bg_report_targets` (sans clé étrangère vers la cible : une équipe dissoute
n'emporte pas le signalement ; `label_snapshot` garde le nom). L'export RGPD
d'un compte rend ses signalements et contestations, **coordonnées saisies
comprises** (nom, adresse, qualité, page) ; l'anonymisation les
détache de lui. Fiche `T11` du registre des traitements ; section
« Signalements » de `/rgpd`.
