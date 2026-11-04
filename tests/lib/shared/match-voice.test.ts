import { describe, expect, it } from "@jest/globals";
import {
  VOICE_CHANNEL_CAPACITY,
  VOICE_CHANNEL_LEAD_MINUTES,
  matchVoiceInfo,
  parseMatchVoiceInfo,
  shownVoiceSide,
  voiceChannelKey,
  voiceChannelsDue,
  voiceGatePending,
  voiceObservationFresh,
  voiceSideFull,
  voiceTracked,
  type VoiceGateInput,
} from "@/lib/shared/match-voice";
import { matchLaunchPhase } from "@/lib/shared/match-launch";
import frMatchPage from "@/messages/fr/matchPage.json";
import enMatchPage from "@/messages/en/matchPage.json";
import frForm from "@/messages/fr/tournamentForm.json";
import enForm from "@/messages/en/tournamentForm.json";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PROCESSING_ACTIVITIES_EN } from "@/lib/shared/processing-register-en";

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

describe("voiceObservationFresh", () => {
  const now = Date.parse("2026-11-05T20:00:00.000Z");

  it("voiceObservationFresh_justObserved_returnsTrue", () => {
    expect(voiceObservationFresh("2026-11-05T20:00:00.000Z", now)).toBe(true);
  });

  it("voiceObservationFresh_exactlyFiveMinutes_returnsTrue", () => {
    expect(voiceObservationFresh("2026-11-05T19:55:00.000Z", now)).toBe(true);
  });

  it("voiceObservationFresh_justOverFiveMinutes_returnsFalse", () => {
    expect(voiceObservationFresh("2026-11-05T19:54:59.999Z", now)).toBe(false);
  });

  it("voiceObservationFresh_null_returnsFalse", () => {
    expect(voiceObservationFresh(null, now)).toBe(false);
  });

  it("voiceObservationFresh_unreadable_returnsFalse", () => {
    expect(voiceObservationFresh("garbage", now)).toBe(false);
  });
});

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
      team1State: "COUNTED",
      team2State: "WAITING",
      pending: true,
    });
  });

  it("matchVoiceInfo_createdNotCounted_saysUncountedNotWaiting", () => {
    const actual = matchVoiceInfo(gate({ team1Channel: { channelId: "c1", members: null, failed: false } }));

    expect(actual?.team1State).toBe("UNCOUNTED");
    expect(actual?.team1Members).toBeNull();
  });

  it("matchVoiceInfo_failedSide_saysFailedAndReleasesGate", () => {
    const actual = matchVoiceInfo(gate({ team1Channel: { channelId: null, members: null, failed: true }, team2Channel: full }));

    expect(actual).toEqual({ team1Members: null, team2Members: 5, team1State: "FAILED", team2State: "COUNTED", pending: false });
  });
});

describe("shownVoiceSide", () => {
  it("shownVoiceSide_noChannel_waiting", () => {
    expect(shownVoiceSide(null)).toEqual({ state: "WAITING", members: null });
  });

  it("shownVoiceSide_failedEvenWithChannel_failed", () => {
    expect(shownVoiceSide({ channelId: "c1", members: 4, failed: true })).toEqual({ state: "FAILED", members: null });
  });

  it("shownVoiceSide_negativeCount_clampsToZero", () => {
    expect(shownVoiceSide({ channelId: "c1", members: -2, failed: false })).toEqual({ state: "COUNTED", members: 0 });
  });
});

