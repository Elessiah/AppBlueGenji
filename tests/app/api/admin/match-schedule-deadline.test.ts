import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/auth");
jest.mock("@/lib/server/tournaments/schedule-deadline", () => ({ setMatchScheduleDeadline: jest.fn() }));

import { PUT } from "@/app/api/admin/matches/[matchId]/schedule-deadline/route";
import { getCurrentUser } from "@/lib/server/auth";
import { setMatchScheduleDeadline } from "@/lib/server/tournaments/schedule-deadline";
import { authUser } from "../../../helpers/auth-user";

/** Date butoir d'un match (`docs/features/SCHEDULE_DEADLINE.md`) : permission `tournaments`. */

const player = authUser({ id: 2, isAdmin: false, roles: [] });
const caster = authUser({ id: 4, isAdmin: false, roles: ["CASTER"] });
const arbitre = authUser({ id: 3, isAdmin: false, roles: ["ARBITRE"] });
const DEADLINE = "2026-11-24T20:00:00.000Z";

function req(body: unknown) {
  return new Request("http://localhost/api/admin/matches/42/schedule-deadline", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const params = (matchId: string) => ({ params: Promise.resolve({ matchId }) });

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(getCurrentUser).mockResolvedValue(arbitre);
});
afterEach(() => {
  jest.restoreAllMocks();
});

describe("PUT /api/admin/matches/[matchId]/schedule-deadline", () => {
  it("PUT_anonymous_returns401", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(null);

    expect((await PUT(req({ deadlineAt: DEADLINE }), params("42"))).status).toBe(401);
    expect(setMatchScheduleDeadline).not.toHaveBeenCalled();
  });

  it("PUT_playerWithoutPermission_returns403", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(player);

    expect((await PUT(req({ deadlineAt: DEADLINE }), params("42"))).status).toBe(403);
    expect(setMatchScheduleDeadline).not.toHaveBeenCalled();
  });

  it("PUT_casterWithoutTournaments_returns403", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(caster);

    expect((await PUT(req({ deadlineAt: DEADLINE }), params("42"))).status).toBe(403);
  });

  it("PUT_referee_setsDeadlineAndReturnsIt", async () => {
    jest.mocked(setMatchScheduleDeadline).mockResolvedValue(DEADLINE);

    const res = await PUT(req({ deadlineAt: DEADLINE }), params("42"));

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ deadlineAt: DEADLINE });
    expect(setMatchScheduleDeadline).toHaveBeenCalledWith(42, DEADLINE, { id: arbitre.id, pseudo: arbitre.pseudo });
  });

  it("PUT_nullDeadline_clearsIt", async () => {
    jest.mocked(setMatchScheduleDeadline).mockResolvedValue(null);

    const res = await PUT(req({ deadlineAt: null }), params("42"));

    expect(res.status).toBe(200);
    expect(setMatchScheduleDeadline).toHaveBeenCalledWith(42, null, { id: arbitre.id, pseudo: arbitre.pseudo });
  });

  it("PUT_invalidMatchId_returns400", async () => {
    const res = await PUT(req({ deadlineAt: DEADLINE }), params("abc"));

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: "INVALID_MATCH_ID" });
  });

  it("PUT_bodyWithoutDeadlineAt_returns400", async () => {
    const res = await PUT(req({ startAt: DEADLINE }), params("42"));

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: "INVALID_SCHEDULE_DEADLINE" });
    expect(setMatchScheduleDeadline).not.toHaveBeenCalled();
  });

  it("PUT_unreadableBody_returns400", async () => {
    const res = await PUT(
      new Request("http://localhost/api/admin/matches/42/schedule-deadline", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: "{\"deadlineAt\": \"2026",
      }),
      params("42"),
    );

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: "INVALID_SCHEDULE_DEADLINE" });
  });

  it("PUT_deadlineTooSoon_returns400WithCode", async () => {
    jest.mocked(setMatchScheduleDeadline).mockRejectedValue(new Error("SCHEDULE_DEADLINE_TOO_SOON"));

    const res = await PUT(req({ deadlineAt: DEADLINE }), params("42"));

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: "SCHEDULE_DEADLINE_TOO_SOON" });
  });

  it("PUT_deadlineTooFar_returns400WithCode", async () => {
    jest.mocked(setMatchScheduleDeadline).mockRejectedValue(new Error("SCHEDULE_DEADLINE_TOO_FAR"));

    await expect((await PUT(req({ deadlineAt: DEADLINE }), params("42"))).json()).resolves.toEqual({
      error: "SCHEDULE_DEADLINE_TOO_FAR",
    });
  });

  it("PUT_unknownMatch_returns404", async () => {
    jest.mocked(setMatchScheduleDeadline).mockRejectedValue(new Error("MATCH_NOT_FOUND"));

    expect((await PUT(req({ deadlineAt: DEADLINE }), params("42"))).status).toBe(404);
  });

  it("PUT_matchAlreadyScheduledOrClosed_returns409", async () => {
    jest.mocked(setMatchScheduleDeadline).mockRejectedValue(new Error("SCHEDULE_DEADLINE_NOT_ALLOWED"));

    const res = await PUT(req({ deadlineAt: DEADLINE }), params("42"));

    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toEqual({ error: "SCHEDULE_DEADLINE_NOT_ALLOWED" });
  });

  it("PUT_unexpectedFailure_returns500CodeWithoutErrorText", async () => {
    jest.spyOn(console, "error").mockImplementation(() => undefined);
    jest.mocked(setMatchScheduleDeadline).mockRejectedValue(new Error("Unknown column 'schedule_deadline_at'"));

    const res = await PUT(req({ deadlineAt: DEADLINE }), params("42"));

    expect(res.status).toBe(500);
    const body = JSON.stringify(await res.json());
    expect(body).toContain("SCHEDULE_DEADLINE_UPDATE_FAILED");
    expect(body).not.toContain("schedule_deadline_at");
  });
});
