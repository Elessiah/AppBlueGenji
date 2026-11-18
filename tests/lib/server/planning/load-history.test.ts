import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/auth");

import { loadPlanningHistory } from "@/lib/server/planning/load";
import { connectionMock, fakeConnection } from "../../../helpers/sql-double";
import { MONDAY } from "../../../helpers/planning";

/** Équité : le travail tenu des semaines passées (`CAST_PLANNING.md` § Calcul). */

const connection = connectionMock();

beforeEach(() => {
  jest.clearAllMocks();
  connection.execute.mockResolvedValue([[{ user_id: 4, jobs: 2 }], []]);
});

describe("loadPlanningHistory", () => {
  it("loadPlanningHistory_rows_mappedByUser", async () => {
    const actual = await loadPlanningHistory(fakeConnection(connection), MONDAY);

    expect(actual).toEqual(new Map([[4, 2]]));
  });

  it("loadPlanningHistory_castSignup_hiddenOnlyByHeldPlanningRow", async () => {
    await loadPlanningHistory(fakeConnection(connection), MONDAY);

    const sql = connection.execute.mock.calls[0][0].replace(/\s+/g, " ");
    expect(sql).toContain("pa.role = 'CASTER' AND (pa.source = 'MANUAL' OR pa.confirmed = 1))");
  });
});
