# `/restore-backup` en clair et champs libres du bot

Détail de l'entrée de `ERREUR.txt` qui renvoie ici. Retirer ce fichier avec l'entrée.

## Entrée d'origine

[2026-09-30] blueGenjiBot/src/commandsHandlers/admin/restoreBackup.ts + src/config/commands.ts (`/scrim niveau`, `/recrute role`) — **audit juridique · lot bot** — (1) `/restore-backup` exige la base **déchiffrée** en pièce jointe de commande : toute la base part en clair sur le CDN de Discord, sans durée déclarée, alors que les textes disent les sauvegardes « chiffrées, 30 jours au plus » ; (2) `niveau` et `role` sont du texte libre, repris tel quel dans `ActivityDaily` (sans limite) et dans le fil public — piste : restauration depuis l'archive `.age` sur la machine, sans passer par Discord ; choix fermés pour `niveau` et `role` — (rencontré sur : feature/bot-privacy-texts)
