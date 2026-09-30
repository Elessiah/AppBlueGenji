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
- **Élagué** à chaque écriture, **et** au plus une fois par heure sans
  suppression nouvelle (`scheduleAccountDeletionJournalPrune`, entraîné par le
  trafic depuis `app/layout.tsx`, comme la purge des signalements) : au-delà de
  deux fois la rétention des sauvegardes, aucune archive ne contient plus le
  compte, et garder la ligne reviendrait à tenir la liste des comptes partis.
  Élaguer à l'écriture seulement laissait une ligne — et sa copie OneDrive —
  survivre à la durée annoncée tant que personne d'autre ne supprimait son
  compte. L'élagage passe par la même file que les écritures (une suppression
  simultanée n'est pas perdue) et ne réécrit le fichier que s'il y a une ligne
  à retirer.
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
3. Simuler, puis rejouer — **avec `NODE_ENV=production`**, sans quoi le script
   lit `.env` au lieu de `.env.production` et meurt sur `DB_HOST` (le shell du
   serveur n'exporte pas `NODE_ENV`, seul pm2 le pose) :

   ```bash
   NODE_ENV=production npm run replay:deletions -- --dry-run
   NODE_ENV=production npm run replay:deletions
   ```

4. Redémarrer le site.

Le rejeu passe par `deleteOwnAccount`, donc tout part comme au premier jour
(avatar, identités, défis de connexion), et il est sans danger à relancer : un
compte déjà supprimé est reconnu et laissé tel quel. Sortie non nulle si une
suppression a échoué.

## Registre des traitements

Le registre est désormais **publié par le site** (`/rgpd/registre`, fiche
`T09`, et son export `/rgpd/registre.csv`) — voir
`docs/features/PROCESSING_REGISTER.md`. La fiche ci-dessous en est l'origine :

- **Traitement** : sauvegarde de la plateforme BlueGenji (base de données,
  images téléversées).
- **Finalité** : reprise d'activité après panne, corruption ou erreur de
  manipulation.
- **Base légale** : intérêt légitime (continuité du service).
- **Données** : l'ensemble des données de la plateforme (profils pseudonymes,
  identifiants de connexion, résultats de tournois, avatars et logos).
- **Destinataires** : le responsable technique de l'association — qui est aussi
  l'hébergeur du site, donc son sous-traitant (contrat de l'article 28 rédigé
  dans `docs/legal/contrat-sous-traitance-hebergement.md`, **non signé** à ce
  jour) —, seul détenteur des clés de déchiffrement, côté association. `/rgpd` le dit ainsi plutôt que « une clé que seule
  l'association détient », formule qui masquait que le détenteur est aussi
  l'hébergeur.
- **Hébergement** : Microsoft (OneDrive, compte **personnel**). Le cadre est
  celui d'un particulier : Contrat de services Microsoft et déclaration de
  confidentialité de Microsoft, **aucun contrat de sous-traitance** (le DPA de
  Microsoft ne vaut que pour ses offres professionnelles). Microsoft n'y
  garantit **aucun lieu de stockage** : on n'en affirme donc aucun (ni UE, ni
  Irlande, ni Pays-Bas), et un transfert éventuel vers les États-Unis repose sur
  la certification EU-U.S. Data Privacy Framework de Microsoft Corporation
  (décision d'adéquation (UE) 2023/1795).
- **Sécurité** : les données sont **chiffrées sur le Raspberry Pi avant tout
  envoi** — `age` pour les archives (clé publique sur le serveur, clé privée
  hors du serveur), `rclone crypt` pour les images, les logos masqués et le
  journal (mot de passe dans la configuration rclone du serveur, copie de
  secours hors du serveur). Aucune clé ne part chez Microsoft, qui stocke sans
  pouvoir lire. Le script des images **refuse** un remote qui n'est pas de type
  `crypt`, sans exception : aucun réglage ne permet d'envoyer en clair (remote
  `crypt` vérifié en production le 30 septembre 2026).
  Le chiffrement au repos de Microsoft et le transport HTTPS/TLS de l'API
  OneDrive ne sont que des **mesures complémentaires**. Le chiffrement est une
  mesure de sécurité (art. 32), au mieux une mesure supplémentaire à un outil de
  transfert (recommandations CEPD 01/2020) : il ne tient lieu **ni** de contrat
  de sous-traitance (art. 28) **ni** de mécanisme de transfert (art. 44 et s.).
  Aucun contrat de sous-traitance n'est affirmé avec Microsoft. Décision
  requise : maintien de ce stockage ou passage à un stockage sous contrat (dans
  l'UE de préférence), signature du contrat avec l'hébergeur — voir
  `ERREUR.txt`.
- **Durée** : archives 30 jours ; images le temps de leur présence sur le site ;
  journal des suppressions 60 jours par entrée.
- **Mesures** : chiffrement, suppression définitive (sans corbeille), clé privée
  conservée hors du serveur, rejeu des **suppressions de compte** à toute
  restauration. Le journal ne porte que celles-là : tout autre effacement
  postérieur à l'archive (tag ou BattleTag retiré, moyen de connexion détaché,
  réglage modifié, signalement purgé…) reviendrait avec elle, et `/rgpd` le dit.

## Ce que dit `/rgpd`

La ligne « Copies de sauvegarde » du tableau (`DONNEE_SAUVEGARDES`) et la note
sous le tableau. La durée vient de `BACKUP_RETENTION_DAYS` : **si
`RETENTION_DAYS` change côté bot, la constante doit changer avec** — la page
annoncerait sinon une durée fausse, ce qu'elle a fait longtemps (« quelques
jours » pour des archives gardées six mois).
