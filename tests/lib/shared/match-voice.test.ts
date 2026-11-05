import { describe, expect, it } from "@jest/globals";
import {
  VOICE_CHANNEL_LATE_HOURS,
  VOICE_CHANNEL_LEAD_MINUTES,
  matchVoiceInfo,
  parseMatchVoiceInfo,
  shownVoiceSide,
  voiceChannelKey,
  voiceChannelsDue,
  voiceTracked,
  type VoiceMatchInput,
} from "@/lib/shared/match-voice";
import { matchLaunchPhase, nextLaunchPhaseChangeAt } from "@/lib/shared/match-launch";
import frMatchPage from "@/messages/fr/matchPage.json";
import enMatchPage from "@/messages/en/matchPage.json";
import frForm from "@/messages/fr/tournamentForm.json";
import enForm from "@/messages/en/tournamentForm.json";
import frTournament from "@/messages/fr/tournament.json";
import enTournament from "@/messages/en/tournament.json";
import frRules from "@/messages/fr/rules.json";
import enRules from "@/messages/en/rules.json";

const START = "2026-11-05T20:00:00.000Z";
const startMs = Date.parse(START);
const team = { isSolo: false, isGhost: false };
const open = { channelId: "c1", failed: false };

function match(overrides: Partial<VoiceMatchInput> = {}): VoiceMatchInput {
  return { enabled: true, startAt: START, team1: team, team2: team, ...overrides };
}

describe("voiceChannelKey", () => {
  it("voiceChannelKey_ids_returnsMatchTeamKey", () => {
    expect(voiceChannelKey(42, 7)).toBe("match:42:team:7");
  });
});

describe("voiceChannelsDue", () => {
  const lead = VOICE_CHANNEL_LEAD_MINUTES * 60_000;
  const late = VOICE_CHANNEL_LATE_HOURS * 3_600_000;

  it("voiceChannelsDue_justBeforeLead_returnsFalse", () => {
    expect(voiceChannelsDue(START, startMs - lead - 1)).toBe(false);
  });

  it("voiceChannelsDue_exactlyLead_returnsTrue", () => {
    expect(voiceChannelsDue(START, startMs - lead)).toBe(true);
  });

  it("voiceChannelsDue_exactlyLateBound_returnsTrue", () => {
    expect(voiceChannelsDue(START, startMs + late)).toBe(true);
  });

  it("voiceChannelsDue_pastLateBound_returnsFalse", () => {
    expect(voiceChannelsDue(START, startMs + late + 1)).toBe(false);
  });

  it("voiceChannelsDue_nullStart_returnsFalse", () => {
    expect(voiceChannelsDue(null, startMs)).toBe(false);
  });
});

describe("voiceTracked", () => {
  it("voiceTracked_optionOff_returnsFalse", () => {
    expect(voiceTracked(match({ enabled: false }))).toBe(false);
  });

  it("voiceTracked_soloSide_returnsFalse", () => {
    expect(voiceTracked(match({ team2: { isSolo: true, isGhost: false } }))).toBe(false);
  });

  it("voiceTracked_ghostSide_returnsFalse", () => {
    expect(voiceTracked(match({ team1: { isSolo: false, isGhost: true } }))).toBe(false);
  });

  it("voiceTracked_noStartAt_returnsFalse", () => {
    expect(voiceTracked(match({ startAt: null }))).toBe(false);
  });

  it("voiceTracked_twoRealTeams_returnsTrue", () => {
    expect(voiceTracked(match())).toBe(true);
  });
});

describe("matchVoiceInfo", () => {
  it("matchVoiceInfo_untracked_returnsNull", () => {
    expect(matchVoiceInfo(match({ enabled: false }), open, open)).toBeNull();
  });

  it("matchVoiceInfo_tracked_returnsSideStatesOnly", () => {
    const actual = matchVoiceInfo(match(), open, { channelId: null, failed: true });

    expect(actual).toEqual({ team1State: "OPEN", team2State: "FAILED", team1Rev: "187t" });
  });

  it("matchVoiceInfo_noRows_waitingBothSides", () => {
    expect(matchVoiceInfo(match(), null, null)).toEqual({ team1State: "WAITING", team2State: "WAITING" });
  });
});

describe("shownVoiceSide", () => {
  it("shownVoiceSide_noChannel_waiting", () => {
    expect(shownVoiceSide({ channelId: null, failed: false })).toBe("WAITING");
  });

  it("shownVoiceSide_failedEvenWithChannel_failed", () => {
    expect(shownVoiceSide({ channelId: "c1", failed: true })).toBe("FAILED");
  });

  it("shownVoiceSide_created_open", () => {
    expect(shownVoiceSide(open)).toBe("OPEN");
  });
});

