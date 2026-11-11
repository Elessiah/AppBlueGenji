import { describe, expect, it, jest } from "@jest/globals";
import { getDatabase } from "@/lib/server/database";
import {
  DELETION_LOG_ANNOUNCEMENTS_LIMIT,
  listLiveAnnouncementsForDeletionLog,
  listOwnLiveAnnouncements,
} from "@/lib/server/users/live-announcement-export";
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
  it("listLiveAnnouncementsForDeletionLog_announcedAccount_returnsAnnouncementsNotTruncated", async () => {
    const execute = jest
      .fn<SqlQuery>()
      .mockResolvedValueOnce([[{ name: "Solo Cup", sent_at: new Date("2026-11-13T20:04:00.000Z") }]]);
    jest.mocked(getDatabase).mockResolvedValue(fakePool({ execute }));

    const actual = await listLiveAnnouncementsForDeletionLog(7);

    expect(actual).toEqual({
      announcements: [{ tournamentName: "Solo Cup", sentAt: "2026-11-13T20:04:00.000Z" }],
      truncated: false,
    });
  });

  it("listLiveAnnouncementsForDeletionLog_query_readsOnlyTheAccountsSoloEntriesNewestFirst", async () => {
    const execute = jest.fn<SqlQuery>().mockResolvedValueOnce([[]]);
    jest.mocked(getDatabase).mockResolvedValue(fakePool({ execute }));

    await listLiveAnnouncementsForDeletionLog(7);

    const [sql, params] = execute.mock.calls[0];
    expect(sql).toMatch(/st\.solo_user_id = \?/);
    expect(sql).toMatch(/FIND_IN_SET\(st\.id, REPLACE\(a\.pairing, ':', ','\)\)/);
    expect(sql).toMatch(/ORDER BY sent_at DESC, match_id DESC\s+LIMIT 501$/);
    expect(sql).not.toMatch(/pseudo/);
    // Un refus d'AutoMod est justement celui qui laisse une alerte : pas de filtre.
    expect(sql).not.toMatch(/refused/);
    expect(params).toEqual([7, 7]);
  });

  it("listLiveAnnouncementsForDeletionLog_query_alsoReadsScheduledStartTimeMatches", async () => {
    const execute = jest.fn<SqlQuery>().mockResolvedValueOnce([[]]);
    jest.mocked(getDatabase).mockResolvedValue(fakePool({ execute }));

    await listLiveAnnouncementsForDeletionLog(7);

    // Le message d'une soirée liste à l'avance les matchs programmés, pseudo compris.
    const [sql] = execute.mock.calls[0];
    expect(sql).toMatch(/UNION ALL/);
    // Listé entre une fenêtre de soirée (4 h) avant son heure et son heure : les deux bornes.
    expect(sql).toMatch(/DATE_SUB\(m\.start_at, INTERVAL sh\.shift HOUR\) AS sent_at/);
    expect(sql).toMatch(/\(SELECT 0 AS shift UNION ALL SELECT 4\) sh/);
    expect(sql).toMatch(/m\.start_at <= DATE_ADD\(NOW\(\), INTERVAL 4 HOUR\)/);
    expect(sql).toMatch(/m\.live_trigger = 'START_TIME'/);
    expect(sql).toMatch(/st\.id IN \(m\.team1_id, m\.team2_id\)/);
  });

  it("listLiveAnnouncementsForDeletionLog_rowWithoutDate_isSkipped", async () => {
    const execute = jest.fn<SqlQuery>().mockResolvedValueOnce([[{ name: "Solo Cup", sent_at: null }]]);
    jest.mocked(getDatabase).mockResolvedValue(fakePool({ execute }));

    const actual = await listLiveAnnouncementsForDeletionLog(7);

    expect(actual).toEqual({ announcements: [], truncated: false });
  });

  it("listLiveAnnouncementsForDeletionLog_moreRowsThanLimit_returnsLimitAndTruncated", async () => {
    const rows = Array.from({ length: DELETION_LOG_ANNOUNCEMENTS_LIMIT + 1 }, () => ({
      name: "Solo Cup",
      sent_at: new Date("2026-11-13T20:04:00.000Z"),
    }));
    const execute = jest.fn<SqlQuery>().mockResolvedValueOnce([rows]);
    jest.mocked(getDatabase).mockResolvedValue(fakePool({ execute }));

    const actual = await listLiveAnnouncementsForDeletionLog(7);

    expect(actual.announcements).toHaveLength(500);
    expect(actual.truncated).toBe(true);
  });
});
