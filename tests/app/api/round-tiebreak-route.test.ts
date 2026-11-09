import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/auth");
jest.mock("@/lib/server/tournaments/round-maps", () => {
  const actual = jest.requireActual<typeof import("@/lib/server/tournaments/round-maps")>(
    "@/lib/server/tournaments/round-maps",
  );
  return { parseRoundKey: actual.parseRoundKey, setRoundTiebreak: jest.fn() };
});

import { PUT } from "@/app/api/admin/tournaments/[id]/round-tiebreak/route";
import { getCurrentUser } from "@/lib/server/auth";
import { setRoundTiebreak } from "@/lib/server/tournaments/round-maps";
import { authUser } from "../../helpers/auth-user";

/**
 * Route de la map de départage d'un tour (`docs/features/ROUND_MAPS.md`) :
 * réservée à la permission `tournaments`, refus par code seul.
 */

const player = authUser({ id: 2, roles: [] });
const caster = authUser({ id: 4, roles: ["CASTER"] });
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

describe("PUT /api/admin/tournaments/[id]/round-tiebreak", () => {
  it("put_noSession_returns401", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(null);

    const actual = await PUT(put({ ...ROUND, map: "Busan" }), tournament("7"));

    expect(actual.status).toBe(401);
    expect(setRoundTiebreak).not.toHaveBeenCalled();
  });

  it("put_playerWithoutPermission_returns403", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(player);

    const actual = await PUT(put({ ...ROUND, map: "Busan" }), tournament("7"));

    expect(actual.status).toBe(403);
    expect(setRoundTiebreak).not.toHaveBeenCalled();
  });

  it("put_casterWithoutPermission_returns403", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(caster);

    const actual = await PUT(put({ ...ROUND, map: "Busan" }), tournament("7"));

    expect(actual.status).toBe(403);
  });

  it("put_invalidTournamentId_returns400", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(arbitre);

    const actual = await PUT(put({ ...ROUND, map: "Busan" }), tournament("abc"));

    expect(actual.status).toBe(400);
    await expect(actual.json()).resolves.toEqual({ error: "INVALID_TOURNAMENT_ID" });
  });

  it("put_invalidRound_returns400InvalidRound", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(arbitre);

    const actual = await PUT(put({ ...ROUND, bracket: "SIDE", map: "Busan" }), tournament("7"));

    expect(actual.status).toBe(400);
    await expect(actual.json()).resolves.toEqual({ error: "INVALID_ROUND" });
    expect(setRoundTiebreak).not.toHaveBeenCalled();
  });

  it("put_nonObjectBody_returns400InvalidRound", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(arbitre);

    const actual = await PUT(put(null), tournament("7"));

    expect(actual.status).toBe(400);
    await expect(actual.json()).resolves.toEqual({ error: "INVALID_ROUND" });
  });

  it("put_bodyWithoutMap_returns400InvalidTiebreakMap", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(arbitre);

    const actual = await PUT(put(ROUND), tournament("7"));

    expect(actual.status).toBe(400);
    await expect(actual.json()).resolves.toEqual({ error: "INVALID_TIEBREAK_MAP" });
    expect(setRoundTiebreak).not.toHaveBeenCalled();
  });

  it("put_roundNotBo3Playoff_returns400TiebreakNotAllowed", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(arbitre);
    jest.mocked(setRoundTiebreak).mockRejectedValue(new Error("TIEBREAK_NOT_ALLOWED"));

    const actual = await PUT(put({ ...ROUND, map: "Busan" }), tournament("7"));

    expect(actual.status).toBe(400);
    await expect(actual.json()).resolves.toEqual({ error: "TIEBREAK_NOT_ALLOWED" });
  });

  it("put_invalidMap_returns400InvalidTiebreakMap", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(arbitre);
    jest.mocked(setRoundTiebreak).mockRejectedValue(new Error("INVALID_TIEBREAK_MAP"));

    const actual = await PUT(put({ ...ROUND, map: 12 }), tournament("7"));

    expect(actual.status).toBe(400);
    await expect(actual.json()).resolves.toEqual({ error: "INVALID_TIEBREAK_MAP" });
  });

  it("put_missingTournament_returns404", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(arbitre);
    jest.mocked(setRoundTiebreak).mockRejectedValue(new Error("TOURNAMENT_NOT_FOUND"));

    const actual = await PUT(put({ ...ROUND, map: "Busan" }), tournament("7"));

    expect(actual.status).toBe(404);
  });

  it("put_unexpectedError_returns500WithCodeOnly", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(arbitre);
    jest.mocked(setRoundTiebreak).mockRejectedValue(new Error("boom"));
    jest.spyOn(console, "error").mockImplementation(() => undefined);

    const actual = await PUT(put({ ...ROUND, map: "Busan" }), tournament("7"));

    expect(actual.status).toBe(500);
    await expect(actual.json()).resolves.toEqual({ error: "ROUND_TIEBREAK_FAILED" });
  });

  it("put_validMap_returns200WithMap", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(arbitre);
    jest.mocked(setRoundTiebreak).mockResolvedValue("Busan");

    const actual = await PUT(put({ ...ROUND, map: " Busan " }), tournament("7"));

    expect(actual.status).toBe(200);
    await expect(actual.json()).resolves.toEqual({ map: "Busan" });
    expect(setRoundTiebreak).toHaveBeenCalledWith(7, ROUND, " Busan ");
  });

  it("put_nullMap_returns200WithNull", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(arbitre);
    jest.mocked(setRoundTiebreak).mockResolvedValue(null);

    const actual = await PUT(put({ ...ROUND, map: null }), tournament("7"));

    expect(actual.status).toBe(200);
    await expect(actual.json()).resolves.toEqual({ map: null });
  });
});
