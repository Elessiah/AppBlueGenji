# Copies `database.sqlite.avant-<date>` sans limite d'âge

Détail de l'entrée de `ERREUR.txt` qui renvoie ici. Retirer ce fichier avec l'entrée.

## Entrée d'origine

[2026-09-30] blueGenjiBot/src/backup/restoreDatabase.ts (`purgeOldRollbacks`) — une restauration garde à côté de la base les trois copies `database.sqlite.avant-<date>` les plus récentes, sans limite d'âge : elles portent les auteurs de scrims/recherches non anonymisés, la table `UserLink` et la configuration de serveurs quittés, que les durées de conservation du bot (blueGenjiBot#33) n'atteignent pas — piste : supprimer une copie au-delà de 30 jours (`BACKUP_RETENTION_DAYS`) ou à la restauration suivante réussie — (rencontré sur : feature/privacy-decisions)
