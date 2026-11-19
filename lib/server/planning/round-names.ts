/**
 * Nom du tour des matchs du planning (`docs/features/CAST_PLANNING.md`) : le
 * même que la fiche du tournoi et les aperçus partagés (`buildShareRounds`,
 * « Quart de finale », « Finale », « Ronde 3 »), jamais le numéro brut du
 * moteur (« Manche 1000 » dans l'arbre final de BlueGenji Survie).
 *
 * Un tour se nomme depuis le dernier de son tableau : il faut donc **tous** les
 * matchs du tournoi, pas seulement ceux de la fenêtre du planning.
 */
import type { RowDataPacket } from "mysql2/promise";
import type { PhaseFormat } from "@/lib/shared/types";
import { buildShareRounds, type ShareRound, type ShareRoundSource } from "@/lib/shared/share-round";
import type { Executor } from "./load";
import { inList } from "./load";

/** Le nom (sans texte) du tour d'un match, et son numéro dans le tour. */
export type EntryRound = { round: ShareRound | null; matchNumber: number };

type MatchRow = RowDataPacket & {
  id: number;
  tournament_id: number;
  phase_id: number;
  bracket: ShareRoundSource["matches"][number]["bracket"];
  round_number: number;
  match_number: number;
  status: ShareRoundSource["matches"][number]["status"];
  double_forfeit: number;
};

type TournamentRow = RowDataPacket & {
  id: number;
  format: ShareRoundSource["card"]["format"];
  state: ShareRoundSource["card"]["state"];
};

type PhaseRow = RowDataPacket & { id: number; tournament_id: number; format: PhaseFormat };

function groupBy<T>(rows: readonly T[], keyOf: (row: T) => number): Map<number, T[]> {
  const groups = new Map<number, T[]>();
  for (const row of rows) {
    const key = keyOf(row);
    const group = groups.get(key);
    if (group) group.push(row);
    else groups.set(key, [row]);
  }
  return groups;
}

/**
 * Le tour de chacun des matchs `matchIds`, par identifiant de match : un
 * tournoi se lit une fois (son format, ses phases, tous ses matchs). Vide
 * sans match demandé — aucune requête.
 */
export async function loadEntryRounds(
  executor: Executor,
  tournamentIds: readonly number[],
  matchIds: ReadonlySet<number>,
): Promise<Map<number, EntryRound>> {
  const result = new Map<number, EntryRound>();
  const ids = [...new Set(tournamentIds)];
  if (ids.length === 0 || matchIds.size === 0) return result;
  const placeholders = inList(ids.length);
  const [tournaments] = await executor.execute<TournamentRow[]>(
    `SELECT id, format, state FROM bg_tournaments WHERE id IN (${placeholders})`,
    ids,
  );
  const [phases] = await executor.execute<PhaseRow[]>(
    `SELECT id, tournament_id, format FROM bg_tournament_phases WHERE tournament_id IN (${placeholders})`,
    ids,
  );
  const [matches] = await executor.execute<MatchRow[]>(
    `SELECT id, tournament_id, phase_id, bracket, round_number, match_number, status, double_forfeit
       FROM bg_matches WHERE tournament_id IN (${placeholders})`,
    ids,
  );
  const phasesOf = groupBy(phases, (row) => Number(row.tournament_id));
  const matchesOf = groupBy(matches, (row) => Number(row.tournament_id));
  for (const tournament of tournaments) {
    const own = matchesOf.get(Number(tournament.id)) ?? [];
    const numbers = new Map<number, number>();
    const source: ShareRoundSource = {
      card: { format: tournament.format, state: tournament.state },
      phases:
        tournament.format === "MULTI"
          ? (phasesOf.get(Number(tournament.id)) ?? []).map((phase) => ({ id: Number(phase.id), format: phase.format }))
          : null,
      matches: own.map((row) => {
        numbers.set(Number(row.id), Number(row.match_number));
        return {
          id: Number(row.id),
          phaseId: Number(row.phase_id),
          bracket: row.bracket,
          roundNumber: Number(row.round_number),
          matchNumber: Number(row.match_number),
          status: row.status,
          doubleForfeit: Number(row.double_forfeit) === 1,
        };
      }),
    };
    const rounds = buildShareRounds(source);
    for (const [id, matchNumber] of numbers) {
      if (matchIds.has(id)) result.set(id, { round: rounds.get(id) ?? null, matchNumber });
    }
  }
  return result;
}
