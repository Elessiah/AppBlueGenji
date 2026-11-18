import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/auth");

import { resolveRoles } from "@/lib/server/auth";
import {
  loadPlanningData,
  loadPlanningEntries,
  loadHiddenTournamentIds,
  loadPlanningMembersByIds,
  parseEntryKey,
  type LoadedMember,
} from "@/lib/server/planning/load";
import { PLANNING_HORIZON_DAYS, PLANNING_PAST_DAYS } from "@/lib/shared/planning";
import { DEFAULT_PLANNING_DURATIONS } from "@/lib/shared/planning-durations";
import { HOUR_MS, loadedMember, MONDAY } from "../../../helpers/planning";
import { connectionMock, fakeConnection } from "../../../helpers/sql-double";

/** Lecture du planning : fenêtre bornée, une seule entrée, lectures groupées (`CAST_PLANNING.md` § Performance). */

const DAY_MS = 24 * HOUR_MS;
const connection = connectionMock();
const executor = fakeConnection(connection);

/** Une base simulée qui répond selon la table lue. */
function routeSql(tables: { tournaments?: unknown[]; matches?: unknown[]; casters?: unknown[] } = {}) {
  connection.execute.mockImplementation(async (sql: string) => {
    if (sql.includes("FROM bg_settings")) return [[], []];
    if (sql.includes("FROM bg_tournaments t")) return [tables.tournaments ?? [], []];
    if (sql.includes("FROM bg_matches m")) return [tables.matches ?? [], []];
    if (sql.includes("FROM bg_match_casters")) return [tables.casters ?? [], []];
    return [[], []];
  });
}

const tournamentRow = (overrides: Record<string, unknown> = {}) => ({
  id: 10,
  name: "Coupe",
  game: "OW",
  state: "REGISTRATION",
  start_at: new Date(MONDAY + 2 * DAY_MS),
  live_url: null,
  referee_scheduling: 0,
  hidden: 0,
  match_format_type: null,
  match_format_value: null,
  match_format_max_maps: null,
  ...overrides,
});

const matchRow = (id: number) => ({
  id,
  tournament_id: 10,
  start_at: new Date(MONDAY + DAY_MS),
  status: "READY",
  round_number: 1,
  team1_id: null,
  team2_id: null,
  team1_name: null,
  team2_name: null,
  team1_solo: null,
  team2_solo: null,
  referee_user_id: null,
  self_managed: 0,
  stream_url: null,
});

/** Les paramètres de la première requête dont le texte contient `fragment`. */
function callWith(fragment: string): [string, unknown[]] {
  const call = connection.execute.mock.calls.find(([sql]) => sql.includes(fragment));
  if (!call) throw new Error(`aucune requête ne contient ${fragment}`);
  return [call[0], call[1] as unknown[]];
}

beforeEach(() => {
  jest.clearAllMocks();
  routeSql();
});

describe("parseEntryKey", () => {
  it("parseEntryKey_matchKey_isMatchKind", () => {
    expect(parseEntryKey("m:42")).toEqual({ kind: "MATCH", id: 42 });
  });

  it("parseEntryKey_tournamentKey_isTournamentKind", () => {
    expect(parseEntryKey("t:7")).toEqual({ kind: "TOURNAMENT", id: 7 });
  });

  it("parseEntryKey_malformedKeys_null", () => {
    for (const key of ["", "x:1", "m:", "m:0", "m:01", "m:-1", "m:1 OR 1=1", "m:1:2", "M:1", "m:99999999999999999"]) {
      expect(parseEntryKey(key)).toBeNull();
    }
  });
});

