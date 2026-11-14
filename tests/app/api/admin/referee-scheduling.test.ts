import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/auth");
jest.mock("@/lib/server/tournaments/referee-scheduling");
jest.mock("@/lib/server/staff-audit");
jest.mock("@/lib/server/api-guard", () => ({
  ...jest.requireActual<typeof import("@/lib/server/api-guard")>("@/lib/server/api-guard"),
  reserveRateLimit: jest.fn(
    jest.requireActual<typeof import("@/lib/server/api-guard")>("@/lib/server/api-guard").reserveRateLimit,
  ),
}));

import { PUT } from "@/app/api/admin/tournaments/[id]/referee-scheduling/route";
import { NextResponse } from "next/server";
import { reserveRateLimit, REFEREE_SCHEDULING_TOGGLE_RULE } from "@/lib/server/api-guard";
import { getCurrentUser } from "@/lib/server/auth";
import { publishStaffAction } from "@/lib/server/staff-audit";
import { setRefereeScheduling } from "@/lib/server/tournaments/referee-scheduling";
import { authUser } from "../../../helpers/auth-user";

const player = authUser({ id: 2, isAdmin: false, roles: [] });
const arbitre = authUser({ id: 3, isAdmin: false, roles: ["ARBITRE"], pseudo: "Arbitre" });
const caster = authUser({ id: 4, isAdmin: false, roles: ["CASTER"] });
const cm = authUser({ id: 5, isAdmin: false, roles: ["COMMUNITY_MANAGER"] });
const admin = authUser({ id: 1, isAdmin: true, roles: ["ADMIN"] });

function req(body: unknown, contentType = "application/json") {
  return new Request("http://localhost/api/admin/tournaments/7/referee-scheduling", {
    method: "PUT",
    headers: { "content-type": contentType },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

const params = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(setRefereeScheduling).mockResolvedValue({
    tournamentId: 7,
    tournamentName: "Coupe <@&1>",
    enabled: true,
    changed: true,
    movedToPlanning: 3,
  });
});
afterEach(() => {
  jest.restoreAllMocks();
});

describe("PUT /api/admin/tournaments/[id]/referee-scheduling — permissions", () => {
  it("rejette un visiteur anonyme avec 401", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(null);
    expect((await PUT(req({ enabled: true }), params("7"))).status).toBe(401);
    expect(setRefereeScheduling).not.toHaveBeenCalled();
  });

  it.each([
    ["un joueur", player],
    ["un caster (il diffuse, il ne planifie pas)", caster],
    ["un community manager", cm],
  ])("rejette %s avec 403", async (_label, user) => {
    jest.mocked(getCurrentUser).mockResolvedValue(user);
    expect((await PUT(req({ enabled: true }), params("7"))).status).toBe(403);
    expect(setRefereeScheduling).not.toHaveBeenCalled();
  });

  it.each([
    ["un arbitre", arbitre],
    ["un admin", admin],
  ])("laisse passer %s", async (_label, user) => {
    jest.mocked(getCurrentUser).mockResolvedValue(user);
    const res = await PUT(req({ enabled: true }), params("7"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ enabled: true, changed: true, movedToPlanning: 3 });
    expect(setRefereeScheduling).toHaveBeenCalledWith(7, true);
  });
});

