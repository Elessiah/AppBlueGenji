import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/auth");
jest.mock("@/lib/server/tournaments-service");

import { POST } from "@/app/api/tournaments/route";
import { getCurrentUser } from "@/lib/server/auth";
import * as service from "@/lib/server/tournaments-service";

const referee = { id: 1, isAdmin: true } as Awaited<ReturnType<typeof getCurrentUser>>;

function jsonReq(body: unknown) {
  return new Request("http://localhost/api/tournaments", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const base = {
  name: "Survie OW2",
  game: "OW2",
  maxTeams: 16,
  startVisibilityAt: new Date().toISOString(),
  registrationOpenAt: new Date().toISOString(),
  registrationCloseAt: new Date().toISOString(),
  startAt: new Date().toISOString(),
};

describe("POST /api/tournaments — mode Survie", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (getCurrentUser as jest.Mock).mockResolvedValue(referee as never);
    (service.createTournament as jest.Mock).mockResolvedValue(42 as never);
  });
  afterEach(() => jest.restoreAllMocks());

  it("accepte le format SURVIVAL et transmet survivalRoundsPerCut", async () => {
    const res = await POST(jsonReq({ ...base, format: "SURVIVAL", survivalRoundsPerCut: 3 }));
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ id: 42 });
    expect(service.createTournament).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ format: "SURVIVAL", survivalRoundsPerCut: 3 }),
    );
  });

  it("rejette SURVIVAL sans nombre de rounds valide", async () => {
    const res = await POST(jsonReq({ ...base, format: "SURVIVAL", survivalRoundsPerCut: 0 }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "INVALID_SURVIVAL_ROUNDS" });
    expect(service.createTournament).not.toHaveBeenCalled();
  });

  it("rejette un rounds/coupe hors bornes", async () => {
    const res = await POST(jsonReq({ ...base, format: "SURVIVAL", survivalRoundsPerCut: 999 }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "INVALID_SURVIVAL_ROUNDS" });
  });

  it("rejette un format inconnu", async () => {
    const res = await POST(jsonReq({ ...base, format: "BATTLE_ROYALE" }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "INVALID_FORMAT" });
  });

  it("n'exige pas survivalRoundsPerCut pour les autres formats", async () => {
    const res = await POST(jsonReq({ ...base, format: "SINGLE" }));
    expect(res.status).toBe(201);
    expect(service.createTournament).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ format: "SINGLE", survivalRoundsPerCut: null }),
    );
  });
});
