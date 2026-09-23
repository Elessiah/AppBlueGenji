# Sauvegardes et protection des données

Les sauvegardes sont faites par le dépôt du bot (`blueGenjiBot/scripts/`,
documentées dans `blueGenjiBot/doc/backup-onedrive.md`). Ce document dit ce que
le **site** doit en savoir, et pourquoi elles sont réglées ainsi : chacune
garde une copie de données personnelles, donc chacune est un traitement.

## Ce qui est sauvegardé

| Quoi | Comment | Durée |
| --- | --- | --- |
| Base MySQL du site (+ SQLite du bot) | Archive hebdomadaire chiffrée (`age`), déposée sur OneDrive | 30 jours (`BACKUP_RETENTION_DAYS`) |
| Images téléversées (`public/uploads`) | Miroir horaire chiffré (`rclone crypt`) | Tant que l'image existe sur le site, **plus une heure au plus** |
| Journal des suppressions (`data/account-deletions.jsonl`) | Copié chiffré avec les images, chaque heure | 60 jours par ligne (`ACCOUNT_DELETION_JOURNAL_RETENTION_DAYS`) |

La purge des archives est refaite **chaque heure** par le cron des images, et
pas seulement par la sauvegarde du lundi : seule, cette dernière laissait une
archive vivre jusqu'à 35 jours (28 jours au quatrième passage, donc gardée),
davantage si une exécution échouait avant sa purge — et `/rgpd` annonce 30 jours
au plus.

Les suppressions côté OneDrive sont **définitives** (`--onedrive-hard-delete`) :
la corbeille OneDrive garde sinon trente jours de plus tout ce qu'on efface, et
la durée annoncée serait fausse d'autant.

## Le problème que règle le journal

Une archive chiffrée ne se corrige pas personne par personne. Un compte
supprimé survit donc dans les archives jusqu'à leur purge — c'est admis, **à
condition** que la suppression soit rejouée si l'une d'elles est restaurée.
Sans cela, restaurer la sauvegarde d'il y a dix jours ferait revenir tous les
comptes supprimés depuis, identités de connexion et tag Discord compris.

La base restaurée ne peut pas dire ce qui a été supprimé depuis elle ; d'où un
journal **hors de la base** (`lib/shared/account-deletion-journal.ts` pur,
`lib/server/account-deletion-journal.ts` pour le fichier) :

- **Une ligne par suppression** : `userId`, `accountCreatedAt`, `deletedAt`. Rien
  qui désigne une personne, et pas le mode — il se redécide au rejeu sur les
  traces de la base restaurée, qui ne sont pas celles du jour de la suppression.
- **Écrite après le commit**, jamais avant : une ligne pour une suppression
  annulée ferait effacer à la restauration un compte que personne n'a voulu
  supprimer. Un échec d'écriture est journalisé et avalé — la suppression a eu
  lieu.
- **`accountCreatedAt` rend le rejeu sûr** : après une restauration, le compteur
  `AUTO_INCREMENT` repart de sa valeur ancienne et un compte neuf peut recevoir
  l'identifiant d'un compte supprimé entre-temps. Le rejeu ne touche qu'une
  ligne dont la date de création correspond (`replayDecision` → `OTHER_ACCOUNT`
  sinon).
- **Élagué** à chaque écriture : au-delà de deux fois la rétention des
  sauvegardes, aucune archive ne contient plus le compte, et garder la ligne
  reviendrait à tenir la liste des comptes partis.
- **Écrit par renommage** (fichier temporaire puis `rename`) : la copie horaire
  du bot ne peut pas le surprendre à moitié écrit. Les écritures d'un processus
  sont sérialisées ; le site tourne en un seul processus pm2.
- **Hors de `public/`** : tout ce qui est sous `public/uploads` est servi par
  `/api/uploads/...`. Le dossier `data/` est ignoré par git.

Limite assumée : une suppression faite dans l'heure qui précède la perte **de la
machine** n'a pas encore été copiée sur OneDrive. Sur une simple corruption de
la base, le journal local est intact et rien ne manque.

## Restaurer une sauvegarde

1. Restaurer le dump (`blueGenjiBot/doc/backup-onedrive.md`) **sans** remettre le
   site en service.
2. Si la machine a été perdue, récupérer le journal sur OneDrive :
   `rclone copy onedrive-crypt:deletions/account-deletions.jsonl data/`.
3. Simuler, puis rejouer :

   ```bash
   npm run replay:deletions -- --dry-run
   npm run replay:deletions
   ```

4. Redémarrer le site.

Le rejeu passe par `deleteOwnAccount`, donc tout part comme au premier jour
(avatar, identités, défis de connexion), et il est sans danger à relancer : un
compte déjà supprimé est reconnu et laissé tel quel. Sortie non nulle si une
suppression a échoué.

## Registre des traitements

L'association doit inscrire les sauvegardes à son registre. Proposition, à
recopier :

- **Traitement** : sauvegarde de la plateforme BlueGenji (base de données,
  images téléversées).
- **Finalité** : reprise d'activité après panne, corruption ou erreur de
  manipulation.
- **Base légale** : intérêt légitime (continuité du service).
- **Données** : l'ensemble des données de la plateforme (profils pseudonymes,
  identifiants de connexion, résultats de tournois, avatars et logos).
- **Destinataires** : le responsable technique de l'association, seul détenteur
  des clés de déchiffrement.
- **Hébergement** : Microsoft (OneDrive, compte personnel de l'association). Les
  données sont **chiffrées avant envoi** (`age` pour les archives, `rclone crypt`
  pour les images et le journal) : Microsoft stocke sans pouvoir lire, ce qui
  couvre à la fois l'absence de contrat de sous-traitance d'un compte personnel
  et un éventuel stockage hors de l'Union européenne.
- **Durée** : archives 30 jours ; images le temps de leur présence sur le site ;
  journal des suppressions 60 jours par entrée.
- **Mesures** : chiffrement, suppression définitive (sans corbeille), clé privée
  conservée hors du serveur, rejeu des suppressions à toute restauration.

## Ce que dit `/rgpd`

La ligne « Copies de sauvegarde » du tableau (`DONNEE_SAUVEGARDES`) et la note
sous le tableau. La durée vient de `BACKUP_RETENTION_DAYS` : **si
`RETENTION_DAYS` change côté bot, la constante doit changer avec** — la page
annoncerait sinon une durée fausse, ce qu'elle a fait longtemps (« quelques
jours » pour des archives gardées six mois).
