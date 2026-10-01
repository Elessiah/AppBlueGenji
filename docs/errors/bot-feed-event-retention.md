# `FeedEvent` sans purge ni durée déclarée

Détail de l'entrée de `ERREUR.txt` qui renvoie ici. Retirer ce fichier avec l'entrée.

## Entrée d'origine

[2026-09-30] blueGenjiBot/src/feed/feedBus.ts (`FeedEvent`) — le fil d'activité garde une ligne par `/scrim` ou `/recrute` (heure exacte, nom du serveur, niveau ou rôle) sans aucune purge ni durée déclarée : croisée avec la réponse publique de la commande, elle date et situe l'action d'une personne au-delà des 30 jours du repli `ActivityDaily` (blueGenjiBot#33) ; ni T08 ni la politique du bot n'en donnent la durée — piste : purge de `FeedEvent` au-delà de N jours dans `runDataRetention`, puis durée dans `bot-legal-content.ts` et T08 — (rencontré sur : feature/bot-privacy-texts)
