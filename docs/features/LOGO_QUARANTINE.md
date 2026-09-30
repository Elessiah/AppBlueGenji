# Quarantaine des images signalées (logos, avatars)

Supprimer tout de suite une image signalée, c'est parfois supprimer à tort le
logo d'une équipe — ou l'avatar d'un joueur — qui en détient les droits. Le
panneau des signalements propose donc de la **masquer** : elle cesse d'être en
ligne — ce qui éteint la responsabilité d'hébergeur de l'association —, mais
elle est gardée à part, le temps que la personne concernée conteste.

Une même table (`bg_logo_quarantines`) et un même cycle servent les deux
domaines : une ligne désigne soit une équipe (`team_id`), soit un joueur
(`user_id`), jamais les deux — même principe que `bg_teams.solo_user_id`, qui
distingue déjà une entrée solo sans colonne « type ». Les gestes d'écriture,
eux, restent **séparés** par domaine (`lib/server/logo-quarantine.ts`) : un
logo peut être partagé par plusieurs équipes (le jeu de test en partage un),
jamais un avatar ; retirer un avatar doit en plus resynchroniser l'entrée solo
du joueur, dont le logo n'est que l'avatar recopié
(`lib/server/solo-entries-service.ts`).

## Cycle

```
HIDDEN ──(contestation acceptée, « Rétablir »)──▶ RESTORED
   │
   ├──(« Supprimer maintenant »)──────────────────▶ PURGED
   └──(échéance passée, sans contestation
       ou signalement archivé)───────────────────▶ PURGED
```

- **Masquer** — `hideTeamLogo` / `hideUserAvatarForReport`, toutes deux
  derrière `POST /api/admin/reports/[id]/logo-quarantine` (corps
  `{ targetType: "TEAM" | "USER", targetId }`) — n'est possible que pour une
  cible **visée par ce signalement** : c'est ce lien qui permet de contester.
  Les membres actuels de l'équipe, ou le joueur, reçoivent un message privé qui
  expose les motifs de la décision (voir « Exposé des motifs » plus bas), la
  **date de suppression définitive** et le lien de contestation.
- **Rétablir** (`restoreReportedImage`, une seule fonction pour les deux
  domaines) remet le fichier à la même adresse et prévient la personne
  concernée. Refusé si elle a envoyé une autre image entre-temps
  (`TEAM_HAS_NEW_LOGO` / `USER_HAS_NEW_AVATAR`) : on n'écrase pas un choix fait
  depuis.
- **Supprimer** (`purgeQuarantinedLogo`) efface le fichier, à la demande ou à
  l'échéance. Décidée **avant** l'échéance (contestation rejetée), la
  suppression est annoncée, qui attendait une autre date ; à l'échéance, le
  message du masquage l'a déjà dite. La page du signalement montre toute image
  supprimée, pas seulement celles qui attendent.

## Durée : six mois civils (`LOGO_QUARANTINE_MONTHS = 6`)

C'est le délai de contestation d'une décision de modération que le DSA fixe aux
plateformes en ligne (art. 20.1, « au moins six mois »), et que l'association
applique ; les textes du site ne disent pas qu'il lui est imposé. Six mois
**civils**, et non 180 jours : 180 jours sont plus courts que six mois à partir
d'un 1er mars (184), et la date annoncée tombait avant l'échéance revendiquée.
`logoQuarantinePurgeDate` compte **au calendrier de Paris**, celui de la date
annoncée : au calendrier UTC, un masquage le 1er mars à 0 h 30 à Paris (28
février en UTC) finissait le 29 août. Un quantième absent du mois d'arrivée
déborde sur le suivant, et une heure avalée par un changement d'heure est
rendue : le délai peut s'allonger, jamais raccourcir. Un logo d'équipe ou un
avatar n'oblige à rien de plus tôt, et plus longtemps n'aurait plus d'objet. **Une
image contestée n'est jamais supprimée d'office** (`canAutoPurgeLogo`) :
l'échéance passée, elle attend que l'association archive le signalement ou la
rétablisse. Seule la contestation d'une **personne visée** compte : celle de
l'auteur du signalement (qui voudrait l'image partie, pas gardée) ne retient
rien, sans quoi elle prolongerait la garde au-delà de l'échéance annoncée. Qui
conteste est écrit avec la contestation (`bg_reports.contest_role`), jamais
redéduit de l'appartenance du jour. Et comme l'auteur ne conteste qu'un dossier
archivé, la réouverture qu'il provoque ne remet rien en attente : seule compte
une contestation de personne visée **postérieure** à la sienne.

## Exposé des motifs

Masquer ou supprimer une image est une décision de modération : chaque message
privé qui l'annonce (`formatLogoHiddenNotice`, `formatLogoRemovedNotice` et
leurs pendants d'avatar) donne, dans cet ordre, la **décision** (masquée mais
conservée, ou supprimée), le **motif**, les **faits retenus** (le signalement,
lisible sur sa page — ou « constat de la modération » hors signalement), le
fait que la décision est prise **sans traitement automatisé**, le
**fondement** — la clause des conditions d'utilisation invoquée, avec le lien
vers `TERMS_PATH#contenus` — et les **voies de recours** : la contestation
auprès de l'association, puis le juge compétent (DSA art. 17.3).

