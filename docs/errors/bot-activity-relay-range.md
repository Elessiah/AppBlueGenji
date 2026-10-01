# Courbe d'activité du bot : relais lus au-delà de leur purge

Détail de l'entrée de `ERREUR.txt` qui renvoie ici. Retirer ce fichier avec l'entrée.

## Entrée d'origine

[2026-10-01] blueGenjiBot/src/internalApi.ts (`/internal/activity`, plages `30j` et `90j`) — la série `relays` et `avgPerDay` sont tirées de `DPMsg`, purgée à `MESSAGE_RETENTION_DAYS` (7 jours) : sur 30 ou 90 jours, tout ce qui précède la dernière semaine vaut zéro, et la moyenne par jour est divisée par 30 ou 90 alors qu'elle ne couvre que sept jours. Les scrims, eux, sont repliés en compteurs journaliers (`ActivityDaily`) avant leur anonymisation et restent justes. Laissé hors de la correction des compteurs `/internal/stats`, `/internal/kpis` et `/internal/servers` (alignés sur 7 jours) parce que la courbe de `/bot` (`components/bot/BotActivityChart.tsx`) offre précisément ces plages — piste : replier les relais en compteurs journaliers comme les scrims (aucune donnée personnelle), ou borner la série des relais à 7 jours et le dire sous le graphe — (rencontré sur : feature/bot-stats-7day-windows)
