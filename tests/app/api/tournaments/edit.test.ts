import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/auth");
jest.mock("@/lib/server/tournaments-service");

import { GET, PATCH } from "@/app/api/tournaments/[id]/edit/route";
import { getCurrentUser } from "@/lib/server/auth";
import * as service from "@/lib/server/tournaments-service";
import type { EditableTournamentValues } from "@/lib/server/tournaments/edit";
import type { EditWindow } from "@/lib/shared/tournament-edit";
import { authUser } from "../../../helpers/auth-user";

const referee = authUser({ id: 1, roles: ["ARBITRE"] });
const plainUser = authUser({ id: 2 });

const params = (id: string) => ({ params: Promise.resolve({ id }) });

function patchReq(body: unknown) {
  return new Request("http://localhost/api/tournaments/1/edit", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const values: EditableTournamentValues = {
  name: "Coupe test",
  description: null,
  game: "OW",
  format: "SINGLE",
  participantType: "TEAM",
  maxTeams: 16,
  startVisibilityAt: "2026-05-01T10:00:00.000Z",
  registrationOpenAt: "2026-05-02T10:00:00.000Z",
  registrationCloseAt: "2026-05-10T10:00:00.000Z",
  startAt: "2026-05-12T10:00:00.000Z",
  hasThirdPlaceMatch: false,
  survivalRoundsBeforeFirstCut: null,
  survivalRoundsPerCut: null,
  swissTotalRounds: null,
  swissPointsWin: null,
  swissPointsDraw: null,
  swissPointsLoss: null,
  endurancePoints: null,
  enduranceWinDelta: null,
  enduranceLossDelta: null,
  endurancePlayoffSize: null,
  enduranceMaxRounds: null,
  matchFormat: null,
  endurancePlayoffFormat: null,
  registrationDiscordRequirement: "ANY_PLAYER",
  registrationBlizzardRequirement: "NONE",
  registrationMinPlayers: 5,
  phases: null,
};
const loaded: { window: EditWindow; values: EditableTournamentValues } = { window: "FULL", values };

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(getCurrentUser).mockResolvedValue(referee);
  jest.mocked(service.loadEditableTournament).mockResolvedValue(loaded);
  jest.mocked(service.updateTournament).mockResolvedValue(undefined);
});

describe("GET /api/tournaments/[id]/edit", () => {
  it("refuse un visiteur non connecté", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(null);
    expect((await GET(new Request("http://localhost"), params("1"))).status).toBe(401);
  });

  it("refuse un utilisateur sans la permission tournaments", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(plainUser);
    expect((await GET(new Request("http://localhost"), params("1"))).status).toBe(403);
  });

  it("refuse un identifiant invalide", async () => {
    expect((await GET(new Request("http://localhost"), params("abc"))).status).toBe(400);
  });

  it("rend 404 sur un tournoi inconnu", async () => {
    jest.mocked(service.loadEditableTournament).mockResolvedValue(null);
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
    jest.mocked(getCurrentUser).mockResolvedValue(plainUser);
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

  // Le corps est analysé derrière un `.catch(() => ({}))` : un corps qui n'est
  // pas du JSON ne doit pas faire tomber la route en 500, il retombe sur le
  // patch vide. Rien ne l'exerçait — c'est pourtant ce que produit un client
  // qui envoie un formulaire au lieu de son JSON.
  it("traite un corps illisible comme un patch vide, sans planter", async () => {
    const res = await PATCH(
      new Request("http://localhost/api/tournaments/1/edit", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: "pas du json {",
      }),
      params("1"),
    );

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: "EMPTY_PATCH" });
    expect(service.updateTournament).not.toHaveBeenCalled();
  });

  it("traduit un tournoi inconnu en 404", async () => {
    jest.mocked(service.updateTournament).mockRejectedValue(
      new Error("TOURNAMENT_NOT_FOUND"),
    );
    expect((await PATCH(patchReq({ name: "X" }), params("1"))).status).toBe(404);
  });

  it("traduit un tournoi verrouillé en 409", async () => {
    jest.mocked(service.updateTournament).mockRejectedValue(
      new Error("TOURNAMENT_LOCKED"),
    );
    expect((await PATCH(patchReq({ name: "X" }), params("1"))).status).toBe(409);
  });

  it("traduit un champ interdit en 409 en nommant le champ", async () => {
    jest.mocked(service.updateTournament).mockRejectedValue(
      new Error("FIELD_NOT_EDITABLE:format"),
    );
    const res = await PATCH(patchReq({ name: "X" }), params("1"));
    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toEqual({ error: "FIELD_NOT_EDITABLE", field: "format" });
  });

  it("traduit une valeur invalide en 400", async () => {
    jest.mocked(service.updateTournament).mockRejectedValue(
      new Error("INVALID_DATE_ORDER"),
    );
    expect((await PATCH(patchReq({ name: "X" }), params("1"))).status).toBe(400);
  });

  it("rend 500 sur une panne inattendue", async () => {
    jest.mocked(service.updateTournament).mockRejectedValue(new Error("ECONNRESET"));
    expect((await PATCH(patchReq({ name: "X" }), params("1"))).status).toBe(500);
  });
});
