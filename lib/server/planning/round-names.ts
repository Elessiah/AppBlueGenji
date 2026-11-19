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
 * Le tour de chacun des matchs `matchIds`, par identifiant de match : une
 * requête lit tous les matchs des tournois (avec leur format et leur état),
 * une seconde les phases des seuls tournois `MULTI`. Vide sans match demandé —
 * aucune requête.
 */
export async function loadEntryRounds(
  executor: Executor,
  tournamentIds: readonly number[],
  matchIds: ReadonlySet<number>,
): Promise<Map<number, EntryRound>> {
  const result = new Map<number, EntryRound>();
  const ids = [...new Set(tournamentIds)];
  if (ids.length === 0 || matchIds.size === 0) return result;
  const [matches] = await executor.execute<MatchRow[]>(
    `SELECT m.id, m.tournament_id, m.phase_id, m.bracket, m.round_number, m.match_number, m.status, m.double_forfeit,
            t.format, t.state
       FROM bg_matches m JOIN bg_tournaments t ON t.id = m.tournament_id
      WHERE m.tournament_id IN (${inList(ids.length)})`,
    ids,
  );
  const matchesOf = groupBy(matches, (row) => Number(row.tournament_id));
  const multiIds = [...matchesOf.entries()].filter(([, rows]) => rows[0].format === "MULTI").map(([id]) => id);
  const phasesOf = new Map<number, PhaseRow[]>();
  if (multiIds.length > 0) {
    const [phases] = await executor.execute<PhaseRow[]>(
      `SELECT id, tournament_id, format FROM bg_tournament_phases WHERE tournament_id IN (${inList(multiIds.length)})`,
      multiIds,
    );
    for (const [id, rows] of groupBy(phases, (row) => Number(row.tournament_id))) phasesOf.set(id, rows);
  }
  for (const [tournamentId, own] of matchesOf) {
    const { format, state } = own[0];
    const numbers = new Map<number, number>();
    const source: ShareRoundSource = {
      card: { format, state },
      phases:
        format === "MULTI"
          ? (phasesOf.get(tournamentId) ?? []).map((phase) => ({ id: Number(phase.id), format: phase.format }))
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
