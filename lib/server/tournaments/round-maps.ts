/**
 * Cartes par manche, choix dans un pool et règles de ban d'un tournoi
 * (`docs/features/ROUND_MAPS.md`). Règles pures : `lib/shared/round-maps.ts`.
 *
 * Toute écriture passe en transaction, publie l'événement qui relit
 * l'instantané (flux SSE et REST de secours portent `mapRules`) et laisse une
 * ligne au journal du staff, sans nommer personne.
 */
import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { withConnection } from "@/lib/server/database";
import { sendBotLog } from "@/lib/server/bot-integration";
import { formatMapRulesLog, formatRoundMapsLog } from "@/lib/shared/bot-logs";
import { matchRoundLabel } from "@/lib/shared/discord-notifications";
import {
  normalizeRoundMapSlots,
  parseFirstBanRule,
  parseNextBanRule,
  parseNextPickRule,
  parseMapPicks,
  parseStoredSlots,
  validateMapPick,
  FIRST_BAN_RULES,
  NEXT_BAN_RULES,
  NEXT_PICK_RULES,
  ROUND_BRACKETS,
  type FirstBanRule,
  type NextBanRule,
  type NextPickRule,
  type RoundKey,
  type RoundMapConfig,
  type TournamentMapRules,
} from "@/lib/shared/round-maps";
import { discardBotLogs, flushBotLogs } from "./bot-logs";
import { resolveMatchParty } from "./match-launch";
import { publishMatchUpdatedEvent } from "./notifications";
import { queueRefereeChange } from "./referee-notices";

/** Une manche : phase (0 sans phases), tableau, numéro (`lib/shared/round-maps.ts`). */
export type { RoundKey };

type RulesRow = RowDataPacket & {
  first_ban_rule: string | null;
  next_ban_rule: string | null;
  next_pick_rule: string | null;
};

type RoundMapsRow = RowDataPacket & {
  phase_id: number;
  bracket: string;
  round_number: number;
  slots_json: string | null;
};

/** Cartes et bans du tournoi, pour l'instantané. Deux lectures, quel que soit le plateau. */
export async function loadMapRules(connection: PoolConnection, tournamentId: number): Promise<TournamentMapRules> {
  const [rules] = await connection.execute<RulesRow[]>(
    `SELECT first_ban_rule, next_ban_rule, next_pick_rule FROM bg_tournaments WHERE id = ? LIMIT 1`,
    [tournamentId],
  );
  const [rows] = await connection.execute<RoundMapsRow[]>(
    `SELECT phase_id, bracket, round_number, slots_json FROM bg_tournament_round_maps
      WHERE tournament_id = ? ORDER BY phase_id, bracket, round_number`,
    [tournamentId],
  );
  const rounds: RoundMapConfig[] = [];
  for (const row of rows) {
    const slots = parseStoredSlots(row.slots_json);
    if (slots.length === 0) continue;
    rounds.push({
      phaseId: Number(row.phase_id),
      bracket: String(row.bracket),
      roundNumber: Number(row.round_number),
      slots,
    });
  }
  return {
    firstBan: parseFirstBanRule(rules[0]?.first_ban_rule),
    nextBan: parseNextBanRule(rules[0]?.next_ban_rule),
    nextPick: parseNextPickRule(rules[0]?.next_pick_rule),
    rounds,
  };
}

/** Les créneaux de la manche d'un match, vides sans réglage. */
export async function loadRoundSlots(connection: PoolConnection, tournamentId: number, round: RoundKey): Promise<string[][]> {
  const [rows] = await connection.execute<RoundMapsRow[]>(
    `SELECT phase_id, bracket, round_number, slots_json FROM bg_tournament_round_maps
      WHERE tournament_id = ? AND phase_id = ? AND bracket = ? AND round_number = ? LIMIT 1`,
    [tournamentId, round.phaseId, round.bracket, round.roundNumber],
  );
  return parseStoredSlots(rows[0]?.slots_json);
}

