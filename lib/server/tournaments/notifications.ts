/**
 * Publication des événements de tournoi.
 *
 * Point de passage unique de « quelque chose a changé sur ce tournoi ». Il tient
 * donc deux rôles : réveiller les abonnés du flux SSE, et **invalider les
 * caches de lecture** — l'instantané partagé du tournoi et la liste publique.
 * Les deux vont ensemble : c'est parce que toute écriture passe ici que les
 * caches peuvent se permettre des durées de vie confortables sans jamais
 * afficher un score périmé.
 */
import { publishTournamentEvent } from "@/lib/server/live";
import { sendBotLog } from "@/lib/server/bot-integration";
import { invalidateTournamentLists } from "./list-cache";
import { invalidateTournamentSnapshot } from "./snapshot";

/** Oublie tout ce qui est mis en cache à propos de ce tournoi. */
function invalidateCaches(tournamentId: number): void {
  invalidateTournamentSnapshot(tournamentId);
  invalidateTournamentLists();
}

export function publishUpdatedEvent(tournamentId: number): void {
  invalidateCaches(tournamentId);
  publishTournamentEvent({
    type: "updated",
    tournamentId,
    emittedAt: new Date().toISOString(),
  });
}

export function publishScoreReportedEvent(tournamentId: number, matchId: number): void {
  invalidateCaches(tournamentId);
  publishTournamentEvent({
    type: "score_reported",
    tournamentId,
    matchId,
    emittedAt: new Date().toISOString(),
  });
}

export function publishScoreResolvedEvent(tournamentId: number, matchId: number): void {
  invalidateCaches(tournamentId);
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
