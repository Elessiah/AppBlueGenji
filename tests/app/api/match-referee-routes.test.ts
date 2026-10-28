import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/auth");
jest.mock("@/lib/server/tournaments/match-launch");
jest.mock("@/lib/server/tournaments/referee-panel");

import { DELETE as refereeDelete, POST as refereePost } from "@/app/api/matches/[matchId]/referee/route";
import { GET as panelGet, PUT as refereePut } from "@/app/api/admin/matches/[matchId]/referee/route";
import { PUT as selfManagementPut } from "@/app/api/admin/matches/[matchId]/self-management/route";
import { PUT as firstMapPut } from "@/app/api/admin/matches/[matchId]/first-map/route";
import { PUT as roundSelfManagementPut } from "@/app/api/admin/tournaments/[id]/self-management/route";
import { getCurrentUser } from "@/lib/server/auth";
import {
  assignMatchReferee,
  releaseMatchReferee,
  setMatchFirstMap,
  setMatchSelfManaged,
  setRoundSelfManaged,
  takeMatchReferee,
} from "@/lib/server/tournaments/match-launch";
import { loadRefereePanel, type RefereePanel } from "@/lib/server/tournaments/referee-panel";
import { authUser } from "../../helpers/auth-user";

/**
 * Routes de l'arbitre désigné (`docs/features/MATCH_REFEREE.md`) : prise et
 * retrait par l'arbitre, désignation, autogestion (match et manche) et
 * première carte par le staff (permission `tournaments`).
 */

const player = authUser({ id: 2, roles: [] });
const caster = authUser({ id: 4, roles: ["CASTER"] });
const arbitre = authUser({ id: 3, roles: ["ARBITRE"] });

const params = (matchId: string) => ({ params: Promise.resolve({ matchId }) });
const tournamentParams = (id: string) => ({ params: Promise.resolve({ id }) });

