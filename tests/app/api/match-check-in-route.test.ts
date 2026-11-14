import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { NextResponse } from "next/server";

jest.mock("@/lib/server/auth");
jest.mock("@/lib/server/tournaments/match-check-in");
jest.mock("@/lib/server/tournaments/staff-action-logs");
jest.mock("@/lib/server/api-guard", () => ({
  ...jest.requireActual<typeof import("@/lib/server/api-guard")>("@/lib/server/api-guard"),
  reserveRateLimit: jest.fn(
    jest.requireActual<typeof import("@/lib/server/api-guard")>("@/lib/server/api-guard").reserveRateLimit,
  ),
}));

import { PUT } from "@/app/api/admin/tournaments/[id]/match-check-in/route";
import { reserveRateLimit, MATCH_CHECK_IN_TOGGLE_RULE } from "@/lib/server/api-guard";
import { getCurrentUser } from "@/lib/server/auth";
import { resetRateLimit } from "@/lib/server/rate-limit";
import { setMatchCheckIn } from "@/lib/server/tournaments/match-check-in";
import { announceStaffTournamentAction } from "@/lib/server/tournaments/staff-action-logs";
import { authUser } from "../../helpers/auth-user";

const player = authUser({ id: 2, isAdmin: false, roles: [] });
const arbitre = authUser({ id: 3, isAdmin: false, roles: ["ARBITRE"] });

function putReq(body: unknown) {
  return new Request("http://localhost/api/admin/tournaments/7/match-check-in", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
const params = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  jest.clearAllMocks();
  resetRateLimit(MATCH_CHECK_IN_TOGGLE_RULE.name);
  jest.mocked(setMatchCheckIn).mockResolvedValue({ tournamentId: 7, enabled: false, changed: true });
});

describe("PUT /api/admin/tournaments/[id]/match-check-in", () => {
  it("put_noSession_returns401", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(null);
    expect((await PUT(putReq({ enabled: false }), params("7"))).status).toBe(401);
    expect(setMatchCheckIn).not.toHaveBeenCalled();
  });

  it("put_noTournamentsPermission_returns403", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(player);
    expect((await PUT(putReq({ enabled: false }), params("7"))).status).toBe(403);
    expect(setMatchCheckIn).not.toHaveBeenCalled();
  });

  it("put_rateLimited_returns429WithoutService", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(arbitre);
    jest.mocked(reserveRateLimit).mockReturnValueOnce({ refused: NextResponse.json({ error: "RATE_LIMITED" }, { status: 429 }), refund: () => undefined });
    expect((await PUT(putReq({ enabled: false }), params("7"))).status).toBe(429);
    expect(reserveRateLimit).toHaveBeenCalledWith(MATCH_CHECK_IN_TOGGLE_RULE, 3);
    expect(setMatchCheckIn).not.toHaveBeenCalled();
  });

  it("put_badTournamentId_returns400", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(arbitre);
    const res = await PUT(putReq({ enabled: false }), params("abc"));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("INVALID_TOURNAMENT_ID");
  });

  it("put_nonBooleanEnabled_returns400", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(arbitre);
    const res = await PUT(putReq({ enabled: "false" }), params("7"));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("INVALID_MATCH_CHECK_IN");
    expect(setMatchCheckIn).not.toHaveBeenCalled();
  });

  it("put_turnedOff_returns200AndLogsOff", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(arbitre);
    const res = await PUT(putReq({ enabled: false }), params("7"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ enabled: false, changed: true });
    expect(setMatchCheckIn).toHaveBeenCalledWith(7, false);
    expect(announceStaffTournamentAction).toHaveBeenCalledWith(7, "MATCH_CHECK_IN_OFF");
  });

  it("put_turnedOn_logsOn", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(arbitre);
    jest.mocked(setMatchCheckIn).mockResolvedValue({ tournamentId: 7, enabled: true, changed: true });
    await PUT(putReq({ enabled: true }), params("7"));
    expect(announceStaffTournamentAction).toHaveBeenCalledWith(7, "MATCH_CHECK_IN_ON");
  });

  it("put_unchanged_logsNothing", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(arbitre);
    jest.mocked(setMatchCheckIn).mockResolvedValue({ tournamentId: 7, enabled: false, changed: false });
    expect((await PUT(putReq({ enabled: false }), params("7"))).status).toBe(200);
    expect(announceStaffTournamentAction).not.toHaveBeenCalled();
  });

  it("put_unknownTournament_returns404", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(arbitre);
    jest.mocked(setMatchCheckIn).mockRejectedValue(new Error("TOURNAMENT_NOT_FOUND"));
    expect((await PUT(putReq({ enabled: false }), params("7"))).status).toBe(404);
  });

  it("put_finishedTournament_returns409", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(arbitre);
    jest.mocked(setMatchCheckIn).mockRejectedValue(new Error("TOURNAMENT_FINISHED"));
    const res = await PUT(putReq({ enabled: false }), params("7"));
    expect(res.status).toBe(409);
    expect(announceStaffTournamentAction).not.toHaveBeenCalled();
  });

  it("put_oversizedBody_returns413WithoutService", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(arbitre);
    const res = await PUT(putReq({ enabled: false, padding: "x".repeat(300 * 1024) }), params("7"));
    expect(res.status).toBe(413);
    expect((await res.json()).error).toBe("PAYLOAD_TOO_LARGE");
    expect(setMatchCheckIn).not.toHaveBeenCalled();
  });

  it("put_foreignContentType_returns415WithoutService", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(arbitre);
    const req = new Request("http://localhost/api/admin/tournaments/7/match-check-in", {
      method: "PUT",
      headers: { "content-type": "text/plain" },
      body: "enabled=false",
    });
    const res = await PUT(req, params("7"));
    expect(res.status).toBe(415);
    expect((await res.json()).error).toBe("UNSUPPORTED_CONTENT_TYPE");
    expect(setMatchCheckIn).not.toHaveBeenCalled();
  });

  it("put_serviceThrows_returns500", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(arbitre);
    jest.mocked(setMatchCheckIn).mockRejectedValue(new Error("boom"));
    const res = await PUT(putReq({ enabled: false }), params("7"));
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("MATCH_CHECK_IN_UPDATE_FAILED");
  });

  it("put_contention_returns409RetryCode", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(arbitre);
    jest
      .mocked(setMatchCheckIn)
      .mockRejectedValueOnce(Object.assign(new Error("Deadlock found"), { code: "ER_LOCK_DEADLOCK", errno: 1213 }));
    const warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
    const response = await PUT(putReq({ enabled: true }), params("7"));
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: "CONCURRENT_UPDATE_RETRY" });
    expect(announceStaffTournamentAction).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("put_staffLogThrows_returns200WithCommittedValue", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(arbitre);
    jest.mocked(announceStaffTournamentAction).mockImplementationOnce(() => {
      throw new Error("journal en panne");
    });
    const error = jest.spyOn(console, "error").mockImplementation(() => undefined);
    const res = await PUT(putReq({ enabled: false }), params("7"));
    // Le changement est validé : le journal en échec ne le fait pas passer pour refusé.
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ enabled: false, changed: true });
    error.mockRestore();
  });
});

