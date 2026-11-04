import { describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/database");

import { applyCastSettings, setCasterStreamUrl } from "@/lib/server/tournaments/cast-settings";
import type { LaunchMatchRow } from "@/lib/server/tournaments/match-launch";
import { fakeConnection, type SqlQuery } from "../../helpers/sql-double";

/**
 * Lien du stream d'un caster (`lib/server/tournaments/cast-settings.ts`,
 * `docs/features/CAST_SETTINGS.md`) : un lien ne s'efface pas, sans quoi le
 * stream du caster deviendrait le premier stream sans lien, que le staff
 * prendrait pour le sien.
 */
describe("setCasterStreamUrl", () => {
  it("setCasterStreamUrl_nullUrlOnOwnStream_throwsStreamUrlRequired", async () => {
    const execute = jest.fn<SqlQuery>();
    execute.mockResolvedValueOnce([[{ id: 5, match_id: 42, live_url: "https://twitch.tv/voix", staff_owned: 0 }], []]);

    await expect(setCasterStreamUrl(fakeConnection({ execute }), 42, 5, null, 900)).rejects.toThrow("STREAM_URL_REQUIRED");
    // La seule lecture des streams : aucune écriture.
    expect(execute).toHaveBeenCalledTimes(1);
  });
});

describe("applyCastSettings", () => {
  it("applyCastSettings_newLink_doesNotReReadCastersUnderLock", async () => {
    const execute = jest.fn<SqlQuery>();
    // Lecture des streams, puis l'écriture du lien, puis (aucun orphelin) rien d'autre.
    execute.mockResolvedValueOnce([[{ id: 5, match_id: 42, live_url: "https://twitch.tv/a", staff_owned: 0 }], []]);
    execute.mockResolvedValue([{ affectedRows: 1 }, []]);
    const row = { id: 42, casters: [{ matchId: 42, userId: 900, streamId: 5, readyAt: null }] } as unknown as LaunchMatchRow;

    await applyCastSettings(fakeConnection({ execute }), row, 900, 5, { liveUrl: "https://twitch.tv/b" });

    const statements = execute.mock.calls.map((call) => String(call[0]));
    expect(statements.some((sql) => sql.includes("FROM bg_match_casters"))).toBe(false);
  });
});
