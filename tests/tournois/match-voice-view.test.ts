import { describe, expect, it } from "@jest/globals";
import {
  currentMatchVoice,
  VOICE_POLL_GRACE_MS,
  VOICE_POLL_MS,
  voicePollActive,
  voicePollDue,
  voiceStreamKey,
  type PolledMatchVoice,
} from "@/app/(secured)/tournois/[id]/_lib/match-voice-view";
import type { MatchVoiceInfo } from "@/lib/shared/match-voice";
import { readSource } from "../helpers/read-source";

// Salons vocaux sur la page du match (`docs/features/MATCH_VOICE.md`) : la
// source qui fait foi entre l'instantané du flux et la relecture REST.

const streamed: MatchVoiceInfo = { team1Members: 3, team2Members: 5, team1State: "COUNTED", team2State: "COUNTED", pending: true };
const polledVoice: MatchVoiceInfo = { team1Members: 5, team2Members: 5, team1State: "COUNTED", team2State: "COUNTED", pending: false };

const polled = (overrides: Partial<PolledMatchVoice> = {}): PolledMatchVoice => ({
  matchId: 34,
  streamKey: voiceStreamKey(streamed),
  voice: polledVoice,
  ...overrides,
});

describe("voiceStreamKey", () => {
  it("voiceStreamKey_null_none", () => {
    expect(voiceStreamKey(null)).toBe("none");
  });

  it("voiceStreamKey_newCount_changesKey", () => {
    expect(voiceStreamKey({ ...streamed, team1Members: 4 })).not.toBe(voiceStreamKey(streamed));
  });

  it("voiceStreamKey_stateChangeSameCount_changesKey", () => {
    const waiting: MatchVoiceInfo = { ...streamed, team1Members: null, team1State: "WAITING" };

    expect(voiceStreamKey({ ...waiting, team1State: "FAILED" })).not.toBe(voiceStreamKey(waiting));
  });
});

describe("currentMatchVoice", () => {
  it("currentMatchVoice_noPoll_streamed", () => {
    expect(currentMatchVoice(34, streamed, null, false)).toBe(streamed);
  });

  it("currentMatchVoice_pollOnCurrentSnapshot_polledWins", () => {
    expect(currentMatchVoice(34, streamed, polled(), false)).toBe(polledVoice);
  });

  it("currentMatchVoice_pollAnsweredNull_nullWins", () => {
    // Match lancé ou option éteinte : la porte REST répond `null`, la section se tait.
    expect(currentMatchVoice(34, streamed, polled({ voice: null }), false)).toBeNull();
  });

  it("currentMatchVoice_newerSnapshotAfterPoll_streamedWins", () => {
    const newer: MatchVoiceInfo = { ...streamed, team1Members: 4 };

    expect(currentMatchVoice(34, newer, polled(), false)).toBe(newer);
  });

  it("currentMatchVoice_streamBackWithSameSnapshot_streamedWins", () => {
    // Reconnexion sur l'instantané d'avant la coupure : la relecture faite flux coupé ne survit pas.
    expect(currentMatchVoice(34, streamed, polled(), true)).toBe(streamed);
  });

  it("currentMatchVoice_pollOfOtherMatch_ignored", () => {
    expect(currentMatchVoice(35, streamed, polled(), false)).toBe(streamed);
  });
});

describe("voicePollActive", () => {
  it("voicePollActive_streamLive_noPoll", () => {
    expect(voicePollActive(streamed, true)).toBe(false);
  });

  it("voicePollActive_streamDownTracked_polls", () => {
    expect(voicePollActive(streamed, false)).toBe(true);
  });

  it("voicePollActive_streamDownReleasedButTracked_stillPolls", () => {
    // Un comptage frais (verrou levé) vieillit sans écriture : on relit tant que le match suit ses salons.
    expect(voicePollActive(polledVoice, false)).toBe(true);
  });

  it("voicePollActive_streamDownUntracked_noPoll", () => {
    expect(voicePollActive(null, false)).toBe(false);
  });
});

