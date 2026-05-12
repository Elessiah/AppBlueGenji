import { publishTournamentEvent } from "@/lib/server/live";
import { sendBotLog } from "@/lib/server/bot-integration";

export function notifyTournamentUpdated(tournamentId: number): void {
  publishTournamentEvent({
    type: "updated",
    tournamentId,
    emittedAt: new Date().toISOString(),
  });
}

export function notifyScoreReported(tournamentId: number, matchId: number): void {
  publishTournamentEvent({
    type: "score_reported",
    tournamentId,
    matchId,
    emittedAt: new Date().toISOString(),
  });
}

export function notifyScoreResolved(tournamentId: number, matchId: number): void {
  publishTournamentEvent({
    type: "score_resolved",
    tournamentId,
    matchId,
    emittedAt: new Date().toISOString(),
  });
}

export async function logScoreConflict(
  tournamentName: string,
  matchId: number,
  team1Name: string,
  team2Name: string,
): Promise<void> {
  const message = `[Score conflict] Tournoi "${tournamentName}" - Match #${matchId} : ${team1Name} vs ${team2Name}. Validation admin requise.`;
  void sendBotLog(message); // fire-and-forget
}
