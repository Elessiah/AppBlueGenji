import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { listOwnMatchRoles } from "@/lib/server/users/match-roles-export";
import { type SqlMock, type SqlQuery, fakePool } from "../../helpers/sql-double";

jest.mock("@/lib/server/database");

/**
 * Les matchs où le titulaire a tenu un rôle, dans son export
 * (`docs/features/RGPD_DATA_RIGHTS.md`) : inscriptions de caster, liens de
 * chaîne fournis, arbitrages désignés, modes d'antenne posés.
 */

async function mockDb(execute: SqlMock) {
  const { getDatabase } = await import("@/lib/server/database");
  jest.mocked(getDatabase).mockResolvedValue(fakePool({ execute }));
}

/**
 * Les quatre lectures partent ensemble (`Promise.all`) : une relecture suit
 * les trois autres premières lectures. Ce double répond **par table lue**
 * (`casts`, `links`, `referee`, `triggers`), chaque entrée servant ses
 * réponses dans l'ordre, la dernière ensuite.
 */
function bySql(answers: Partial<Record<"casts" | "links" | "referee" | "triggers", (unknown[] | Error)[]>>) {
  const served: Record<string, number> = {};
  return jest.fn<SqlQuery>(async (rawSql) => {
    const sql = String(rawSql);
    const key = sql.includes("FROM bg_match_casters")
      ? "casts"
      : sql.includes("FROM bg_match_streams")
        ? "links"
        : sql.includes("referee_user_id = ?")
          ? "referee"
          : "triggers";
    const list = answers[key] ?? [[]];
    const index = Math.min(served[key] ?? 0, list.length - 1);
    served[key] = index + 1;
    const answer = list[index];
    if (answer instanceof Error) throw answer;
    return [answer];
  });
}

const callsOn = (execute: SqlMock, table: string) =>
  execute.mock.calls.map(([sql]) => String(sql)).filter((sql) => sql.includes(table));

const missingTable = () => Object.assign(new Error("Table 'bg_match_casters' doesn't exist"), { code: "ER_NO_SUCH_TABLE" });
const unknownColumn = () => Object.assign(new Error("Unknown column 's.link_user_id'"), { code: "ER_BAD_FIELD_ERROR" });

