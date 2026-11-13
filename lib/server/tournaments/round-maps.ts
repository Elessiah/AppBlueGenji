/**
 * Cartes par manche, choix dans un pool et règles de ban d'un tournoi
 * (`docs/features/ROUND_MAPS.md`). Règles pures : `lib/shared/round-maps.ts`.
 *
 * Toute écriture passe en transaction, publie l'événement qui relit
 * l'instantané (flux SSE et REST de secours portent `mapRules`) et laisse une
 * ligne au journal du staff, sans nommer personne.
 */
import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { getDatabase } from "@/lib/server/database";
import { sendBotLog } from "@/lib/server/bot-integration";
import { formatMapRulesLog } from "@/lib/shared/bot-logs";
import {
  normalizeRoundMapSlots,
  normalizeTiebreakMap,
  parseFirstBanRule,
  parseNextBanRule,
  parseNextPickRule,
  parseMapPicks,
  parseStoredSlots,
  parseStoredTiebreak,
  validateMapPick,
  FIRST_BAN_RULES,
  NEXT_BAN_RULES,
  NEXT_PICK_RULES,
  ROUND_BRACKETS,
  ROUND_MAPS_BULK_MAX,
  ROUND_NUMBER_MAX,
  type FirstBanRule,
  type NextBanRule,
  type NextPickRule,
  type RoundKey,
  type RoundMapConfig,
  type RoundTiebreak,
  type TournamentMapRules,
} from "@/lib/shared/round-maps";
import { roundAllowsTiebreak, tiebreakTournamentFromRow } from "@/lib/shared/round-plan";
import {
  bracketFitsFormat,
  isValidMapPointTarget,
  parseStoredMapPointTarget,
  type RoundPointTarget,
} from "@/lib/shared/map-points";
import { assertMapPointsUnlocked } from "./map-points";
import type { PhaseFormat, TournamentFormat } from "@/lib/shared/types";
import { retryOnDeadlock } from "./deadlock-retry";
import { releaseWithServerLockWait, withShortLockWait } from "./lock-wait";
import { resolveMatchParty } from "./match-launch";
import { publishMatchUpdatedEvent } from "./notifications";
import { queueRefereeChange } from "./referee-notices";
import { loadRoundSlots } from "./round-map-slots";
import { queueRoundMapsNotice, roundMapsFingerprint, scheduleRoundMapsNotice } from "./round-maps-notice";
import { inTransaction, transact } from "./transaction";

/** Une manche : phase (0 sans phases), tableau, numéro (`lib/shared/round-maps.ts`). */
export type { RoundKey };

/** Colonnes des règles de ban sur la ligne du tournoi. */
export type MapRulesColumns = {
  first_ban_rule?: string | null;
  next_ban_rule?: string | null;
  next_pick_rule?: string | null;
};

type RulesRow = RowDataPacket & MapRulesColumns;

type RoundMapsRow = RowDataPacket & {
  phase_id: number;
  bracket: string;
  round_number: number;
  slots_json: string | null;
  tiebreak_map: string | null;
  map_point_target: number | null;
};

/**
 * Cartes et bans du tournoi, pour l'instantané : une lecture des tours réglés,
 * plus celle des règles quand l'appelant n'a pas déjà la ligne du tournoi
 * (`tournamentRow` portant ces colonnes, que l'instantané lit de toute façon). Les tours réglés sans
 * match encore créé sont portés aussi : l'écran de réglage les liste et les
 * résume (`plannedRoundKeys`).
 */
