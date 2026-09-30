import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/auth");
jest.mock("@/lib/server/tournaments/referee-scheduling");
jest.mock("@/lib/server/staff-audit");

import { PUT } from "@/app/api/admin/tournaments/[id]/referee-scheduling/route";
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
    expect(await res.json()).toEqual({ enabled: true, movedToPlanning: 3 });
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
    expect((await PUT(req("enabled=true", "text/plain"), params("7"))).status).toBe(400);
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
    expect((await res.json()).error).toBe("INTERNAL_ERROR");
  });
});

describe("PUT /api/admin/tournaments/[id]/referee-scheduling — journal", () => {
  it("journalise la bascule, nom de tournoi désamorcé, auteur à part", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(arbitre);
    await PUT(req({ enabled: true }), params("7"));
    const [line, actor] = jest.mocked(publishStaffAction).mock.calls[0];
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