describe("listOwnMatchRoles", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("listOwnMatchRoles_rowsForEachRole_mapsThemForTheExport", async () => {
    const execute = jest
      .fn<SqlQuery>()
      .mockResolvedValueOnce([[
        { match_id: 5, tournament_id: 2, stream_id: 3, ready_at: new Date("2026-10-20T18:00:00Z"), created_at: new Date("2026-10-20T17:00:00Z"), cast_battletag: "Voix#2100" },
      ]])
      .mockResolvedValueOnce([[
        { match_id: 5, tournament_id: 2, live_url: "https://twitch.tv/voix", created_at: new Date("2026-10-20T17:00:00Z") },
      ]])
      .mockResolvedValueOnce([[{ id: 6, tournament_id: 2, referee_ready_at: null }]])
      .mockResolvedValueOnce([[{ id: 7, tournament_id: 2, live_trigger: "MANUAL" }]]);
    await mockDb(execute);

    expect(await listOwnMatchRoles(12)).toEqual({
      // Le BattleTag de cast est une donnée gardée : l'export la rend (art. 15).
      casts: [{ matchId: 5, tournamentId: 2, streamId: 3, readyAt: "2026-10-20T18:00:00.000Z", createdAt: "2026-10-20T17:00:00.000Z", castBattletag: "Voix#2100" }],
      providedStreamLinks: [{ matchId: 5, tournamentId: 2, liveUrl: "https://twitch.tv/voix", createdAt: "2026-10-20T17:00:00.000Z" }],
      refereeAssignments: [{ matchId: 6, tournamentId: 2, readyAt: null }],
      // Le compte qui a posé le mode d'antenne est une donnée gardée (CAST-FOLLOWUP).
      liveTriggers: [{ matchId: 7, tournamentId: 2, liveTrigger: "MANUAL" }],
    });
  });

  it("listOwnMatchRoles_anyRead_bindsOnlyTheHolderId", async () => {
    const execute = jest.fn<SqlQuery>().mockResolvedValue([[]]);
    await mockDb(execute);

    await listOwnMatchRoles(12);

    expect(execute.mock.calls.map(([, params]) => params)).toEqual([[12], [12], [12], [12]]);
    expect(execute.mock.calls[0][0]).toMatch(/WHERE c\.user_id = \?/);
    expect(execute.mock.calls[1][0]).toMatch(/WHERE s\.link_user_id = \?/);
    expect(execute.mock.calls[2][0]).toMatch(/WHERE referee_user_id = \?/);
    expect(execute.mock.calls[3][0]).toMatch(/WHERE live_trigger_user_id = \?/);
  });

  it("listOwnMatchRoles_noRole_returnsEmptyLists", async () => {
    await mockDb(jest.fn<SqlQuery>().mockResolvedValue([[]]));

    expect(await listOwnMatchRoles(12)).toEqual({ casts: [], providedStreamLinks: [], refereeAssignments: [], liveTriggers: [] });
  });

  it("listOwnMatchRoles_missingTable_returnsEmptyForThatReadOnly", async () => {
    const execute = jest
      .fn<SqlQuery>()
      .mockRejectedValueOnce(missingTable())
      .mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([[{ id: 6, tournament_id: 2, referee_ready_at: null }]])
      .mockResolvedValueOnce([[]]);
    await mockDb(execute);

    const roles = await listOwnMatchRoles(12);

    expect(roles.casts).toEqual([]);
    expect(roles.refereeAssignments).toEqual([{ matchId: 6, tournamentId: 2, readyAt: null }]);
  });

  it("listOwnMatchRoles_unknownColumn_returnsEmptyForThatReadOnly", async () => {
    const execute = jest
      .fn<SqlQuery>()
      .mockResolvedValueOnce([[]])
      .mockRejectedValueOnce(unknownColumn())
      .mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([[]]);
    await mockDb(execute);

    expect((await listOwnMatchRoles(12)).providedStreamLinks).toEqual([]);
  });

  it("listOwnMatchRoles_liveTriggerColumnMissing_returnsEmptyTriggersOnly", async () => {
    const execute = jest
      .fn<SqlQuery>()
      .mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([[{ id: 6, tournament_id: 2, referee_ready_at: null }]])
      .mockRejectedValueOnce(unknownColumn());
    await mockDb(execute);

    const roles = await listOwnMatchRoles(12);

    // Migration CAST-FOLLOWUP pas encore jouée : l'export part quand même.
    expect(roles.liveTriggers).toEqual([]);
    expect(roles.refereeAssignments).toEqual([{ matchId: 6, tournamentId: 2, readyAt: null }]);
  });

  // ERREUR.txt (revue EF-21 #526, art. 15) : une colonne récente absente ne
  // vide plus toute la lecture — elle seule est lue NULL.
  it("listOwnMatchRoles_refereeReadyAtMissing_keepsAssignmentsWithNullReady", async () => {
    const execute = bySql({
      referee: [
        Object.assign(new Error("Unknown column 'referee_ready_at' in 'field list'"), { code: "ER_BAD_FIELD_ERROR" }),
        [{ id: 6, tournament_id: 2, referee_ready_at: null }],
      ],
    });
    await mockDb(execute);

    const roles = await listOwnMatchRoles(12);

    expect(roles.refereeAssignments).toEqual([{ matchId: 6, tournamentId: 2, readyAt: null }]);
    expect(roles.liveTriggers).toEqual([]);
    expect(callsOn(execute, "referee_user_id = ?")[1]).toContain("NULL AS referee_ready_at");
  });

  // Revue sécurité #579 : le nom se lit quelle que soit la langue du serveur.
  it("listOwnMatchRoles_localizedUnknownColumnMessage_dropsTheNamedColumnOnly", async () => {
    const execute = bySql({
      casts: [Object.assign(new Error("Champ 'c.ready_at' inconnu dans field list"), { code: "ER_BAD_FIELD_ERROR" }), []],
    });
    await mockDb(execute);

    await listOwnMatchRoles(12);

    const retried = callsOn(execute, "FROM bg_match_casters")[1];
    expect(retried).toContain("NULL AS ready_at");
    expect(retried).toContain("c.created_at AS created_at");
    expect(retried).toContain("c.cast_battletag AS cast_battletag");
  });

  it("listOwnMatchRoles_casterReadyAtMissing_keepsCastsAndOtherColumns", async () => {
    const execute = bySql({
      casts: [
        Object.assign(new Error("Unknown column 'c.ready_at' in 'field list'"), { code: "ER_BAD_FIELD_ERROR" }),
        [{ match_id: 5, tournament_id: 2, stream_id: 3, ready_at: null, created_at: new Date("2026-10-20T17:00:00Z"), cast_battletag: "Voix#2100" }],
      ],
    });
    await mockDb(execute);

    const roles = await listOwnMatchRoles(12);

    expect(roles.casts).toEqual([
      { matchId: 5, tournamentId: 2, streamId: 3, readyAt: null, createdAt: "2026-10-20T17:00:00.000Z", castBattletag: "Voix#2100" },
    ]);
    const retried = callsOn(execute, "FROM bg_match_casters")[1];
    expect(retried).toContain("NULL AS ready_at");
    expect(retried).toContain("c.created_at AS created_at");
    expect(retried).toContain("c.cast_battletag AS cast_battletag");
  });

  it("listOwnMatchRoles_casterCreatedAtMissing_ordersByMatchOnly", async () => {
    const execute = bySql({
      casts: [Object.assign(new Error("Unknown column 'c.created_at' in 'field list'"), { code: "ER_BAD_FIELD_ERROR" }), []],
    });
    await mockDb(execute);

    await listOwnMatchRoles(12);

    const retried = callsOn(execute, "FROM bg_match_casters")[1];
    expect(retried).toContain("NULL AS created_at");
    expect(retried).toMatch(/ORDER BY c\.match_id/);
  });

  it("listOwnMatchRoles_unnamedUnknownColumn_dropsLatestOptionalFirst", async () => {
    const execute = bySql({ casts: [Object.assign(new Error("bad field"), { code: "ER_BAD_FIELD_ERROR" }), []] });
    await mockDb(execute);

    await listOwnMatchRoles(12);

    expect(callsOn(execute, "FROM bg_match_casters")[1]).toContain("NULL AS cast_battletag");
  });

  it("listOwnMatchRoles_otherFailure_rethrows", async () => {
    await mockDb(jest.fn<SqlQuery>().mockRejectedValueOnce(new Error("DB_DOWN")));

    await expect(listOwnMatchRoles(12)).rejects.toThrow("DB_DOWN");
  });
});

describe("listOwnMatchRoles — lectures lancées ensemble", () => {
  it("listOwnMatchRoles_fourReads_startBeforeAnyResolves", async () => {
    // Aucune lecture n'attend la précédente : les quatre partent avant toute réponse.
    let started = 0;
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const execute = jest.fn<SqlQuery>(async () => {
      started += 1;
      await gate;
      return [[]];
    });
    await mockDb(execute);

    const pending = listOwnMatchRoles(12);
    await new Promise((resolve) => setImmediate(resolve));
    expect(started).toBe(4);
    release();
    await expect(pending).resolves.toEqual({ casts: [], providedStreamLinks: [], refereeAssignments: [], liveTriggers: [] });
  });
});