describe("loadPlanningEntries — fenêtre", () => {
  it("loadPlanningEntries_window_boundedBelowAndAbove", async () => {
    await loadPlanningEntries(executor, { now: MONDAY, includeHidden: true });

    const [, params] = callWith("FROM bg_tournaments t");
    expect((params[0] as Date).getTime()).toBe(MONDAY - PLANNING_PAST_DAYS * DAY_MS);
    expect((params[1] as Date).getTime()).toBe(MONDAY + PLANNING_HORIZON_DAYS * DAY_MS);
    expect(params[2]).toEqual(params[0]);
    expect(params[3]).toEqual(params[1]);
  });

  it("loadPlanningEntries_eventBeyondHorizon_dropped", async () => {
    routeSql({ tournaments: [tournamentRow({ start_at: new Date(MONDAY + (PLANNING_HORIZON_DAYS + 1) * DAY_MS) })] });

    expect(await loadPlanningEntries(executor, { now: MONDAY, includeHidden: true })).toEqual([]);
  });

  it("loadPlanningEntries_eventInsideHorizon_kept", async () => {
    routeSql({ tournaments: [tournamentRow({ start_at: new Date(MONDAY + (PLANNING_HORIZON_DAYS - 1) * DAY_MS) })] });

    const entries = await loadPlanningEntries(executor, { now: MONDAY, includeHidden: true });

    expect(entries.map((entry) => entry.key)).toEqual(["t:10"]);
  });

  it("loadPlanningEntries_scheduledTournament_matchQueryBoundedAbove", async () => {
    routeSql({ tournaments: [tournamentRow({ referee_scheduling: 1 })] });

    await loadPlanningEntries(executor, { now: MONDAY, includeHidden: true });

    const [sql, params] = callWith("FROM bg_matches m");
    expect(sql).toContain("m.start_at < ?");
    expect(params.at(-1)).toEqual(new Date(MONDAY + PLANNING_HORIZON_DAYS * DAY_MS));
  });
});

describe("loadPlanningEntries — une seule entrée", () => {
  it("loadPlanningEntries_onlyMatch_filtersTournamentAndMatchById", async () => {
    routeSql({ tournaments: [tournamentRow({ referee_scheduling: 1 })] });

    await loadPlanningEntries(executor, { now: MONDAY, includeHidden: false, only: { kind: "MATCH", id: 5 } });

    const [tournamentSql, tournamentParams] = callWith("FROM bg_tournaments t");
    expect(tournamentSql).toContain("om.id = ?");
    expect(tournamentParams.at(-1)).toBe(5);
    const [matchSql, matchParams] = callWith("FROM bg_matches m");
    expect(matchSql).toContain("AND m.id = ?");
    expect(matchParams.at(-1)).toBe(5);
  });

  it("loadPlanningEntries_onlyTournament_filtersById", async () => {
    await loadPlanningEntries(executor, { now: MONDAY, includeHidden: true, only: { kind: "TOURNAMENT", id: 10 } });

    const [sql, params] = callWith("FROM bg_tournaments t");
    expect(sql).toContain("AND t.id = ?");
    expect(params.at(-1)).toBe(10);
  });

  it("loadPlanningEntries_givenDurations_settingsNotReadAgain", async () => {
    await loadPlanningEntries(executor, { now: MONDAY, includeHidden: true, durations: DEFAULT_PLANNING_DURATIONS });

    expect(connection.execute.mock.calls.some(([sql]) => sql.includes("FROM bg_settings"))).toBe(false);
  });

  it("loadPlanningEntries_noOnly_noIdFilter", async () => {
    await loadPlanningEntries(executor, { now: MONDAY, includeHidden: true });

    const [sql] = callWith("FROM bg_tournaments t");
    expect(sql).not.toContain("AND t.id = ?");
    expect(sql).not.toContain("om.id");
  });
});

