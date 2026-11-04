import { describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/database");

import { setCasterStreamUrl } from "@/lib/server/tournaments/cast-settings";
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
