import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/auth");
jest.mock("@/lib/server/tournaments-service");

import { GET, PATCH } from "@/app/api/tournaments/[id]/edit/route";
import { getCurrentUser } from "@/lib/server/auth";
import * as service from "@/lib/server/tournaments-service";

const referee = { id: 1, isAdmin: false, roles: ["ARBITRE"] };
const plainUser = { id: 2, isAdmin: false, roles: [] };

const params = (id: string) => ({ params: Promise.resolve({ id }) });

function patchReq(body: unknown) {
  return new Request("http://localhost/api/tournaments/1/edit", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const loaded = {
  window: "FULL" as const,
  values: { name: "Coupe test", maxTeams: 16 },
};

beforeEach(() => {
  jest.clearAllMocks();
  (getCurrentUser as jest.Mock).mockResolvedValue(referee as never);
  (service.loadEditableTournament as jest.Mock).mockResolvedValue(loaded as never);
  (service.updateTournament as jest.Mock).mockResolvedValue(undefined as never);
});

describe("GET /api/tournaments/[id]/edit", () => {
  it("refuse un visiteur non connecté", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(null as never);
    expect((await GET(new Request("http://localhost"), params("1"))).status).toBe(401);
  });

  it("refuse un utilisateur sans la permission tournaments", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(plainUser as never);
    expect((await GET(new Request("http://localhost"), params("1"))).status).toBe(403);
  });

  it("refuse un identifiant invalide", async () => {
    expect((await GET(new Request("http://localhost"), params("abc"))).status).toBe(400);
  });

  it("rend 404 sur un tournoi inconnu", async () => {
    (service.loadEditableTournament as jest.Mock).mockResolvedValue(null as never);
    expect((await GET(new Request("http://localhost"), params("1"))).status).toBe(404);
  });

  it("rend la fenêtre et les valeurs", async () => {
    const res = await GET(new Request("http://localhost"), params("1"));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual(loaded);
  });
});

describe("PATCH /api/tournaments/[id]/edit", () => {
  it("refuse un utilisateur sans la permission tournaments", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(plainUser as never);
    expect((await PATCH(patchReq({ name: "X" }), params("1"))).status).toBe(403);
  });

  it("transmet le patch au service", async () => {
    const res = await PATCH(patchReq({ name: "Nouveau nom" }), params("1"));
    expect(res.status).toBe(200);
    expect(service.updateTournament).toHaveBeenCalledWith(1, { name: "Nouveau nom" });
  });

  it("ignore les clés inconnues du corps", async () => {
    await PATCH(patchReq({ name: "X", isAdmin: true, id: 99 }), params("1"));
    expect(service.updateTournament).toHaveBeenCalledWith(1, { name: "X" });
  });

  it("refuse un patch vide", async () => {
    const res = await PATCH(patchReq({}), params("1"));
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: "EMPTY_PATCH" });
  });

  it("traduit un tournoi inconnu en 404", async () => {
    (service.updateTournament as jest.Mock).mockRejectedValue(
      new Error("TOURNAMENT_NOT_FOUND") as never,
    );
    expect((await PATCH(patchReq({ name: "X" }), params("1"))).status).toBe(404);
  });

  it("traduit un tournoi verrouillé en 409", async () => {
    (service.updateTournament as jest.Mock).mockRejectedValue(
      new Error("TOURNAMENT_LOCKED") as never,
    );
    expect((await PATCH(patchReq({ name: "X" }), params("1"))).status).toBe(409);
  });

  it("traduit un champ interdit en 409 en nommant le champ", async () => {
    (service.updateTournament as jest.Mock).mockRejectedValue(
      new Error("FIELD_NOT_EDITABLE:format") as never,
    );
    const res = await PATCH(patchReq({ name: "X" }), params("1"));
    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toEqual({ error: "FIELD_NOT_EDITABLE", field: "format" });
  });

  it("traduit une valeur invalide en 400", async () => {
    (service.updateTournament as jest.Mock).mockRejectedValue(
      new Error("INVALID_DATE_ORDER") as never,
    );
    expect((await PATCH(patchReq({ name: "X" }), params("1"))).status).toBe(400);
  });

  it("rend 500 sur une panne inattendue", async () => {
    (service.updateTournament as jest.Mock).mockRejectedValue(new Error("ECONNRESET") as never);
    expect((await PATCH(patchReq({ name: "X" }), params("1"))).status).toBe(500);
  });
});
