# Salon de journal du staff sans purge

Détail de l'entrée de `ERREUR.txt` qui renvoie ici. Retirer ce fichier avec l'entrée.

## Entrée d'origine

[2026-09-30] blueGenjiBot/src/safe/sendLog.ts + src/commandsHandlers/ban/ban.ts — **audit juridique · lot bot · décision requise** — aucune purge du salon de journal privé du staff (avis d'exclusion, motifs libres pouvant citer un pseudo, erreurs, journal du site), et le motif d'une exclusion part aussi en message privé à `OWNER_ID` (`sendLog` avec `idMsg`), où il reste même après `/unban` (art. 5.1.e RGPD) ; les textes le disent (« aucune suppression automatique à ce jour ») — piste : durée de conservation du salon (suppression des messages de plus de N jours par le bot), et suppression des deux messages de l'exclusion à la levée — (rencontré sur : feature/privacy-decisions)