describe("parseMatchVoiceInfo", () => {
  it("parseMatchVoiceInfo_notAnObject_returnsNull", () => {
    expect(parseMatchVoiceInfo("3/5")).toBeNull();
  });

  it("parseMatchVoiceInfo_noStates_waiting", () => {
    expect(parseMatchVoiceInfo({})).toEqual({ team1State: "WAITING", team2State: "WAITING" });
  });

  it("parseMatchVoiceInfo_legacyGatePayload_dropsPendingAndNumbers", () => {
    const actual = parseMatchVoiceInfo({ team1Members: 3, team1State: "COUNTED", team2State: "UNCOUNTED", pending: true });

    expect(actual).toEqual({ team1State: "OPEN", team2State: "OPEN" });
  });

  it("parseMatchVoiceInfo_knownStates_keptAsIs", () => {
    expect(parseMatchVoiceInfo({ team1State: "FAILED", team2State: "OPEN" })).toEqual({ team1State: "FAILED", team2State: "OPEN" });
  });

  it("parseMatchVoiceInfo_unknownState_waiting", () => {
    const actual = parseMatchVoiceInfo({ team1State: "FULL", team2State: 7 });

    expect(actual).toEqual({ team1State: "WAITING", team2State: "WAITING" });
  });
});

describe("matchLaunchPhase — les salons ne retiennent plus le départ", () => {
  const base = {
    status: "READY" as const,
    team1Id: 1,
    team2Id: 2,
    startAt: "2026-01-01T00:00:00.000Z",
    launchedAt: null,
    refereeScheduling: false,
    launchPhase: false,
  };
  const afterStart = Date.parse("2026-01-01T01:00:00.000Z");

  it("matchLaunchPhase_phaseOffPastStart_returnsLaunched", () => {
    expect(matchLaunchPhase(base, afterStart)).toBe("LAUNCHED");
  });

  it("nextLaunchPhaseChangeAt_scheduled_returnsStart", () => {
    expect(nextLaunchPhaseChangeAt(base, Date.parse("2025-12-31T23:00:00.000Z"))).toBe(Date.parse(base.startAt));
  });
});

describe("textes des salons vocaux (FR + EN)", () => {
  it("messages_voiceKeys_presentInFrAndEnWithoutGateTexts", () => {
    expect(Object.keys(enMatchPage.voice)).toEqual(Object.keys(frMatchPage.voice));
    expect(Object.keys(enForm.form.teamVoice)).toEqual(Object.keys(frForm.form.teamVoice));
    expect(frMatchPage.voice).not.toHaveProperty("waiting");
    expect(frMatchPage.voice).not.toHaveProperty("failedNote");
    expect(frTournament.launch).not.toHaveProperty("voicePending");
    expect(enTournament.launch).not.toHaveProperty("voicePending");
  });

  it("messages_teamVoiceDescription_atMostTwoSentences", () => {
    // Texte explicatif d'un « i » (INFO_HINTS.md) : une à deux phrases.
    const sentences = (text: string) => text.split(/[.!?](?:\s|$)/).filter((part) => part.trim() !== "").length;

    expect(sentences(frForm.form.teamVoice.description)).toBeLessThanOrEqual(2);
    expect(sentences(enForm.form.teamVoice.description)).toBeLessThanOrEqual(2);
  });

  it("messages_teamVoiceDescription_scopeEitherSideSoloOrGhost", () => {
    expect(frForm.form.teamVoice.description).toContain("aucun si l'un des deux camps est une entrée solo ou une équipe fantôme");
    expect(enForm.form.teamVoice.description).toContain("none if either side is a solo entry or a ghost team");
  });

  it("messages_teamVoiceDescription_launchIndependentAndNoCount", () => {
    expect(frForm.form.teamVoice.description).toContain("le lancement du match n'en dépend pas");
    expect(frForm.form.teamVoice.description).not.toContain("nombre de présents");
    expect(enForm.form.teamVoice.description).toContain("the match launch doesn't depend on the channels");
    expect(enForm.form.teamVoice.description).not.toContain("how many people");
  });

  it("messages_voiceHint_launchIndependentFrAndEn", () => {
    expect(frMatchPage.voice.hint).toContain("le lancement du match ne dépend pas des salons");
    expect(enMatchPage.voice.hint).toContain("the match launch doesn't depend on the channels");
  });

  it("messages_rulesVoice_noGateNoCountFrAndEn", () => {
    const fr = frRules.common[1].bullets.join(" ");
    const en = enRules.common[1].bullets.join(" ");

    expect(fr).toContain("Les salons ne retiennent jamais le lancement du match");
    expect(fr).not.toContain("compte les personnes");
    expect(en).toContain("The channels never hold the match's launch");
    expect(en).not.toContain("counts the people");
  });

  it("messages_voiceStateTexts_frenchAndEnglish", () => {
    expect(frMatchPage.voice.open).toBe("Salon vocal : ouvert");
    expect(enMatchPage.voice.open).toBe("Voice channel: open");
    expect(frMatchPage.voice.failed).toBe("Salon vocal : indisponible, nouvelle tentative en cours");
    expect(enMatchPage.voice.failed).toBe("Voice channel: unavailable, trying again");
  });

  it("messages_finishedVoiceError_frenchAndEnglish", () => {
    expect(frForm.edit.voiceErrors.TOURNAMENT_FINISHED).toBe(frForm.edit.planningErrors.TOURNAMENT_FINISHED);
    expect(enForm.edit.voiceErrors.TOURNAMENT_FINISHED).toBe(enForm.edit.planningErrors.TOURNAMENT_FINISHED);
  });
});
