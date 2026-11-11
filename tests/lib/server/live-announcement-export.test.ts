import { describe, expect, it, jest } from "@jest/globals";
import { getDatabase } from "@/lib/server/database";
import { listLiveAnnouncementsForDeletionLog, listOwnLiveAnnouncements } from "@/lib/server/users/live-announcement-export";
import { type SqlQuery, fakePool } from "../../helpers/sql-double";

jest.mock("@/lib/server/database");

describe("listOwnLiveAnnouncements (export RGPD, T16)", () => {
  it("rend les annonces #live des entrées individuelles du titulaire, sans rien d'autre", async () => {
    const execute = jest
      .fn<SqlQuery>()
      .mockResolvedValueOnce([
        [
          { match_id: "12", tournament_id: 3, sent_at: new Date("2026-10-20T18:00:00.000Z"), refused: 0 },
          { match_id: 13, tournament_id: 3, sent_at: "2026-10-20 19:00:00", refused: 1 },
        ],
      ]);
    jest.mocked(getDatabase).mockResolvedValue(fakePool({ execute }));

    await expect(listOwnLiveAnnouncements(7)).resolves.toEqual([
      { matchId: 12, tournamentId: 3, sentAt: "2026-10-20T18:00:00.000Z", refused: false },
      // Une trace refusée (bot ou AutoMod) est rendue avec son refus, que le registre T16 déclare.
      { matchId: 13, tournamentId: 3, sentAt: expect.any(String), refused: true },
    ]);
    const [sql, params] = execute.mock.calls[0];
    // Seules les entrées dont il est le titulaire, retrouvées dans la paire annoncée.
    expect(sql).toMatch(/a\.refused/);
    expect(sql).toMatch(/st\.solo_user_id = \?/);
    expect(sql).toMatch(/FIND_IN_SET\(st\.id, REPLACE\(a\.pairing, ':', ','\)\)/);
    expect(params).toEqual([7]);
  });

  it("rend une liste vide sans annonce", async () => {
    const execute = jest.fn<SqlQuery>().mockResolvedValueOnce([[]]);
    jest.mocked(getDatabase).mockResolvedValue(fakePool({ execute }));
    await expect(listOwnLiveAnnouncements(7)).resolves.toEqual([]);
  });
});

// D56b : annonces relues à la demande de suppression, pour la ligne du journal
// du staff — tournoi et date, jamais un pseudo.
describe("listLiveAnnouncementsForDeletionLog", () => {
  it("listLiveAnnouncementsForDeletionLog_announcedAccount_returnsTournamentNameAndIsoDate", async () => {
    const execute = jest
      .fn<SqlQuery>()
      .mockResolvedValueOnce([[{ name: "Solo Cup", sent_at: new Date("2026-11-13T20:04:00.000Z") }]]);
    jest.mocked(getDatabase).mockResolvedValue(fakePool({ execute }));

    const actual = await listLiveAnnouncementsForDeletionLog(7);

    expect(actual).toEqual([{ tournamentName: "Solo Cup", sentAt: "2026-11-13T20:04:00.000Z" }]);
  });

  it("listLiveAnnouncementsForDeletionLog_query_readsOnlyTheAccountsSoloEntriesNewestFirst", async () => {
    const execute = jest.fn<SqlQuery>().mockResolvedValueOnce([[]]);
    jest.mocked(getDatabase).mockResolvedValue(fakePool({ execute }));

    await listLiveAnnouncementsForDeletionLog(7);

    const [sql, params] = execute.mock.calls[0];
    expect(sql).toMatch(/st\.solo_user_id = \?/);
    expect(sql).toMatch(/FIND_IN_SET\(st\.id, REPLACE\(a\.pairing, ':', ','\)\)/);
    expect(sql).toMatch(/ORDER BY a\.sent_at DESC, a\.match_id DESC\s+LIMIT 50/);
    expect(sql).not.toMatch(/pseudo/);
    expect(params).toEqual([7]);
  });

  it("listLiveAnnouncementsForDeletionLog_rowWithoutDate_isSkipped", async () => {
    const execute = jest.fn<SqlQuery>().mockResolvedValueOnce([[{ name: "Solo Cup", sent_at: null }]]);
    jest.mocked(getDatabase).mockResolvedValue(fakePool({ execute }));

    const actual = await listLiveAnnouncementsForDeletionLog(7);

    expect(actual).toEqual([]);
  });
});
