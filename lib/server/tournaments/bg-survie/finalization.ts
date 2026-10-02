/**
 * BlueGenji Survie — classement final et clôture du tournoi (`docs/features/BG_SURVIE_MODE.md`).
 */

import type { PoolConnection } from "mysql2/promise";
import { assignRanks, type EnduranceStanding } from "@/lib/shared/bg-survie/standings";
import { appendSequentialRanks, podiumRanks } from "@/lib/shared/double-forfeit";
import { finishTournament } from "../repository";

/** Classement final : podium issu des play-offs, puis ordre d'élimination. */
export async function finalizeEndurance(
  conn: PoolConnection,
  tournamentId: number,
  standings: EnduranceStanding[],
  finalMatches: {
    bracket: string;
    teamAId: number | null;
    teamBId: number | null;
    winnerTeamId: number | null;
    loserTeamId: number | null;
    doubleForfeit: boolean;
  }[] = [],
): Promise<void> {
  const toPodium = (match: (typeof finalMatches)[number] | undefined) =>
    match && {
      team1Id: match.teamAId,
      team2Id: match.teamBId,
      winnerTeamId: match.winnerTeamId,
      loserTeamId: match.loserTeamId,
      doubleForfeit: match.doubleForfeit,
    };

  // Une finale ou une petite finale close sur un double forfait laisse sa
  // première place vacante et range ses deux engagées ex æquo à la seconde :
  // la règle est celle des tableaux à élimination (`podiumRanks`).
  // Une finale ou une petite finale d'exemption n'existe dans cet arbre que
  // par un double forfait (le tirage n'en produit aucune au dernier tour) : sa
  // seconde place est donc toujours vacante.
  const podium = podiumRanks(
    [
      toPodium(finalMatches.find((match) => match.bracket !== "THIRD_PLACE")),
      toPodium(finalMatches.find((match) => match.bracket === "THIRD_PLACE")),
    ],
    { byeLeavesVacancy: true },
  );

  const ranks = appendSequentialRanks(
    podium,
    assignRanks(standings).map((standing) => standing.teamId),
  );

  for (const { teamId, rank } of ranks) {
    await conn.execute(
      `UPDATE bg_tournament_registrations SET final_rank = ? WHERE tournament_id = ? AND team_id = ?`,
      [rank, tournamentId, teamId],
    );
  }

  await finishTournament(conn, tournamentId);
}
