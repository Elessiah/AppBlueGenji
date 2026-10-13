import { describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/database");

import { getDatabase } from "@/lib/server/database";
import { forgetMatchReminders, releaseDatedMarks } from "@/lib/server/tournaments/reminder-marks";
import { connectionMock, fakeConnection, fakePool, type SqlQuery } from "../../helpers/sql-double";

describe("releaseDatedMarks", () => {
  it("ne rend que les marques prises pour cet horaire", async () => {
    const execute = jest.fn<SqlQuery>().mockResolvedValue([{ affectedRows: 2 }]);
    jest.mocked(getDatabase).mockResolvedValue(fakePool({ execute }));
    const start = new Date("2099-01-01T18:00:00Z");

    await releaseDatedMarks(31, ["SEEN", "P1D"], start);

    const [sql, params] = execute.mock.calls[0] as unknown as [string, unknown[]];
    expect(sql).toMatch(/WHERE match_id = \? AND offset_key IN \(\?, \?\) AND start_at <=> \?$/);
    expect(params).toEqual([31, "SEEN", "P1D", start]);
  });

  it("ne lit rien sans marque à rendre", async () => {
    const execute = jest.fn<SqlQuery>();
    jest.mocked(getDatabase).mockResolvedValue(fakePool({ execute }));
    await releaseDatedMarks(31, [], new Date());
    expect(execute).not.toHaveBeenCalled();
  });

  it("ne lève jamais, mais dit l'échec dans pm2 (sauf table absente)", async () => {
    const error = jest.spyOn(console, "error").mockImplementation(() => undefined);
    const failing = jest.fn<SqlQuery>().mockRejectedValue(new Error("Lock wait timeout exceeded"));
    jest.mocked(getDatabase).mockResolvedValue(fakePool({ execute: failing }));
    await expect(releaseDatedMarks(31, ["SEEN"], new Date())).resolves.toBeUndefined();
    expect(error).toHaveBeenCalledTimes(1);

    const missing = jest
      .fn<SqlQuery>()
      .mockRejectedValue(Object.assign(new Error("no table"), { code: "ER_NO_SUCH_TABLE", errno: 1146 }));
    jest.mocked(getDatabase).mockResolvedValue(fakePool({ execute: missing }));
    await releaseDatedMarks(31, ["SEEN"], new Date());
    expect(error).toHaveBeenCalledTimes(1);
    error.mockRestore();
  });
});

describe("forgetMatchReminders", () => {
  it("efface les marques des manches données, par lots", async () => {
    const connection = connectionMock();
    connection.execute.mockResolvedValue([{ affectedRows: 1 }]);
    const ids = Array.from({ length: 501 }, (_, index) => index + 1);

    await forgetMatchReminders(fakeConnection(connection), ids);

    expect(connection.execute).toHaveBeenCalledTimes(2);
    const [sql, params] = connection.execute.mock.calls[0] as unknown as [string, number[]];
    expect(sql).toMatch(/^DELETE FROM bg_match_reminders WHERE match_id IN \(\?(, \?){499}\)$/);
    expect(params).toHaveLength(500);
    expect((connection.execute.mock.calls[1] as unknown as [string, number[]])[1]).toEqual([501]);
  });

  it("ne fait rien sans manche", async () => {
    const connection = connectionMock();
    await forgetMatchReminders(fakeConnection(connection), []);
    expect(connection.execute).not.toHaveBeenCalled();
  });

  it("tolère une table absente", async () => {
    const connection = connectionMock();
    connection.execute.mockRejectedValue(Object.assign(new Error("no table"), { code: "ER_NO_SUCH_TABLE", errno: 1146 }));
    await expect(forgetMatchReminders(fakeConnection(connection), [7])).resolves.toBeUndefined();
  });

  it("laisse passer toute autre erreur", async () => {
    const connection = connectionMock();
    connection.execute.mockRejectedValue(new Error("deadlock"));
    await expect(forgetMatchReminders(fakeConnection(connection), [7])).rejects.toThrow("deadlock");
  });
});
