import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { NextResponse } from "next/server";

jest.mock("@/lib/server/auth");
jest.mock("@/lib/server/tournaments/match-voice");
jest.mock("@/lib/server/tournaments/staff-action-logs");
jest.mock("@/lib/server/staff-audit");
jest.mock("@/lib/server/api-guard", () => ({
  ...jest.requireActual<typeof import("@/lib/server/api-guard")>("@/lib/server/api-guard"),
  enforceRateLimit: jest.fn(() => null),
}));

import { PUT } from "@/app/api/admin/tournaments/[id]/voice-channels/route";
import { GET } from "@/app/api/matches/[matchId]/voice/route";
import { POST as CLEAR } from "@/app/api/admin/matches/[matchId]/voice/clear/route";
import { enforceRateLimit, MATCH_VOICE_READ_RULE, TEAM_VOICE_TOGGLE_RULE, VOICE_CLEAR_RULE } from "@/lib/server/api-guard";
import { getCurrentUser } from "@/lib/server/auth";
import { announceStaffMatchAction, announceStaffTournamentAction } from "@/lib/server/tournaments/staff-action-logs";
import { auditStaffAction } from "@/lib/server/staff-audit";
import { clearTeamVoiceChannel, readMatchVoice, setTeamVoiceChannels } from "@/lib/server/tournaments/match-voice";
import { authUser } from "../../helpers/auth-user";

const player = authUser({ id: 2, isAdmin: false, roles: [] });
const arbitre = authUser({ id: 3, isAdmin: false, roles: ["ARBITRE"], pseudo: "ArbitrePseudo" });

function putReq(body: unknown) {
  return new Request("http://localhost/api/admin/tournaments/7/voice-channels", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
const tournamentParams = (id: string) => ({ params: Promise.resolve({ id }) });
const matchParams = (matchId: string) => ({ params: Promise.resolve({ matchId }) });
const getReq = () => new Request("http://localhost/api/matches/9/voice");

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(setTeamVoiceChannels).mockResolvedValue({
    tournamentId: 7,
    tournamentName: "Coupe <@&1>",
    enabled: true,
    changed: true,
  });
});
afterEach(() => {
  jest.restoreAllMocks();
});

