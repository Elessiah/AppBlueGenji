import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { HOST_COOKIE_SESSIONS_MARKER, purgePreHostCookieSessions } from "@/lib/server/database/data-migrations";
import { fakePool, type SqlQuery } from "../../helpers/sql-double";

/**
 * Sessions d'avant les cookies `__Host-` : leur cookie nu n'est plus lu en
 * production, leurs lignes sont purgées **une fois** — sans quoi `/profil` les
 * compterait trente jours comme d'autres appareils connectés.
 */

let errorSpy: jest.SpiedFunction<typeof console.error>;

beforeEach(() => {
  errorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);
  jest.replaceProperty(process, "env", { ...process.env, NODE_ENV: "production" });
});

afterEach(() => {
  jest.restoreAllMocks();
});

const claim = (affectedRows: number) => [{ affectedRows }, undefined];

describe("purgePreHostCookieSessions", () => {
  it("purgePreHostCookieSessions_productionMarkerClaimed_deletesAllSessions", async () => {
    const execute = jest.fn<SqlQuery>().mockResolvedValueOnce(claim(1)).mockResolvedValueOnce(claim(4));

    await purgePreHostCookieSessions(fakePool({ execute }));

    expect(execute.mock.calls.map(([sql]) => sql)).toEqual([
      "INSERT IGNORE INTO bg_settings (setting_key, setting_value) VALUES (?, '1')",
      "DELETE FROM bg_user_sessions",
    ]);
    expect(execute.mock.calls[0][1]).toEqual([HOST_COOKIE_SESSIONS_MARKER]);
  });

  it("purgePreHostCookieSessions_productionMarkerAlreadySet_deletesNothing", async () => {
    // Un redémarrage, ou un second processus : personne n'est déconnecté deux fois.
    const execute = jest.fn<SqlQuery>().mockResolvedValueOnce(claim(0));

    await purgePreHostCookieSessions(fakePool({ execute }));

    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("purgePreHostCookieSessions_development_issuesNoQuery", async () => {
    // Hors production, le nom nu est le cookie en service : ses sessions vivent.
    jest.replaceProperty(process, "env", { ...process.env, NODE_ENV: "development" });
    const execute = jest.fn<SqlQuery>();

    await purgePreHostCookieSessions(fakePool({ execute }));

    expect(execute).not.toHaveBeenCalled();
  });

  it("purgePreHostCookieSessions_markerInsertFails_reportsAndSkipsPurge", async () => {
    const execute = jest.fn<SqlQuery>().mockRejectedValueOnce(new Error("ER_LOCK_WAIT_TIMEOUT"));

    await purgePreHostCookieSessions(fakePool({ execute }));

    expect(execute).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalled();
  });

  it("purgePreHostCookieSessions_deleteFails_reportsWithoutThrowing", async () => {
    const execute = jest
      .fn<SqlQuery>()
      .mockResolvedValueOnce(claim(1))
      .mockRejectedValueOnce(new Error("ER_LOCK_WAIT_TIMEOUT"));

    await expect(purgePreHostCookieSessions(fakePool({ execute }))).resolves.toBeUndefined();

    expect(errorSpy).toHaveBeenCalled();
  });
});
