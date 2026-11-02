import { describe, expect, it } from "@jest/globals";
import {
  VOICE_CHANNEL_CAPACITY,
  VOICE_CHANNEL_LEAD_MINUTES,
  matchVoiceInfo,
  parseMatchVoiceInfo,
  voiceChannelKey,
  voiceChannelsDue,
  voiceGatePending,
  voiceTracked,
  type VoiceGateInput,
} from "@/lib/shared/match-voice";
import { matchLaunchPhase } from "@/lib/shared/match-launch";
import frMatchPage from "@/messages/fr/matchPage.json";
import enMatchPage from "@/messages/en/matchPage.json";
import frForm from "@/messages/fr/tournamentForm.json";
import enForm from "@/messages/en/tournamentForm.json";

const START = "2026-11-05T20:00:00.000Z";
const startMs = Date.parse(START);
const team = { isSolo: false, isGhost: false };
const full = { channelId: "c1", members: VOICE_CHANNEL_CAPACITY, failed: false };

function gate(overrides: Partial<VoiceGateInput> = {}): VoiceGateInput {
  return {
    enabled: true,
    startAt: START,
    team1: team,
    team2: team,
    team1Channel: null,
    team2Channel: null,
    ...overrides,
  };
}

describe("voiceChannelKey", () => {
  it("voiceChannelKey_ids_returnsMatchTeamKey", () => {
    expect(voiceChannelKey(12, 34)).toBe("match:12:team:34");
  });
});

describe("voiceChannelsDue", () => {
  it("voiceChannelsDue_justBeforeLead_returnsFalse", () => {
    expect(voiceChannelsDue(START, startMs - VOICE_CHANNEL_LEAD_MINUTES * 60_000 - 1)).toBe(false);
  });

  it("voiceChannelsDue_exactlyLead_returnsTrue", () => {
    expect(voiceChannelsDue(START, startMs - VOICE_CHANNEL_LEAD_MINUTES * 60_000)).toBe(true);
  });

  it("voiceChannelsDue_startPassedLateToggle_returnsTrue", () => {
    expect(voiceChannelsDue(START, startMs + 3_600_000)).toBe(true);
  });

  it("voiceChannelsDue_nullStart_returnsFalse", () => {
    expect(voiceChannelsDue(null, startMs)).toBe(false);
  });
});

describe("voiceTracked", () => {
  it("voiceTracked_optionOff_returnsFalse", () => {
    expect(voiceTracked(gate({ enabled: false }))).toBe(false);
  });

  it("voiceTracked_soloSide_returnsFalse", () => {
    expect(voiceTracked(gate({ team2: { isSolo: true, isGhost: false } }))).toBe(false);
  });

  it("voiceTracked_ghostSide_returnsFalse", () => {
    expect(voiceTracked(gate({ team1: { isSolo: false, isGhost: true } }))).toBe(false);
  });

  it("voiceTracked_noStartAt_returnsFalse", () => {
    expect(voiceTracked(gate({ startAt: null }))).toBe(false);
  });

  it("voiceTracked_twoRealTeams_returnsTrue", () => {
    expect(voiceTracked(gate())).toBe(true);
  });
});

describe("voiceGatePending", () => {
  it("voiceGatePending_noChannelsYet_returnsTrue", () => {
    expect(voiceGatePending(gate())).toBe(true);
  });

  it("voiceGatePending_oneFull_returnsTrue", () => {
    expect(voiceGatePending(gate({ team1Channel: full, team2Channel: { channelId: "c2", members: 0, failed: false } }))).toBe(true);
  });

  it("voiceGatePending_oneShortOfCapacity_returnsTrue", () => {
    const four = { channelId: "c2", members: VOICE_CHANNEL_CAPACITY - 1, failed: false };
    expect(voiceGatePending(gate({ team1Channel: full, team2Channel: four }))).toBe(true);
  });

  it("voiceGatePending_bothFull_returnsFalse", () => {
    expect(voiceGatePending(gate({ team1Channel: full, team2Channel: { ...full, channelId: "c2" } }))).toBe(false);
  });

  it("voiceGatePending_oneFailed_returnsFalse", () => {
    expect(voiceGatePending(gate({ team1Channel: { channelId: null, members: null, failed: true } }))).toBe(false);
  });

  it("voiceGatePending_untracked_returnsFalse", () => {
    expect(voiceGatePending(gate({ enabled: false }))).toBe(false);
  });
});

describe("matchVoiceInfo", () => {
  it("matchVoiceInfo_untracked_returnsNull", () => {
    expect(matchVoiceInfo(gate({ team1: { isSolo: true, isGhost: false } }))).toBeNull();
  });

  it("matchVoiceInfo_counts_clampsToCapacityAndNullWhenNotCreated", () => {
    expect(matchVoiceInfo(gate({ team1Channel: { channelId: "c1", members: 9, failed: false } }))).toEqual({
      team1Members: VOICE_CHANNEL_CAPACITY,
      team2Members: null,
      pending: true,
    });
  });
});

describe("parseMatchVoiceInfo", () => {
  it("parseMatchVoiceInfo_notAnObject_returnsNull", () => {
    expect(parseMatchVoiceInfo("3/5")).toBeNull();
  });

  it("parseMatchVoiceInfo_badMembers_mapsToNull", () => {
    expect(parseMatchVoiceInfo({ team1Members: -1, team2Members: 2.5, pending: "yes" })).toEqual({
      team1Members: null,
      team2Members: null,
      pending: false,
    });
  });
});

describe("matchLaunchPhase — salons vocaux", () => {
  const base = {
    status: "READY" as const,
    team1Id: 1,
    team2Id: 2,
    startAt: "2026-01-01T00:00:00.000Z",
    launchedAt: null,
    refereeScheduling: false,
    launchPhase: false,
  };

  it("matchLaunchPhase_phaseOffGatePending_returnsScheduled", () => {
    expect(matchLaunchPhase({ ...base, voice: { pending: true } }, Date.parse("2026-01-01T01:00:00.000Z"))).toBe("SCHEDULED");
  });

  it("matchLaunchPhase_phaseOffGateLifted_returnsLaunched", () => {
    expect(matchLaunchPhase({ ...base, voice: { pending: false } }, Date.parse("2026-01-01T01:00:00.000Z"))).toBe("LAUNCHED");
  });
});

describe("textes des salons vocaux (FR + EN)", () => {
  it("messages_voiceKeys_presentInFrAndEn", () => {
    expect(Object.keys(enMatchPage.voice)).toEqual(Object.keys(frMatchPage.voice));
    expect(Object.keys(enForm.form.teamVoice)).toEqual(Object.keys(frForm.form.teamVoice));
    expect(frMatchPage.voice.count).toBe("Salon vocal : {count}/{capacity}");
    expect(enMatchPage.voice.count).toBe("Voice channel: {count}/{capacity}");
  });
});
