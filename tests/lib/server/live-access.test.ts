import { describe, expect, it } from "@jest/globals";

import { mayConfigureMatchLive, parseStreamLinks } from "@/lib/server/tournaments/live-access";
import { authUser } from "../../helpers/auth-user";

/**
 * Porte des routes de diffusion d'un match (`docs/features/CAST_SETTINGS.md`
 * § L'arbitre désigné, médiateur de la diffusion).
 */

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
  it("mayConfigureMatchLive_livePermission_true", () => {
    expect(mayConfigureMatchLive(authUser({ id: 4, roles: ["CASTER"] }))).toBe(true);
  });

  it("mayConfigureMatchLive_arbitre_trueRefereeJudgedUnderLock", () => {
    // `tournaments` : condition de l'arbitrage ; l'arbitre de ce match se juge sous verrou.
    expect(mayConfigureMatchLive(authUser({ id: 6, roles: ["ARBITRE"] }))).toBe(true);
  });

  it("mayConfigureMatchLive_admin_true", () => {
    expect(mayConfigureMatchLive(authUser({ id: 7, isAdmin: true }))).toBe(true);
  });

  it("mayConfigureMatchLive_otherPlatformRole_false", () => {
    expect(mayConfigureMatchLive(authUser({ id: 8, roles: ["COMMUNITY_MANAGER", "RECRUTEUR"] }))).toBe(false);
  });

  it("mayConfigureMatchLive_neither_false", () => {
    expect(mayConfigureMatchLive(authUser({ id: 2, roles: [] }))).toBe(false);
  });
});
