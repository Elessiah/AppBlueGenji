import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/auth");
jest.mock("@/lib/server/staff-audit");
jest.mock("@/lib/server/tournaments/referee-objection");

import { PUT } from "@/app/api/admin/referees/[userId]/objection/route";
import { getCurrentUser } from "@/lib/server/auth";
import { publishStaffAction } from "@/lib/server/staff-audit";
import { setRefereeObjection } from "@/lib/server/tournaments/referee-objection";
import { authUser } from "../../helpers/auth-user";

/**
 * Route de l'opposition d'un arbitre (`docs/features/MATCH_REFEREE.md`) :
 * réservée à la permission `tournaments`, journal anonyme sur Discord.
 */

const player = authUser({ id: 2, roles: [] });
const staff = authUser({ id: 3, roles: ["ARBITRE"], pseudo: "Staff" });

const params = (userId: string) => ({ params: Promise.resolve({ userId }) });

function putRequest(body?: unknown) {
  return new Request("http://localhost/api/admin/referees/9/objection", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(getCurrentUser).mockResolvedValue(staff);
});

describe("PUT /api/admin/referees/[userId]/objection", () => {
  it("PUT_noSession_returns401", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(null);

    const res = await PUT(putRequest({ upheld: true }), params("9"));

    expect(res.status).toBe(401);
    expect(setRefereeObjection).not.toHaveBeenCalled();
  });

  it("PUT_withoutTournamentsPermission_returns403", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(player);

    const res = await PUT(putRequest({ upheld: true }), params("9"));

    expect(res.status).toBe(403);
    expect(setRefereeObjection).not.toHaveBeenCalled();
  });

  it("PUT_malformedUserId_returns400", async () => {
    const res = await PUT(putRequest({ upheld: true }), params("abc"));

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: "INVALID_USER_ID" });
  });

  it("PUT_upheldNotBoolean_returns400", async () => {
    const res = await PUT(putRequest({ upheld: "yes" }), params("9"));

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: "INVALID_REFEREE_OBJECTION" });
    expect(setRefereeObjection).not.toHaveBeenCalled();
  });

  it("PUT_unknownAccount_returns404", async () => {
    jest.mocked(setRefereeObjection).mockRejectedValue(new Error("USER_NOT_FOUND"));

    const res = await PUT(putRequest({ upheld: true }), params("9"));

    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toEqual({ error: "USER_NOT_FOUND" });
  });

  it("PUT_newObjection_returnsCount_logsAnonymouslyOnDiscord", async () => {
    jest.mocked(setRefereeObjection).mockResolvedValue({ changed: true, released: 2, failed: 0 });

    const res = await PUT(putRequest({ upheld: true }), params("9"));

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ upheld: true, changed: true, released: 2 });
    expect(setRefereeObjection).toHaveBeenCalledWith(9, true);
    const [discordLine, actor, pm2Line] = jest.mocked(publishStaffAction).mock.calls[0];
    expect(discordLine).toContain("retiré de ses matchs non terminés (2)");
    expect(discordLine).not.toContain("#9");
    expect(actor).toEqual({ id: 3, pseudo: "Staff" });
    expect(pm2Line).toContain("Arbitre : #9.");
  });

  it("PUT_lift_logsLiftLine", async () => {
    jest.mocked(setRefereeObjection).mockResolvedValue({ changed: true, released: 0, failed: 0 });

    const res = await PUT(putRequest({ upheld: false }), params("9"));

    expect(res.status).toBe(200);
    expect(setRefereeObjection).toHaveBeenCalledWith(9, false);
    expect(jest.mocked(publishStaffAction).mock.calls[0][0]).toBe("🛡 Opposition d'un arbitre levée par le staff.");
  });

  it("PUT_unchangedNothingReleased_doesNotLog", async () => {
    jest.mocked(setRefereeObjection).mockResolvedValue({ changed: false, released: 0, failed: 0 });

    const res = await PUT(putRequest({ upheld: true }), params("9"));

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ upheld: true, changed: false, released: 0 });
    expect(publishStaffAction).not.toHaveBeenCalled();
  });

  it("PUT_replayedSweepReleasesMatches_logs", async () => {
    jest.mocked(setRefereeObjection).mockResolvedValue({ changed: false, released: 1, failed: 0 });

    const res = await PUT(putRequest({ upheld: true }), params("9"));

    expect(res.status).toBe(200);
    expect(jest.mocked(publishStaffAction).mock.calls[0][0]).toContain("(1)");
  });

  it("PUT_incompleteSweep_logsThenReturns500", async () => {
    jest.mocked(setRefereeObjection).mockResolvedValue({ changed: true, released: 1, failed: 1 });

    const res = await PUT(putRequest({ upheld: true }), params("9"));

    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toEqual({ error: "REFEREE_OBJECTION_FAILED" });
    expect(publishStaffAction).toHaveBeenCalledTimes(1);
  });
});
