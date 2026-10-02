# Multi-phases — classements stockés faux avant la correction de `savePhaseResults`

Détail de l'entrée de `ERREUR.txt` qui renvoie ici. Retirer ce fichier avec l'entrée.

## Constat

Jusqu'à la PR #364, `savePhaseResults` (`lib/server/tournaments/phases-repository.ts`) liait ses paramètres entrelacés (équipe, rang, équipe, qualifiée) alors que l'`UPDATE … CASE` place tous les `?` du rang avant ceux de la qualification. Dès qu'une phase comptait deux équipes ou plus :

- seule la première moitié des équipes recevait son rang (`bg_tournament_phase_teams.rank`), les autres le gardaient vide ;
- `qualified` était écrit pour la seconde moitié seulement, avec un **rang** en guise de booléen.

L'avancement d'une phase à l'autre lit le classement en mémoire et n'était pas touché. Mais ce qui est relu en base l'était :

- le tableau de classement d'une phase (`loadPhaseStandings` → `PhaseStandingsTable`) : ordre et badges « qualifiée » faux ;
- le `final_rank` d'un tournoi MULTI terminé : `finalizeMultiTournament` lit le rang de phase stocké et range à 999, ex æquo, les équipes sans rang.

La PR #364 corrige l'écriture : toute phase close **après** son déploiement est juste. Les phases closes **avant** gardent leurs lignes fausses, et rien ne les réécrit tant qu'aucun score de leur dernière phase n'est corrigé.

## Piste

Décision requise : recalculer ou non les tournois MULTI déjà terminés. Si oui, un script ponctuel (sur le modèle de `npm run backfill:avatars`) qui, pour chaque phase `FINISHED`, rejoue le classement (`rankPhaseStandings`) puis `savePhaseResults`, et enfin `finalizeMultiTournament` pour le tournoi ; à lancer en production avec `--dry-run` d'abord.