describe("voiceSideFull", () => {
  it("voiceSideFull_countedAtCapacity_true", () => {
    expect(voiceSideFull("COUNTED", VOICE_CHANNEL_CAPACITY)).toBe(true);
  });

  it("voiceSideFull_countedBelowCapacity_false", () => {
    expect(voiceSideFull("COUNTED", VOICE_CHANNEL_CAPACITY - 1)).toBe(false);
  });

  it("voiceSideFull_notCounted_false", () => {
    expect(voiceSideFull("UNCOUNTED", null)).toBe(false);
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
      team1State: "WAITING",
      team2State: "WAITING",
      pending: false,
    });
  });

  it("parseMatchVoiceInfo_olderPayloadWithCount_derivesCounted", () => {
    expect(parseMatchVoiceInfo({ team1Members: 3, team2Members: null, pending: true })).toEqual({
      team1Members: 3,
      team2Members: null,
      team1State: "COUNTED",
      team2State: "WAITING",
      pending: true,
    });
  });

  it("parseMatchVoiceInfo_countedWithoutNumber_becomesUncounted", () => {
    const actual = parseMatchVoiceInfo({ team1Members: null, team2Members: 2, team1State: "COUNTED", team2State: "COUNTED", pending: true });

    expect(actual?.team1State).toBe("UNCOUNTED");
  });

  it("parseMatchVoiceInfo_failedWithStrayCount_dropsCount", () => {
    const actual = parseMatchVoiceInfo({ team1Members: 4, team2Members: 2, team1State: "FAILED", team2State: "COUNTED", pending: false });

    expect(actual).toEqual({ team1Members: null, team2Members: 2, team1State: "FAILED", team2State: "COUNTED", pending: false });
  });

  it("parseMatchVoiceInfo_unknownState_fallsBackToCount", () => {
    const actual = parseMatchVoiceInfo({ team1Members: null, team2Members: 1, team1State: "OPEN", team2State: 7, pending: true });

    expect(actual?.team1State).toBe("WAITING");
    expect(actual?.team2State).toBe("COUNTED");
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

  it("messages_teamVoiceDescription_atMostTwoSentences", () => {
    // Texte explicatif d'un « i » (INFO_HINTS.md) : une à deux phrases.
    const sentences = (text: string) => text.split(/[.!?](?:\s|$)/).filter((part) => part.trim() !== "").length;

    expect(sentences(frForm.form.teamVoice.description)).toBeLessThanOrEqual(2);
    expect(sentences(enForm.form.teamVoice.description)).toBeLessThanOrEqual(2);
  });

  it("messages_teamVoiceDescription_scopeEitherSideSoloOrGhost", () => {
    // voiceTracked : aucun salon dès qu'un des deux camps n'est pas éligible.
    expect(frForm.form.teamVoice.description).toContain("aucun si l'un des deux camps est une entrée solo ou une équipe fantôme");
    expect(enForm.form.teamVoice.description).toContain("none if either side is a solo entry or a ghost team");
  });

  it("messages_teamVoiceDescription_gateReleaseAnyBotFailure", () => {
    // voiceGatePending : levé sur tout échec du bot, pas seulement s'il est injoignable.
    expect(frForm.form.teamVoice.description).toContain("échec du bot");
    expect(frForm.form.teamVoice.description).not.toContain("injoignable");
    expect(enForm.form.teamVoice.description).toContain("the bot fails");
    expect(enForm.form.teamVoice.description).not.toContain("can't be reached");
  });

  it("messages_teamVoiceDescription_keptDataPerTeamOfMatch", () => {
    // Registre T18 : chaque relevé est rattaché au match et à l'équipe.
    expect(frForm.form.teamVoice.description).toContain("pour chaque équipe du match");
    expect(enForm.form.teamVoice.description).toContain("For each team in the match");
  });

  it("messages_voiceStateTexts_frenchAndEnglish", () => {
    expect(frMatchPage.voice.uncounted).toBe("Salon vocal : pas encore compté");
    expect(enMatchPage.voice.uncounted).toBe("Voice channel: not counted yet");
    expect(frMatchPage.voice.failed).toBe("Salon vocal : indisponible");
    expect(enMatchPage.voice.failed).toBe("Voice channel: unavailable");
  });

  it("messages_finishedVoiceError_frenchAndEnglish", () => {
    expect(frForm.edit.voiceErrors.TOURNAMENT_FINISHED).toBe(frForm.edit.planningErrors.TOURNAMENT_FINISHED);
    expect(enForm.edit.voiceErrors.TOURNAMENT_FINISHED).toBe(enForm.edit.planningErrors.TOURNAMENT_FINISHED);
  });
});

describe("levée du verrou vocal : textes juridiques anglais", () => {
  // voiceGatePending lève le verrou sur tout échec du bot (le français est figé par tests/fixtures/legal-fr).
  const subPurposesEn = (ref: string) => {
    const found = PROCESSING_ACTIVITIES_EN.find((entry) => entry.ref === ref);
    if (!found) throw new Error(`activité absente : ${ref}`);
    return found.subPurposes.join(" ");
  };

  it("legalTexts_voiceGateRelease_registerEnSaysBotFails", () => {
    const text = subPurposesEn("T18");

    expect(text).toContain("if the bot fails, the match doesn't wait");
    expect(text).not.toContain("doesn't answer");
  });

  it("legalTexts_voiceGateRelease_rgpdEnSaysBotFails", () => {
    const source = readFileSync(join(__dirname, "..", "..", "..", "app", "rgpd", "RgpdEn.tsx"), "utf8");

    expect(source).toContain("if the bot fails, the match doesn&apos;t wait");
    expect(source).not.toContain("the bot doesn&apos;t answer, the match");
  });
});
