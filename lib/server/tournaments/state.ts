import type { PoolConnection } from "mysql2/promise";
import type { TournamentState } from "@/lib/shared/types";
import { TournamentRow } from "./_internal";
import {
  loadTournamentRow,
  updateTournamentState,
} from "./repository";

export function computeTournamentState(
  row: Pick<
    TournamentRow,
    "state" | "finished_at" | "registration_open_at" | "registration_close_at" | "start_at"
  >,
): TournamentState {
  if (row.state === "FINISHED" || row.finished_at) {
    return "FINISHED";
  }

  const now = Date.now();
  const openAt = new Date(row.registration_open_at).getTime();
  const closeAt = new Date(row.registration_close_at).getTime();
  const startAt = new Date(row.start_at).getTime();

  if (now < openAt) return "UPCOMING";
  if (now >= openAt && now <= closeAt) return "REGISTRATION";
  if (now >= startAt) return "RUNNING";
  return "UPCOMING";
}

export async function syncTournamentState(
  connection: PoolConnection,
  tournamentId: number,
): Promise<{ row: TournamentRow | null; stateChanged: boolean }> {
  const tournament = await loadTournamentRow(connection, tournamentId);
  if (!tournament) return { row: null, stateChanged: false };

  const computed = computeTournamentState(tournament);
  let stateChanged = false;

  if (computed !== tournament.state) {
    await updateTournamentState(connection, tournamentId, computed);
    tournament.state = computed;
    stateChanged = true;
  }

  return { row: tournament, stateChanged };
}

export async function hasPendingStateTransition(row: TournamentRow): Promise<boolean> {
  const currentState = computeTournamentState(row);
  return currentState !== row.state;
}