/** Manche lue d'un corps de requête. @throws `INVALID_ROUND` */
export function parseRoundKey(body: { phaseId?: unknown; roundNumber?: unknown; bracket?: unknown }): RoundKey {
  const { phaseId, roundNumber, bracket } = body;
  if (typeof phaseId !== "number" || !Number.isInteger(phaseId) || phaseId < 0) throw new Error("INVALID_ROUND");
  if (typeof roundNumber !== "number" || !Number.isInteger(roundNumber) || roundNumber < 1) {
    throw new Error("INVALID_ROUND");
  }
  if (typeof bracket !== "string" || !ROUND_BRACKETS.includes(bracket)) throw new Error("INVALID_ROUND");
  return { phaseId, bracket, roundNumber };
}

async function inTransaction<T>(run: (connection: PoolConnection) => Promise<T>): Promise<T> {
  return withConnection(async (connection) => {
    await connection.beginTransaction();
    try {
      const result = await run(connection);
      await connection.commit();
      flushBotLogs(connection);
      return result;
    } catch (error) {
      await connection.rollback().catch(() => undefined);
      discardBotLogs(connection);
      throw error;
    }
  });
}

type TournamentRow = RowDataPacket & { id: number; name: string; format: string };

async function lockTournament(connection: PoolConnection, tournamentId: number): Promise<TournamentRow> {
  const [rows] = await connection.execute<TournamentRow[]>(
    `SELECT id, name, format FROM bg_tournaments WHERE id = ? LIMIT 1 FOR UPDATE`,
    [tournamentId],
  );
  if (!rows[0]) throw new Error("TOURNAMENT_NOT_FOUND");
  return rows[0];
}

/**
 * Pose (ou retire, liste vide) les cartes d'une manche — à tout moment, avant,
 * pendant ou après la manche. Réservé à l'arbitrage (permission `tournaments`,
 * vérifiée par la route). Les choix déjà faits sur les matchs restent.
 *
 * @returns les créneaux retenus.
 * @throws `INVALID_ROUND_MAPS` | `TOURNAMENT_NOT_FOUND`
 */
export async function setRoundMaps(tournamentId: number, round: RoundKey, rawSlots: unknown): Promise<string[][]> {
  const slots = normalizeRoundMapSlots(rawSlots);
  const result = await inTransaction(async (connection) => {
    const tournament = await lockTournament(connection, tournamentId);
    const before = await loadRoundSlots(connection, tournamentId, round);
    if (JSON.stringify(before) === JSON.stringify(slots)) return null;
    if (slots.length === 0) {
      await connection.execute(
        `DELETE FROM bg_tournament_round_maps
          WHERE tournament_id = ? AND phase_id = ? AND bracket = ? AND round_number = ?`,
        [tournamentId, round.phaseId, round.bracket, round.roundNumber],
      );
    } else {
      await connection.execute(
        `INSERT INTO bg_tournament_round_maps (tournament_id, phase_id, bracket, round_number, slots_json)
         VALUES (?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE slots_json = VALUES(slots_json)`,
        [tournamentId, round.phaseId, round.bracket, round.roundNumber, JSON.stringify(slots)],
      );
    }
    return tournament;
  });
  if (result !== null) {
    publishMatchUpdatedEvent(tournamentId);
    void sendBotLog(
      formatRoundMapsLog({
        tournament: { id: Number(result.id), name: result.name },
        roundLabel: matchRoundLabel(round.bracket, round.roundNumber, result.format === "SWISS"),
        slots: slots.length,
        imposed: slots.filter((slot) => slot.length === 1).length,
      }),
    ).catch((error: unknown) => console.error("[round-maps] journal non envoyé", error));
  }
  return slots;
}

export type MapRulesInput = { firstBan: FirstBanRule; nextBan: NextBanRule; nextPick: NextPickRule };