describe("PUT /api/admin/tournaments/[id]/voice-channels", () => {
  it("put_noSession_returns401", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(null);
    expect((await PUT(putReq({ enabled: true }), tournamentParams("7"))).status).toBe(401);
    expect(setTeamVoiceChannels).not.toHaveBeenCalled();
  });

  it("put_noTournamentsPermission_returns403", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(player);
    expect((await PUT(putReq({ enabled: true }), tournamentParams("7"))).status).toBe(403);
    expect(setTeamVoiceChannels).not.toHaveBeenCalled();
  });

  it("put_badTournamentId_returns400", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(arbitre);
    const res = await PUT(putReq({ enabled: true }), tournamentParams("0"));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("INVALID_TOURNAMENT_ID");
  });

  it("put_nonBooleanEnabled_returns400", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(arbitre);
    const res = await PUT(putReq({ enabled: "true" }), tournamentParams("7"));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("INVALID_TEAM_VOICE_CHANNELS");
    expect(setTeamVoiceChannels).not.toHaveBeenCalled();
  });

  it("put_unknownTournament_returns404", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(arbitre);
    jest.mocked(setTeamVoiceChannels).mockRejectedValue(new Error("TOURNAMENT_NOT_FOUND"));
    const res = await PUT(putReq({ enabled: true }), tournamentParams("7"));
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe("TOURNAMENT_NOT_FOUND");
  });

  it("put_finishedTournament_returns409", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(arbitre);
    jest.mocked(setTeamVoiceChannels).mockRejectedValue(new Error("TOURNAMENT_FINISHED"));
    const res = await PUT(putReq({ enabled: true }), tournamentParams("7"));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("TOURNAMENT_FINISHED");
    expect(announceStaffTournamentAction).not.toHaveBeenCalled();
  });

  it("put_rateLimited_returns429WithoutService", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(arbitre);
    jest.mocked(enforceRateLimit).mockReturnValueOnce(NextResponse.json({ error: "RATE_LIMITED" }, { status: 429 }));
    const res = await PUT(putReq({ enabled: true }), tournamentParams("7"));
    expect(res.status).toBe(429);
    expect(enforceRateLimit).toHaveBeenCalledWith(TEAM_VOICE_TOGGLE_RULE, 3);
    expect(setTeamVoiceChannels).not.toHaveBeenCalled();
  });

  it("put_serviceThrows_returns500", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(arbitre);
    jest.mocked(setTeamVoiceChannels).mockRejectedValue(new Error("boom"));
    const res = await PUT(putReq({ enabled: true }), tournamentParams("7"));
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("TEAM_VOICE_CHANNELS_UPDATE_FAILED");
  });

  it("put_changed_logsAnonymousTournamentActionWithoutAuthor", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(arbitre);
    const res = await PUT(putReq({ enabled: true }), tournamentParams("7"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ enabled: true, changed: true });
    expect(setTeamVoiceChannels).toHaveBeenCalledWith(7, true);
    expect(announceStaffTournamentAction).toHaveBeenCalledWith(7, "TEAM_VOICE_ON");
  });

  it("put_turnedOff_logsTeamVoiceOff", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(arbitre);
    jest.mocked(setTeamVoiceChannels).mockResolvedValue({
      tournamentId: 7,
      tournamentName: "Coupe",
      enabled: false,
      changed: true,
    });
    await PUT(putReq({ enabled: false }), tournamentParams("7"));
    expect(announceStaffTournamentAction).toHaveBeenCalledWith(7, "TEAM_VOICE_OFF");
  });

  it("put_unchanged_logsNothing", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(arbitre);
    jest.mocked(setTeamVoiceChannels).mockResolvedValue({
      tournamentId: 7,
      tournamentName: "Coupe",
      enabled: false,
      changed: false,
    });
    const res = await PUT(putReq({ enabled: false }), tournamentParams("7"));
    expect(await res.json()).toEqual({ enabled: false, changed: false });
    expect(announceStaffTournamentAction).not.toHaveBeenCalled();
  });
});

describe("GET /api/matches/[matchId]/voice", () => {
  it("get_noSession_returns401", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(null);
    expect((await GET(getReq(), matchParams("9"))).status).toBe(401);
  });

  it("get_badMatchId_returns400", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(player);
    expect((await GET(getReq(), matchParams("abc"))).status).toBe(400);
  });

  it("get_matchNotVisible_returns404", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(player);
    jest.mocked(readMatchVoice).mockResolvedValue(undefined);
    expect((await GET(getReq(), matchParams("9"))).status).toBe(404);
  });

  it("get_tracked_returnsVoiceStates", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(arbitre);
    const voice = { team1State: "OPEN", team2State: "OPEN" } as const;
    jest.mocked(readMatchVoice).mockResolvedValue(voice);
    const res = await GET(getReq(), matchParams("9"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ voice });
    expect(readMatchVoice).toHaveBeenCalledWith(9, true);
  });

  it("get_rateLimited_returns429WithoutRead", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(player);
    jest.mocked(enforceRateLimit).mockReturnValueOnce(NextResponse.json({ error: "RATE_LIMITED" }, { status: 429 }));
    const res = await GET(getReq(), matchParams("9"));
    expect(res.status).toBe(429);
    expect(enforceRateLimit).toHaveBeenCalledWith(MATCH_VOICE_READ_RULE, 2);
    expect(readMatchVoice).not.toHaveBeenCalled();
  });

  it("get_readThrows_returns500", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(player);
    jest.mocked(readMatchVoice).mockRejectedValue(new Error("db"));
    const res = await GET(getReq(), matchParams("9"));
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("MATCH_VOICE_READ_FAILED");
  });
});

