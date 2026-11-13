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
import {
  indexBuiltRounds,
  isWholeBracketFormat,
  roundAllowsTiebreak,
  roundWithinBuiltBracket,
  tiebreakTournamentFromRow,
} from "@/lib/shared/round-plan";
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
import { lockTournamentRowShared } from "./registration";
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
 * verrou (`roundsFittingTournament`). @throws `INVALID_ROUND`
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
  state?: string | null;
  map_point_target?: number | null;
  has_third_place_match?: number | boolean | null;
};

/**
 * Verrou exclusif du tournoi, en première instruction (règle « verrou en
 * premier ») : la ligne lue porte aussi les règles de ban, à jour sous verrou.
 */
async function lockTournament(connection: PoolConnection, tournamentId: number): Promise<TournamentRow> {
  const [rows] = await connection.execute<TournamentRow[]>(
    `SELECT id, name, format, state, first_ban_rule, next_ban_rule, next_pick_rule, map_point_target, has_third_place_match
       FROM bg_tournaments WHERE id = ? LIMIT 1 FOR UPDATE`,
    [tournamentId],
  );
  if (!rows[0]) throw new Error("TOURNAMENT_NOT_FOUND");
  return rows[0];
}


type PhaseRules = { format: TournamentFormat | PhaseFormat; thirdPlace: boolean };

/** Format (et petite finale) de chaque phase citée par `rounds` : la phase 0 hors MULTI, sinon les phases **de ce** tournoi. */
async function phaseRulesOf(
  connection: PoolConnection,
  tournament: Pick<TournamentRow, "id" | "format" | "has_third_place_match">,
  rounds: readonly RoundKey[],
): Promise<Map<number, PhaseRules>> {
  if (tournament.format !== "MULTI") {
    return new Map([
      [0, { format: tournament.format as TournamentFormat, thirdPlace: Boolean(Number(tournament.has_third_place_match)) }],
    ]);
  }
  const phaseIds = [...new Set(rounds.map((round) => round.phaseId).filter((phaseId) => phaseId !== 0))];
  if (phaseIds.length === 0) return new Map();
  const [rows] = await connection.execute<
    (RowDataPacket & { id: number; format: PhaseFormat; has_third_place_match: number | boolean | null })[]
  >(
    `SELECT id, format, has_third_place_match FROM bg_tournament_phases
      WHERE tournament_id = ? AND id IN (${phaseIds.map(() => "?").join(", ")})`,
    [Number(tournament.id), ...phaseIds],
  );
  return new Map(
    rows.map((row) => [Number(row.id), { format: row.format, thirdPlace: Boolean(Number(row.has_third_place_match)) }]),
  );
}

/**
 * Tours de `rounds` que le tournoi verrouillé peut jouer : phase 0 hors MULTI,
 * sinon une phase **de ce** tournoi, et un tableau que le format (de la phase)
 * joue (`bracketFitsFormat` : pas de tableau perdant hors double élimination,
 * pas de petite finale sans elle). En élimination, une fois l'arbre créé, le
 * tour doit en être un (ses tours sont tous connus) ; avant, ou en ronde
 * suisse / Survie (tours créés au fil de l'eau), le numéro n'est borné que
 * par `parseRoundKey`. Les autres (clé inventée — `GRAND` n° 1500 sur une
 * élimination simple —, ou ligne restée d'une phase supprimée) sont écartés :
 * on n'y écrit ni cartes, ni map de départage, ni points, mais une copie « à
 * tous les tours » qui en contient ne refuse pas pour autant les tours valides.
 * Deux lectures au plus, quel que soit le nombre de tours.
 */
