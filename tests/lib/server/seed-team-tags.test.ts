import { afterEach, describe, expect, it, jest } from "@jest/globals";
import { releaseSeedTeamTag } from "@/lib/server/seed/teams";
import { fakePool, type SqlQuery } from "../../helpers/sql-double";

/**
 * Sigles du jeu de test : repris à une équipe semée renommée hors du préfixe
 * « Test - » avant la recréation (`uniq_bg_teams_tag`).
 */
describe("releaseSeedTeamTag", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("releaseSeedTeamTag_tagHeldByRenamedTeam_clearsItAndSaysSo", async () => {
    const log = jest.spyOn(console, "log").mockImplementation(() => undefined);
    const execute = jest.fn<SqlQuery>().mockResolvedValue([{ affectedRows: 1 }]);

    await releaseSeedTeamTag(fakePool({ execute }), "DRGN");

    expect(execute).toHaveBeenCalledWith("UPDATE bg_teams SET tag = NULL WHERE tag = ?", ["DRGN"]);
    expect(log).toHaveBeenCalledWith("  ↺ sigle DRGN repris à une équipe hors du jeu de test");
  });

  it("releaseSeedTeamTag_tagFree_staysSilent", async () => {
    const log = jest.spyOn(console, "log").mockImplementation(() => undefined);
    const execute = jest.fn<SqlQuery>().mockResolvedValue([{ affectedRows: 0 }]);

    await releaseSeedTeamTag(fakePool({ execute }), "PHNX");

    expect(log).not.toHaveBeenCalled();
  });

  it("releaseSeedTeamTag_teamWithoutTag_runsNoQuery", async () => {
    const execute = jest.fn<SqlQuery>();

    await releaseSeedTeamTag(fakePool({ execute }), null);

    expect(execute).not.toHaveBeenCalled();
  });
});