function jsonRequest(method: string, body?: unknown) {
  return new Request("http://localhost/api/matches/42/referee", {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

const PANEL: RefereePanel = {
  matchId: 42,
  referee: { userId: 3, pseudo: "Arbitre", eligible: true },
  selfManaged: false,
  firstMap: null,
  round: { phaseId: 0, roundNumber: 1, bracket: "UPPER" },
  roundSlots: [],
  candidates: [{ userId: 3, pseudo: "Arbitre" }],
  objections: [],
  objectable: [{ userId: 3, pseudo: "Arbitre" }],
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe("POST / DELETE /api/matches/[matchId]/referee", () => {
  it("rejette un visiteur anonyme", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(null);
    expect((await refereePost(jsonRequest("POST"), params("42"))).status).toBe(401);
    expect((await refereeDelete(jsonRequest("DELETE"), params("42"))).status).toBe(401);
    expect(takeMatchReferee).not.toHaveBeenCalled();
  });

  it("refuse la prise sans la permission `tournaments`, caster compris", async () => {
    for (const user of [player, caster]) {
      jest.mocked(getCurrentUser).mockResolvedValue(user);
      const res = await refereePost(jsonRequest("POST"), params("42"));
      expect(res.status).toBe(403);
      await expect(res.json()).resolves.toEqual({ error: "NOT_REFEREE" });
    }
    expect(takeMatchReferee).not.toHaveBeenCalled();
  });

  it("valide l'identifiant puis prend le match", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(arbitre);
    expect((await refereePost(jsonRequest("POST"), params("abc"))).status).toBe(400);
    jest.mocked(takeMatchReferee).mockResolvedValue();
    const res = await refereePost(jsonRequest("POST"), params("42"));
    expect(res.status).toBe(200);
    expect(takeMatchReferee).toHaveBeenCalledWith(42, 3);
  });

  it.each<[string, number]>([
    ["MATCH_NOT_FOUND", 404],
    ["MATCH_ALREADY_REFEREED", 409],
    ["REFEREE_IDENTITY_REQUIRED", 409],
    ["REFEREE_IS_PLAYER", 409],
    ["MATCH_ALREADY_COMPLETED", 409],
  ])("traduit %s en %i, code seul", async (code, status) => {
    jest.mocked(getCurrentUser).mockResolvedValue(arbitre);
    jest.mocked(takeMatchReferee).mockRejectedValue(new Error(code));
    const res = await refereePost(jsonRequest("POST"), params("42"));
    expect(res.status).toBe(status);
    await expect(res.json()).resolves.toEqual({ error: code });
  });

  it("le retrait ne vaut que pour soi : jamais au nom du staff", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(arbitre);
    jest.mocked(releaseMatchReferee).mockResolvedValue();
    expect((await refereeDelete(jsonRequest("DELETE"), params("42"))).status).toBe(200);
    expect(releaseMatchReferee).toHaveBeenCalledWith(42, 3, false);
    jest.mocked(releaseMatchReferee).mockRejectedValue(new Error("NOT_MATCH_REFEREE"));
    expect((await refereeDelete(jsonRequest("DELETE"), params("42"))).status).toBe(403);
  });

  it("ne laisse pas fuir le message d'une vraie panne", async () => {
    const quiet = jest.spyOn(console, "error").mockImplementation(() => undefined);
    jest.mocked(getCurrentUser).mockResolvedValue(arbitre);
    jest.mocked(takeMatchReferee).mockRejectedValue(new Error("ER_LOCK_DEADLOCK: base bg_prod"));
    const res = await refereePost(jsonRequest("POST"), params("42"));
    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toEqual({ error: "MATCH_REFEREE_TAKE_FAILED" });
    quiet.mockRestore();
  });
});

describe("GET / PUT /api/admin/matches/[matchId]/referee", () => {
  it("réserve la fiche nominative et la désignation au staff", async () => {
    for (const user of [player, caster]) {
      jest.mocked(getCurrentUser).mockResolvedValue(user);
      expect((await panelGet(jsonRequest("GET"), params("42"))).status).toBe(403);
      expect((await refereePut(jsonRequest("PUT", { userId: 3 }), params("42"))).status).toBe(403);
    }
    expect(loadRefereePanel).not.toHaveBeenCalled();
    expect(assignMatchReferee).not.toHaveBeenCalled();
  });

  it("rend la fiche, 404 sur un match inconnu", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(arbitre);
    jest.mocked(loadRefereePanel).mockResolvedValue(PANEL);
    const res = await panelGet(jsonRequest("GET"), params("42"));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ panel: PANEL });
    jest.mocked(loadRefereePanel).mockResolvedValue(null);
    expect((await panelGet(jsonRequest("GET"), params("42"))).status).toBe(404);
  });

  it("désigne, retire sur `null`, refuse un identifiant mal formé", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(arbitre);
    jest.mocked(assignMatchReferee).mockResolvedValue();
    expect((await refereePut(jsonRequest("PUT", { userId: 9 }), params("42"))).status).toBe(200);
    expect(assignMatchReferee).toHaveBeenLastCalledWith(42, 3, 9);
    expect((await refereePut(jsonRequest("PUT", { userId: null }), params("42"))).status).toBe(200);
    expect(assignMatchReferee).toHaveBeenLastCalledWith(42, 3, null);
    expect((await refereePut(jsonRequest("PUT", { userId: "9" }), params("42"))).status).toBe(400);
    expect((await refereePut(jsonRequest("PUT", { userId: -1 }), params("42"))).status).toBe(400);
    expect(assignMatchReferee).toHaveBeenCalledTimes(2);
  });

  it.each<[string, number]>([
    ["NOT_REFEREE", 409],
    ["REFEREE_IDENTITY_REQUIRED", 409],
    ["REFEREE_IS_PLAYER", 409],
    ["MATCH_NOT_FOUND", 404],
  ])("désignation refusée : %s en %i", async (code, status) => {
    jest.mocked(getCurrentUser).mockResolvedValue(arbitre);
    jest.mocked(assignMatchReferee).mockRejectedValue(new Error(code));
    const res = await refereePut(jsonRequest("PUT", { userId: 9 }), params("42"));
    expect(res.status).toBe(status);
    await expect(res.json()).resolves.toEqual({ error: code });
  });
});

