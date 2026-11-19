import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/auth");
jest.mock("@/lib/server/tournaments/schedule-deadline", () => ({ setTournamentScheduleDeadlines: jest.fn() }));

import { POST } from "@/app/api/admin/tournaments/[id]/schedule-deadlines/route";
import { getCurrentUser } from "@/lib/server/auth";
import { setTournamentScheduleDeadlines } from "@/lib/server/tournaments/schedule-deadline";
import { authUser } from "../../../helpers/auth-user";

/** Dates butoirs de tout un tournoi (`docs/features/SCHEDULE_DEADLINE.md`) : permission `tournaments`. */

const player = authUser({ id: 2, isAdmin: false, roles: [] });
const caster = authUser({ id: 4, isAdmin: false, roles: ["CASTER"] });
const arbitre = authUser({ id: 3, isAdmin: false, roles: ["ARBITRE"] });
const DEADLINE = "2026-11-24T20:00:00.000Z";

function req(body: unknown) {
  return new Request("http://localhost/api/admin/tournaments/42/schedule-deadlines", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const params = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(getCurrentUser).mockResolvedValue(arbitre);
});
afterEach(() => {
  jest.restoreAllMocks();
});

describe("POST /api/admin/tournaments/[id]/schedule-deadlines", () => {
  it("POST_anonymous_returns401", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(null);

    expect((await POST(req({ deadlineAt: DEADLINE }), params("42"))).status).toBe(401);
    expect(setTournamentScheduleDeadlines).not.toHaveBeenCalled();
  });

  it("POST_playerWithoutPermission_returns403", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(player);

    expect((await POST(req({ deadlineAt: DEADLINE }), params("42"))).status).toBe(403);
    expect(setTournamentScheduleDeadlines).not.toHaveBeenCalled();
  });

  it("POST_casterWithoutTournaments_returns403", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(caster);

    expect((await POST(req({ deadlineAt: DEADLINE }), params("42"))).status).toBe(403);
  });

  it("POST_referee_setsEveryOpenMatchAndReturnsCount", async () => {
    jest.mocked(setTournamentScheduleDeadlines).mockResolvedValue(3);

    const res = await POST(req({ deadlineAt: DEADLINE }), params("42"));

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ count: 3 });
    expect(setTournamentScheduleDeadlines).toHaveBeenCalledWith(42, DEADLINE, { id: arbitre.id, pseudo: arbitre.pseudo });
  });

  it("POST_nullDeadline_clearsThem", async () => {
    jest.mocked(setTournamentScheduleDeadlines).mockResolvedValue(0);

    const res = await POST(req({ deadlineAt: null }), params("42"));

    expect(res.status).toBe(200);
    expect(setTournamentScheduleDeadlines).toHaveBeenCalledWith(42, null, { id: arbitre.id, pseudo: arbitre.pseudo });
  });

  it("POST_invalidTournamentId_returns400", async () => {
    const res = await POST(req({ deadlineAt: DEADLINE }), params("abc"));

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: "INVALID_TOURNAMENT_ID" });
  });

  it("POST_bodyWithoutDeadlineAt_returns400", async () => {
    const res = await POST(req({ startAt: DEADLINE }), params("42"));

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: "INVALID_SCHEDULE_DEADLINE" });
    expect(setTournamentScheduleDeadlines).not.toHaveBeenCalled();
  });

  it("POST_unreadableBody_returns400", async () => {
    const res = await POST(
      new Request("http://localhost/api/admin/tournaments/42/schedule-deadlines", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{\"deadlineAt\": \"2026",
      }),
      params("42"),
    );

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: "INVALID_SCHEDULE_DEADLINE" });
  });

  it("POST_deadlineTooSoon_returns400WithCode", async () => {
    jest.mocked(setTournamentScheduleDeadlines).mockRejectedValue(new Error("SCHEDULE_DEADLINE_TOO_SOON"));

    const res = await POST(req({ deadlineAt: DEADLINE }), params("42"));

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: "SCHEDULE_DEADLINE_TOO_SOON" });
  });

  it("POST_deadlineTooFar_returns400WithCode", async () => {
    jest.mocked(setTournamentScheduleDeadlines).mockRejectedValue(new Error("SCHEDULE_DEADLINE_TOO_FAR"));

    await expect((await POST(req({ deadlineAt: DEADLINE }), params("42"))).json()).resolves.toEqual({
      error: "SCHEDULE_DEADLINE_TOO_FAR",
    });
  });

  it("POST_unknownTournament_returns404", async () => {
    jest.mocked(setTournamentScheduleDeadlines).mockRejectedValue(new Error("TOURNAMENT_NOT_FOUND"));

    expect((await POST(req({ deadlineAt: DEADLINE }), params("42"))).status).toBe(404);
  });

  it("POST_tournamentNotRunning_returns409", async () => {
    jest.mocked(setTournamentScheduleDeadlines).mockRejectedValue(new Error("SCHEDULE_DEADLINE_NOT_ALLOWED"));

    const res = await POST(req({ deadlineAt: DEADLINE }), params("42"));

    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toEqual({ error: "SCHEDULE_DEADLINE_NOT_ALLOWED" });
  });

  it("POST_unexpectedFailure_returns500CodeWithoutErrorText", async () => {
    jest.spyOn(console, "error").mockImplementation(() => undefined);
    jest.mocked(setTournamentScheduleDeadlines).mockRejectedValue(new Error("Unknown column 'schedule_deadline_at'"));

    const res = await POST(req({ deadlineAt: DEADLINE }), params("42"));

    expect(res.status).toBe(500);
    const body = JSON.stringify(await res.json());
    expect(body).toContain("SCHEDULE_DEADLINE_UPDATE_FAILED");
    expect(body).not.toContain("schedule_deadline_at");
  });
});
