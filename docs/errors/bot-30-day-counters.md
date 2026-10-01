# Compteurs « 30 jours » du bot sur des tables purgées à 7 jours

Détail de l'entrée de `ERREUR.txt` qui renvoie ici. Retirer ce fichier avec l'entrée.

## Entrée d'origine

[2026-09-30] blueGenjiBot/src/internalApi.ts (`/internal/stats` : `messagesLast30Days`, `uniqueUsersLast30Days` ; `/internal/kpis` : fenêtre de comparaison 30–60 jours ; `/internal/servers` : relais sur 30 jours) — les compteurs tirés de `OGMsg`/`DPMsg` sont annoncés sur 30 jours (ou comparés à la période 30–60 jours) alors que ces tables sont purgées à 7 jours (`MESSAGE_RETENTION_DAYS`) : ils ne couvrent que 7 jours, la tendance des KPI est toujours nulle, et le site les relit (`lib/shared/types.ts`, `lib/server/bot-integration.ts`) — même défaut que celui corrigé dans `/stats` par blueGenjiBot#33, laissé parce que c'est un contrat entre les deux dépôts — piste : fenêtres à 7 jours des deux côtés (ou fenêtre exposée dans la réponse) — (rencontré sur : feature/privacy-decisions)
