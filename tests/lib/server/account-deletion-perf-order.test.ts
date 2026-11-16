import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "node:fs";

/*
 * EF-62 (revue performance, cycle 1) : placement des relevés — en parallèle
 * quand ils sont indépendants, le coup d'envoi tardif avant la transaction.
 */
const read = (path: string) => readFileSync(path, "utf8");

describe("account deletion — placement des requêtes", () => {
  it("republishSoloEntryTournaments_independentReads_runTogether", () => {
    const source = read("lib/server/users/account-reactivation.ts");

    expect(source).toContain("await Promise.all([");
    expect(source).toContain("listSoloRegistrationTournamentIds(db, userId)");
    expect(source).toContain("listNamingTournamentIds(db, userId)");
  });

  it("afterDeletionRequest_namingQuery_startsBeforeAvatarRotation", () => {
    const source = read("lib/server/users/account-deletion-request.ts");

    expect(source.indexOf("const namingLoad = namingTournamentsOrNone(")).toBeGreaterThan(0);
    expect(source.indexOf("const namingLoad = namingTournamentsOrNone(")).toBeLessThan(
      source.indexOf("await rotateHeldAvatarFile("),
    );
  });

  it("deletionTransactions_lateStart_givenBeforeConnection", () => {
    for (const path of ["lib/server/users/account-deletion.ts", "lib/server/users/account-deletion-request.ts"]) {
      const source = read(path);
      const start = source.indexOf("await startDueTournaments(openSoloTournaments)");

      expect(start).toBeGreaterThan(0);
      expect(start).toBeLessThan(source.indexOf("await db.getConnection()", start - 10));
    }
  });

  it("withdrawDeletedAccountRegistrations_syncsOncePerPass_beforeConnection", () => {
    const source = read("lib/server/users/deleted-solo-entries.ts");

    expect(source).toContain("await startDueTournaments(tournamentIds, synced)");
    expect(source.indexOf("await startDueTournaments(tournamentIds, synced)")).toBeLessThan(
      source.indexOf("const connection = await db.getConnection()", source.indexOf("async function withdrawDeletedAccountRegistrations")),
    );
  });
});