function clearReq(body: unknown) {
  return new Request("http://localhost/api/admin/matches/9/voice/clear", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/admin/matches/[matchId]/voice/clear", () => {
  beforeEach(() => {
    jest.mocked(clearTeamVoiceChannel).mockImplementation(async (_m, _t, _u, beforeClear) => {
      beforeClear?.(false);
      return "cleared";
    });
  });

  it("clear_noSession_returns401", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(null);
    expect((await CLEAR(clearReq({ teamId: 4 }), matchParams("9"))).status).toBe(401);
    expect(clearTeamVoiceChannel).not.toHaveBeenCalled();
  });

  it("clear_noTournamentsPermission_returns403", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(player);
    expect((await CLEAR(clearReq({ teamId: 4 }), matchParams("9"))).status).toBe(403);
    expect(clearTeamVoiceChannel).not.toHaveBeenCalled();
  });

  it("clear_throttled_returnsLimitResponse", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(arbitre);
    jest.mocked(enforceRateLimit).mockReturnValueOnce(NextResponse.json({ error: "TOO_MANY_REQUESTS" }, { status: 429 }));
    expect((await CLEAR(clearReq({ teamId: 4 }), matchParams("9"))).status).toBe(429);
    expect(enforceRateLimit).toHaveBeenCalledWith(VOICE_CLEAR_RULE, arbitre.id);
    expect(clearTeamVoiceChannel).not.toHaveBeenCalled();
  });

  it("clear_badMatchId_returns400", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(arbitre);
    const res = await CLEAR(clearReq({ teamId: 4 }), matchParams("0"));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("INVALID_MATCH_ID");
  });

  it("clear_teamIdZero_returns400", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(arbitre);
    const res = await CLEAR(clearReq({ teamId: 0 }), matchParams("9"));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("INVALID_TEAM_ID");
    expect(clearTeamVoiceChannel).not.toHaveBeenCalled();
  });

  it("clear_teamIdNotInteger_returns400", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(arbitre);
    const res = await CLEAR(clearReq({ teamId: "4" }), matchParams("9"));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("INVALID_TEAM_ID");
  });

  it("clear_teamIdOne_clearsAndReturns200", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(arbitre);
    const res = await CLEAR(clearReq({ teamId: 1 }), matchParams("9"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ cleared: true });
    expect(clearTeamVoiceChannel).toHaveBeenCalledWith(9, 1, arbitre.id, expect.any(Function));
  });

  it("clear_staffNotDesignatedReferee_loggedAnonymouslyAndNamedInPm2", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(arbitre);
    await CLEAR(clearReq({ teamId: 4 }), matchParams("9"));
    expect(announceStaffMatchAction).toHaveBeenCalledWith(9, "VOICE_CLEARED");
    expect(auditStaffAction).toHaveBeenCalledWith("Vidage du salon vocal d'une équipe demandé — match #9", { id: arbitre.id, pseudo: "ArbitrePseudo" });
    expect(auditStaffAction).toHaveBeenLastCalledWith("Vidage du salon vocal d'une équipe — match #9 : cleared", { id: arbitre.id, pseudo: "ArbitrePseudo" });
  });

  it("clear_staffNotDesignatedReferee_botRefuses_stillNamedInPm2ButNotAnnounced", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(arbitre);
    jest.mocked(clearTeamVoiceChannel).mockImplementation(async (_m, _t, _u, beforeClear) => {
      beforeClear?.(false);
      return "unavailable";
    });
    const res = await CLEAR(clearReq({ teamId: 4 }), matchParams("9"));
    expect(res.status).toBe(503);
    expect(auditStaffAction).toHaveBeenCalledWith("Vidage du salon vocal d'une équipe demandé — match #9", { id: arbitre.id, pseudo: "ArbitrePseudo" });
    expect(auditStaffAction).toHaveBeenLastCalledWith("Vidage du salon vocal d'une équipe — match #9 : unavailable", { id: arbitre.id, pseudo: "ArbitrePseudo" });
    expect(announceStaffMatchAction).not.toHaveBeenCalled();
  });

  it("clear_designatedReferee_loggedWithoutName", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(arbitre);
    jest.mocked(clearTeamVoiceChannel).mockImplementation(async (_m, _t, _u, beforeClear) => {
      beforeClear?.(true);
      return "cleared";
    });
    await CLEAR(clearReq({ teamId: 4 }), matchParams("9"));
    expect(announceStaffMatchAction).toHaveBeenCalledWith(9, "VOICE_CLEARED");
    expect(auditStaffAction).not.toHaveBeenCalled();
  });

  it("clear_callerPlaysMatch_returns403AndLogsNothing", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(arbitre);
    jest.mocked(clearTeamVoiceChannel).mockResolvedValue("player");
    const res = await CLEAR(clearReq({ teamId: 4 }), matchParams("9"));
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("VOICE_CLEAR_IS_PLAYER");
    expect(announceStaffMatchAction).not.toHaveBeenCalled();
  });

  it("clear_noOpenChannel_returns409", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(arbitre);
    jest.mocked(clearTeamVoiceChannel).mockResolvedValue("notOpen");
    const res = await CLEAR(clearReq({ teamId: 4 }), matchParams("9"));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("VOICE_CHANNEL_NOT_OPEN");
  });

  it("clear_botUnavailable_returns503", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(arbitre);
    jest.mocked(clearTeamVoiceChannel).mockResolvedValue("unavailable");
    const res = await CLEAR(clearReq({ teamId: 4 }), matchParams("9"));
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe("VOICE_CLEAR_UNAVAILABLE");
  });

  it("clear_serviceThrows_returns500", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(arbitre);
    jest.mocked(clearTeamVoiceChannel).mockRejectedValue(new Error("boom"));
    const res = await CLEAR(clearReq({ teamId: 4 }), matchParams("9"));
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("VOICE_CLEAR_FAILED");
    expect(auditStaffAction).not.toHaveBeenCalled();
  });

  it("clear_staffNotDesignatedReferee_throwsAfterNaming_logsFailedOutcome", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(arbitre);
    jest.mocked(clearTeamVoiceChannel).mockImplementation(async (_m, _t, _u, beforeClear) => {
      beforeClear?.(false);
      throw new Error("boom");
    });
    const res = await CLEAR(clearReq({ teamId: 4 }), matchParams("9"));
    expect(res.status).toBe(500);
    expect(auditStaffAction).toHaveBeenCalledTimes(2);
    expect(auditStaffAction).toHaveBeenNthCalledWith(1, "Vidage du salon vocal d'une équipe demandé — match #9", { id: arbitre.id, pseudo: "ArbitrePseudo" });
    expect(auditStaffAction).toHaveBeenNthCalledWith(2, "Vidage du salon vocal d'une équipe — match #9 : failed", { id: arbitre.id, pseudo: "ArbitrePseudo" });
    expect(announceStaffMatchAction).not.toHaveBeenCalled();
  });

  it("clear_designatedReferee_throws_logsNothing", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(arbitre);
    jest.mocked(clearTeamVoiceChannel).mockImplementation(async (_m, _t, _u, beforeClear) => {
      beforeClear?.(true);
      throw new Error("boom");
    });
    const res = await CLEAR(clearReq({ teamId: 4 }), matchParams("9"));
    expect(res.status).toBe(500);
    expect(auditStaffAction).not.toHaveBeenCalled();
  });
});

describe("POST /api/admin/matches/[matchId]/voice/clear — lecture du corps", () => {
  it("clear_notJson_returns415", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(arbitre);
    const req = new Request("http://localhost/api/admin/matches/9/voice/clear", {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: "teamId=4",
    });
    expect((await CLEAR(req, matchParams("9"))).status).toBe(415);
    expect(clearTeamVoiceChannel).not.toHaveBeenCalled();
  });
});