/** Règles lues d'un corps de requête. @throws `INVALID_MAP_RULES` */
export function parseMapRulesInput(body: { firstBan?: unknown; nextBan?: unknown; nextPick?: unknown }): MapRulesInput {
  const { firstBan, nextBan, nextPick } = body;
  if (!FIRST_BAN_RULES.includes(firstBan as FirstBanRule)) throw new Error("INVALID_MAP_RULES");
  if (!NEXT_BAN_RULES.includes(nextBan as NextBanRule)) throw new Error("INVALID_MAP_RULES");
  if (!NEXT_PICK_RULES.includes(nextPick as NextPickRule)) throw new Error("INVALID_MAP_RULES");
  return { firstBan: firstBan as FirstBanRule, nextBan: nextBan as NextBanRule, nextPick: nextPick as NextPickRule };
}

/**
 * Règles de ban et de choix du tournoi, modifiables à tout moment par
 * l'arbitrage. @throws `TOURNAMENT_NOT_FOUND`
 */
export async function setTournamentMapRules(tournamentId: number, rules: MapRulesInput): Promise<void> {
  const tournament = await inTransaction(async (connection) => {
    const row = await lockTournament(connection, tournamentId);
    const [current] = await connection.execute<RulesRow[]>(
      `SELECT first_ban_rule, next_ban_rule, next_pick_rule FROM bg_tournaments WHERE id = ? LIMIT 1`,
      [tournamentId],
    );
    const before = current[0];
    if (
      parseFirstBanRule(before?.first_ban_rule) === rules.firstBan &&
      parseNextBanRule(before?.next_ban_rule) === rules.nextBan &&
      parseNextPickRule(before?.next_pick_rule) === rules.nextPick
    ) {
      return null;
    }
    await connection.execute(
      `UPDATE bg_tournaments SET first_ban_rule = ?, next_ban_rule = ?, next_pick_rule = ? WHERE id = ?`,
      [rules.firstBan, rules.nextBan, rules.nextPick, tournamentId],
    );
    return row;
  });
  if (tournament === null) return;
  publishMatchUpdatedEvent(tournamentId);
  void sendBotLog(formatMapRulesLog({ tournament: { id: Number(tournament.id), name: tournament.name } })).catch(
    (error: unknown) => console.error("[round-maps] journal non envoyé", error),
  );
}

const PICK_MATCH_SELECT = `SELECT tournament_id, status, phase_id, bracket, round_number, self_managed, team1_id, team2_id,
         first_map, map_picks
    FROM bg_matches WHERE id = ?`;

type PickMatchRow = RowDataPacket & {
  tournament_id: number;
  status: string;
  phase_id: number;
  bracket: string;
  round_number: number;
  self_managed: number;
  team1_id: number | null;
  team2_id: number | null;
  first_map: string | null;
  map_picks: string | null;
};

/**
 * Qui choisit : le staff qui ne joue pas le match, toujours ; sinon, sur un
 * match en autogestion, un joueur d'une des deux équipes qui peut déclarer
 * « Prêt ». Un membre du staff qui joue le match suit la règle des joueurs,
 * comme l'arbitrage (`REFEREE_IS_PLAYER`) : il ne choisit pas pour son équipe
 * hors autogestion.
 * @returns `true` quand le choix vient d'une équipe. @throws `NOT_MAP_PICKER`
 */
async function assertMapPicker(
  connection: PoolConnection,
  row: PickMatchRow,
  viewer: { userId: number; staff: boolean },
): Promise<boolean> {
  const selfManaged = Number(row.self_managed) === 1;
  const party =
    viewer.staff || selfManaged
      ? await resolveMatchParty(connection, { team1_id: row.team1_id, team2_id: row.team2_id, casters: [] }, viewer.userId)
      : null;
  const plays = party?.role === "TEAM1" || party?.role === "TEAM2";
  if (viewer.staff && !plays) return false;
  if (!selfManaged || !plays || !party?.canDeclareReady) throw new Error("NOT_MAP_PICKER");
  return true;
}

