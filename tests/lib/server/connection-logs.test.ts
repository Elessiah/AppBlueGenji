import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { headers } from "next/headers";
import { getDatabase } from "@/lib/server/database";
import {
  listOwnConnectionLogs,
  purgeExpiredConnectionLogs,
  recordConnection,
  resetConnectionLogPurgeForTests,
} from "@/lib/server/connection-logs";
import { CONNECTION_LOG_RETENTION_DAYS } from "@/lib/shared/connection-logs";
import { type SqlQuery, fakePool } from "../../helpers/sql-double";

jest.mock("@/lib/server/database");
jest.mock("next/headers", () => ({ headers: jest.fn() }));

const originalEnv = { ...process.env };

function withHeaders(values: Record<string, string>) {
  const map = new Headers(values);
  jest.mocked(headers).mockResolvedValue(map as Awaited<ReturnType<typeof headers>>);
}

describe("journal des données de connexion (serveur)", () => {
  let execute: jest.Mock<SqlQuery>;
  let errorSpy: jest.SpiedFunction<typeof console.error>;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...originalEnv };
    delete process.env.TRUSTED_PROXY_HOPS;
    delete process.env.TRUSTED_PROXY_REAL_IP;
    resetConnectionLogPurgeForTests();
    execute = jest.fn<SqlQuery>().mockResolvedValue([{ affectedRows: 0 }]);
    jest.mocked(getDatabase).mockResolvedValue(fakePool({ execute }));
    errorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    errorSpy.mockRestore();
    process.env = { ...originalEnv };
  });

  it("écrit compte, porte et adresse retenue par le proxy de confiance", async () => {
    // Le client forge l'entrée de gauche ; le proxy (1 relais) ajoute la vraie.
    withHeaders({ "x-forwarded-for": "6.6.6.6, 203.0.113.7" });

    await recordConnection(42, "LOGIN_DISCORD");

    const [sql, params] = execute.mock.calls[0];
    expect(sql).toContain("INSERT INTO bg_connection_logs");
    expect(params).toEqual([42, "LOGIN_DISCORD", "203.0.113.7"]);
  });

  it("n'écrit jamais X-Real-IP sans déclaration du proxy", async () => {
    withHeaders({ "x-real-ip": "6.6.6.6" });

    await recordConnection(42, "LOGIN_GOOGLE");

    expect(execute.mock.calls[0][1]).toEqual([42, "LOGIN_GOOGLE", null]);
  });

  it("écrit la ligne sans adresse quand elle est illisible", async () => {
    withHeaders({ "x-forwarded-for": "pas-une-adresse" });

    await recordConnection(7, "LOGIN_BLIZZARD");

    expect(execute.mock.calls[0][1]).toEqual([7, "LOGIN_BLIZZARD", null]);
  });

  it("écrit la ligne hors requête (en-têtes indisponibles)", async () => {
    jest.mocked(headers).mockRejectedValue(new Error("outside request scope"));

    await recordConnection(7, "LOGIN_DISCORD_CODE");

    expect(execute.mock.calls[0][1]).toEqual([7, "LOGIN_DISCORD_CODE", null]);
  });

  it("ne lève jamais : une panne du journal ne refuse pas la connexion", async () => {
    withHeaders({ "x-forwarded-for": "203.0.113.7" });
    execute.mockRejectedValue(new Error("ER_NO_SUCH_TABLE"));

    await expect(recordConnection(42, "LOGIN_GOOGLE")).resolves.toBeUndefined();
    expect(errorSpy).toHaveBeenCalled();
  });

  it("purge ce qui dépasse un an, au plus une fois par heure", async () => {
    withHeaders({ "x-forwarded-for": "203.0.113.7" });

    await recordConnection(1, "LOGIN_GOOGLE");
    await recordConnection(2, "LOGIN_GOOGLE");

    const purges = execute.mock.calls.filter(([sql]) => sql.includes("DELETE FROM bg_connection_logs"));
    expect(purges).toHaveLength(1);
    expect(purges[0][1]).toEqual([CONNECTION_LOG_RETENTION_DAYS]);
  });

  it("repurge une fois l'heure écoulée", async () => {
    const start = 1_000_000_000_000;
    await purgeExpiredConnectionLogs(start);
    expect(await purgeExpiredConnectionLogs(start + 60_000)).toBe(0);
    await purgeExpiredConnectionLogs(start + 60 * 60 * 1000);

    expect(execute).toHaveBeenCalledTimes(2);
  });

  it("rend au titulaire ses lignes pour l'export", async () => {
    execute.mockResolvedValue([
      [{ event_type: "LOGIN_GOOGLE", ip: "203.0.113.7", created_at: new Date("2026-07-01T10:00:00.000Z") }],
    ]);

    const rows = await listOwnConnectionLogs(42);

    expect(execute.mock.calls[0][1]).toEqual([42]);
    expect(rows).toEqual([{ event: "LOGIN_GOOGLE", ip: "203.0.113.7", createdAt: "2026-07-01T10:00:00.000Z" }]);
  });
});

describe("aucune suppression de compte n'efface le journal", () => {
  it("la table n'a pas de clé étrangère et n'est effacée que par sa purge", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const root = path.resolve(__dirname, "../../..");
    const schema = fs.readFileSync(path.join(root, "lib/server/database.ts"), "utf8");
    const table = schema.slice(schema.indexOf("CREATE TABLE IF NOT EXISTS bg_connection_logs"));
    expect(table.slice(0, table.indexOf(") ENGINE"))).not.toMatch(/FOREIGN KEY|REFERENCES/);

    const users = fs.readFileSync(path.join(root, "lib/server/users-service.ts"), "utf8");
    expect(users).not.toMatch(/DELETE FROM bg_connection_logs/);
  });
});
