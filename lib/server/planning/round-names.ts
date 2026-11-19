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

/** Une entrée à nommer : un match et son tournoi. */
export type RoundRequest = Readonly<{ tournamentId: number; matchId: number }>;

/**
 * Mémoire courte des tours d'un tournoi (tous ses matchs) : la page se relit à
 * chaque rafraîchissement de chaque lecteur, et l'arbre d'un tournoi ne change
 * qu'à un tirage ou à un forfait. Un nom de tour peut donc retarder de
 * {@link ROUND_CACHE_TTL_MS} sur un bracket qui change ; un match absent de la
 * mémoire (tirage tout juste fait) relit son tournoi aussitôt.
 */
export const ROUND_CACHE_TTL_MS = 10_000;
export const ROUND_CACHE_MAX_TOURNAMENTS = 64;
const roundCache = new Map<number, { at: number; rounds: Map<number, EntryRound> }>();

/** Vide la mémoire (tests). */
export function clearEntryRoundCache(): void {
  roundCache.clear();
}

function remember(tournamentId: number, rounds: Map<number, EntryRound>, now: number): void {
  roundCache.delete(tournamentId);
  roundCache.set(tournamentId, { at: now, rounds });
  while (roundCache.size > ROUND_CACHE_MAX_TOURNAMENTS) {
    const oldest = roundCache.keys().next();
    if (oldest.done) break;
    roundCache.delete(oldest.value);
  }
}

/** Les tours de tous les matchs d'un tournoi, depuis ses lignes (et ses phases, s'il est `MULTI`). */
function tournamentRounds(own: readonly MatchRow[], phases: readonly PhaseRow[]): Map<number, EntryRound> {
  const { format, state } = own[0];
  const numbers = new Map<number, number>();
  const source: ShareRoundSource = {
    card: { format, state },
    phases: format === "MULTI" ? phases.map((phase) => ({ id: Number(phase.id), format: phase.format })) : null,
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
  const all = new Map<number, EntryRound>();
  for (const [id, matchNumber] of numbers) all.set(id, { round: rounds.get(id) ?? null, matchNumber });
  return all;
}

/** Une requête pour les matchs des tournois, une seconde pour les phases des seuls `MULTI`. */
async function readTournaments(executor: Executor, ids: readonly number[]): Promise<Map<number, Map<number, EntryRound>>> {
  const [matches] = await executor.execute<MatchRow[]>(
    `SELECT m.id, m.tournament_id, m.phase_id, m.bracket, m.round_number, m.match_number, m.status, m.double_forfeit,
            t.format, t.state
       FROM bg_matches m JOIN bg_tournaments t ON t.id = m.tournament_id
      WHERE m.tournament_id IN (${inList(ids.length)})`,
    [...ids],
  );
  const matchesOf = groupBy(matches, (row) => Number(row.tournament_id));
  const multiIds = [...matchesOf.entries()].filter(([, rows]) => rows[0].format === "MULTI").map(([id]) => id);
  let phasesOf = new Map<number, PhaseRow[]>();
  if (multiIds.length > 0) {
    const [phases] = await executor.execute<PhaseRow[]>(
      `SELECT id, tournament_id, format FROM bg_tournament_phases WHERE tournament_id IN (${inList(multiIds.length)})`,
      multiIds,
    );
    phasesOf = groupBy(phases, (row) => Number(row.tournament_id));
  }
  return new Map([...matchesOf].map(([id, own]) => [id, tournamentRounds(own, phasesOf.get(id) ?? [])]));
}

/** Les matchs demandés par tournoi. */
function groupRequests(requests: readonly RoundRequest[]): Map<number, number[]> {
  const wanted = new Map<number, number[]>();
  for (const { tournamentId, matchId } of requests) {
    const list = wanted.get(tournamentId);
    if (list) list.push(matchId);
    else wanted.set(tournamentId, [matchId]);
  }
  return wanted;
}

/** La mémoire courte rend-elle tous les matchs demandés de ce tournoi ? */
function freshRounds(tournamentId: number, matchIds: readonly number[], now: number): Map<number, EntryRound> | null {
  const cached = roundCache.get(tournamentId);
  if (!cached || now - cached.at >= ROUND_CACHE_TTL_MS) return null;
  return matchIds.every((id) => cached.rounds.has(id)) ? cached.rounds : null;
}

/**
 * Le tour de chacun des matchs demandés, par identifiant de match : une
 * requête lit tous les matchs des tournois (avec leur format et leur état),
 * une seconde les phases des seuls tournois `MULTI` — pour les seuls tournois
 * absents de la mémoire courte. Vide sans match demandé — aucune requête.
 */
export async function loadEntryRounds(
  executor: Executor,
  requests: readonly RoundRequest[],
  now: number = Date.now(),
): Promise<Map<number, EntryRound>> {
  const result = new Map<number, EntryRound>();
  const wanted = groupRequests(requests);
  const stale: number[] = [];
  for (const [tournamentId, matchIds] of wanted) {
    const rounds = freshRounds(tournamentId, matchIds, now);
    if (rounds === null) stale.push(tournamentId);
    else for (const id of matchIds) result.set(id, rounds.get(id) as EntryRound);
  }
  if (stale.length === 0) return result;
  for (const [tournamentId, rounds] of await readTournaments(executor, stale)) {
    remember(tournamentId, rounds, now);
    for (const id of wanted.get(tournamentId) ?? []) {
      const found = rounds.get(id);
      if (found) result.set(id, found);
    }
  }
  return result;
}
