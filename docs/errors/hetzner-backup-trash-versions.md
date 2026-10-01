# Corbeille et versions Nextcloud des sauvegardes

Détail de l'entrée de `ERREUR.txt` qui renvoie ici. Retirer ce fichier avec l'entrée.

## Entrée d'origine

[2026-10-01] production (Hetzner Storage Share, sauvegardes du bot) + lib/shared/processing-register.ts (T09) — **action requise en production** — le registre (T09), `/rgpd` et la politique du bot annoncent une suppression définitive des sauvegardes au bout de 30 jours au plus, « sans corbeille ni historique de versions chez le fournisseur » ; sur le Nextcloud de Hetzner aucune option rclone ne l'assure, et les copies déposées sur l'ancien OneDrive y restent tant qu'on ne les efface pas — piste : désactiver les applications Nextcloud « Deleted files » et « Versions » (ou rétention à zéro) puis vider ce qu'elles gardent ; après vérification d'une restauration depuis Hetzner, effacer définitivement les copies OneDrive (corbeille comprise) et retirer ses remotes (`blueGenjiBot/doc/backup-onedrive.md`) — (rencontré sur : feature/offsite-backup-texts)
