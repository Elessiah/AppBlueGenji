import { describe, expect, it } from "@jest/globals";
import {
  missingVoiceLinksKey,
  ownVoiceLink,
  parseMatchVoiceInfo,
  parseVoiceLinks,
  voiceChannelRevision,
  voiceChannelUrl,
} from "@/lib/shared/match-voice";

/**
 * Lien du salon vocal de son équipe (`docs/features/MATCH_VOICE.md` § Lien du
 * salon) : à ses seuls membres, jamais celui de l'adversaire.
 */

const GUILD = "676735851119640577";
const CHANNEL = "1300000000000000001";
const URL = `https://discord.com/channels/${GUILD}/${CHANNEL}`;
const bothOpen = { team1State: "OPEN" as const, team2State: "OPEN" as const };
const match = { id: 42, team1Id: 10, team2Id: 20, voice: bothOpen };

describe("voiceChannelUrl", () => {
  it("voiceChannelUrl_discordIds_returnsChannelLink", () => {
    expect(voiceChannelUrl(GUILD, CHANNEL)).toBe(URL);
  });

  it("voiceChannelUrl_nonNumericId_null", () => {
    expect(voiceChannelUrl("evil.com/x", CHANNEL)).toBeNull();
  });

  it("voiceChannelUrl_missingGuild_null", () => {
    expect(voiceChannelUrl(null, CHANNEL)).toBeNull();
  });
});

describe("ownVoiceLink", () => {
  it("ownVoiceLink_ownTeamChannelOpen_returnsLink", () => {
    expect(ownVoiceLink(match, 10, [{ matchId: 42, url: URL }])).toBe(URL);
  });

  it("ownVoiceLink_viewerNotInMatch_null", () => {
    // Un spectateur, ou l'équipe d'un autre match : aucun lien, même si la liste en porte un.
    expect(ownVoiceLink(match, 30, [{ matchId: 42, url: URL }])).toBeNull();
  });

  it("ownVoiceLink_ownChannelNotOpen_null", () => {
    const waiting = { ...match, voice: { team1State: "WAITING" as const, team2State: "OPEN" as const } };
    expect(ownVoiceLink(waiting, 10, [{ matchId: 42, url: URL }])).toBeNull();
  });
});

describe("missingVoiceLinksKey", () => {
  it("missingVoiceLinksKey_openWithoutLink_listsMatchIds", () => {
    const other = { id: 43, team1Id: 20, team2Id: 10, voice: bothOpen };
    expect(missingVoiceLinksKey([match, other], 10, [{ matchId: 42, url: URL }])).toBe("43:");
  });

  it("missingVoiceLinksKey_channelRecreated_listsMatchWithNewRevision", () => {
    const recreated = { ...match, voice: { ...bothOpen, team1Rev: "b2" } };

    expect(missingVoiceLinksKey([recreated], 10, [{ matchId: 42, url: URL, rev: "a1" }])).toBe("42:b2");
  });

  it("missingVoiceLinksKey_sameRevision_empty", () => {
    const current = { ...match, voice: { ...bothOpen, team1Rev: "a1" } };

    expect(missingVoiceLinksKey([current], 10, [{ matchId: 42, url: URL, rev: "a1" }])).toBe("");
  });

  it("missingVoiceLinksKey_noTeam_empty", () => {
    expect(missingVoiceLinksKey([match], null, [])).toBe("");
  });
});

describe("ownVoiceLink — salon recréé", () => {
  it("ownVoiceLink_staleRevision_null", () => {
    // Le salon d'avant a été supprimé : son lien ne mène plus nulle part.
    const recreated = { ...match, voice: { ...bothOpen, team1Rev: "b2" } };

    expect(ownVoiceLink(recreated, 10, [{ matchId: 42, url: URL, rev: "a1" }])).toBeNull();
  });

  it("ownVoiceLink_matchingRevision_returnsUrl", () => {
    const current = { ...match, voice: { ...bothOpen, team2Rev: "a1" } };

    expect(ownVoiceLink(current, 20, [{ matchId: 42, url: URL, rev: "a1" }])).toBe(URL);
  });
});

describe("voiceChannelRevision", () => {
  it("voiceChannelRevision_sameChannel_stable", () => {
    expect(voiceChannelRevision(CHANNEL)).toBe("ulg");
  });

  it("voiceChannelRevision_otherChannel_differs", () => {
    expect(voiceChannelRevision("1300000000000000002")).not.toBe("ulg");
  });

  it("voiceChannelRevision_noChannel_null", () => {
    expect(voiceChannelRevision(null)).toBeNull();
  });
});

describe("parseMatchVoiceInfo — révisions", () => {
  it("parseMatchVoiceInfo_wellFormedRevision_kept", () => {
    expect(parseMatchVoiceInfo({ team1State: "OPEN", team2State: "OPEN", team1Rev: "ulg" })).toEqual({
      team1State: "OPEN",
      team2State: "OPEN",
      team1Rev: "ulg",
    });
  });

  it("parseMatchVoiceInfo_malformedRevision_dropped", () => {
    expect(parseMatchVoiceInfo({ team1State: "OPEN", team2State: "OPEN", team2Rev: "1300000000000000001" })).toEqual({
      team1State: "OPEN",
      team2State: "OPEN",
    });
  });
});

describe("parseVoiceLinks", () => {
  it("parseVoiceLinks_mixedItems_keepsDiscordChannelLinksOnly", () => {
    expect(
      parseVoiceLinks([
        { matchId: 42, url: URL },
        { matchId: 43, url: "https://evil.example/channels/1/2" },
        { matchId: "44", url: URL },
        null,
      ]),
    ).toEqual([{ matchId: 42, url: URL }]);
  });

  it("parseVoiceLinks_revision_keptWhenWellFormed", () => {
    expect(
      parseVoiceLinks([
        { matchId: 42, url: URL, rev: "ulg" },
        { matchId: 43, url: URL, rev: "<b>" },
      ]),
    ).toEqual([
      { matchId: 42, url: URL, rev: "ulg" },
      { matchId: 43, url: URL },
    ]);
  });

  it("parseVoiceLinks_notArray_null", () => {
    expect(parseVoiceLinks({ matchId: 42, url: URL })).toBeNull();
  });
});