describe("loadPlanningMembersByIds", () => {
  it("loadPlanningMembersByIds_noIds_noQuery", async () => {
    expect(await loadPlanningMembersByIds(executor, [])).toEqual([]);
    expect(connection.execute).not.toHaveBeenCalled();
  });

  it("loadPlanningMembersByIds_ids_readByKeyAliveOnly", async () => {
    connection.execute.mockResolvedValue([[], []]);

    await loadPlanningMembersByIds(executor, [4, 9]);

    const [sql, params] = connection.execute.mock.calls[0];
    expect(sql).toContain("u.id IN (?, ?) AND u.is_deleted = 0");
    expect(params).toEqual([4, 9]);
  });

  it("loadPlanningMembersByIds_rows_rolesResolvedRolelessDropped", async () => {
    jest.mocked(resolveRoles).mockImplementation((_isAdmin, raw) => (raw === '["CASTER"]' ? ["CASTER"] : []));
    connection.execute.mockResolvedValue([
      [
        { id: 4, pseudo: "Caster", is_admin: 0, platform_roles_json: '["CASTER"]', solo_caster: 1 },
        { id: 9, pseudo: "Ancien", is_admin: 0, platform_roles_json: "[]", solo_caster: null },
      ],
      [],
    ]);

    expect(await loadPlanningMembersByIds(executor, [4, 9])).toEqual([
      { userId: 4, pseudo: "Caster", roles: ["CASTER"], soloCaster: true, seesHidden: false },
    ]);
  });

  it("loadPlanningMembersByIds_lock_shareLockOnAccountsOnly", async () => {
    connection.execute.mockResolvedValue([[], []]);

    await loadPlanningMembersByIds(executor, [4], { lock: true });

    const [sql] = connection.execute.mock.calls[0];
    expect(sql).toContain("LOCK IN SHARE MODE");
    expect(sql).not.toContain("JOIN");
  });

  it("loadPlanningMembersByIds_admin_seesHidden", async () => {
    jest.mocked(resolveRoles).mockReturnValue([]);
    connection.execute.mockResolvedValue([[{ id: 1, pseudo: "Admin", is_admin: 1, platform_roles_json: null, solo_caster: null }], []]);

    const [admin] = await loadPlanningMembersByIds(executor, [1]);

    expect(admin.seesHidden).toBe(true);
  });
});

describe("loadHiddenTournamentIds", () => {
  it("loadHiddenTournamentIds_noIds_noQuery", async () => {
    expect(await loadHiddenTournamentIds(executor, [])).toEqual(new Set());
    expect(connection.execute).not.toHaveBeenCalled();
  });

  it("loadHiddenTournamentIds_rows_onlyHiddenReturnedUnderShareLock", async () => {
    connection.execute.mockResolvedValue([
      [
        { id: 10, hidden: 1 },
        { id: 11, hidden: 0 },
      ],
      [],
    ]);

    const hidden = await loadHiddenTournamentIds(executor, [10, 11]);

    expect(hidden).toEqual(new Set([10]));
    const [sql, params] = connection.execute.mock.calls[0];
    expect(sql).toContain("LOCK IN SHARE MODE");
    expect(params).toEqual([10, 11]);
  });
});

