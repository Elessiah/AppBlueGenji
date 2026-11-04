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

  // Décision de l'utilisateur du 2026-11-04 : le nombre de présents ne quitte plus le serveur.
  it("matchVoiceInfo_tracked_returnsStatesWithoutCounts", () => {
    expect(matchVoiceInfo(gate({ team1Channel: { channelId: "c1", members: 9, failed: false } }))).toEqual({
      team1State: "OPEN",
      team2State: "WAITING",
      pending: true,
    });
  });

  it("matchVoiceInfo_createdNotCounted_saysOpenNotWaiting", () => {
    const actual = matchVoiceInfo(gate({ team1Channel: { channelId: "c1", members: null, failed: false } }));

    expect(actual?.team1State).toBe("OPEN");
  });

  it("matchVoiceInfo_failedSide_saysFailedAndReleasesGate", () => {
    const actual = matchVoiceInfo(gate({ team1Channel: { channelId: null, members: null, failed: true }, team2Channel: full }));

    expect(actual).toEqual({ team1State: "FAILED", team2State: "OPEN", pending: false });
  });

  it("matchVoiceInfo_bothFull_gateLiftedWithoutCounts", () => {
    const actual = matchVoiceInfo(gate({ team1Channel: full, team2Channel: full }));

    expect(actual).toEqual({ team1State: "OPEN", team2State: "OPEN", pending: false });
  });
});

describe("shownVoiceSide", () => {
  it("shownVoiceSide_noChannel_waiting", () => {
    expect(shownVoiceSide(null)).toBe("WAITING");
  });

  it("shownVoiceSide_failedEvenWithChannel_failed", () => {
    expect(shownVoiceSide({ channelId: "c1", members: 4, failed: true })).toBe("FAILED");
  });

  it("shownVoiceSide_created_open", () => {
    expect(shownVoiceSide({ channelId: "c1", members: 2, failed: false })).toBe("OPEN");
  });
});

describe("parseMatchVoiceInfo", () => {
  it("parseMatchVoiceInfo_notAnObject_returnsNull", () => {
    expect(parseMatchVoiceInfo("3/5")).toBeNull();
  });

  it("parseMatchVoiceInfo_noStates_waitingAndNotPending", () => {
    expect(parseMatchVoiceInfo({ pending: "yes" })).toEqual({ team1State: "WAITING", team2State: "WAITING", pending: false });
  });

  it("parseMatchVoiceInfo_legacyCountedPayload_mapsToOpenAndDropsNumbers", () => {
    const actual = parseMatchVoiceInfo({ team1Members: 3, team2Members: 5, team1State: "COUNTED", team2State: "UNCOUNTED", pending: true });

    expect(actual).toEqual({ team1State: "OPEN", team2State: "OPEN", pending: true });
  });

  it("parseMatchVoiceInfo_knownStates_keptAsIs", () => {
    const actual = parseMatchVoiceInfo({ team1State: "FAILED", team2State: "OPEN", pending: false });

    expect(actual).toEqual({ team1State: "FAILED", team2State: "OPEN", pending: false });
  });

  it("parseMatchVoiceInfo_unknownState_waiting", () => {
    const actual = parseMatchVoiceInfo({ team1State: "FULL", team2State: 7, pending: true });

    expect(actual?.team1State).toBe("WAITING");
    expect(actual?.team2State).toBe("WAITING");
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
    expect(frMatchPage.voice).not.toHaveProperty("count");
    expect(enMatchPage.voice).not.toHaveProperty("countFull");
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
    expect(frMatchPage.voice.open).toBe("Salon vocal : ouvert");
    expect(enMatchPage.voice.open).toBe("Voice channel: open");
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
