/**
 * Têtes de série d'un match pour la règle de l'hôte (`matchHostTeamId`,
 * `docs/features/MATCH_REFEREE.md`) : en **BlueGenji Survie, phase finale**
 * (tours numérotés à partir de `PLAYOFF_ROUND_OFFSET`), la meilleure tête de
 * série — rang du classement d'endurance — héberge, l'autre bannit la
 * première. Ailleurs, aucune ligne ne correspond : les deux rangs sont `NULL`.
 *
 * Jointures partagées par l'instantané (`repository.ts`) et la modale de
 * lancement (`match-launch-info.ts`), pour qu'ils ne divergent jamais. Elles
 * exposent `es1.rank` et `es2.rank`.
 */
import { PLAYOFF_ROUND_OFFSET } from "@/lib/shared/bg-survie/rounds";

/** Jointures du rang d'endurance des deux engagées du match d'alias `alias`. */
export function seedJoins(alias: string): string {
  return `LEFT JOIN bg_endurance_standings es1
       ON es1.tournament_id = ${alias}.tournament_id AND es1.team_id = ${alias}.team1_id
      AND ${alias}.round_number >= ${PLAYOFF_ROUND_OFFSET}
     LEFT JOIN bg_endurance_standings es2
       ON es2.tournament_id = ${alias}.tournament_id AND es2.team_id = ${alias}.team2_id
      AND ${alias}.round_number >= ${PLAYOFF_ROUND_OFFSET}`;
}