describe("loadPlanningData", () => {
  it("loadPlanningData_withdrawals_readAndExcludedFromRole", async () => {
    routeSql({ tournaments: [tournamentRow()] });
    const plain = connection.execute.getMockImplementation();
    connection.execute.mockImplementation(async (sql: string, params?: unknown) => {
      if (sql.includes("kind = 'WITHDRAWN'")) {
        return [
          [
            { id: 8, entry_key: "t:10", user_id: 5, role: "CASTER", kind: "WITHDRAWN", source: "AUTO", reason: null, late: 0, created_at: new Date("2026-11-20T10:00:00Z") },
            { id: 9, entry_key: "t:10", user_id: 6, role: "PROD", kind: "REMOVED", source: "MANUAL", reason: null, late: 0, created_at: new Date("2026-11-19T10:00:00Z") },
            { id: 7, entry_key: "t:10", user_id: 4, role: "CASTER", kind: "WITHDRAWN", source: "MANUAL", reason: "Malade", late: 1, created_at: new Date("2026-11-20T10:00:00Z") },
          ],
          [],
        ];
      }
      return plain ? plain(sql, params) : [[], []];
    });

    const data = await loadPlanningData(executor, { now: MONDAY, includeHidden: true, members: [] });

    // Une seule lecture pour retraits et désistements ; les désistements sortent par date puis identifiant.
    expect(connection.execute.mock.calls.filter(([sql]) => sql.includes("FROM bg_planning_events"))).toHaveLength(1);
    expect(data.withdrawals.map((row) => row.userId)).toEqual([4, 5]);
    expect(data.withdrawals[0]).toEqual({ entryKey: "t:10", userId: 4, role: "CASTER", reason: "Malade", late: true, confirmed: true, createdAt: "2026-11-20T10:00:00.000Z" });
    expect(data.removals).toContainEqual({ entryKey: "t:10", userId: 4, role: "CASTER" });
    expect(data.removals).toContainEqual({ entryKey: "t:10", userId: 6, role: "PROD" });
  });

  it("loadPlanningData_reads_settingsOnce_andCarriesThem", async () => {
    routeSql({ tournaments: [tournamentRow()] });

    const data = await loadPlanningData(executor, { now: MONDAY, includeHidden: true, members: [] });

    expect(connection.execute.mock.calls.filter(([sql]) => sql.includes("FROM bg_settings"))).toHaveLength(1);
    expect(data.durations).toEqual(DEFAULT_PLANNING_DURATIONS);
  });

  it("loadPlanningData_membersGiven_userTableNotScanned", async () => {
    routeSql({ tournaments: [tournamentRow()] });
    const members: LoadedMember[] = [loadedMember({ userId: 3 })];

    const data = await loadPlanningData(executor, { now: MONDAY, includeHidden: true, members });

    expect(data.members).toBe(members);
    expect(connection.execute.mock.calls.some(([sql]) => sql.includes("FROM bg_users"))).toBe(false);
  });

  it("loadPlanningData_noMembersGiven_usersRead", async () => {
    routeSql({ tournaments: [tournamentRow()] });

    await loadPlanningData(executor, { now: MONDAY, includeHidden: true });

    expect(connection.execute.mock.calls.some(([sql]) => sql.includes("FROM bg_users u"))).toBe(true);
  });

  it("loadPlanningData_availabilityOf_onlyThatAccountRead", async () => {
    routeSql({ tournaments: [tournamentRow()] });

    await loadPlanningData(executor, { now: MONDAY, includeHidden: true, members: [], availabilityOf: 4 });

    const [sql, params] = connection.execute.mock.calls.find(([text]) => text.includes("FROM bg_planning_availability")) ?? [];
    expect(sql).toContain("AND user_id = ?");
    expect(params).toEqual(["t:10", 4]);
  });

  it("loadPlanningData_noAvailabilityOf_everyoneRead", async () => {
    routeSql({ tournaments: [tournamentRow()] });

    await loadPlanningData(executor, { now: MONDAY, includeHidden: true, members: [] });

    const [sql] = connection.execute.mock.calls.find(([text]) => text.includes("FROM bg_planning_availability")) ?? [];
    expect(sql).not.toContain("user_id = ?");
  });

  it("loadPlanningData_noEntries_availabilityNotRead", async () => {
    const data = await loadPlanningData(executor, { now: MONDAY, includeHidden: true, members: [] });

    expect(data.entries).toEqual([]);
    expect(connection.execute.mock.calls.some(([sql]) => sql.includes("bg_planning_availability"))).toBe(false);
  });

  it("loadPlanningData_matchCasters_groupedPerEntryInOrder", async () => {
    routeSql({
      tournaments: [tournamentRow({ referee_scheduling: 1 })],
      matches: [matchRow(1)],
      casters: [
        { match_id: 1, user_id: 4 },
        { match_id: 1, user_id: 6 },
      ],
    });

    const data = await loadPlanningData(executor, { now: MONDAY, includeHidden: true, members: [] });

    expect(data.matchCasters.get("m:1")).toEqual([4, 6]);
  });
});