export async function loadMapRules(
  connection: PoolConnection,
  tournamentId: number,
  tournamentRow?: MapRulesColumns | null,
): Promise<TournamentMapRules> {
  // Une ligne lue sans ces colonnes (`undefined`) ne vaut pas règles par défaut : on relit.
  let rules: MapRulesColumns | undefined =
    tournamentRow && tournamentRow.first_ban_rule !== undefined ? tournamentRow : undefined;
  if (!rules) {
    const [ruleRows] = await connection.execute<RulesRow[]>(
      `SELECT first_ban_rule, next_ban_rule, next_pick_rule FROM bg_tournaments WHERE id = ? LIMIT 1`,
      [tournamentId],
    );
    rules = ruleRows[0];
  }
  const [rows] = await connection.execute<RoundMapsRow[]>(
    `SELECT phase_id, bracket, round_number, slots_json, tiebreak_map, map_point_target FROM bg_tournament_round_maps
      WHERE tournament_id = ? ORDER BY phase_id, bracket, round_number`,
    [tournamentId],
  );
  const rounds: RoundMapConfig[] = [];
  // Maps de départage telles que stockées : l'instantané n'en garde que celles
  // des tours éligibles (`applicableTiebreaks`), le format pouvant avoir changé.
  const tiebreaks: RoundTiebreak[] = [];
  // Points par carte propres à un tour (format Duel / Arcade). Éteindre le
  // format sur le tournoi les efface (`updateTournament`) ; une ligne restée
  // d'ailleurs ne s'applique pas (`effectiveMapPointTarget`).
  const pointTargets: RoundPointTarget[] = [];
  for (const row of rows) {
    const key = { phaseId: Number(row.phase_id), bracket: String(row.bracket), roundNumber: Number(row.round_number) };
    const tiebreak = parseStoredTiebreak(row.tiebreak_map);
    if (tiebreak !== null) tiebreaks.push({ ...key, map: tiebreak });
    const target = parseStoredMapPointTarget(row.map_point_target);
    if (target !== null) pointTargets.push({ ...key, target });
    const slots = parseStoredSlots(row.slots_json);
    if (slots.length === 0) continue;
    rounds.push({ ...key, slots });
  }
  return {
    firstBan: parseFirstBanRule(rules?.first_ban_rule),
    nextBan: parseNextBanRule(rules?.next_ban_rule),
    nextPick: parseNextPickRule(rules?.next_pick_rule),
    rounds,
    tiebreaks,
    // Champ omis sans réglage (le cas courant) : l'instantané n'en grossit pas.
    ...(pointTargets.length > 0 ? { pointTargets } : {}),
  };
}

/** Les créneaux de la manche d'un match, vides sans réglage (`./round-map-slots`). */
export { loadRoundSlots };

/**
 * Manche lue d'un corps de requête : sa **forme** seulement (numéro de 1 à
 * {@link ROUND_NUMBER_MAX}) ; son appartenance au tournoi se vérifie sous
 * verrou (`roundsOfTournament`). @throws `INVALID_ROUND`
 */
export function parseRoundKey(body: { phaseId?: unknown; roundNumber?: unknown; bracket?: unknown }): RoundKey {
  const { phaseId, roundNumber, bracket } = body;
  if (typeof phaseId !== "number" || !Number.isInteger(phaseId) || phaseId < 0) throw new Error("INVALID_ROUND");
  if (typeof roundNumber !== "number" || !Number.isInteger(roundNumber) || roundNumber < 1 || roundNumber > ROUND_NUMBER_MAX) {
    throw new Error("INVALID_ROUND");
  }
  if (typeof bracket !== "string" || !ROUND_BRACKETS.includes(bracket)) throw new Error("INVALID_ROUND");
  return { phaseId, bracket, roundNumber };
}

type TournamentRow = RowDataPacket & MapRulesColumns & {
  id: number;
  name: string;
  format: string;
  map_point_target?: number | null;
  has_third_place_match?: number | boolean | null;
};

/**
 * Verrou exclusif du tournoi, en première instruction (règle « verrou en
 * premier ») : la ligne lue porte aussi les règles de ban, à jour sous verrou.
 */
async function lockTournament(connection: PoolConnection, tournamentId: number): Promise<TournamentRow> {
  const [rows] = await connection.execute<TournamentRow[]>(
    `SELECT id, name, format, first_ban_rule, next_ban_rule, next_pick_rule, map_point_target, has_third_place_match
       FROM bg_tournaments WHERE id = ? LIMIT 1 FOR UPDATE`,
    [tournamentId],
  );
  if (!rows[0]) throw new Error("TOURNAMENT_NOT_FOUND");
  return rows[0];
}

/**
 * Verrou **partagé** du tournoi, pour un choix dans un pool : il attend un
 * `setRoundsMaps` en cours (verrou exclusif) et le retient le temps du choix,
 * sans mettre en file les choix des autres matchs entre eux. Écriture
 * MariaDB (`LOCK IN SHARE MODE`, requête sans jointure — `CLAUDE.md`).
 */
