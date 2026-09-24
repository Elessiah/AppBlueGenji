# Quarantaine des logos signalés

Supprimer tout de suite un logo signalé, c'est parfois supprimer à tort le logo
d'une équipe qui en détient les droits. Le panneau des signalements propose donc
de le **masquer** : il cesse d'être en ligne — ce qui éteint la responsabilité
d'hébergeur de l'association —, mais il est gardé à part, le temps que l'équipe
conteste.

## Cycle

```
HIDDEN ──(contestation acceptée, « Rétablir »)──▶ RESTORED
   │
   ├──(« Supprimer maintenant »)──────────────────▶ PURGED
   └──(échéance passée, sans contestation
       ou signalement archivé)───────────────────▶ PURGED
```

- **Masquer** (`hideTeamLogo`, `POST /api/admin/reports/[id]/logo-quarantine`)
  n'est possible que pour une équipe **visée par ce signalement** : c'est ce lien
  qui permet à l'équipe de contester. Les membres actuels reçoivent un message
  privé qui donne la **date de suppression définitive** et le lien de
  contestation.
- **Rétablir** (`restoreTeamLogo`) remet le fichier à la même adresse et
  prévient l'équipe. Refusé si l'équipe a envoyé un autre logo entre-temps
  (`TEAM_HAS_NEW_LOGO`) : on n'écrase pas un choix fait depuis.
- **Supprimer** (`purgeQuarantinedLogo`) efface le fichier, à la demande ou à
  l'échéance.

## Durée : six mois (`LOGO_QUARANTINE_DAYS = 180`)

C'est la durée pendant laquelle le DSA impose de pouvoir contester une décision
de modération (art. 20.1, « au moins six mois »). Un logo d'équipe n'est en
règle générale pas une donnée personnelle : rien n'oblige à le supprimer plus
tôt, et plus longtemps n'aurait plus d'objet. **Un logo contesté n'est jamais
supprimé d'office** (`canAutoPurgeLogo`) : l'échéance passée, il attend que
l'association archive le signalement ou le rétablisse.

## Où va le fichier

De `public/uploads/teams/` (servi par `/api/uploads/...` à quiconque connaît
l'adresse) vers `data/quarantine/teams/`, qu'aucune route publique ne sert. Vider
la seule colonne `logo_url` n'aurait pas suffi : l'adresse du fichier a pu être
copiée. L'aperçu du panneau passe par
`GET /api/admin/logo-quarantines/[id]/image` (permission `moderation`, jamais mis
en cache).

Le nom en quarantaine porte l'équipe (`team-<id>-<fichier>`). Un fichier
**partagé** par plusieurs équipes (le jeu de test en partage un) n'est pas
déplacé mais **copié** : le déplacer effacerait le logo des autres. Un
`logo_url` qui désigne un fichier absent est refusé (`LOGO_FILE_MISSING`) : il
n'y a rien à garder, le retrait immédiat vide la colonne.

Un déplacement de fichier ne se défait pas avec une transaction : il est fait
**avant** l'écriture en base, et défait si l'écriture échoue. L'inverse
laisserait une base annonçant un logo masqué pendant que le site le sert encore.
Une exception : si l'équipe a **changé de logo** pendant le geste
(`LOGO_CHANGED`), plus rien ne désigne le fichier — l'envoi du nouveau a voulu
l'effacer sans le trouver. Il est alors effacé, pas remis en ligne : il
resterait sinon servi à son ancienne adresse, sans que rien ne le retire jamais.

## Sauvegarde

Le miroir horaire des images (dépôt du bot, `scripts/sync-uploads-onedrive.sh`)
synchronise aussi `data/quarantine` vers `quarantine/` du remote chiffré : un logo
masqué doit pouvoir être rétabli même après la perte de la machine. Rétabli ou
supprimé, il quitte le dossier, donc la sauvegarde au passage suivant.

## Conservation du signalement

Un signalement archivé qui tient encore un logo masqué n'est **pas** purgé à
30 jours (`purgeExpiredReports`) : l'équipe conteste depuis sa page, qui doit
exister jusqu'à l'échéance. La purge des logos tourne d'abord, celle des
signalements ensuite (`schedulePurgeExpiredReports`).

## Retrait immédiat

Depuis le panneau, « Supprimer le logo » d'une équipe visée passe par
`POST /api/admin/reports/[id]/logo-removal` (`deleteTeamLogoForReport`) : la
décision laisse la **même trace** qu'un masquage — une ligne de
`bg_logo_quarantines` `PURGED`, close à l'instant de son ouverture
(`isImmediateLogoRemoval`), rattachée au signalement —, si bien que le panneau
et la page de l'équipe visée la montrent, et l'équipe est prévenue en message
privé avec le lien pour **contester** (DSA art. 17 et 20). Son `purge_after` est
la fin du délai de contestation (six mois) : le signalement est gardé jusque-là.

Hors de tout signalement, `DELETE /api/admin/teams/[id]/logo` (permission
`moderation`, fiche de l'équipe) supprime un logo sans quarantaine, pour un
contenu manifestement illicite ; l'équipe est prévenue aussi, le message la
renvoyant vers l'association faute de signalement à contester ; un fichier que
d'autres équipes désignent encore n'est pas effacé (même règle que le masquage) — depuis le panneau ou
depuis la fiche de l'équipe (`ModerationLogoBar`). Trace dans les journaux du
staff (`publishStaffAction`), sans nom de joueur sur Discord.