describe("PUT match-check-in — débit réservé, rendu sans changement", () => {
  const overCap = MATCH_CHECK_IN_TOGGLE_RULE.limit + 1;

  it("put_noOpRequestsBeyondCap_neverThrottled", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(arbitre);
    jest.mocked(setMatchCheckIn).mockResolvedValue({ tournamentId: 7, enabled: true, changed: false });
    const statuses: number[] = [];
    for (let attempt = 0; attempt < overCap; attempt += 1) {
      statuses.push((await PUT(putReq({ enabled: true }), params("7"))).status);
    }
    expect(statuses).toEqual(Array.from({ length: overCap }, () => 200));
  });

  it("put_realChangesBeyondCap_returns429WithoutService", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(arbitre);
    for (let attempt = 0; attempt < MATCH_CHECK_IN_TOGGLE_RULE.limit; attempt += 1) {
      await PUT(putReq({ enabled: false }), params("7"));
    }
    jest.mocked(setMatchCheckIn).mockClear();
    const res = await PUT(putReq({ enabled: false }), params("7"));
    expect(res.status).toBe(429);
    expect((await res.json()).error).toBe("TOO_MANY_REQUESTS");
    expect(setMatchCheckIn).not.toHaveBeenCalled();
  });

  it("put_invalidBodiesBeyondCap_refundEachSlot", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(arbitre);
    for (let attempt = 0; attempt < overCap; attempt += 1) {
      await PUT(putReq({ enabled: "on" }), params("7"));
    }
    expect((await PUT(putReq({ enabled: false }), params("7"))).status).toBe(200);
  });

  it("put_serviceFailuresBeyondCap_refundEachSlot", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(arbitre);
    jest.mocked(setMatchCheckIn).mockRejectedValue(new Error("TOURNAMENT_FINISHED"));
    for (let attempt = 0; attempt < overCap; attempt += 1) {
      await PUT(putReq({ enabled: false }), params("7"));
    }
    jest.mocked(setMatchCheckIn).mockResolvedValue({ tournamentId: 7, enabled: false, changed: true });
    expect((await PUT(putReq({ enabled: false }), params("7"))).status).toBe(200);
  });
});
