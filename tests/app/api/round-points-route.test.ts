import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/auth");
jest.mock("@/lib/server/staff-audit");
jest.mock("@/lib/server/tournaments/round-maps", () => {
  const actual = jest.requireActual<typeof import("@/lib/server/tournaments/round-maps")>(
    "@/lib/server/tournaments/round-maps",
  );
  return { parseRoundKey: actual.parseRoundKey, setRoundPointTarget: jest.fn() };
});

import { PUT } from "@/app/api/admin/tournaments/[id]/round-points/route";
import { getCurrentUser } from "@/lib/server/auth";
import { setRoundPointTarget } from "@/lib/server/tournaments/round-maps";
import { auditStaffAction } from "@/lib/server/staff-audit";
import { authUser } from "../../helpers/auth-user";

/**
 * Route des points par carte d'un tour (`docs/features/DUEL_ARCADE.md`) :
 * réservée à la permission `tournaments`, refus par code seul.
 */

const player = authUser({ id: 2, roles: [] });
const arbitre = authUser({ id: 3, roles: ["ARBITRE"] });

const tournament = (id: string) => ({ params: Promise.resolve({ id }) });

function put(body: unknown) {
  return new Request("http://localhost/api/x", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const ROUND = { phaseId: 0, bracket: "UPPER", roundNumber: 2 };

beforeEach(() => {
  jest.restoreAllMocks();
  jest.clearAllMocks();
});

describe("PUT /api/admin/tournaments/[id]/round-points", () => {
  it("put_noSession_returns401", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(null);

    const actual = await PUT(put({ ...ROUND, target: 3 }), tournament("7"));

    expect(actual.status).toBe(401);
    expect(setRoundPointTarget).not.toHaveBeenCalled();
  });

  it("put_playerWithoutPermission_returns403", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(player);

    const actual = await PUT(put({ ...ROUND, target: 3 }), tournament("7"));

    expect(actual.status).toBe(403);
    expect(setRoundPointTarget).not.toHaveBeenCalled();
  });

  it("put_invalidRound_returns400InvalidRound", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(arbitre);

    const actual = await PUT(put({ ...ROUND, bracket: "SIDE", target: 3 }), tournament("7"));

    expect(actual.status).toBe(400);
    await expect(actual.json()).resolves.toEqual({ error: "INVALID_ROUND" });
  });

  it("put_bodyWithoutTarget_returns400InvalidMapPointTarget", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(arbitre);

    const actual = await PUT(put(ROUND), tournament("7"));

    expect(actual.status).toBe(400);
    await expect(actual.json()).resolves.toEqual({ error: "INVALID_MAP_POINT_TARGET" });
    expect(setRoundPointTarget).not.toHaveBeenCalled();
  });

  it("put_invalidTarget_returns400InvalidMapPointTarget", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(arbitre);
    jest.mocked(setRoundPointTarget).mockRejectedValue(new Error("INVALID_MAP_POINT_TARGET"));

    const actual = await PUT(put({ ...ROUND, target: 0 }), tournament("7"));

    expect(actual.status).toBe(400);
    await expect(actual.json()).resolves.toEqual({ error: "INVALID_MAP_POINT_TARGET" });
  });

  it("put_formatOff_returns400MapPointsDisabled", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(arbitre);
    jest.mocked(setRoundPointTarget).mockRejectedValue(new Error("MAP_POINTS_DISABLED"));

    const actual = await PUT(put({ ...ROUND, target: 3 }), tournament("7"));

    expect(actual.status).toBe(400);
    await expect(actual.json()).resolves.toEqual({ error: "MAP_POINTS_DISABLED" });
  });

  it("put_scoredRound_returns409MapPointsLocked", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(arbitre);
    jest.mocked(setRoundPointTarget).mockRejectedValue(new Error("MAP_POINTS_LOCKED"));

    const actual = await PUT(put({ ...ROUND, target: 3 }), tournament("7"));

    expect(actual.status).toBe(409);
    await expect(actual.json()).resolves.toEqual({ error: "MAP_POINTS_LOCKED" });
  });

  it("put_missingTournament_returns404", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(arbitre);
    jest.mocked(setRoundPointTarget).mockRejectedValue(new Error("TOURNAMENT_NOT_FOUND"));

    const actual = await PUT(put({ ...ROUND, target: 3 }), tournament("7"));

    expect(actual.status).toBe(404);
  });

  it("put_unexpectedError_returns500WithFallbackCode", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(arbitre);
    jest.mocked(setRoundPointTarget).mockRejectedValue(new Error("boom"));
    jest.spyOn(console, "error").mockImplementation(() => undefined);

    const actual = await PUT(put({ ...ROUND, target: 3 }), tournament("7"));

    expect(actual.status).toBe(500);
    await expect(actual.json()).resolves.toEqual({ error: "ROUND_POINTS_FAILED" });
  });

  it("put_validTarget_returnsStoredTarget", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(arbitre);
    jest.mocked(setRoundPointTarget).mockResolvedValue({ target: 3, before: null, changed: true });

    const actual = await PUT(put({ ...ROUND, target: 3 }), tournament("7"));

    expect(actual.status).toBe(200);
    await expect(actual.json()).resolves.toEqual({ target: 3 });
    expect(setRoundPointTarget).toHaveBeenCalledWith(7, ROUND, 3);
  });

  it("put_nullTarget_passesNullToClearTheOverride", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(arbitre);
    jest.mocked(setRoundPointTarget).mockResolvedValue({ target: null, before: 3, changed: true });

    const actual = await PUT(put({ ...ROUND, target: null }), tournament("7"));

    expect(actual.status).toBe(200);
    expect(setRoundPointTarget).toHaveBeenCalledWith(7, ROUND, null);
  });

  it("put_changed_auditsTheStaffMemberInPm2", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(arbitre);
    jest.mocked(setRoundPointTarget).mockResolvedValue({ target: 7, before: null, changed: true });

    await PUT(put({ ...ROUND, target: 7 }), tournament("7"));

    expect(auditStaffAction).toHaveBeenCalledWith(
      "🎯 Points par carte du tournoi #7, phase 0 UPPER tour 2 : points du tournoi → 7",
      { id: arbitre.id, pseudo: arbitre.pseudo },
    );
  });

  it("put_unchanged_writesNoAudit", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(arbitre);
    jest.mocked(setRoundPointTarget).mockResolvedValue({ target: 3, before: 3, changed: false });

    const actual = await PUT(put({ ...ROUND, target: 3 }), tournament("7"));

    expect(actual.status).toBe(200);
    expect(auditStaffAction).not.toHaveBeenCalled();
  });

  it("put_finishedTournament_returns409", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(arbitre);
    jest.mocked(setRoundPointTarget).mockRejectedValue(new Error("MAP_POINTS_FINISHED"));

    const actual = await PUT(put({ ...ROUND, target: 3 }), tournament("7"));

    expect(actual.status).toBe(409);
    await expect(actual.json()).resolves.toEqual({ error: "MAP_POINTS_FINISHED" });
    expect(auditStaffAction).not.toHaveBeenCalled();
  });
});
