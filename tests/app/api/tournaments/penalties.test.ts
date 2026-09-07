import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/auth");
jest.mock("@/lib/server/tournaments-service");

import { POST } from "@/app/api/tournaments/[id]/penalties/route";
import { DELETE } from "@/app/api/tournaments/[id]/penalties/[penaltyId]/route";
import { getCurrentUser } from "@/lib/server/auth";
import * as service from "@/lib/server/tournaments-service";

const member = { id: 2, isAdmin: false, roles: [] } as unknown as Awaited<
  ReturnType<typeof getCurrentUser>
>;
const referee = { id: 9, isAdmin: true } as Awaited<ReturnType<typeof getCurrentUser>>;

const VALID = { teamId: 42, points: 3, reason: "Retard au coup d'envoi" };

function req(body: unknown = VALID) {
  return new Request("http://localhost/api/tournaments/5/penalties", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const params = { params: Promise.resolve({ id: "5" }) };
const deleteParams = { params: Promise.resolve({ id: "5", penaltyId: "15" }) };

function deleteReq() {
  return new Request("http://localhost/api/tournaments/5/penalties/15", { method: "DELETE" });
}

describe("POST /api/tournaments/[id]/penalties", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (service.applyEndurancePenalty as jest.Mock).mockResolvedValue(undefined as never);
  });
  afterEach(() => jest.restoreAllMocks());

  it("rejette les anonymes (401)", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(null as never);
    const res = await POST(req(), params);
    expect(res.status).toBe(401);
    expect(service.applyEndurancePenalty).not.toHaveBeenCalled();
  });

  it("rejette un membre sans droit d'arbitrage (403) — on ne se pénalise pas soi-même", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(member as never);
    const res = await POST(req(), params);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "FORBIDDEN" });
    expect(service.applyEndurancePenalty).not.toHaveBeenCalled();
  });

  it("l'arbitrage inflige la sanction, l'auteur étant celui de la session", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(referee as never);
    const res = await POST(req(), params);
    expect(res.status).toBe(200);
    expect(service.applyEndurancePenalty).toHaveBeenCalledWith(
      5,
      42,
      3,
      "Retard au coup d'envoi",
      9,
    );
  });

  it("refuse un identifiant de tournoi illisible (400)", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(referee as never);
    const res = await POST(req(), { params: Promise.resolve({ id: "abc" }) });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "INVALID_TOURNAMENT_ID" });
  });

  it("refuse un engagé illisible (400)", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(referee as never);
    for (const teamId of [undefined, 0, -3, "x"]) {
      const res = await POST(req({ ...VALID, teamId }), params);
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "INVALID_TEAM" });
    }
    expect(service.applyEndurancePenalty).not.toHaveBeenCalled();
  });

  it("rend le refus de forme du module partagé, et non un « invalide » unique", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(referee as never);

    const cases: [unknown, string][] = [
      [{ ...VALID, points: 0 }, "POINTS_NOT_POSITIVE"],
      [{ ...VALID, points: 1000 }, "POINTS_TOO_HIGH"],
      [{ ...VALID, reason: "   " }, "REASON_REQUIRED"],
      [{ ...VALID, reason: "x".repeat(201) }, "REASON_TOO_LONG"],
    ];

    for (const [body, error] of cases) {
      const res = await POST(req(body), params);
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error });
    }
    expect(service.applyEndurancePenalty).not.toHaveBeenCalled();
  });

  it("refuse un motif absent du corps", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(referee as never);
    const res = await POST(req({ teamId: 42, points: 3 }), params);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "REASON_REQUIRED" });
  });

  it("mappe les refus du moteur sur leur statut", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(referee as never);

    const cases: [string, number][] = [
      ["NOT_BG_SURVIE", 400],
      ["TOURNAMENT_NOT_RUNNING", 400],
      ["ENDURANCE_PLAYOFFS_STARTED", 400],
      ["TEAM_ALREADY_OUT", 400],
      ["INVALID_PENALTY", 400],
      ["TEAM_NOT_IN_TOURNAMENT", 404],
    ];

    for (const [message, status] of cases) {
      (service.applyEndurancePenalty as jest.Mock).mockRejectedValueOnce(
        new Error(message) as never,
      );
      const res = await POST(req(), params);
      expect(res.status).toBe(status);
      expect(await res.json()).toEqual({ error: message });
    }
  });

  it("remonte une panne inattendue en 500", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(referee as never);
    (service.applyEndurancePenalty as jest.Mock).mockRejectedValueOnce(
      new Error("ER_LOCK_DEADLOCK") as never,
    );
    const res = await POST(req(), params);
    expect(res.status).toBe(500);
  });
});

describe("DELETE /api/tournaments/[id]/penalties/[penaltyId]", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (service.liftEndurancePenalty as jest.Mock).mockResolvedValue(undefined as never);
  });
  afterEach(() => jest.restoreAllMocks());

  it("rejette les anonymes (401)", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(null as never);
    const res = await DELETE(deleteReq(), deleteParams);
    expect(res.status).toBe(401);
    expect(service.liftEndurancePenalty).not.toHaveBeenCalled();
  });

  it("rejette un membre sans droit d'arbitrage (403)", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(member as never);
    const res = await DELETE(deleteReq(), deleteParams);
    expect(res.status).toBe(403);
    expect(service.liftEndurancePenalty).not.toHaveBeenCalled();
  });

  it("l'arbitrage retire la sanction", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(referee as never);
    const res = await DELETE(deleteReq(), deleteParams);
    expect(res.status).toBe(200);
    expect(service.liftEndurancePenalty).toHaveBeenCalledWith(5, 15);
  });

  it("refuse un identifiant de sanction illisible (400)", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(referee as never);
    const res = await DELETE(deleteReq(), {
      params: Promise.resolve({ id: "5", penaltyId: "0" }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "INVALID_PENALTY_ID" });
  });

  it("mappe une sanction introuvable en 404", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(referee as never);
    (service.liftEndurancePenalty as jest.Mock).mockRejectedValueOnce(
      new Error("PENALTY_NOT_FOUND") as never,
    );
    const res = await DELETE(deleteReq(), deleteParams);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "PENALTY_NOT_FOUND" });
  });

  it("mappe les refus d'état en 400", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(referee as never);
    for (const message of [
      "ENDURANCE_PLAYOFFS_STARTED",
      "TOURNAMENT_NOT_RUNNING",
      "NOT_BG_SURVIE",
    ]) {
      (service.liftEndurancePenalty as jest.Mock).mockRejectedValueOnce(
        new Error(message) as never,
      );
      const res = await DELETE(deleteReq(), deleteParams);
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: message });
    }
  });

  it("mappe le verrou de manche en 409, comme le verrou de score", async () => {
    // La demande était licite, c'est l'état qui ne la permet plus : même
    // famille que `CANNOT_MODIFY_COMPLETED_DEPENDENT_MATCHES`.
    (getCurrentUser as jest.Mock).mockResolvedValue(referee as never);
    (service.liftEndurancePenalty as jest.Mock).mockRejectedValueOnce(
      new Error("ENDURANCE_ROUND_ALREADY_PLAYED") as never,
    );
    const res = await DELETE(deleteReq(), deleteParams);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "ENDURANCE_ROUND_ALREADY_PLAYED" });
  });
});
