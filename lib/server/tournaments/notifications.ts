import { publishTournamentEvent } from "@/lib/server/live";
import { sendBotLog } from "@/lib/server/bot-integration";

export function publishUpdatedEvent(tournamentId: number): void {
  publishTournamentEvent({
    type: "updated",
    tournamentId,
    emittedAt: new Date().toISOString(),
  });
}

export function publishScoreReportedEvent(tournamentId: number, matchId: number): void {
  publishTournamentEvent({
    type: "score_reported",
    tournamentId,
    matchId,
    emittedAt: new Date().toISOString(),
  });
}

export function publishScoreResolvedEvent(tournamentId: number, matchId: number): void {
  publishTournamentEvent({
    type: "score_resolved",
    tournamentId,
    matchId,
    emittedAt: new Date().toISOString(),
  });
}

export async function sendBotLogAsync(message: string): Promise<void> {
  void sendBotLog(message);
}
