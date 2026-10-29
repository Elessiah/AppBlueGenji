import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/database");
jest.mock("@/lib/server/bot-integration");
jest.mock("@/lib/server/tournaments/notifications");
jest.mock("@/lib/server/tournaments/referee-notices");
jest.mock("@/lib/server/tournaments/match-launch");

import { withConnection } from "@/lib/server/database";
import { sendBotLog } from "@/lib/server/bot-integration";
import { publishMatchUpdatedEvent } from "@/lib/server/tournaments/notifications";
import { queueRefereeChange } from "@/lib/server/tournaments/referee-notices";
import { resolveMatchParty } from "@/lib/server/tournaments/match-launch";
import {
  loadMapRules,
  parseMapRulesInput,
  ROUND_MAPS_BULK_MAX,
  parseRoundKey,
  parseRoundKeys,
  pickMatchMap,
  setRoundMaps,
  setRoundsMaps,
  setTournamentMapRules,
} from "@/lib/server/tournaments/round-maps";
import { ROUND_NUMBER_MAX } from "@/lib/shared/round-maps";
import { connectionMock, fakeConnection, type SqlMock } from "../../helpers/sql-double";

/**
 * Service des cartes par manche (`docs/features/ROUND_MAPS.md`), contre une
 * connexion simulée : chaque requête est aiguillée par son SQL.
 */

type Rows = Record<string, unknown>[];

const TOURNAMENT = { id: 7, name: "Coupe", format: "SINGLE" };
const ROUND = { phaseId: 0, bracket: "UPPER", roundNumber: 2 };
const MATCH = {
  tournament_id: 7,
  status: "READY",
  phase_id: 0,
  bracket: "UPPER",
  round_number: 2,
  self_managed: 0,
  team1_id: 10,
  team2_id: 20,
  first_map: null,
  map_picks: null,
};

let connection: ReturnType<typeof connectionMock>;

/** Aiguille `execute` : chaque motif SQL rend ses lignes. */
function route(execute: SqlMock, table: { pattern: RegExp; rows: Rows }[]) {
  execute.mockImplementation(async (sql: string) => {
    const hit = table.find((entry) => entry.pattern.test(sql));
    if (hit) return [hit.rows, []];
    return [/^\s*SELECT/.test(sql) ? [] : { affectedRows: 1 }, []];
  });
}

function writes(pattern: RegExp) {
  return connection.execute.mock.calls.filter(([sql]) => pattern.test(sql));
}

beforeEach(() => {
  jest.clearAllMocks();
  connection = connectionMock();
  connection.beginTransaction.mockResolvedValue();
  connection.commit.mockResolvedValue();
  connection.rollback.mockResolvedValue();
  jest.mocked(withConnection).mockImplementation((run) => run(fakeConnection(connection)));
  jest.mocked(sendBotLog).mockResolvedValue();
});

describe("parseRoundKey", () => {
  it("lit une manche valide", () => {
    expect(parseRoundKey({ phaseId: 0, bracket: "LOWER", roundNumber: 1 })).toEqual({
      phaseId: 0,
      bracket: "LOWER",
      roundNumber: 1,
    });
  });

  it("refuse phase négative, numéro nul, tableau inconnu ou absent", () => {
    expect(() => parseRoundKey({ phaseId: -1, bracket: "UPPER", roundNumber: 1 })).toThrow("INVALID_ROUND");
    expect(() => parseRoundKey({ phaseId: 0, bracket: "UPPER", roundNumber: 0 })).toThrow("INVALID_ROUND");
    expect(() => parseRoundKey({ phaseId: 0, bracket: "SIDE", roundNumber: 1 })).toThrow("INVALID_ROUND");
    expect(() => parseRoundKey({ phaseId: 0, roundNumber: 1 })).toThrow("INVALID_ROUND");
  });

  it("parseRoundKey_roundNumberAtMax_accepted", () => {
    expect(parseRoundKey({ phaseId: 0, bracket: "UPPER", roundNumber: ROUND_NUMBER_MAX }).roundNumber).toBe(2000);
  });

  it("parseRoundKey_roundNumberOverMax_throwsInvalidRound", () => {
    expect(() => parseRoundKey({ phaseId: 0, bracket: "UPPER", roundNumber: ROUND_NUMBER_MAX + 1 })).toThrow("INVALID_ROUND");
  });
});

