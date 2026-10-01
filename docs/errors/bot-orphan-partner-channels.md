# Salons partenaires supprimés pendant que le bot est arrêté

Détail de l'entrée de `ERREUR.txt` qui renvoie ici. Retirer ce fichier avec l'entrée.

## Entrée d'origine

[2026-09-30] blueGenjiBot/src/main.ts (`channelDelete`) — un salon relayé supprimé pendant que le bot est arrêté ne déclenche aucun `channelDelete` : ses lignes `ChannelPartner`/`ChannelPartnerService`/`ChannelPartnerRank` restent (identifiants de salon, pas de donnée personnelle) et chaque relais vers lui échoue ; le rattrapage de blueGenjiBot#33 ne couvre que les serveurs quittés — piste : au démarrage, retirer par `Bdd.deleteChannel` les salons partenaires d'un serveur rejoint que `guild.channels.cache` ne connaît plus — (rencontré sur : feature/privacy-decisions)
