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
    const isStarting = tournament.state === "REGISTRATION" && computed === "RUNNING";

    const isSwissStart = isStarting && tournament.format === "SWISS";
    if (isSwissStart) {
      const { initializeSwissTournament, generateSwissRound } = await import("./swiss");
      await initializeSwissTournament(tournamentId, connection);
      await generateSwissRound(tournamentId, connection);
    }

    const isSurvivalStart = isStarting && tournament.format === "SURVIVAL";
    if (isSurvivalStart) {
      const { initializeSurvivalTournament, generateSurvivalRound } = await import("./survival");
      await initializeSurvivalTournament(tournamentId, connection);
      await generateSurvivalRound(tournamentId, connection);
    }

    const isMultiStart =
      tournament.state === "REGISTRATION" && computed === "RUNNING" && tournament.format === "MULTI";
    if (isMultiStart) {
      const { initializeMultiTournament } = await import("./phases");
      await initializeMultiTournament(tournamentId, connection);
    }

    await updateTournamentState(connection, tournamentId, computed);
    tournament.state = computed;
    stateChanged = true;

    // Après passage en RUNNING : clôture immédiate si départ à ≤ 1 équipe.
    if (isSurvivalStart) {
      const { reconcileSurvival } = await import("./survival");
      await reconcileSurvival(tournamentId, connection);
    }
    if (isSwissStart) {
      const { reconcileSwiss } = await import("./swiss");
      await reconcileSwiss(tournamentId, connection);
    }

    if (isMultiStart) {
      const { reconcilePhases } = await import("./phases");
      await reconcilePhases(tournamentId, connection);
    }
  }

  return { row: tournament, stateChanged };
}

export async function hasPendingStateTransition(row: TournamentRow): Promise<boolean> {
  const currentState = computeTournamentState(row);
  return currentState !== row.state;
}