async function lockTournamentShared(connection: PoolConnection, tournamentId: number): Promise<void> {
  const [rows] = await connection.execute<(RowDataPacket & { id: number })[]>(
    `SELECT id FROM bg_tournaments WHERE id = ? LIMIT 1 LOCK IN SHARE MODE`,
    [tournamentId],
  );
  if (!rows[0]) throw new Error("TOURNAMENT_NOT_FOUND");
}

/**
 * Tours de `rounds` qui appartiennent au tournoi verrouillé : phase 0 hors
 * MULTI, sinon une phase **de ce** tournoi. Les autres (clé inventée, ou ligne
 * restée d'une phase supprimée par une édition du tournoi) sont écartés : on
 * n'y écrit pas de cartes, mais une copie « à tous les tours » qui en contient
 * ne refuse pas pour autant les tours valides.
 */
async function roundsOfTournament(
  connection: PoolConnection,
  tournament: Pick<TournamentRow, "id" | "format">,
  rounds: readonly RoundKey[],
): Promise<RoundKey[]> {
  if (tournament.format !== "MULTI") return rounds.filter((round) => round.phaseId === 0);
  const phaseIds = [...new Set(rounds.map((round) => round.phaseId).filter((phaseId) => phaseId !== 0))];
  if (phaseIds.length === 0) return [];
  const [rows] = await connection.execute<(RowDataPacket & { id: number })[]>(
    `SELECT id FROM bg_tournament_phases WHERE tournament_id = ? AND id IN (${phaseIds.map(() => "?").join(", ")})`,
    [Number(tournament.id), ...phaseIds],
  );
  const owned = new Set(rows.map((row) => Number(row.id)));
  return rounds.filter((round) => owned.has(round.phaseId));
}

/**
 * Tour que le tournoi verrouillé peut jouer : phase 0 hors MULTI, sinon une
 * phase **de ce** tournoi, et un tableau que le format (de la phase) joue
 * (`bracketFitsFormat` : pas de tableau perdant hors double élimination).
 * Pose des points d'un tour (`setRoundPointTarget`).
 */
async function roundFitsTournament(
  connection: PoolConnection,
  tournament: Pick<TournamentRow, "id" | "format" | "has_third_place_match">,
  round: RoundKey,
): Promise<boolean> {
  if (tournament.format !== "MULTI") {
    return (
      round.phaseId === 0 &&
      bracketFitsFormat(tournament.format as TournamentFormat, round.bracket, Boolean(Number(tournament.has_third_place_match)))
    );
  }
  if (round.phaseId === 0) return false;
  const [rows] = await connection.execute<
    (RowDataPacket & { format: PhaseFormat; has_third_place_match: number | boolean | null })[]
  >(
    `SELECT format, has_third_place_match FROM bg_tournament_phases WHERE tournament_id = ? AND id = ? LIMIT 1`,
    [Number(tournament.id), round.phaseId],
  );
  return (
    rows[0] !== undefined &&
    bracketFitsFormat(rows[0].format, round.bracket, Boolean(Number(rows[0].has_third_place_match)))
  );
}

/** Tours au plus d'une copie « à tous les tours » (partagé avec l'écran, qui découpe). */
export { ROUND_MAPS_BULK_MAX };

/**
 * Tours lus d'un corps de requête : une liste (copie vers plusieurs tours),
 * dédoublonnée, de 1 à {@link ROUND_MAPS_BULK_MAX} tours. @throws `INVALID_ROUND`
 */
export function parseRoundKeys(raw: unknown): RoundKey[] {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > ROUND_MAPS_BULK_MAX) throw new Error("INVALID_ROUND");
  const seen = new Map<string, RoundKey>();
  for (const entry of raw) {
    if (entry === null || typeof entry !== "object") throw new Error("INVALID_ROUND");
    const round = parseRoundKey(entry as Record<string, unknown>);
    seen.set(`${round.phaseId}:${round.bracket}:${round.roundNumber}`, round);
  }
  return [...seen.values()];
}

/** Ce qu'une écriture de cartes a retenu (`setRoundsMaps`). */
export type RoundsMapsResult = { slots: string[][]; skipped: number };

/**
 * Écrit (ou retire) le réglage d'une manche ; rend le réglage d'avant, `null`
 * s'il ne change rien.
 */
