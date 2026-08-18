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
  name: "Coupe individuelle",
  game: "OW2",
  format: "SINGLE",
  maxTeams: 16,
  startVisibilityAt: new Date().toISOString(),
  registrationOpenAt: new Date().toISOString(),
  registrationCloseAt: new Date().toISOString(),
  startAt: new Date().toISOString(),
};

describe("POST /api/tournaments — tournoi individuel", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (getCurrentUser as jest.Mock).mockResolvedValue(referee as never);
    (service.createTournament as jest.Mock).mockResolvedValue(42 as never);
  });
  afterEach(() => jest.restoreAllMocks());

  it("transmet participantType SOLO", async () => {
    const res = await POST(jsonReq({ ...base, participantType: "SOLO" }));
    expect(res.status).toBe(201);
    expect(service.createTournament).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ participantType: "SOLO" }),
    );
  });

  it("reste sur un tournoi par équipes quand le champ est absent", async () => {
    const res = await POST(jsonReq(base));
    expect(res.status).toBe(201);
    expect(service.createTournament).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ participantType: "TEAM" }),
    );
  });

  it.each(["SOLO ", "solo", "PLAYER", 1, null])(
    "rejette un type de participant invalide (%p)",
    async (participantType) => {
      const res = await POST(jsonReq({ ...base, participantType }));
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "INVALID_PARTICIPANT_TYPE" });
      expect(service.createTournament).not.toHaveBeenCalled();
    },
  );

  it("accepte l'individuel sur tous les formats", async () => {
    for (const format of ["SINGLE", "DOUBLE", "SWISS", "BG_SURVIE"]) {
      jest.clearAllMocks();
      (getCurrentUser as jest.Mock).mockResolvedValue(referee as never);
      (service.createTournament as jest.Mock).mockResolvedValue(7 as never);

      const res = await POST(jsonReq({ ...base, format, participantType: "SOLO" }));
      expect(res.status).toBe(201);
      expect(service.createTournament).toHaveBeenCalledWith(
        1,
        expect.objectContaining({ format, participantType: "SOLO" }),
      );
    }
  });
});
