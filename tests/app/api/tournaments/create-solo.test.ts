import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/auth");
jest.mock("@/lib/server/tournaments-service");

import { POST } from "@/app/api/tournaments/route";
import { getCurrentUser } from "@/lib/server/auth";
import * as service from "@/lib/server/tournaments-service";
import { authUser } from "../../../helpers/auth-user";
import { resetIdempotencyForTests } from "@/lib/server/idempotency";

const referee = authUser({ id: 1, isAdmin: true });

function jsonReq(body: unknown) {
  return new Request("http://localhost/api/tournaments", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const base = {
  name: "Coupe individuelle",
  game: "OW",
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
    jest.mocked(getCurrentUser).mockResolvedValue(referee);
    jest.mocked(service.createTournament).mockResolvedValue(42);
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

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
      jest.mocked(getCurrentUser).mockResolvedValue(referee);
      jest.mocked(service.createTournament).mockResolvedValue(7);

      const res = await POST(jsonReq({ ...base, format, participantType: "SOLO" }));
      expect(res.status).toBe(201);
      expect(service.createTournament).toHaveBeenCalledWith(
        1,
        expect.objectContaining({ format, participantType: "SOLO" }),
      );
    }
  });

  it("POST_sameRequestKeyTwice_createsOneTournament", async () => {
    resetIdempotencyForTests();
    const body = { ...base, requestKey: "create-key-00000000001" };

    const first = await POST(jsonReq(body));
    const second = await POST(jsonReq(body));

    expect(first.status).toBe(201);
    expect(await second.json()).toEqual({ id: 42 });
    expect(service.createTournament).toHaveBeenCalledTimes(1);
  });

  it("POST_sameRequestKeyOtherUser_createsAgain", async () => {
    resetIdempotencyForTests();
    const body = { ...base, requestKey: "create-key-00000000002" };

    await POST(jsonReq(body));
    jest.mocked(getCurrentUser).mockResolvedValue(authUser({ id: 2, isAdmin: true }));
    await POST(jsonReq(body));

    expect(service.createTournament).toHaveBeenCalledTimes(2);
  });

  it("POST_noRequestKey_createsEachTime", async () => {
    resetIdempotencyForTests();

    await POST(jsonReq(base));
    await POST(jsonReq(base));

    expect(service.createTournament).toHaveBeenCalledTimes(2);
  });
});