/** Écrit le choix (carte 1 : `first_map`, suivantes : `map_picks`) ; `false` s'il ne change rien. */
async function writeMapPick(
  connection: PoolConnection,
  matchId: number,
  row: PickMatchRow,
  slot: number,
  map: string | null,
): Promise<boolean> {
  if (slot === 1) {
    if ((row.first_map ?? null) === map) return false;
    await connection.execute(`UPDATE bg_matches SET first_map = ? WHERE id = ?`, [map, matchId]);
    return true;
  }
  const picks = parseMapPicks(row.map_picks);
  if ((picks[String(slot)] ?? null) === map) return false;
  if (map === null) delete picks[String(slot)];
  else picks[String(slot)] = map;
  const json = Object.keys(picks).length === 0 ? null : JSON.stringify(picks);
  await connection.execute(`UPDATE bg_matches SET map_picks = ? WHERE id = ?`, [json, matchId]);
  return true;
}

/**
 * Choisit la carte `slot` d'un match dans le pool de sa manche (`null` retire
 * le choix). Permis à l'arbitrage (`staff`, permission `tournaments`, s'il ne
 * joue pas le match) et, sur un
 * match **en autogestion** seulement, aux joueurs d'une des deux équipes qui
 * peuvent déclarer son « Prêt » (ou à l'engagé solo). La carte 1 est
 * `first_map` ; les suivantes, `map_picks`.
 *
 * @throws `MATCH_NOT_FOUND` | `TOURNAMENT_NOT_FOUND` | `MATCH_ALREADY_COMPLETED` | `INVALID_MAP_PICK` | `NOT_MAP_PICKER`
 */
export async function pickMatchMap(
  matchId: number,
  viewer: { userId: number; staff: boolean },
  slot: unknown,
  rawMap: unknown,
): Promise<void> {
  // Le match lu hors de la transaction, sans verrou : sous REPEATABLE READ, une
  // lecture avant le verrou figerait la vue, et le pool relu ensuite serait
  // celui d'avant un `setRoundMaps` simultané (règle « verrou en premier »).
  // Le droit de choisir s'y vérifie aussi : un compte quelconque qui appelle
  // en boucle ne prend jamais le verrou exclusif du tournoi.
  const ownerId = await withConnection(async (connection) => {
    const [rows] = await connection.execute<PickMatchRow[]>(`${PICK_MATCH_SELECT} LIMIT 1`, [matchId]);
    if (!rows[0]) throw new Error("MATCH_NOT_FOUND");
    await assertMapPicker(connection, rows[0], viewer);
    return Number(rows[0].tournament_id);
  });
  const tournamentId = await inTransaction(async (connection) => {
    // Le tournoi d'abord, comme `setRoundMaps` : un choix ne se valide pas
    // contre un pool que le staff remplace au même instant.
    await lockTournament(connection, ownerId);
    const [rows] = await connection.execute<PickMatchRow[]>(`${PICK_MATCH_SELECT} LIMIT 1 FOR UPDATE`, [matchId]);
    const row = rows[0];
    if (!row || Number(row.tournament_id) !== ownerId) throw new Error("MATCH_NOT_FOUND");
    if (row.status === "COMPLETED") throw new Error("MATCH_ALREADY_COMPLETED");
    const byTeam = await assertMapPicker(connection, row, viewer);
    const slots = await loadRoundSlots(connection, Number(row.tournament_id), {
      phaseId: Number(row.phase_id),
      bracket: String(row.bracket),
      roundNumber: Number(row.round_number),
    });
    const map = validateMapPick(slots, slot, rawMap);
    if (!(await writeMapPick(connection, matchId, row, slot as number, map))) return null;
    queueRefereeChange(connection, { kind: "MAP_PICK", matchId, set: map !== null, byTeam });
    return Number(row.tournament_id);
  });
  if (tournamentId !== null) publishMatchUpdatedEvent(tournamentId);
}