describe("PUT autogestion et première carte", () => {
  it("réservés au staff", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(caster);
    expect((await selfManagementPut(jsonRequest("PUT", { enabled: true }), params("42"))).status).toBe(403);
    expect((await firstMapPut(jsonRequest("PUT", { map: "Ilios" }), params("42"))).status).toBe(403);
    expect(
      (await roundSelfManagementPut(jsonRequest("PUT", { phaseId: 0, roundNumber: 1, enabled: true }), tournamentParams("7")))
        .status,
    ).toBe(403);
    expect(setMatchSelfManaged).not.toHaveBeenCalled();
    expect(setMatchFirstMap).not.toHaveBeenCalled();
    expect(setRoundSelfManaged).not.toHaveBeenCalled();
  });

  it("autogestion d'un match : un booléen, sinon 400", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(arbitre);
    jest.mocked(setMatchSelfManaged).mockResolvedValue();
    expect((await selfManagementPut(jsonRequest("PUT", { enabled: "oui" }), params("42"))).status).toBe(400);
    expect((await selfManagementPut(jsonRequest("PUT", { enabled: true }), params("42"))).status).toBe(200);
    expect(setMatchSelfManaged).toHaveBeenCalledWith(42, true);
    jest.mocked(setMatchSelfManaged).mockRejectedValue(new Error("MATCH_ALREADY_COMPLETED"));
    expect((await selfManagementPut(jsonRequest("PUT", { enabled: false }), params("42"))).status).toBe(409);
  });

  it("autogestion d'une manche : manche et tableau validés", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(arbitre);
    jest.mocked(setRoundSelfManaged).mockResolvedValue(3);
    const put = (body: unknown) => roundSelfManagementPut(jsonRequest("PUT", body), tournamentParams("7"));
    expect((await put({ phaseId: 0, roundNumber: 0, enabled: true })).status).toBe(400);
    expect((await put({ phaseId: -1, roundNumber: 1, enabled: true })).status).toBe(400);
    expect((await put({ phaseId: 0, roundNumber: 1, bracket: "SIDE", enabled: true })).status).toBe(400);
    expect((await put({ phaseId: 0, roundNumber: 1, enabled: "oui" })).status).toBe(400);
    const res = await put({ phaseId: 0, roundNumber: 2, bracket: "LOWER", enabled: true });
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ changed: 3 });
    expect(setRoundSelfManaged).toHaveBeenCalledWith(7, { phaseId: 0, roundNumber: 2, bracket: "LOWER" }, true);
    jest.mocked(setRoundSelfManaged).mockRejectedValue(new Error("TOURNAMENT_NOT_FOUND"));
    expect((await put({ phaseId: 0, roundNumber: 2, enabled: false })).status).toBe(404);
  });

  it("première carte : transmise telle quelle, refus en code seul", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(arbitre);
    jest.mocked(setMatchFirstMap).mockResolvedValue();
    expect((await firstMapPut(jsonRequest("PUT", { map: "Ilios" }), params("42"))).status).toBe(200);
    expect(setMatchFirstMap).toHaveBeenCalledWith(42, "Ilios");
    jest.mocked(setMatchFirstMap).mockRejectedValue(new Error("INVALID_FIRST_MAP"));
    const res = await firstMapPut(jsonRequest("PUT", { map: "x".repeat(80) }), params("42"));
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: "INVALID_FIRST_MAP" });
  });

  it("PUT first-map_roundMapsSet_returns409", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(arbitre);
    jest.mocked(setMatchFirstMap).mockRejectedValue(new Error("ROUND_MAPS_SET"));
    const res = await firstMapPut(jsonRequest("PUT", { map: "Busan" }), params("42"));
    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toEqual({ error: "ROUND_MAPS_SET" });
  });
});
