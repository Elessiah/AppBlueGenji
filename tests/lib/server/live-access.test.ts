import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/tournaments/live-streams");

import { mayConfigureMatchLive, parseStreamLinks } from "@/lib/server/tournaments/live-access";
import { isDesignatedMatchReferee } from "@/lib/server/tournaments/live-streams";
import { authUser } from "../../helpers/auth-user";

/**
 * Porte des routes de diffusion d'un match (`docs/features/CAST_SETTINGS.md`
 * § L'arbitre désigné, médiateur de la diffusion).
 */

beforeEach(() => {
  jest.clearAllMocks();
});

describe("parseStreamLinks", () => {
  it("parseStreamLinks_absent_undefined", () => {
    expect(parseStreamLinks(undefined)).toBeUndefined();
  });

  it("parseStreamLinks_validEntries_returnsEdits", () => {
    expect(parseStreamLinks([{ streamId: 3, liveUrl: "twitch.tv/voix" }, { streamId: 4, liveUrl: null }])).toEqual([
      { streamId: 3, liveUrl: "twitch.tv/voix" },
      { streamId: 4, liveUrl: null },
    ]);
  });

  it("parseStreamLinks_notArray_null", () => {
    expect(parseStreamLinks({ streamId: 3, liveUrl: null })).toBeNull();
  });

  it("parseStreamLinks_moreThanTwentyEntries_null", () => {
    const edits = Array.from({ length: 21 }, (_, index) => ({ streamId: index + 1, liveUrl: null }));
    expect(parseStreamLinks(edits)).toBeNull();
  });

  it("parseStreamLinks_duplicateStream_null", () => {
    expect(parseStreamLinks([{ streamId: 3, liveUrl: null }, { streamId: 3, liveUrl: "kick.com/x" }])).toBeNull();
  });

  it("parseStreamLinks_nonPositiveStreamId_null", () => {
    expect(parseStreamLinks([{ streamId: 0, liveUrl: null }])).toBeNull();
  });

  it("parseStreamLinks_nonTextLink_null", () => {
    expect(parseStreamLinks([{ streamId: 3, liveUrl: 12 }])).toBeNull();
  });
});

describe("mayConfigureMatchLive", () => {
  it("mayConfigureMatchLive_livePermission_trueWithoutRefereeRead", async () => {
    const caster = authUser({ id: 4, roles: ["CASTER"] });

    await expect(mayConfigureMatchLive(caster, 42)).resolves.toBe(true);
    expect(isDesignatedMatchReferee).not.toHaveBeenCalled();
  });

  it("mayConfigureMatchLive_notThisMatchReferee_false", async () => {
    jest.mocked(isDesignatedMatchReferee).mockResolvedValue(false);
    const player = authUser({ id: 2, roles: [] });

    await expect(mayConfigureMatchLive(player, 43)).resolves.toBe(false);
    // Le match demandé, et le lecteur lui-même : jamais l'arbitre d'un autre match.
    expect(isDesignatedMatchReferee).toHaveBeenCalledWith(43, 2, false);
  });

  it("mayConfigureMatchLive_thisMatchReferee_true", async () => {
    jest.mocked(isDesignatedMatchReferee).mockResolvedValue(true);
    const player = authUser({ id: 2, roles: [] });

    await expect(mayConfigureMatchLive(player, 42)).resolves.toBe(true);
  });
});
