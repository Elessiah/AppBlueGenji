import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/database");
jest.mock("@/lib/server/bot-integration");
jest.mock("@/lib/server/notify");

import type { PoolConnection } from "mysql2/promise";
import { flushBotLogs, queueBotLog } from "@/lib/server/tournaments/bot-logs";
import { isBotCircuitOpen } from "@/lib/server/bot-integration";
import { notifyStaff } from "@/lib/server/notify";
import { getDatabase } from "@/lib/server/database";
import { type SqlMock, fakePool } from "../../helpers/sql-double";

/**
 * Bot éteint pendant un litige verrouillé (`SCORE_DISPUTE_LOCK.md`) : si le
 * push a joint un arbitre, l'escalade est remise et sa réservation gardée —
 * la rendre la ferait repartir, push compris, à chaque passage d'entretien
 * jusqu'au retour du bot.
 */
const MATCH_ROW = {
  id: 31,
  bracket: "UPPER",
  round_number: 2,
  team1_score: null,
  team2_score: null,
  forfeit_team_id: null,
  is_bye: 0,
  team1_name: "Les Renards",
  team2_name: "Team Nova",
  tournament_id: 12,
  tournament_name: "Coupe BlueGenji",
};

function connection(): PoolConnection {
  return { execute: async () => [{ affectedRows: 1, insertId: 501 }, []] } as unknown as PoolConnection;
}

function mockDb(): SqlMock {
  const execute = jest.fn<(sql: string, params?: unknown[]) => Promise<unknown>>();
  execute.mockResolvedValueOnce([[MATCH_ROW]]);
  execute.mockResolvedValue([[]]);
  jest.mocked(getDatabase).mockResolvedValue(fakePool({ execute }));
  return execute as unknown as SqlMock;
}

function deletes(execute: SqlMock): string[] {
  return execute.mock.calls.map((call) => String(call[0])).filter((sql) => sql.trim().startsWith("DELETE"));
}

async function flushEscalation(): Promise<SqlMock> {
  const execute = mockDb();
  const conn = connection();
  queueBotLog(conn, { kind: "score_report_stalled", matchId: 31, claimId: 77 });
  flushBotLogs(conn);
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  return execute;
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(isBotCircuitOpen).mockReturnValue(false);
});

describe("escalade remise par le seul push", () => {
  it("garde la réservation quand Discord est injoignable mais qu'un arbitre a reçu le push", async () => {
    jest.mocked(notifyStaff).mockResolvedValue({ discord: null, pushed: 2, discordUnreachedUserIds: [] });
    const execute = await flushEscalation();
    expect(notifyStaff).toHaveBeenCalledTimes(1);
    expect(deletes(execute)).toHaveLength(0);
  });

  it("rend la réservation quand personne n'a été joint (ni Discord, ni push)", async () => {
    jest.mocked(notifyStaff).mockResolvedValue({ discord: null, pushed: 0, discordUnreachedUserIds: [] });
    const execute = await flushEscalation();
    const released = deletes(execute);
    expect(released).toHaveLength(1);
    expect(released[0]).toContain("bg_referee_alerts");
  });
});
