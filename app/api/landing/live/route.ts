import type { RowDataPacket } from "mysql2/promise";
import { getDatabase } from "@/lib/server/database";
import { fail, ok } from "@/lib/server/http";
import { getSubscribersCount } from "@/lib/server/live";
import { listTournamentBuckets } from "@/lib/server/tournaments-service";
import type { BracketType, TournamentCard } from "@/lib/shared/types";

export const dynamic = "force-dynamic";

type LiveMatchRow = RowDataPacket & {
  id: number;
  bracket: BracketType;
  round_number: number;
  match_number: number;
  status: "READY" | "AWAITING_CONFIRMATION" | "COMPLETED" | "PENDING";
  team1_name: string | null;
  team2_name: string | null;
  team1_score: number | null;
  team2_score: number | null;
};

type LiveMatchPayload = {
  id: number;
  team1Name: string | null;
  team2Name: string | null;
  team1Score: number | null;
  team2Score: number | null;
  bracket: BracketType;
  roundLabel: string;
};

type LivePayload = {
  tournament: TournamentCard;
  currentMatch: LiveMatchPayload | null;
  viewers: number;
};

function roundLabelFor(bracket: BracketType, roundNumber: number, matchCount: number): string {
  if ((bracket === "UPPER" || bracket === "GRAND") && matchCount === 1) {
    return "Finale";
  }

  if (matchCount === 2) {
    return "Demi-finale";
  }

  if (matchCount === 4) {
    return "Quarts de finale";
  }

  return `Round ${roundNumber}`;
}

export async function GET() {
  try {
    const buckets = await listTournamentBuckets(null);
    const tournament = buckets.running[0] ?? null;

    if (!tournament) {
      return ok({ live: null });
    }

    const db = await getDatabase();
    const [rows] = await db.execute<LiveMatchRow[]>(
      `SELECT
        m.id,
        m.bracket,
        m.round_number,
        m.match_number,
        m.status,
        t1.name AS team1_name,
        t2.name AS team2_name,
        m.team1_score,
        m.team2_score
       FROM bg_matches m
       LEFT JOIN bg_teams t1 ON t1.id = m.team1_id
       LEFT JOIN bg_teams t2 ON t2.id = m.team2_id
       WHERE m.tournament_id = ?
       ORDER BY FIELD(m.bracket, 'UPPER', 'LOWER', 'GRAND', 'THIRD_PLACE') ASC,
                m.round_number ASC,
                m.match_number ASC`,
      [tournament.id],
    );

    const currentRow = rows.find((row) => row.status === "READY" || row.status === "AWAITING_CONFIRMATION") ?? null;
    const currentMatch = currentRow
      ? {
          id: Number(currentRow.id),
          team1Name: currentRow.team1_name,
          team2Name: currentRow.team2_name,
          team1Score: currentRow.team1_score === null ? null : Number(currentRow.team1_score),
          team2Score: currentRow.team2_score === null ? null : Number(currentRow.team2_score),
          bracket: currentRow.bracket,
          roundLabel: roundLabelFor(
            currentRow.bracket,
            Number(currentRow.round_number),
            rows.filter((row) => row.bracket === currentRow.bracket).length,
          ),
        }
      : null;

    const live: LivePayload = {
      tournament,
      currentMatch,
      viewers: getSubscribersCount(tournament.id),
    };

    return ok({ live });
  } catch (error) {
    const message = error instanceof Error ? error.message : "LANDING_LIVE_FAILED";
    return fail(message || "LANDING_LIVE_FAILED", 500);
  }
}