async function roundsFittingTournament(
  connection: PoolConnection,
  tournament: Pick<TournamentRow, "id" | "format" | "has_third_place_match">,
  rounds: readonly RoundKey[],
): Promise<RoundKey[]> {
  const phases = await phaseRulesOf(connection, tournament, rounds);
  const fitting = rounds.filter((round) => {
    const phase = phases.get(round.phaseId);
    return phase !== undefined && bracketFitsFormat(phase.format, round.bracket, phase.thirdPlace);
  });
  const wholePhaseIds = [
    ...new Set(fitting.map((round) => round.phaseId).filter((phaseId) => isWholeBracketFormat(phases.get(phaseId)?.format))),
  ];
  if (wholePhaseIds.length === 0) return fitting;
  const [built] = await connection.execute<
    (RowDataPacket & { phase_id: number; bracket: string; max_round: number | null })[]
  >(
    `SELECT phase_id, bracket, MAX(round_number) AS max_round FROM bg_matches
      WHERE tournament_id = ? AND phase_id IN (${wholePhaseIds.map(() => "?").join(", ")})
      GROUP BY phase_id, bracket`,
    [Number(tournament.id), ...wholePhaseIds],
  );
  const index = indexBuiltRounds(
    built.flatMap((row) =>
      row.max_round === null
        ? []
        : [{ phaseId: Number(row.phase_id), bracket: String(row.bracket), roundNumber: Number(row.max_round) }],
    ),
  );
  // Même règle que l'instantané (`withoutUnbuiltRounds`) : un réglage accepté ici y reste visible.
  return fitting.filter((round) => roundWithinBuiltBracket(round, phases.get(round.phaseId)?.format, index));
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

/** Ligne de réglage d'un tour, telle que relue sous le verrou du tournoi. */
type StoredRoundRow = RowDataPacket & {
  id: number;
  phase_id: number;
  bracket: string;
  round_number: number;
  slots_json: string | null;
  tiebreak_map: string | null;
  map_point_target: number | null;
};

/** Manches au plus par upsert groupé de `writeRoundsSlots`. */
export const ROUND_MAPS_UPSERT_CHUNK = 64;

/** Clé d'un tour, pour indexer les lignes lues. */
function roundKeyOf(round: RoundKey): string {
  return `${round.phaseId}:${round.bracket}:${round.roundNumber}`;
}

/**
 * Écrit (ou retire) le même réglage sur plusieurs manches, **en lot** : une
 * lecture des lignes du tournoi, puis une écriture groupée des seules manches
 * qui changent (un upsert, ou un `DELETE` et un `UPDATE` pour un retrait) —
 * jamais une lecture et une écriture par tour sous le verrou du tournoi.
 *
 * @returns les manches changées, chacune avec son réglage d'avant.
 */
async function writeRoundsSlots(
  connection: PoolConnection,
  tournamentId: number,
  rounds: readonly RoundKey[],
  slots: string[][],
): Promise<{ round: RoundKey; before: string[][] }[]> {
  // Les seules lignes visées (`setRoundMaps` n'en relit qu'une), pas tout le tournoi.
  const [rows] = await connection.execute<StoredRoundRow[]>(
    `SELECT id, phase_id, bracket, round_number, slots_json, tiebreak_map, map_point_target
       FROM bg_tournament_round_maps
      WHERE tournament_id = ? AND (phase_id, bracket, round_number) IN (${rounds.map(() => "(?, ?, ?)").join(", ")})`,
    [tournamentId, ...rounds.flatMap((round) => [round.phaseId, round.bracket, round.roundNumber])],
  );
  const stored = new Map(
    rows.map((row) => [
      roundKeyOf({ phaseId: Number(row.phase_id), bracket: String(row.bracket), roundNumber: Number(row.round_number) }),
      row,
    ]),
  );
  const wanted = JSON.stringify(slots);
  const changed = rounds.flatMap((round) => {
    const row = stored.get(roundKeyOf(round));
    const before = parseStoredSlots(row?.slots_json);
    return JSON.stringify(before) === wanted ? [] : [{ round, before, row }];
  });
  if (changed.length === 0) return [];
  if (slots.length === 0) {
    // Une map de départage (ou des points par carte) réglée garde la ligne :
    // seules ses cartes partent. Une manche sans ligne n'a rien à retirer.
    const kept = changed.flatMap(({ row }) => (row ? [row] : []));
    const bare = kept.filter((row) => row.tiebreak_map === null && row.map_point_target === null).map((row) => Number(row.id));
    const emptied = kept.filter((row) => row.tiebreak_map !== null || row.map_point_target !== null).map((row) => Number(row.id));
    if (bare.length > 0) {
      await connection.execute(
        `DELETE FROM bg_tournament_round_maps WHERE tournament_id = ? AND id IN (${bare.map(() => "?").join(", ")})`,
        [tournamentId, ...bare],
      );
    }
    if (emptied.length > 0) {
      await connection.execute(
        `UPDATE bg_tournament_round_maps SET slots_json = '[]'
          WHERE tournament_id = ? AND id IN (${emptied.map(() => "?").join(", ")})`,
        [tournamentId, ...emptied],
      );
    }
  } else {
    // Par lots bornés ({@link ROUND_MAPS_UPSERT_CHUNK}) : la taille d'une
    // requête ne dépend plus du seul plafond de `parseRoundKeys`.
    for (let start = 0; start < changed.length; start += ROUND_MAPS_UPSERT_CHUNK) {
      const chunk = changed.slice(start, start + ROUND_MAPS_UPSERT_CHUNK);
      await connection.execute(
        `INSERT INTO bg_tournament_round_maps (tournament_id, phase_id, bracket, round_number, slots_json)
         VALUES ${chunk.map(() => "(?, ?, ?, ?, ?)").join(", ")}
         ON DUPLICATE KEY UPDATE slots_json = VALUES(slots_json)`,
        chunk.flatMap(({ round }) => [tournamentId, round.phaseId, round.bracket, round.roundNumber, wanted]),
      );
    }
  }
  return changed.map(({ round, before }) => ({ round, before }));
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
    // poser des cartes, seulement sur les tours que le tournoi peut jouer.
    const targets = slots.length === 0 ? rounds : await roundsFittingTournament(connection, tournament, rounds);
    if (targets.length === 0) throw new Error("INVALID_ROUND");
    const changedRounds = (await writeRoundsSlots(connection, tournamentId, targets, slots)).map(({ round, before }) => ({
      ...round,
      before: roundMapsFingerprint(before),
    }));
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
 * tournoi en première instruction, format relu dessous ; poser exige un tour
 * que le tournoi peut jouer (`roundsFittingTournament`) ; retirer est permis
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
      const [owned] = await roundsFittingTournament(connection, tournament, [round]);
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

/** Issue d'un réglage des points d'un tour ({@link setRoundPointTarget}). */
export type RoundPointTargetChange = {
  /** Points retenus (`null` = le tour suit le tournoi). */
  target: number | null;
  /** Points propres au tour avant le geste. */
  before: number | null;
  /** Faux quand rien n'a changé (même valeur) : aucun journal à écrire. */
  changed: boolean;
};

/**
 * Pose (ou retire, `null`) les **points par carte propres à un tour**, en
 * format Duel / Arcade (`docs/features/DUEL_ARCADE.md`) : ils remplacent ceux
 * du tournoi sur les matchs de ce tour (finale au premier à 7, par exemple).
 * Réservé à l'arbitrage (permission `tournaments`, vérifiée par la route).
 * Verrou du tournoi en première instruction ; poser exige le format allumé sur
 * le tournoi, un tournoi pas encore terminé et un tour qu'il peut jouer
 * (phase du tournoi, tableau du format, tour de l'arbre une fois créé) ; poser
 * comme retirer est refusé dès qu'un match jouable du tour porte un score ou
 * est lancé (`assertMapPointsUnlocked`). Retirer est permis sur toute clé ;
 * format éteint, le réglage resté n'a plus d'effet
 * (`effectiveMapPointTarget`) et part sans condition.
 *
 * @returns la valeur retenue, celle d'avant et si elle a changé.
 * @throws `INVALID_MAP_POINT_TARGET` | `INVALID_ROUND` | `MAP_POINTS_DISABLED` |
 *   `MAP_POINTS_LOCKED` | `MAP_POINTS_FINISHED` | `TOURNAMENT_NOT_FOUND`
 */
export async function setRoundPointTarget(
  tournamentId: number,
  round: RoundKey,
  rawTarget: unknown,
): Promise<RoundPointTargetChange> {
  if (rawTarget !== null && !isValidMapPointTarget(rawTarget)) throw new Error("INVALID_MAP_POINT_TARGET");
  const target = rawTarget;
  const outcome = await retryOnDeadlock(() => inTransaction(async (connection) => {
    const tournament = await lockTournament(connection, tournamentId);
    const duelOn = parseStoredMapPointTarget(tournament.map_point_target) !== null;
    if (target !== null) {
      if (!duelOn) throw new Error("MAP_POINTS_DISABLED");
      if (tournament.state === "FINISHED") throw new Error("MAP_POINTS_FINISHED");
      if ((await roundsFittingTournament(connection, tournament, [round])).length === 0) throw new Error("INVALID_ROUND");
    }
    const [rows] = await connection.execute<(RowDataPacket & { map_point_target: number | null })[]>(
      `SELECT map_point_target FROM bg_tournament_round_maps
        WHERE tournament_id = ? AND phase_id = ? AND bracket = ? AND round_number = ? LIMIT 1`,
      [tournamentId, round.phaseId, round.bracket, round.roundNumber],
    );
    const before = parseStoredMapPointTarget(rows[0]?.map_point_target);
    if (before === target) return { before, changed: false };
    // Format éteint, le réglage du tour ne joue plus : le retirer ne change
    // aucune règle sous un score.
    if (duelOn) await assertMapPointsUnlocked(connection, tournamentId, round);
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
    return { before, changed: true };
  }));
  if (outcome.changed) {
    publishMatchUpdatedEvent(tournamentId);
    scheduleRoundMapsNotice();
  }
  return { target, before: outcome.before, changed: outcome.changed };
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
        await withShortLockWait(connection, () => lockTournamentRowShared(connection, ownerId));
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

