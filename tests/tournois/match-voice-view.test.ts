import { describe, expect, it } from "@jest/globals";
import {
  currentMatchVoice,
  VOICE_POLL_GRACE_MS,
  VOICE_POLL_MS,
  voicePollActive,
  voicePollDue,
  voicePollStep,
  voiceStreamKey,
  voiceClearRoute,
  voiceClearUrl,
  type VoiceClearViewer,
  type PolledMatchVoice,
} from "@/app/(secured)/tournois/[id]/_lib/match-voice-view";
import type { MatchVoiceInfo } from "@/lib/shared/match-voice";
import { readSource } from "../helpers/read-source";

// Salons vocaux sur la page du match (`docs/features/MATCH_VOICE.md`) : la
// source qui fait foi entre l'instantané du flux et la relecture REST.

const streamed: MatchVoiceInfo = { team1State: "OPEN", team2State: "OPEN" };
const polledVoice: MatchVoiceInfo = { team1State: "OPEN", team2State: "FAILED" };

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

  it("voiceStreamKey_stateChange_changesKey", () => {
    const waiting: MatchVoiceInfo = { ...streamed, team1State: "WAITING" };

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
    const newer: MatchVoiceInfo = { ...streamed, team2State: "FAILED" };

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

  it("useMatchVoice_source_pollStepFeedsRefBeforeFetch", () => {
    const source = readSource("app/(secured)/tournois/[id]/_lib/match-voice-view.ts");

    expect(source).toContain("voicePollStep(downSince.current, active, tick, Date.now())");
    expect(source).toContain("if (!step.fetch) return;");
  });
});

describe("voicePollStep", () => {
  const t0 = 2_000_000;

  it("voicePollStep_inactive_resetsAndNoFetch", () => {
    expect(voicePollStep(t0, false, t0 + VOICE_POLL_MS, t0 + VOICE_POLL_MS)).toEqual({ downSince: null, fetch: false });
  });

  it("voicePollStep_firstActivePass_armsWithoutFetch", () => {
    // Même avec un battement périmé : le premier passage arme, il ne relit pas.
    expect(voicePollStep(null, true, t0 - 60_000, t0)).toEqual({ downSince: t0, fetch: false });
  });

  it("voicePollStep_activePassWithNullTick_armsWithoutFetch", () => {
    expect(voicePollStep(null, true, null, t0)).toEqual({ downSince: t0, fetch: false });
  });

  it("voicePollStep_freshTickRightAfterArming_noFetch", () => {
    expect(voicePollStep(t0, true, t0 + 3, t0 + 3)).toEqual({ downSince: t0, fetch: false });
  });

  it("voicePollStep_firstIntervalTick_fetches", () => {
    expect(voicePollStep(t0, true, t0 + VOICE_POLL_MS - 4, t0 + VOICE_POLL_MS - 4)).toEqual({ downSince: t0, fetch: true });
  });

  it("voicePollStep_activeNullTickArmed_noFetch", () => {
    expect(voicePollStep(t0, true, null, t0 + VOICE_POLL_MS)).toEqual({ downSince: t0, fetch: false });
  });

  it("voicePollStep_streamFlapsBackThenDown_rearmsFromScratch", () => {
    const down = voicePollStep(t0, true, t0 + VOICE_POLL_MS, t0 + VOICE_POLL_MS);
    const back = voicePollStep(down.downSince, false, t0 + VOICE_POLL_MS, t0 + VOICE_POLL_MS + 1);
    const downAgain = voicePollStep(back.downSince, true, t0 + 20_000, t0 + 20_000);

    expect(downAgain).toEqual({ downSince: t0 + 20_000, fetch: false });
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
});

describe("voiceClearRoute", () => {
  // Décisions D13 et D36 : l'arbitrage qui ne joue pas le match, ou l'équipe elle-même
  // (OWNER, MANAGER, CAPITAINE — `canCreateReportsForTeamIds`) pour son seul salon.
  const match = { team1Id: 4, team2Id: 5 };
  const viewer = (overrides: Partial<VoiceClearViewer> = {}): VoiceClearViewer => ({
    staff: false,
    frozen: false,
    solo: false,
    myTeamId: null,
    leadTeamIds: [],
    ...overrides,
  });

  it("voiceClearRoute_leaderOfThisTeam_team", () => {
    expect(voiceClearRoute(viewer({ myTeamId: 4, leadTeamIds: [4] }), match, 4)).toBe("team");
  });

  it("voiceClearRoute_leaderOnOpponentChannel_null", () => {
    expect(voiceClearRoute(viewer({ myTeamId: 4, leadTeamIds: [4] }), match, 5)).toBeNull();
  });

  it("voiceClearRoute_rosterMemberNotLeader_null", () => {
    expect(voiceClearRoute(viewer({ myTeamId: 4, leadTeamIds: [] }), match, 4)).toBeNull();
  });

  it("voiceClearRoute_staffNotPlaying_staff", () => {
    expect(voiceClearRoute(viewer({ staff: true }), match, 5)).toBe("staff");
  });

  it("voiceClearRoute_staffPlayingOnOwnLedTeam_team", () => {
    expect(voiceClearRoute(viewer({ staff: true, myTeamId: 4, leadTeamIds: [4] }), match, 4)).toBe("team");
  });

  it("voiceClearRoute_staffPlayingOnOpponent_null", () => {
    // Correctif de #572 : le serveur répondrait 403 VOICE_CLEAR_IS_PLAYER.
    expect(voiceClearRoute(viewer({ staff: true, myTeamId: 4, leadTeamIds: [4] }), match, 5)).toBeNull();
  });

  it("voiceClearRoute_staffMemberOfOtherTournamentTeam_staff", () => {
    expect(voiceClearRoute(viewer({ staff: true, myTeamId: 8, leadTeamIds: [8] }), match, 4)).toBe("staff");
  });

  it("voiceClearRoute_soloTournament_neverTeam", () => {
    expect(voiceClearRoute(viewer({ solo: true, myTeamId: 4, leadTeamIds: [4] }), match, 4)).toBeNull();
  });

  it("voiceClearRoute_frozen_null", () => {
    expect(voiceClearRoute(viewer({ frozen: true, staff: true }), match, 4)).toBeNull();
    expect(voiceClearRoute(viewer({ frozen: true, myTeamId: 4, leadTeamIds: [4] }), match, 4)).toBeNull();
  });
});

describe("voiceClearUrl", () => {
  it("voiceClearUrl_team_publicRoute", () => {
    expect(voiceClearUrl("team", 34)).toBe("/api/matches/34/voice/clear");
  });

  it("voiceClearUrl_staff_adminRoute", () => {
    expect(voiceClearUrl("staff", 34)).toBe("/api/admin/matches/34/voice/clear");
  });
});
