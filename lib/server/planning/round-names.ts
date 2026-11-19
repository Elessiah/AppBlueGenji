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
import { buildShareRounds, groupBy, type ShareRound, type ShareRoundSource } from "@/lib/shared/share-round";
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

/**
 * Une entrée à nommer : un match, son tournoi, et si ce tournoi est terminé
 * (lu par le planning à la même requête) — un tournoi qui vient de se terminer
 * relit ses tours aussitôt (« Finale » d'un arbre clos).
 */
export type RoundRequest = Readonly<{ tournamentId: number; matchId: number; finished: boolean }>;

/**
 * Mémoire courte des tours d'un tournoi (tous ses matchs) : la page se relit à
 * chaque rafraîchissement de chaque lecteur, et l'arbre d'un tournoi ne change
 * qu'à un tirage ou à un forfait. Un nom de tour peut donc retarder de
 * {@link ROUND_CACHE_TTL_MS} sur un bracket qui change en place ; un match
 * absent de la mémoire (tirage tout juste fait) ou un tournoi qui vient de se
 * terminer relit son tournoi aussitôt. Un tournoi terminé ne change plus : ses
 * tours se gardent {@link ROUND_CACHE_FINISHED_TTL_MS}. Les noms ne dépendent
 * d'aucun lecteur (la mémoire est commune) : chacun ne reçoit que ceux des
 * matchs que son planning lui rend déjà.
 */
export const ROUND_CACHE_TTL_MS = 10_000;
export const ROUND_CACHE_FINISHED_TTL_MS = 10 * 60_000;
export const ROUND_CACHE_MAX_TOURNAMENTS = 64;
type CachedRounds = { at: number; finished: boolean; rounds: Map<number, EntryRound> };
/** Ordre d'insertion = ordre d'usage : un tournoi relu ou servi repasse en queue (LRU). */
const roundCache = new Map<number, CachedRounds>();

/** Vide la mémoire (tests). */
export function clearEntryRoundCache(): void {
  roundCache.clear();
}

function remember(tournamentId: number, cached: CachedRounds): void {
  roundCache.delete(tournamentId);
  roundCache.set(tournamentId, cached);
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
async function readTournaments(executor: Executor, ids: readonly number[]): Promise<Map<number, Omit<CachedRounds, "at">>> {
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
  return new Map(
    [...matchesOf].map(([id, own]) => [id, { finished: own[0].state === "FINISHED", rounds: tournamentRounds(own, phasesOf.get(id) ?? []) }]),
  );
}

/**
 * La mémoire courte rend-elle tous les matchs demandés de ce tournoi, dans
 * l'état (terminé ou non) que le planning vient de lire ? Servie, l'entrée
 * repasse en queue de la mémoire.
 */
function freshRounds(tournamentId: number, own: readonly RoundRequest[], now: number): Map<number, EntryRound> | null {
  const cached = roundCache.get(tournamentId);
  if (!cached) return null;
  const finished = own.some((request) => request.finished);
  const ttl = cached.finished ? ROUND_CACHE_FINISHED_TTL_MS : ROUND_CACHE_TTL_MS;
  if (cached.finished !== finished || now - cached.at >= ttl) return null;
  if (!own.every((request) => cached.rounds.has(request.matchId))) return null;
  remember(tournamentId, cached);
  return cached.rounds;
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
  const wanted = groupBy(requests, (request) => request.tournamentId);
  const stale: number[] = [];
  for (const [tournamentId, own] of wanted) {
    const rounds = freshRounds(tournamentId, own, now);
    if (rounds === null) stale.push(tournamentId);
    else for (const { matchId } of own) result.set(matchId, rounds.get(matchId) as EntryRound);
  }
  if (stale.length === 0) return result;
  for (const [tournamentId, read] of await readTournaments(executor, stale)) {
    remember(tournamentId, { at: now, ...read });
    for (const { matchId } of wanted.get(tournamentId) ?? []) {
      const found = read.rounds.get(matchId);
      if (found) result.set(matchId, found);
    }
  }
  return result;
}