describe("parseMapRulesInput", () => {
  it("lit des règles valides", () => {
    expect(parseMapRulesInput({ firstBan: "HOST", nextBan: "WINNER", nextPick: "FREE" })).toEqual({
      firstBan: "HOST",
      nextBan: "WINNER",
      nextPick: "FREE",
    });
  });

  it("refuse chaque règle inconnue", () => {
    const valid = { firstBan: "NON_HOST", nextBan: "LOSER", nextPick: "LOSER" };
    expect(() => parseMapRulesInput({ ...valid, firstBan: "COIN" })).toThrow("INVALID_MAP_RULES");
    expect(() => parseMapRulesInput({ ...valid, nextBan: "DRAW" })).toThrow("INVALID_MAP_RULES");
    expect(() => parseMapRulesInput({ ...valid, nextPick: null })).toThrow("INVALID_MAP_RULES");
  });
});

describe("loadMapRules", () => {
  it("relit règles et manches, en écartant un réglage vide", async () => {
    route(connection.execute, [
      { pattern: /FROM bg_tournaments/, rows: [{ first_ban_rule: "HOST", next_ban_rule: "WINNER", next_pick_rule: "FREE" }] },
      {
        pattern: /FROM bg_tournament_round_maps/,
        rows: [
          { phase_id: 0, bracket: "UPPER", round_number: 1, slots_json: '[["Ilios"]]' },
          { phase_id: 0, bracket: "UPPER", round_number: 2, slots_json: "[]" },
        ],
      },
    ]);
    await expect(loadMapRules(fakeConnection(connection), 7)).resolves.toEqual({
      firstBan: "HOST",
      nextBan: "WINNER",
      nextPick: "FREE",
      rounds: [{ phaseId: 0, bracket: "UPPER", roundNumber: 1, slots: [["Ilios"]] }],
    });
  });

  it("loadMapRules_tournamentRowWithRules_skipsRulesSelect", async () => {
    route(connection.execute, []);
    const row = { first_ban_rule: "HOST", next_ban_rule: "WINNER", next_pick_rule: "FREE" };

    const actual = await loadMapRules(fakeConnection(connection), 7, row);

    expect(actual).toMatchObject({ firstBan: "HOST", nextBan: "WINNER", nextPick: "FREE" });
    expect(writes(/FROM bg_tournaments\b/)).toHaveLength(0);
  });

  it("loadMapRules_tournamentRowWithoutRuleColumns_readsRules", async () => {
    route(connection.execute, [
      { pattern: /SELECT first_ban_rule/, rows: [{ first_ban_rule: "HOST", next_ban_rule: "WINNER", next_pick_rule: "FREE" }] },
    ]);

    const actual = await loadMapRules(fakeConnection(connection), 7, {});

    expect(actual.firstBan).toBe("HOST");
    expect(writes(/SELECT first_ban_rule/)).toHaveLength(1);
  });

  it("sans ligne de tournoi, les règles par défaut", async () => {
    route(connection.execute, []);
    await expect(loadMapRules(fakeConnection(connection), 7)).resolves.toEqual({
      firstBan: "NON_HOST",
      nextBan: "LOSER",
      nextPick: "LOSER",
      rounds: [],
    });
  });
});

