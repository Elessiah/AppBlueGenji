/**
 * Qui **joue** pendant une entrée du planning (`docs/features/CAST_PLANNING.md`
 * § Refus) : les joueurs d'un match (membres actifs des deux engagées, ou
 * l'engagé solo), ceux de tout un tournoi pour l'entrée d'un tournoi entier
 * (ses engagées, une soirée de matchs enchaînés). Un joueur ne couvre ni
 * l'entrée où il joue, ni une entrée qui la **chevauche**. En deux lectures,
 * quel que soit le nombre d'entrées.
 */
import type { RowDataPacket } from "mysql2/promise";
import { loadTeamPlayers } from "@/lib/server/tournaments/match-players";
import { slotsOverlap } from "@/lib/shared/planning-planner";
import { inList, type Executor, type LoadedEntry } from "./load";

type RegistrationRow = RowDataPacket & { tournament_id: number; team_id: number };

/** Engagées de chaque entrée : les deux d'un match, toutes celles d'un tournoi entier. */
async function entryTeams(executor: Executor, entries: readonly LoadedEntry[]): Promise<Map<string, number[]>> {
  const teams = new Map<string, number[]>();
  const events = entries.filter((entry) => entry.kind === "TOURNAMENT");
  const registered = new Map<number, number[]>();
  if (events.length > 0) {
    const ids = [...new Set(events.map((entry) => entry.tournamentId))];
    const [rows] = await executor.execute<RegistrationRow[]>(
      `SELECT tournament_id, team_id FROM bg_tournament_registrations WHERE tournament_id IN (${inList(ids.length)})`,
      ids,
    );
    for (const row of rows) {
      const id = Number(row.tournament_id);
      registered.set(id, [...(registered.get(id) ?? []), Number(row.team_id)]);
    }
  }
  for (const entry of entries) {
    if (entry.kind === "TOURNAMENT") teams.set(entry.key, registered.get(entry.tournamentId) ?? []);
    else teams.set(entry.key, [entry.team1?.teamId, entry.team2?.teamId].filter((id): id is number => id != null));
  }
  return teams;
}

/** Joueurs de chaque entrée (`entryKey` → comptes). */
export async function loadEntryPlayers(
  executor: Executor,
  entries: readonly LoadedEntry[],
): Promise<Map<string, Set<number>>> {
  const teams = await entryTeams(executor, entries);
  const players = await loadTeamPlayers(executor, [...teams.values()].flat());
  const out = new Map<string, Set<number>>();
  for (const [key, ids] of teams) out.set(key, new Set(ids.flatMap((id) => [...(players.get(id) ?? [])])));
  return out;
}

/**
 * Comptes qui jouent pendant `target` : ses joueurs, et ceux de toute entrée
 * de `entries` qui la chevauche.
 */
export function playersDuring(
  target: LoadedEntry,
  entries: readonly LoadedEntry[],
  players: ReadonlyMap<string, ReadonlySet<number>>,
): Set<number> {
  const out = new Set<number>();
  for (const entry of entries) {
    if (entry.key !== target.key && !slotsOverlap(entry, target)) continue;
    for (const userId of players.get(entry.key) ?? []) out.add(userId);
  }
  return out;
}
