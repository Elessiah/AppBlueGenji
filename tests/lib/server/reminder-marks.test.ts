import { describe, expect, it } from "@jest/globals";
import { forgetMatchReminders } from "@/lib/server/tournaments/reminder-marks";
import { connectionMock, fakeConnection } from "../../helpers/sql-double";

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