describe("setRoundMaps", () => {
  it("pose les créneaux, publie l'instantané et journalise sans nommer le staff", async () => {
    route(connection.execute, [
      { pattern: /FROM bg_tournaments/, rows: [TOURNAMENT] },
      { pattern: /SELECT[\s\S]*FROM bg_tournament_round_maps/, rows: [] },
    ]);
    await expect(setRoundMaps(7, ROUND, [["Ilios"], ["Busan", "Nepal"]])).resolves.toEqual([["Ilios"], ["Busan", "Nepal"]]);
    const [insert] = writes(/INSERT INTO bg_tournament_round_maps/);
    expect(insert[1]).toEqual([7, 0, "UPPER", 2, '[["Ilios"],["Busan","Nepal"]]']);
    expect(connection.commit).toHaveBeenCalled();
    expect(publishMatchUpdatedEvent).toHaveBeenCalledWith(7);
    // Aucune ligne Discord à l'enregistrement : la manche est mise en attente.
    expect(sendBotLog).not.toHaveBeenCalled();
    expect(writes(/INSERT INTO bg_round_maps_notices/).map(([, params]) => params)).toEqual([
      [7, '[{"phaseId":0,"bracket":"UPPER","roundNumber":2}]', 60],
    ]);
  });

  it("une liste vide retire le réglage", async () => {
    route(connection.execute, [
      { pattern: /FROM bg_tournaments/, rows: [TOURNAMENT] },
      { pattern: /SELECT[\s\S]*FROM bg_tournament_round_maps/, rows: [{ ...ROUND, slots_json: '[["Ilios"]]' }] },
    ]);
    await expect(setRoundMaps(7, ROUND, [])).resolves.toEqual([]);
    expect(writes(/DELETE FROM bg_tournament_round_maps/)).toHaveLength(1);
    expect(sendBotLog).not.toHaveBeenCalled();
    expect(writes(/INSERT INTO bg_round_maps_notices/)).toHaveLength(1); // un retrait est un changement
  });

  it("un réglage inchangé n'écrit ni ne publie rien", async () => {
    route(connection.execute, [
      { pattern: /FROM bg_tournaments/, rows: [TOURNAMENT] },
      { pattern: /SELECT[\s\S]*FROM bg_tournament_round_maps/, rows: [{ ...ROUND, slots_json: '[["Ilios"]]' }] },
    ]);
    await setRoundMaps(7, ROUND, [["Ilios"]]);
    expect(writes(/^\s*(INSERT|DELETE)/)).toHaveLength(0);
    expect(publishMatchUpdatedEvent).not.toHaveBeenCalled();
    expect(sendBotLog).not.toHaveBeenCalled();
  });

  it("tournoi absent : refusé, transaction annulée", async () => {
    route(connection.execute, []);
    await expect(setRoundMaps(7, ROUND, [["Ilios"]])).rejects.toThrow("TOURNAMENT_NOT_FOUND");
    expect(connection.rollback).toHaveBeenCalled();
    expect(publishMatchUpdatedEvent).not.toHaveBeenCalled();
  });

  it("cartes invalides : refusées avant toute requête", async () => {
    await expect(setRoundMaps(7, ROUND, "Ilios")).rejects.toThrow("INVALID_ROUND_MAPS");
    expect(withConnection).not.toHaveBeenCalled();
  });
});

describe("parseRoundKeys", () => {
  it("parseRoundKeys_validList_returnsDedupedKeys", () => {
    expect(parseRoundKeys([ROUND, { ...ROUND }, { phaseId: 0, bracket: "LOWER", roundNumber: 1 }])).toEqual([
      ROUND,
      { phaseId: 0, bracket: "LOWER", roundNumber: 1 },
    ]);
  });

  it("parseRoundKeys_emptyList_throwsInvalidRound", () => {
    expect(() => parseRoundKeys([])).toThrow("INVALID_ROUND");
  });

  it("parseRoundKeys_notAList_throwsInvalidRound", () => {
    expect(() => parseRoundKeys(ROUND)).toThrow("INVALID_ROUND");
  });

  it("parseRoundKeys_bulkMax_accepted", () => {
    const rounds = Array.from({ length: ROUND_MAPS_BULK_MAX }, (_, index) => ({ ...ROUND, roundNumber: index + 1 }));
    expect(parseRoundKeys(rounds)).toHaveLength(ROUND_MAPS_BULK_MAX);
  });

  it("parseRoundKeys_overBulkMax_throwsInvalidRound", () => {
    const rounds = Array.from({ length: ROUND_MAPS_BULK_MAX + 1 }, (_, index) => ({ ...ROUND, roundNumber: index + 1 }));
    expect(() => parseRoundKeys(rounds)).toThrow("INVALID_ROUND");
  });

  it("parseRoundKeys_invalidEntry_throwsInvalidRound", () => {
    expect(() => parseRoundKeys([ROUND, null])).toThrow("INVALID_ROUND");
    expect(() => parseRoundKeys([{ ...ROUND, bracket: "NOPE" }])).toThrow("INVALID_ROUND");
  });
});