Le fondement se déduit de la catégorie du signalement (`moderationGroundsFor`) :
`COPYRIGHT` → atteinte présumée aux droits d'un tiers, tout le reste (et le
retrait hors signalement) → règles du site. La phrase de réponse suit le motif
— « si vous en détenez les droits » pour le premier, « si l'image respecte les
règles, expliquez pourquoi » pour le second — : un logo retiré comme contraire
aux règles n'a rien à répondre sur ses droits d'auteur. Côté serveur, le
masquage lit la catégorie en vérifiant que le signalement vise la cible
(`assertTargeted`) ; les avis de suppression la relisent (`reportGrounds`),
leurs appelants ne connaissant que l'identifiant du signalement.

## Où va le fichier

De `public/uploads/teams/` (ou `.../avatars/`, servi par `/api/uploads/...` à
quiconque connaît l'adresse) vers `data/quarantine/teams/` (ou `.../players/`),
qu'aucune route publique ne sert. Vider la seule colonne n'aurait pas suffi :
l'adresse du fichier a pu être copiée. L'aperçu du panneau passe par
`GET /api/admin/logo-quarantines/[id]/image` (permission `moderation`, jamais
mis en cache).

Le nom en quarantaine porte la cible (`team-<id>-<fichier>` ou
`user-<id>-<fichier>`). Un logo **partagé** par plusieurs équipes (le jeu de
test en partage un) n'est pas déplacé mais **copié** : le déplacer effacerait
le logo des autres — un avatar, jamais partagé entre comptes, n'a pas cette
question. Une adresse qui désigne un fichier absent est refusée
(`LOGO_FILE_MISSING` / `AVATAR_FILE_MISSING`) : il n'y a rien à garder, le
retrait immédiat vide la colonne.

Un déplacement de fichier ne se défait pas avec une transaction : il est fait
**avant** l'écriture en base, et défait si l'écriture échoue. L'inverse
laisserait une base annonçant une image masquée pendant que le site la sert
encore. Une exception : si la cible a **changé d'image** pendant le geste
(`LOGO_CHANGED` / `AVATAR_CHANGED`), plus rien ne désigne le fichier — l'envoi
du nouveau a voulu l'effacer sans le trouver. Il est alors effacé, pas remis en
ligne : il resterait sinon servi à son ancienne adresse, sans que rien ne le
retire jamais.

## Sauvegarde

Le miroir horaire des images (dépôt du bot, `scripts/sync-uploads-onedrive.sh`)
synchronise aussi `data/quarantine` vers `quarantine/` du remote chiffré : une
image masquée doit pouvoir être rétablie même après la perte de la machine.
Rétablie ou supprimée, elle quitte le dossier, donc la sauvegarde au passage
suivant.

## Conservation du signalement

Un signalement archivé qui tient encore une image masquée n'est **pas** purgé à
30 jours (`purgeExpiredReports`) : la personne concernée conteste depuis sa
page, qui doit exister jusqu'à l'échéance. La purge des images tourne d'abord,
celle des signalements ensuite (`schedulePurgeExpiredReports`).

## Retrait immédiat

Depuis le panneau, « Supprimer le logo » (ou « Supprimer l'avatar ») d'une
cible visée passe par `POST /api/admin/reports/[id]/logo-removal` (même corps
que le masquage) — `deleteTeamLogoForReport` ou `deleteUserAvatarForReport`
selon `targetType` : la décision laisse la **même trace** qu'un masquage — une
ligne de `bg_logo_quarantines` `PURGED`, close à l'instant de son ouverture
(`isImmediateLogoRemoval`), rattachée au signalement —, si bien que le panneau
et la fiche de la cible la montrent, et la personne concernée est prévenue en
message privé avec le lien pour **contester** (DSA art. 17 et 20). Son
`purge_after` est la fin du délai de contestation (six mois civils) : le signalement
est gardé jusque-là.

Hors de tout signalement, `DELETE /api/admin/teams/[id]/logo` (fiche
d'équipe, `ModerationLogoBar`) et `DELETE /api/admin/users/[id]/avatar` (fiche
joueur, `PlayerModerationBar`) — toutes deux réservées à la permission
`moderation` — suppriment une image sans quarantaine, pour un contenu
manifestement illicite. Elles **exigent un motif** (`{ reason }`, 10 à 500
caractères, `validateModerationReason` ; 400 `MODERATION_REASON_REQUIRED` /
`MODERATION_REASON_TOO_LONG` avant toute écriture) : faute de signalement, il
est le seul fait que l'exposé des motifs puisse citer (DSA art. 17.3.b), et il
remplace « constat de la modération » dans le message privé. Il n'est pas
conservé par le site. La personne concernée est prévenue aussi, le message
la renvoyant vers l'association faute de signalement à contester ; un logo que
d'autres équipes désignent encore n'est pas effacé (même règle que le
masquage). Trace dans les journaux du staff (`publishStaffAction`), sans nom de
joueur sur Discord.