describe("useMatchVoice — câblage", () => {
  it("useMatchVoice_source_clockGatedByPollAndBodyNeedsVoiceKey", () => {
    const source = readSource("app/(secured)/tournois/[id]/_lib/match-voice-view.ts");

    expect(source).toContain("voicePollActive(");
    expect(source).toContain("VOICE_POLL_MS");
    expect(source).toContain('"voice" in');
    // Pas d'empreinte en dépendance : un nouvel instantané ne relit pas hors cadence.
    expect(source).toContain("}, [tick, active, match.id]);");
  });

  it("useMatchVoice_source_streamKeyRefWrittenInEffectNotDuringRender", () => {
    const source = readSource("app/(secured)/tournois/[id]/_lib/match-voice-view.ts");

    // Un rendu écarté ne doit pas estampiller une relecture : la ref suit l'empreinte validée.
    expect(source).not.toContain("streamKey.current = voiceStreamKey(");
    expect(source).toMatch(/useEffect\(\(\) => \{\s*streamKey\.current = key;\s*\}, \[key\]\);/);
    // Posée avant l'effet de relecture, qui la lit.
    expect(source.indexOf("streamKey.current = key;")).toBeLessThan(source.indexOf("const seen = streamKey.current;"));
  });

  it("matchPageSection_source_passesStreamLiveFromSheet", () => {
    const source = readSource("app/(secured)/tournois/[id]/_components/TournamentSheet.tsx");

    expect(source).toMatch(/streamLive=\{isLive\}/);
  });
});

describe("voicePollDue", () => {
  const since = 1_000_000;

  it("voicePollDue_streamNeverDown_false", () => {
    expect(voicePollDue(null, since + VOICE_POLL_MS)).toBe(false);
  });

  it("voicePollDue_justWentDown_false", () => {
    expect(voicePollDue(since, since)).toBe(false);
  });

  it("voicePollDue_justBelowGrace_false", () => {
    expect(voicePollDue(since, since + VOICE_POLL_GRACE_MS - 1)).toBe(false);
  });

  it("voicePollDue_atGraceBoundary_true", () => {
    expect(voicePollDue(since, since + VOICE_POLL_GRACE_MS)).toBe(true);
  });

  it("voicePollDue_firstIntervalTickWithJitter_true", () => {
    // Le premier battement tombe une période après l'instant lu, à quelques ms près.
    expect(voicePollDue(since, since + VOICE_POLL_MS - 5)).toBe(true);
  });

  it("VOICE_POLL_GRACE_MS_isHalfPeriod", () => {
    expect(VOICE_POLL_GRACE_MS).toBe(VOICE_POLL_MS / 2);
  });

  it("useMatchVoice_source_pollGatedByGraceAndDownSinceReset", () => {
    const source = readSource("app/(secured)/tournois/[id]/_lib/match-voice-view.ts");

    expect(source).toContain("voicePollDue(downSince.current, tick)");
    expect(source).toContain("if (!active) downSince.current = null;");
  });
});

describe("isoTime et mémoïsation de la page (poids client)", () => {
  it("isoTime_module_hasNoImport", () => {
    expect(readSource("lib/shared/iso-time.ts")).not.toMatch(/^import /m);
    expect(readSource("lib/shared/dates.ts")).not.toContain("export function isoTime");
  });

  it("isoTime_clientModules_importTinyModuleNotDates", () => {
    for (const file of ["match-voice", "match-launch", "match-sections"]) {
      const source = readSource(`lib/shared/${file}.ts`);

      expect(source).toContain('from "./iso-time"');
      expect(source).not.toContain('from "./dates"');
    }
  });

  it("matchPage_source_streamsAndOfficiatingMemoized", () => {
    const source = readSource("app/(secured)/tournois/[id]/_components/MatchPage.tsx");

    expect(source).toContain("useMemo(() => matchPageStreams(match, liveState)");
    expect(source).toMatch(/useMemo\(\s*\(\) => officiatingContent\(/);
  });
});