describe("setRoundsMaps", () => {
  const ROUND_3 = { ...ROUND, roundNumber: 3 };

  it("setRoundsMaps_severalRounds_locksOnceWritesEachPublishesOnce", async () => {
    route(connection.execute, [
      { pattern: /FROM bg_tournaments/, rows: [TOURNAMENT] },
      { pattern: /SELECT[\s\S]*FROM bg_tournament_round_maps/, rows: [] },
    ]);
    await expect(setRoundsMaps(7, [ROUND, ROUND_3], [["Ilios"]])).resolves.toEqual([["Ilios"]]);
    expect(connection.execute.mock.calls[0][0]).toMatch(/FROM bg_tournaments[\s\S]*FOR UPDATE/);
    expect(writes(/FROM bg_tournaments/)).toHaveLength(1);
    expect(writes(/INSERT INTO bg_tournament_round_maps/).map(([, params]) => params)).toEqual([
      [7, 0, "UPPER", 2, '[["Ilios"]]'],
      [7, 0, "UPPER", 3, '[["Ilios"]]'],
    ]);
    expect(publishMatchUpdatedEvent).toHaveBeenCalledTimes(1);
    expect(sendBotLog).not.toHaveBeenCalled();
    const [notice] = writes(/INSERT INTO bg_round_maps_notices/);
    expect(JSON.parse(String((notice[1] as unknown[])[1]))).toEqual([
      { phaseId: 0, bracket: "UPPER", roundNumber: 2 },
      { phaseId: 0, bracket: "UPPER", roundNumber: 3 },
    ]);
  });

  it("setRoundsMaps_everyRoundUnchanged_publishesNothing", async () => {
    route(connection.execute, [
      { pattern: /FROM bg_tournaments/, rows: [TOURNAMENT] },
      { pattern: /SELECT[\s\S]*FROM bg_tournament_round_maps/, rows: [{ ...ROUND, slots_json: '[["Ilios"]]' }] },
    ]);
    await setRoundsMaps(7, [ROUND, ROUND_3], [["Ilios"]]);
    expect(writes(/^\s*(INSERT|DELETE)/)).toHaveLength(0);
    expect(publishMatchUpdatedEvent).not.toHaveBeenCalled();
    expect(sendBotLog).not.toHaveBeenCalled();
  });

  it("setRoundsMaps_phaseOnNonMultiTournament_throwsInvalidRoundWithoutWriting", async () => {
    route(connection.execute, [{ pattern: /FROM bg_tournaments/, rows: [TOURNAMENT] }]);

    await expect(setRoundsMaps(7, [{ ...ROUND, phaseId: 4 }], [["Ilios"]])).rejects.toThrow("INVALID_ROUND");

    expect(writes(/^\s*(INSERT|DELETE)/)).toHaveLength(0);
    expect(connection.rollback).toHaveBeenCalled();
  });

  it("setRoundsMaps_phaseZeroOnMultiTournament_throwsInvalidRound", async () => {
    route(connection.execute, [{ pattern: /FROM bg_tournaments/, rows: [{ ...TOURNAMENT, format: "MULTI" }] }]);

    await expect(setRoundsMaps(7, [ROUND], [["Ilios"]])).rejects.toThrow("INVALID_ROUND");

    expect(writes(/FROM bg_tournament_phases/)).toHaveLength(0);
  });

  it("setRoundsMaps_phaseOfAnotherTournament_throwsInvalidRound", async () => {
    route(connection.execute, [
      { pattern: /FROM bg_tournaments/, rows: [{ ...TOURNAMENT, format: "MULTI" }] },
      { pattern: /FROM bg_tournament_phases/, rows: [] },
    ]);

    await expect(setRoundsMaps(7, [{ ...ROUND, phaseId: 99 }], [["Ilios"]])).rejects.toThrow("INVALID_ROUND");

    expect(writes(/FROM bg_tournament_phases/)[0][1]).toEqual([7, 99]);
    expect(writes(/^\s*(INSERT|DELETE)/)).toHaveLength(0);
  });

  it("setRoundsMaps_ownPhaseOnMultiTournament_writesRound", async () => {
    route(connection.execute, [
      { pattern: /FROM bg_tournaments/, rows: [{ ...TOURNAMENT, format: "MULTI" }] },
      { pattern: /FROM bg_tournament_phases/, rows: [{ id: 3 }] },
      { pattern: /SELECT[\s\S]*FROM bg_tournament_round_maps/, rows: [] },
    ]);

    await setRoundsMaps(7, [{ ...ROUND, phaseId: 3 }], [["Ilios"]]);

    expect(writes(/INSERT INTO bg_tournament_round_maps/)[0][1]).toEqual([7, 3, "UPPER", 2, '[["Ilios"]]']);
  });

  it("setRoundsMaps_mixedOwnAndForeignRounds_writesOwnOnly", async () => {
    route(connection.execute, [
      { pattern: /FROM bg_tournaments/, rows: [{ ...TOURNAMENT, format: "MULTI" }] },
      { pattern: /FROM bg_tournament_phases/, rows: [{ id: 3 }] },
      { pattern: /SELECT[\s\S]*FROM bg_tournament_round_maps/, rows: [] },
    ]);

    await setRoundsMaps(7, [{ ...ROUND, phaseId: 3 }, { ...ROUND, phaseId: 99 }], [["Ilios"]]);

    expect(writes(/INSERT INTO bg_tournament_round_maps/).map(([, params]) => params)).toEqual([[7, 3, "UPPER", 2, '[["Ilios"]]']]);
  });

  it("setRoundsMaps_clearOrphanRound_deletesWithoutPhaseCheck", async () => {
    route(connection.execute, [
      { pattern: /FROM bg_tournaments/, rows: [TOURNAMENT] },
      { pattern: /SELECT[\s\S]*FROM bg_tournament_round_maps/, rows: [{ ...ROUND, phaseId: 4, slots_json: '[["Ilios"]]' }] },
    ]);

    await setRoundsMaps(7, [{ ...ROUND, phaseId: 4 }], []);

    expect(writes(/DELETE FROM bg_tournament_round_maps/)).toHaveLength(1);
    expect(writes(/FROM bg_tournament_phases/)).toHaveLength(0);
  });

  it("setRoundsMaps_noRound_throwsInvalidRoundBeforeQuery", async () => {
    await expect(setRoundsMaps(7, [], [["Ilios"]])).rejects.toThrow("INVALID_ROUND");
    expect(withConnection).not.toHaveBeenCalled();
  });
});