describe("PUT /api/admin/tournaments/[id]/referee-scheduling — corps et refus", () => {
  beforeEach(() => {
    jest.mocked(getCurrentUser).mockResolvedValue(arbitre);
  });

  it.each(["0", "abc", "-3", "1.5"])("refuse l'identifiant %s", async (id) => {
    expect((await PUT(req({ enabled: true }), params(id))).status).toBe(400);
    expect(setRefereeScheduling).not.toHaveBeenCalled();
  });

  it.each([[{}], [{ enabled: "true" }], [{ enabled: 1 }], [{ enabled: null }]])(
    "exige un booléen strict (%j)",
    async (body) => {
      const res = await PUT(req(body), params("7"));
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe("INVALID_REFEREE_SCHEDULING");
      expect(setRefereeScheduling).not.toHaveBeenCalled();
    },
  );

  it("refuse un corps illisible ou non JSON sans rien écrire", async () => {
    expect((await PUT(req("{", "application/json"), params("7"))).status).toBe(400);
    // ERREUR.txt (revue #506) : un corps d'un autre type n'est plus avalé en
    // corps vide (400 d'un champ) — il rend son propre refus, 415.
    const foreign = await PUT(req("enabled=true", "text/plain"), params("7"));
    expect(foreign.status).toBe(415);
    await expect(foreign.json()).resolves.toEqual({ error: "UNSUPPORTED_CONTENT_TYPE" });
    expect(setRefereeScheduling).not.toHaveBeenCalled();
  });

  it("éteint l'option", async () => {
    jest.mocked(setRefereeScheduling).mockResolvedValue({
      tournamentId: 7,
      tournamentName: "Coupe",
      enabled: false,
      changed: true,
      movedToPlanning: 0,
    });
    const res = await PUT(req({ enabled: false }), params("7"));
    expect(res.status).toBe(200);
    expect(setRefereeScheduling).toHaveBeenCalledWith(7, false);
  });

  it("traduit un tournoi introuvable en 404 et un tournoi terminé en 409", async () => {
    jest.mocked(setRefereeScheduling).mockRejectedValueOnce(new Error("TOURNAMENT_NOT_FOUND"));
    expect((await PUT(req({ enabled: true }), params("7"))).status).toBe(404);
    jest.mocked(setRefereeScheduling).mockRejectedValueOnce(new Error("TOURNAMENT_FINISHED"));
    expect((await PUT(req({ enabled: true }), params("7"))).status).toBe(409);
    expect(publishStaffAction).not.toHaveBeenCalled();
  });

  it("ne relaie jamais un message d'exception brut", async () => {
    jest.mocked(setRefereeScheduling).mockRejectedValueOnce(new Error("Table 'bg.x' doesn't exist"));
    const res = await PUT(req({ enabled: true }), params("7"));
    expect(res.status).toBe(500);
    // Le code de repli de la route (ERREUR.txt, revue sécurité EF-35), jamais le texte.
    expect((await res.json()).error).toBe("REFEREE_SCHEDULING_UPDATE_FAILED");
  });

  it("rend une contention en 409 CONCURRENT_UPDATE_RETRY", async () => {
    jest.mocked(setRefereeScheduling).mockRejectedValueOnce(
      Object.assign(new Error("Lock wait timeout exceeded"), { code: "ER_LOCK_WAIT_TIMEOUT", errno: 1205 }),
    );
    jest.spyOn(console, "warn").mockImplementation(() => {});
    const res = await PUT(req({ enabled: true }), params("7"));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("CONCURRENT_UPDATE_RETRY");
  });
});

describe("PUT /api/admin/tournaments/[id]/referee-scheduling — journal", () => {
  it("journalise la bascule, nom de tournoi désamorcé, auteur à part", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(arbitre);
    await PUT(req({ enabled: true }), params("7"));
    const [line, actor, options] = jest.mocked(publishStaffAction).mock.calls[0];
    expect(options).toEqual({ category: "referees", tournamentId: 7 });
    expect(line).toMatch(/activée/);
    expect(line).toMatch(/par le staff/);
    expect(line).not.toContain("<@&1>");
    expect(line).not.toContain("Arbitre");
    expect(actor).toEqual({ id: 3, pseudo: "Arbitre" });
  });
});

describe("PUT /api/admin/tournaments/[id]/referee-scheduling — bascule sans effet", () => {
  it("ne journalise rien quand l'option avait déjà cette valeur", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(arbitre);
    jest.mocked(setRefereeScheduling).mockResolvedValue({
      tournamentId: 7,
      tournamentName: "Coupe",
      enabled: true,
      changed: false,
      movedToPlanning: 0,
    });
    expect((await PUT(req({ enabled: true }), params("7"))).status).toBe(200);
    expect(publishStaffAction).not.toHaveBeenCalled();
  });
});

describe("PUT /api/admin/tournaments/[id]/referee-scheduling — débit", () => {
  it("put_rateLimited_returns429WithoutService", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(arbitre);
    jest.mocked(reserveRateLimit).mockReturnValueOnce({ refused: NextResponse.json({ error: "RATE_LIMITED" }, { status: 429 }), refund: () => undefined });
    expect((await PUT(req({ enabled: true }), params("7"))).status).toBe(429);
    expect(reserveRateLimit).toHaveBeenCalledWith(REFEREE_SCHEDULING_TOGGLE_RULE, 3);
    expect(setRefereeScheduling).not.toHaveBeenCalled();
  });

  it("put_changed_returnsMovedToPlanning", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(arbitre);
    const response = await PUT(req({ enabled: true }), params("7"));
    expect(await response.json()).toMatchObject({ enabled: true, changed: true, movedToPlanning: 3 });
  });
});
