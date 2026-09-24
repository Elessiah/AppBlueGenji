import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/auth");
jest.mock("@/lib/server/tournaments/issue-reports");

import { POST } from "@/app/api/tournaments/[id]/report-issue/route";
import { getCurrentUser } from "@/lib/server/auth";
import { reportTournamentIssue } from "@/lib/server/tournaments/issue-reports";
import { authUser } from "../../../helpers/auth-user";

type SessionUser = Awaited<ReturnType<typeof getCurrentUser>>;

/**
 * Un utilisateur différent par cas : le plafond de débit du signalement compte
 * par identité et survit d'un test à l'autre (le seau vit dans le module).
 */
let nextUserId = 1000;
function player(): SessionUser {
  nextUserId += 1;
  return authUser({ id: nextUserId, isAdmin: false, roles: [] });
}

function jsonReq(body: unknown, id = "5") {
  return new Request(`http://localhost/api/tournaments/${id}/report-issue`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const params = (id: string) => ({ params: Promise.resolve({ id }) });

const VALID = { message: "adversaire absent depuis 20 minutes" };

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(reportTournamentIssue).mockResolvedValue({ notifiedReferees: 2 });
});
afterEach(() => {
  jest.restoreAllMocks();
});

describe("POST /api/tournaments/[id]/report-issue", () => {
  it("rejette un visiteur anonyme avec 401", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(null);

    expect((await POST(jsonReq(VALID), params("5"))).status).toBe(401);
    expect(reportTournamentIssue).not.toHaveBeenCalled();
  });

  it("transmet le signalement et rend le nombre d'arbitres joints", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(player());

    const res = await POST(jsonReq(VALID), params("5"));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ notifiedReferees: 2 });
    expect(reportTournamentIssue).toHaveBeenCalledWith(5, expect.any(Number), VALID.message, null);
  });

  it("transmet la manche visée quand elle est fournie", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(player());

    await POST(jsonReq({ ...VALID, matchId: 31 }), params("5"));

    expect(reportTournamentIssue).toHaveBeenCalledWith(5, expect.any(Number), VALID.message, 31);
  });

  it("refuse un identifiant de tournoi invalide", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(player());

    const res = await POST(jsonReq(VALID, "abc"), params("abc"));

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "INVALID_TOURNAMENT_ID" });
    expect(reportTournamentIssue).not.toHaveBeenCalled();
  });

  it("refuse un identifiant de match qui n'est pas un entier positif", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(player());

    const res = await POST(jsonReq({ ...VALID, matchId: -3 }), params("5"));

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "INVALID_MATCH_ID" });
    expect(reportTournamentIssue).not.toHaveBeenCalled();
  });

  it("traite un matchId null comme une portée « tournoi entier »", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(player());

    await POST(jsonReq({ ...VALID, matchId: null }), params("5"));

    expect(reportTournamentIssue).toHaveBeenCalledWith(5, expect.any(Number), VALID.message, null);
  });

  it("refuse un non-inscrit avec 403", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(player());
    jest.mocked(reportTournamentIssue).mockRejectedValue(new Error("NOT_REGISTERED"));

    const res = await POST(jsonReq(VALID), params("5"));

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "NOT_REGISTERED" });
  });

  it("refuse un message hors bornes avec 400", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(player());
    jest.mocked(reportTournamentIssue).mockRejectedValue(
      new Error("INVALID_ISSUE_MESSAGE"),
    );

    expect((await POST(jsonReq({ message: "???" }), params("5"))).status).toBe(400);
  });

  it("signale un match introuvable avec 404", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(player());
    jest.mocked(reportTournamentIssue).mockRejectedValue(new Error("MATCH_NOT_FOUND"));

    expect((await POST(jsonReq({ ...VALID, matchId: 31 }), params("5"))).status).toBe(404);
  });

  it("rend 503 quand le bot est injoignable — le signalement n'est pas parti", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(player());
    jest.mocked(reportTournamentIssue).mockRejectedValue(
      new Error("BOT_INTERNAL_UNREACHABLE"),
    );

    const res = await POST(jsonReq(VALID), params("5"));

    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "BOT_INTERNAL_UNREACHABLE" });
  });

  it("plafonne les signalements en rafale d'un même joueur", async () => {
    const kiro = player();
    jest.mocked(getCurrentUser).mockResolvedValue(kiro);

    for (let i = 0; i < 5; i++) {
      expect((await POST(jsonReq(VALID), params("5"))).status).toBe(200);
    }

    const res = await POST(jsonReq(VALID), params("5"));
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: "TOO_MANY_REQUESTS" });
  });
});