describe("setTournamentMapRules", () => {
  const rules = { firstBan: "HOST", nextBan: "LOSER", nextPick: "LOSER" } as const;

  it("enregistre des règles changées et publie", async () => {
    route(connection.execute, [
      { pattern: /SELECT id, name, format/, rows: [{ ...TOURNAMENT, first_ban_rule: "NON_HOST", next_ban_rule: "LOSER", next_pick_rule: "LOSER" }] },
    ]);
    await setTournamentMapRules(7, rules);
    const [update] = writes(/UPDATE bg_tournaments SET first_ban_rule/);
    expect(update[1]).toEqual(["HOST", "LOSER", "LOSER", 7]);
    expect(publishMatchUpdatedEvent).toHaveBeenCalledWith(7);
    expect(jest.mocked(sendBotLog).mock.calls[0][0]).toContain("Règles de ban modifiées");
  });

  it("des règles inchangées n'écrivent rien", async () => {
    route(connection.execute, [
      { pattern: /SELECT id, name, format/, rows: [{ ...TOURNAMENT, first_ban_rule: "HOST", next_ban_rule: "LOSER", next_pick_rule: "LOSER" }] },
    ]);
    await setTournamentMapRules(7, rules);
    expect(writes(/^\s*UPDATE/)).toHaveLength(0);
    expect(publishMatchUpdatedEvent).not.toHaveBeenCalled();
  });

  it("setTournamentMapRules_anyRules_comparesAgainstLockedRowWithoutSecondSelect", async () => {
    route(connection.execute, [
      { pattern: /SELECT id, name, format/, rows: [{ ...TOURNAMENT, first_ban_rule: "NON_HOST", next_ban_rule: "LOSER", next_pick_rule: "LOSER" }] },
    ]);

    await setTournamentMapRules(7, rules);

    expect(writes(/FROM bg_tournaments/)).toHaveLength(1);
    expect(writes(/FROM bg_tournaments/)[0][0]).toMatch(/first_ban_rule[\s\S]*FOR UPDATE/);
  });
});

