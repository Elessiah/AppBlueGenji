# Multi-phases — `rankEliminationPhase` range des équipes absentes de la phase

Détail de l'entrée de `ERREUR.txt` qui renvoie ici. Retirer ce fichier avec l'entrée.

## Constat

`rankEliminationPhase` (`lib/server/tournaments/finalization.ts`) classe le reste du tableau (hors podium) à partir de **toutes les inscriptions du tournoi** (`FROM bg_tournament_registrations r WHERE r.tournament_id = ?`). Seuls les matchs sont filtrés sur la phase (`m.phase_id = ?`). Dans une phase `SINGLE` / `DOUBLE` qui n'est pas la première d'un tournoi `MULTI`, une équipe éliminée à une phase antérieure figure donc dans le classement avec 0 victoire et 0 défaite. Le tri par défaites croissantes la place **devant** les équipes de la phase sorties sur 0 V – 1 D.

`rankPhaseStandings` (`lib/server/tournaments/phases.ts`) reprend cette liste telle quelle (`phaseFinalRanking`) et calcule `qualified` **par index** (`index < qualifiersCount`), puis le rang par `eliminationRanks`.

Ce comportement est antérieur à la PR #368, qui a seulement remplacé le départage par l'heure de saisie (`updated_at`). L'ancien `ORDER BY wins DESC, losses ASC, …` plaçait déjà ces équipes au même endroit.

## À confirmer

- **Rangs** : les rangs de phase d'équipes réellement engagées sont-ils décalés par les non-participantes ?
- **Qualification** : une non-participante peut-elle prendre une place de qualifiée quand la cible dépasse le nombre de survivantes du tableau tronqué ?
- **Classement final** : la finalisation `MULTI` (`finalizeMultiTournament`) réécrit-elle ces rangs dans `final_rank` ?

## Piste

Pour `phaseId > 0`, restreindre la requête aux équipes de la phase (`JOIN bg_tournament_phase_teams pt ON pt.phase_id = ? AND pt.team_id = r.team_id` au lieu du `LEFT JOIN` actuel, qui ne sert qu'au seed). Le faire avec un test sur un tournoi `MULTI` à au moins deux phases à élimination.