async function writeRoundSlots(
  connection: PoolConnection,
  tournamentId: number,
  round: RoundKey,
  slots: string[][],
): Promise<string[][] | null> {
  const before = await loadRoundSlots(connection, tournamentId, round);
  if (JSON.stringify(before) === JSON.stringify(slots)) return null;
  if (slots.length === 0) {
    // Une map de départage (ou des points par carte) réglée garde la ligne :
    // seules ses cartes partent.
    await connection.execute(
      `DELETE FROM bg_tournament_round_maps
        WHERE tournament_id = ? AND phase_id = ? AND bracket = ? AND round_number = ?
          AND tiebreak_map IS NULL AND map_point_target IS NULL`,
      [tournamentId, round.phaseId, round.bracket, round.roundNumber],
    );
    await connection.execute(
      `UPDATE bg_tournament_round_maps SET slots_json = '[]'
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
  return before;
}

/**
 * Pose (ou retire, liste vide) les mêmes cartes sur une ou plusieurs manches —
 * à tout moment, avant, pendant ou après la manche, y compris sur un tour pas
 * encore généré (le réglage s'applique à ses matchs dès leur création).
 * Réservé à l'arbitrage (permission `tournaments`, vérifiée par la route). Les
 * choix déjà faits sur les matchs restent. Une seule transaction, un seul
 * événement, une seule ligne au journal, quel que soit le nombre de tours.
 *
 * @returns les créneaux retenus, et `skipped` : le nombre de tours demandés
 *   que le tournoi ne porte pas (phase supprimée entre-temps) et qui n'ont donc
 *   rien reçu — l'écran le dit au lieu d'annoncer un succès entier.
 * @throws `INVALID_ROUND_MAPS` | `INVALID_ROUND` | `TOURNAMENT_NOT_FOUND`
 */
export async function setRoundsMaps(
  tournamentId: number,
  rounds: readonly RoundKey[],
  rawSlots: unknown,
): Promise<RoundsMapsResult> {
  const slots = normalizeRoundMapSlots(rawSlots);
  if (rounds.length === 0 || rounds.length > ROUND_MAPS_BULK_MAX) throw new Error("INVALID_ROUND");
  // Rejouée sur un interblocage ou un refus de l'isolation par instantané de
  // MariaDB (`ER_CHECKREAD`) : un balayage de l'annonce, qui ne prend pas le
  // verrou du tournoi, peut supprimer la ligne `bg_round_maps_notices` après
  // l'ouverture de l'image de cette transaction (`queueRoundMapsNotice`).
  const result = await retryOnDeadlock(() => inTransaction(async (connection) => {
    const tournament = await lockTournament(connection, tournamentId);
    // Retirer est permis sur toute clé (une ligne orpheline doit pouvoir partir) ;
    // poser des cartes, seulement sur les tours du tournoi.
    const targets = slots.length === 0 ? rounds : await roundsOfTournament(connection, tournament, rounds);
    if (targets.length === 0) throw new Error("INVALID_ROUND");
    const changedRounds: (RoundKey & { before: string })[] = [];
    for (const round of targets) {
      const before = await writeRoundSlots(connection, tournamentId, round, slots);
      if (before !== null) changedRounds.push({ ...round, before: roundMapsFingerprint(before) });
    }
    // L'annonce Discord ne part pas ici : elle est mise en attente dans la
    // transaction et une seule ligne résume la série (`./round-maps-notice`).
    await queueRoundMapsNotice(connection, tournamentId, changedRounds);
    return { changed: changedRounds.length > 0, skipped: rounds.length - targets.length };
  }));
  if (result.changed) {
    publishMatchUpdatedEvent(tournamentId);
    scheduleRoundMapsNotice();
  }
  return { slots, skipped: result.skipped };
}

/** Les cartes d'une seule manche (`setRoundsMaps`). */
export async function setRoundMaps(tournamentId: number, round: RoundKey, rawSlots: unknown): Promise<string[][]> {
  return (await setRoundsMaps(tournamentId, [round], rawSlots)).slots;
}

type TiebreakTournamentRow = RowDataPacket & {
  format: TournamentFormat;
  match_format_type: "BO" | "FT" | null;
  match_format_value: number | null;
  match_format_max_maps: number | null;
  match_format_draws: number | null;
  endurance_playoff_format_type: "BO" | "FT" | null;
  endurance_playoff_format_value: number | null;
};

/**
 * Le tour peut-il porter une map de départage ? Formats relus **sous le verrou**
 * du tournoi (ligne et phases), règle pure partagée avec l'écran
 * (`roundAllowsTiebreak`).
 */
async function tiebreakAllowedUnderLock(
  connection: PoolConnection,
  tournamentId: number,
  round: RoundKey,
): Promise<boolean> {
  const [rows] = await connection.execute<TiebreakTournamentRow[]>(
    `SELECT format, match_format_type, match_format_value, match_format_max_maps, match_format_draws,
            endurance_playoff_format_type, endurance_playoff_format_value
       FROM bg_tournaments WHERE id = ? LIMIT 1`,
    [tournamentId],
  );
  const row = rows[0];
  if (!row) throw new Error("TOURNAMENT_NOT_FOUND");
  let phases: { id: number; format: PhaseFormat }[] | null = null;
  if (row.format === "MULTI") {
    const [phaseRows] = await connection.execute<(RowDataPacket & { id: number; format: PhaseFormat })[]>(
      `SELECT id, format FROM bg_tournament_phases WHERE tournament_id = ?`,
      [tournamentId],
    );
    phases = phaseRows.map((phase) => ({ id: Number(phase.id), format: phase.format }));
  }
  return roundAllowsTiebreak(tiebreakTournamentFromRow(row, phases), round);
}

/**
 * Pose (ou retire, `null` / vide) la **map de départage** d'un tour de
 * play-offs à format de match défini (`docs/features/ROUND_MAPS.md`) : jouée
 * en N + 1 seulement si la série est à égalité après les N maps régulières. Une
 * carte, imposée ; les cartes du tour et leurs choix ne changent pas. Réservé
 * à l'arbitrage (permission `tournaments`, vérifiée par la route). Verrou du
 * tournoi en première instruction, format relu dessous ; retirer est permis
 * sur toute clé (un réglage resté d'un format changé doit pouvoir partir).
 *
 * @returns la map retenue (`null` = retirée).
 * @throws `INVALID_TIEBREAK_MAP` | `INVALID_ROUND` | `TIEBREAK_NOT_ALLOWED` | `TOURNAMENT_NOT_FOUND`
 */
export async function setRoundTiebreak(tournamentId: number, round: RoundKey, rawMap: unknown): Promise<string | null> {
  const map = normalizeTiebreakMap(rawMap);
  // Rejouée comme `setRoundsMaps` (même mise en attente de l'annonce).
  const changed = await retryOnDeadlock(() => inTransaction(async (connection) => {
    const tournament = await lockTournament(connection, tournamentId);
    if (map !== null) {
      const [owned] = await roundsOfTournament(connection, tournament, [round]);
      if (!owned) throw new Error("INVALID_ROUND");
      if (!(await tiebreakAllowedUnderLock(connection, tournamentId, round))) throw new Error("TIEBREAK_NOT_ALLOWED");
    }
    const [rows] = await connection.execute<(RowDataPacket & { tiebreak_map: string | null })[]>(
      `SELECT tiebreak_map FROM bg_tournament_round_maps
        WHERE tournament_id = ? AND phase_id = ? AND bracket = ? AND round_number = ? LIMIT 1`,
      [tournamentId, round.phaseId, round.bracket, round.roundNumber],
    );
    const before = parseStoredTiebreak(rows[0]?.tiebreak_map);
    if (before === map) return false;
    if (map === null) {
      await connection.execute(
        `UPDATE bg_tournament_round_maps SET tiebreak_map = NULL
          WHERE tournament_id = ? AND phase_id = ? AND bracket = ? AND round_number = ?`,
        [tournamentId, round.phaseId, round.bracket, round.roundNumber],
      );
      // Une ligne qui ne portait que la map de départage n'a plus lieu d'être.
      await connection.execute(
        `DELETE FROM bg_tournament_round_maps
          WHERE tournament_id = ? AND phase_id = ? AND bracket = ? AND round_number = ?
            AND slots_json = '[]' AND map_point_target IS NULL`,
        [tournamentId, round.phaseId, round.bracket, round.roundNumber],
      );
    } else {
      await connection.execute(
        `INSERT INTO bg_tournament_round_maps (tournament_id, phase_id, bracket, round_number, slots_json, tiebreak_map)
         VALUES (?, ?, ?, ?, '[]', ?)
         ON DUPLICATE KEY UPDATE tiebreak_map = VALUES(tiebreak_map)`,
        [tournamentId, round.phaseId, round.bracket, round.roundNumber, map],
      );
    }
    await queueRoundMapsNotice(connection, tournamentId, [{ ...round, before: roundMapsFingerprint(before) }], {
      tiebreak: true,
    });
    return true;
  }));
  if (changed) {
    publishMatchUpdatedEvent(tournamentId);
    scheduleRoundMapsNotice();
  }
  return map;
}

/**
 * Pose (ou retire, `null`) les **points par carte propres à un tour**, en
 * format Duel / Arcade (`docs/features/DUEL_ARCADE.md`) : ils remplacent ceux
 * du tournoi sur les matchs de ce tour (finale au premier à 7, par exemple).
 * Réservé à l'arbitrage (permission `tournaments`, vérifiée par la route).
 * Verrou du tournoi en première instruction ; poser exige le format allumé sur
 * le tournoi et un tour qu'il peut jouer (phase du tournoi, tableau du
 * format) ; poser comme retirer est refusé dès qu'un
 * match du tour porte un score (`assertMapPointsUnlocked`). Retirer est permis
 * sur toute clé, format éteint compris (un réglage resté doit pouvoir partir).
 *
 * @returns les points retenus (`null` = le tour suit le tournoi).
 * @throws `INVALID_MAP_POINT_TARGET` | `INVALID_ROUND` | `MAP_POINTS_DISABLED` |
 *   `MAP_POINTS_LOCKED` | `TOURNAMENT_NOT_FOUND`
 */
export async function setRoundPointTarget(
  tournamentId: number,
  round: RoundKey,
  rawTarget: unknown,
): Promise<number | null> {
  if (rawTarget !== null && !isValidMapPointTarget(rawTarget)) throw new Error("INVALID_MAP_POINT_TARGET");
  const target = rawTarget;
  const changed = await retryOnDeadlock(() => inTransaction(async (connection) => {
    const tournament = await lockTournament(connection, tournamentId);
    if (target !== null) {
      if (parseStoredMapPointTarget(tournament.map_point_target) === null) throw new Error("MAP_POINTS_DISABLED");
      if (!(await roundFitsTournament(connection, tournament, round))) throw new Error("INVALID_ROUND");
    }
    const [rows] = await connection.execute<(RowDataPacket & { map_point_target: number | null })[]>(
      `SELECT map_point_target FROM bg_tournament_round_maps
        WHERE tournament_id = ? AND phase_id = ? AND bracket = ? AND round_number = ? LIMIT 1`,
      [tournamentId, round.phaseId, round.bracket, round.roundNumber],
    );
    const before = parseStoredMapPointTarget(rows[0]?.map_point_target);
    if (before === target) return false;
    await assertMapPointsUnlocked(connection, tournamentId, round);
    if (target === null) {
      await connection.execute(
        `UPDATE bg_tournament_round_maps SET map_point_target = NULL
          WHERE tournament_id = ? AND phase_id = ? AND bracket = ? AND round_number = ?`,
        [tournamentId, round.phaseId, round.bracket, round.roundNumber],
      );
      // Une ligne qui ne portait que ces points n'a plus lieu d'être.
      await connection.execute(
        `DELETE FROM bg_tournament_round_maps
          WHERE tournament_id = ? AND phase_id = ? AND bracket = ? AND round_number = ?
            AND slots_json = '[]' AND tiebreak_map IS NULL`,
        [tournamentId, round.phaseId, round.bracket, round.roundNumber],
      );
    } else {
      await connection.execute(
        `INSERT INTO bg_tournament_round_maps (tournament_id, phase_id, bracket, round_number, slots_json, map_point_target)
         VALUES (?, ?, ?, ?, '[]', ?)
         ON DUPLICATE KEY UPDATE map_point_target = VALUES(map_point_target)`,
        [tournamentId, round.phaseId, round.bracket, round.roundNumber, target],
      );
    }
    // Annonce au journal du staff, regroupée avec les cartes (`./round-maps-notice`).
    await queueRoundMapsNotice(connection, tournamentId, [{ ...round, before: roundMapsFingerprint(before) }], {
      points: true,
    });
    return true;
  }));
  if (changed) {
    publishMatchUpdatedEvent(tournamentId);
    scheduleRoundMapsNotice();
  }
  return target;
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
 * l'arbitrage. Les règles en place se lisent sur la ligne verrouillée.
 * @throws `TOURNAMENT_NOT_FOUND`
 */
export async function setTournamentMapRules(tournamentId: number, rules: MapRulesInput): Promise<void> {
  const tournament = await inTransaction(async (connection) => {
    const row = await lockTournament(connection, tournamentId);
    if (
      parseFirstBanRule(row.first_ban_rule) === rules.firstBan &&
      parseNextBanRule(row.next_ban_rule) === rules.nextBan &&
      parseNextPickRule(row.next_pick_rule) === rules.nextPick
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
  sendBotLog(formatMapRulesLog({ tournament: { id: Number(tournament.id), name: tournament.name } }), {
    tournamentId: Number(tournament.id),
    category: "maps",
  });
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
      ? await resolveMatchParty(connection, { team1_id: row.team1_id, team2_id: row.team2_id, casters: [], tournament_game: null }, viewer.userId)
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
  // Rejouée sur interblocage : le verrou tournoi puis match croise les
  // écritures d'arbitrage qui prennent le match puis le tournoi.
  // Connexion prise ici (pas `withConnection`) : rendue par
  // `releaseWithServerLockWait`, jamais au pool sous le délai de verrou court.
  const tournamentId = await retryOnDeadlock(async () => {
    const connection = await (await getDatabase()).getConnection();
    try {
      // Le match lu avant la transaction (lecture autonome) : sous REPEATABLE
      // READ, une lecture dans la transaction avant le verrou figerait la vue, et
      // le pool relu ensuite serait celui d'avant un `setRoundMaps` simultané
      // (règle « verrou en premier »). Droit de choisir et match joué s'y
      // vérifient aussi : un appel refusé ne prend jamais le verrou du tournoi.
      const [pre] = await connection.execute<PickMatchRow[]>(`${PICK_MATCH_SELECT} LIMIT 1`, [matchId]);
      if (!pre[0]) throw new Error("MATCH_NOT_FOUND");
      await assertMapPicker(connection, pre[0], viewer);
      if (pre[0].status === "COMPLETED") throw new Error("MATCH_ALREADY_COMPLETED");
      const ownerId = Number(pre[0].tournament_id);
      // `await` : le `finally` ne rend la connexion qu'une fois la transaction close.
      return await transact(connection, async () => {
        // Le tournoi d'abord, comme `setRoundMaps` : un choix ne se valide pas
        // contre un pool que le staff remplace au même instant. Verrou partagé :
        // les choix de deux matchs ne s'attendent pas l'un l'autre. Attente
        // bornée (`withShortLockWait`) : un verrou exclusif tenu longtemps
        // (remplacement du pool, avancement) ne garde pas la connexion jusqu'à
        // `innodb_lock_wait_timeout` — passé le délai court, `ER_LOCK_WAIT_TIMEOUT`
        // rend 409 `CONCURRENT_UPDATE_RETRY` (`launchFailure`).
        await withShortLockWait(connection, () => lockTournamentShared(connection, ownerId));
        const [rows] = await connection.execute<PickMatchRow[]>(`${PICK_MATCH_SELECT} LIMIT 1 FOR UPDATE`, [matchId]);
        const row = rows[0];
        if (!row) throw new Error("MATCH_NOT_FOUND");
        // Le droit d'abord : qui l'a perdu entre les deux lectures reçoit 403,
        // pas l'état du match.
        const byTeam = await assertMapPicker(connection, row, viewer);
        if (row.status === "COMPLETED") throw new Error("MATCH_ALREADY_COMPLETED");
        const slots = await loadRoundSlots(connection, ownerId, {
          phaseId: Number(row.phase_id),
          bracket: String(row.bracket),
          roundNumber: Number(row.round_number),
        });
        const map = validateMapPick(slots, slot, rawMap, byTeam);
        if (!(await writeMapPick(connection, matchId, row, slot as number, map))) return null;
        queueRefereeChange(connection, { kind: "MAP_PICK", matchId, set: map !== null, byTeam });
        return ownerId;
      });
    } finally {
      await releaseWithServerLockWait(connection);
    }
  });
  if (tournamentId !== null) publishMatchUpdatedEvent(tournamentId);
}