describe("pickMatchMap", () => {
  const POOL_ROUND = { ...ROUND, slots_json: '[["Ilios","Nepal"],["Busan","Oasis"],["Numbani"]]' };

  beforeEach(() => {
    // Par défaut, le lecteur ne joue pas le match (`clearAllMocks` garde les implémentations).
    jest.mocked(resolveMatchParty).mockResolvedValue(null);
  });

  function withMatch(match: Record<string, unknown>) {
    route(connection.execute, [
      { pattern: /FROM bg_tournaments/, rows: [TOURNAMENT] },
      { pattern: /FROM bg_matches/, rows: [match] },
      { pattern: /FROM bg_tournament_round_maps/, rows: [POOL_ROUND] },
    ]);
  }

  it("verrouille le tournoi avant de relire le match et son pool", async () => {
    withMatch(MATCH);
    await pickMatchMap(42, { userId: 3, staff: true }, 1, "Ilios");
    const sqls = connection.execute.mock.calls.map(([sql]) => sql);
    const tournamentLock = sqls.findIndex((sql) => /FROM bg_tournaments[\s\S]*LOCK IN SHARE MODE/.test(sql));
    const matchLock = sqls.findIndex((sql) => /FROM bg_matches[\s\S]*FOR UPDATE/.test(sql));
    const pool = sqls.findIndex((sql) => /FROM bg_tournament_round_maps/.test(sql));
    expect(tournamentLock).toBeGreaterThanOrEqual(0);
    expect(tournamentLock).toBeLessThan(matchLock);
    expect(matchLock).toBeLessThan(pool);
  });

  it("lit le tournoi du match hors transaction : le verrou du tournoi est la première instruction", async () => {
    withMatch(MATCH);
    await pickMatchMap(42, { userId: 3, staff: true }, 1, "Ilios");
    const begin = connection.beginTransaction.mock.invocationCallOrder[0];
    const calls = connection.execute.mock.calls.map(([sql], index) => ({
      sql,
      order: connection.execute.mock.invocationCallOrder[index],
    }));
    expect(calls.filter((call) => call.order < begin).map((call) => call.sql)).toEqual([
      expect.stringMatching(/^SELECT tournament_id[\s\S]*FROM bg_matches WHERE id = \? LIMIT 1$/),
    ]);
    expect(calls.find((call) => call.order > begin)?.sql).toMatch(/FROM bg_tournaments[\s\S]*LOCK IN SHARE MODE/);
  });

  it("pickMatchMap_tournamentLock_isSharedNotExclusive", async () => {
    withMatch(MATCH);

    await pickMatchMap(42, { userId: 3, staff: true }, 1, "Ilios");

    expect(writes(/FROM bg_tournaments[\s\S]*LOCK IN SHARE MODE/)).toHaveLength(1);
    expect(writes(/FROM bg_tournaments[\s\S]*FOR UPDATE/)).toHaveLength(0);
  });

  it("pickMatchMap_tournamentGoneUnderLock_throwsTournamentNotFound", async () => {
    route(connection.execute, [{ pattern: /FROM bg_matches/, rows: [MATCH] }]);

    await expect(pickMatchMap(42, { userId: 3, staff: true }, 1, "Ilios")).rejects.toThrow("TOURNAMENT_NOT_FOUND");
    expect(connection.rollback).toHaveBeenCalled();
  });

  it("pickMatchMap_rightLostAndMatchCompletedUnderLock_throwsNotMapPicker", async () => {
    route(connection.execute, [
      { pattern: /FROM bg_tournaments/, rows: [TOURNAMENT] },
      { pattern: /FROM bg_matches[\s\S]*FOR UPDATE/, rows: [{ ...MATCH, status: "COMPLETED" }] },
      { pattern: /FROM bg_matches/, rows: [{ ...MATCH, self_managed: 1 }] },
    ]);
    jest.mocked(resolveMatchParty).mockResolvedValue({ role: "TEAM1", canDeclareReady: true });

    await expect(pickMatchMap(42, { userId: 5, staff: false }, 1, "Ilios")).rejects.toThrow("NOT_MAP_PICKER");
  });

  it("pickMatchMap_clearPickOnSlotNowImposed_clearsIt", async () => {
    withMatch({ ...MATCH, map_picks: '{"3":"Oasis"}' });

    await pickMatchMap(42, { userId: 3, staff: true }, 3, null);

    expect(writes(/UPDATE bg_matches SET map_picks/)[0][1]).toEqual([null, 42]);
  });

  it("un match joué est refusé avant tout verrou, même au staff", async () => {
    withMatch({ ...MATCH, status: "COMPLETED" });
    await expect(pickMatchMap(42, { userId: 3, staff: true }, 1, "Ilios")).rejects.toThrow("MATCH_ALREADY_COMPLETED");
    expect(connection.beginTransaction).not.toHaveBeenCalled();
    expect(writes(/FOR UPDATE/)).toHaveLength(0);
  });

  it("un interblocage au verrou rejoue le choix, une connexion par essai", async () => {
    withMatch(MATCH);
    const routed = connection.execute.getMockImplementation();
    let deadlocked = false;
    connection.execute.mockImplementation(async (sql: string, params?: unknown) => {
      if (!deadlocked && /FROM bg_tournaments[\s\S]*LOCK IN SHARE MODE/.test(sql)) {
        deadlocked = true;
        throw Object.assign(new Error("Deadlock found when trying to get lock"), { code: "ER_LOCK_DEADLOCK" });
      }
      return routed!(sql, params);
    });
    await pickMatchMap(42, { userId: 3, staff: true }, 1, "Ilios");
    expect(withConnection).toHaveBeenCalledTimes(2);
    expect(connection.rollback).toHaveBeenCalledTimes(1);
    expect(writes(/UPDATE bg_matches SET first_map/)).toHaveLength(1);
    expect(publishMatchUpdatedEvent).toHaveBeenCalledWith(7);
  });

  it("un membre du staff qui joue le match ne choisit pas hors autogestion", async () => {
    withMatch(MATCH);
    jest.mocked(resolveMatchParty).mockResolvedValue({ role: "TEAM1", canDeclareReady: true });
    await expect(pickMatchMap(42, { userId: 3, staff: true }, 1, "Ilios")).rejects.toThrow("NOT_MAP_PICKER");
    expect(writes(/^\s*UPDATE/)).toHaveLength(0);
  });

  it("un membre du staff qui joue un match en autogestion choisit au nom de son équipe", async () => {
    withMatch({ ...MATCH, self_managed: 1 });
    jest.mocked(resolveMatchParty).mockResolvedValue({ role: "TEAM2", canDeclareReady: true });
    await pickMatchMap(42, { userId: 3, staff: true }, 1, "Ilios");
    expect(queueRefereeChange).toHaveBeenCalledWith(expect.anything(), { kind: "MAP_PICK", matchId: 42, set: true, byTeam: true });
  });

  it("un membre du staff qui ne joue pas le match choisit en arbitre, même s'il le caste", async () => {
    withMatch(MATCH);
    jest.mocked(resolveMatchParty).mockResolvedValue({ role: "CASTER", canDeclareReady: true });
    await pickMatchMap(42, { userId: 3, staff: true }, 1, "Ilios");
    expect(queueRefereeChange).toHaveBeenCalledWith(expect.anything(), { kind: "MAP_PICK", matchId: 42, set: true, byTeam: false });
  });

  it("le staff choisit la carte 1 : c'est `first_map`", async () => {
    withMatch(MATCH);
    await pickMatchMap(42, { userId: 3, staff: true }, 1, "nepal");
    expect(writes(/UPDATE bg_matches SET first_map/)[0][1]).toEqual(["Nepal", 42]);
    expect(queueRefereeChange).toHaveBeenCalledWith(expect.anything(), { kind: "MAP_PICK", matchId: 42, set: true, byTeam: false });
    expect(publishMatchUpdatedEvent).toHaveBeenCalledWith(7);
  });

  it("les cartes suivantes vont dans `map_picks`", async () => {
    withMatch(MATCH);
    await pickMatchMap(42, { userId: 3, staff: true }, 2, "Oasis");
    expect(writes(/UPDATE bg_matches SET map_picks/)[0][1]).toEqual(['{"2":"Oasis"}', 42]);
  });

  it("retirer le dernier choix vide la colonne", async () => {
    withMatch({ ...MATCH, map_picks: '{"2":"Oasis"}' });
    await pickMatchMap(42, { userId: 3, staff: true }, 2, null);
    expect(writes(/UPDATE bg_matches SET map_picks/)[0][1]).toEqual([null, 42]);
    expect(queueRefereeChange).toHaveBeenCalledWith(expect.anything(), { kind: "MAP_PICK", matchId: 42, set: false, byTeam: false });
  });

  it("un choix identique n'écrit rien", async () => {
    withMatch({ ...MATCH, first_map: "Nepal" });
    await pickMatchMap(42, { userId: 3, staff: true }, 1, "Nepal");
    expect(writes(/^\s*UPDATE/)).toHaveLength(0);
    expect(publishMatchUpdatedEvent).not.toHaveBeenCalled();
  });

  it("un joueur hors autogestion est refusé avant toute transaction", async () => {
    withMatch(MATCH);
    await expect(pickMatchMap(42, { userId: 5, staff: false }, 1, "Ilios")).rejects.toThrow("NOT_MAP_PICKER");
    expect(resolveMatchParty).not.toHaveBeenCalled();
    expect(connection.beginTransaction).not.toHaveBeenCalled();
  });

  it("un compte hors du match est refusé sans verrou, même sur un match joué", async () => {
    withMatch({ ...MATCH, status: "COMPLETED" });
    await expect(pickMatchMap(42, { userId: 5, staff: false }, 1, "Ilios")).rejects.toThrow("NOT_MAP_PICKER");
    expect(connection.beginTransaction).not.toHaveBeenCalled();
    expect(writes(/FOR UPDATE/)).toHaveLength(0);
  });

  it("l'autogestion retirée avant le verrou : le choix d'équipe est refusé à la relecture", async () => {
    route(connection.execute, [
      { pattern: /FROM bg_tournaments/, rows: [TOURNAMENT] },
      { pattern: /FROM bg_matches[\s\S]*FOR UPDATE/, rows: [MATCH] },
      { pattern: /FROM bg_matches/, rows: [{ ...MATCH, self_managed: 1 }] },
      { pattern: /FROM bg_tournament_round_maps/, rows: [POOL_ROUND] },
    ]);
    jest.mocked(resolveMatchParty).mockResolvedValue({ role: "TEAM1", canDeclareReady: true });
    await expect(pickMatchMap(42, { userId: 5, staff: false }, 1, "Ilios")).rejects.toThrow("NOT_MAP_PICKER");
    expect(writes(/^\s*UPDATE/)).toHaveLength(0);
    expect(connection.rollback).toHaveBeenCalled();
  });

  it("en autogestion, un joueur d'une équipe qui déclare « Prêt » choisit", async () => {
    withMatch({ ...MATCH, self_managed: 1 });
    jest.mocked(resolveMatchParty).mockResolvedValue({ role: "TEAM2", canDeclareReady: true });
    await pickMatchMap(42, { userId: 5, staff: false }, 1, "Ilios");
    expect(queueRefereeChange).toHaveBeenCalledWith(expect.anything(), { kind: "MAP_PICK", matchId: 42, set: true, byTeam: true });
  });

  it("en autogestion, un joueur qui ne déclare pas « Prêt » est refusé", async () => {
    withMatch({ ...MATCH, self_managed: 1 });
    jest.mocked(resolveMatchParty).mockResolvedValue({ role: "TEAM1", canDeclareReady: false });
    await expect(pickMatchMap(42, { userId: 5, staff: false }, 1, "Ilios")).rejects.toThrow("NOT_MAP_PICKER");
  });

  it("refuse un match absent ou joué, et un créneau imposé", async () => {
    route(connection.execute, []);
    await expect(pickMatchMap(42, { userId: 3, staff: true }, 1, "Ilios")).rejects.toThrow("MATCH_NOT_FOUND");
    withMatch({ ...MATCH, status: "COMPLETED" });
    await expect(pickMatchMap(42, { userId: 3, staff: true }, 1, "Ilios")).rejects.toThrow("MATCH_ALREADY_COMPLETED");
    withMatch(MATCH);
    await expect(pickMatchMap(42, { userId: 3, staff: true }, 3, "Numbani")).rejects.toThrow("INVALID_MAP_PICK");
  });
});
