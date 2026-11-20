import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/auth");
jest.mock("@/lib/server/tournaments/match-prod");

import { DELETE as prodDelete, POST as prodPost } from "@/app/api/matches/[matchId]/prod/route";
import { GET as panelGet, PUT as prodPut } from "@/app/api/admin/matches/[matchId]/prod/route";
import { getCurrentUser } from "@/lib/server/auth";
import {
  assignMatchProd,
  claimMatchProd,
  loadProdPanel,
  releaseMatchProd,
  type ProdPanel,
} from "@/lib/server/tournaments/match-prod";
import { authUser } from "../../helpers/auth-user";
import { PROCESSING_ACTIVITIES } from "@/lib/shared/processing-register";
import { PRIVACY_CHANGES } from "@/lib/shared/privacy-changes";
import frErrors from "@/messages/fr/tournamentErrors.json";
import enErrors from "@/messages/en/tournamentErrors.json";

/**
 * Routes de la prod d'un match (`docs/features/MATCH_PROD.md`) : se placer et
 * se retirer (permission `prod`), placement par le staff (`tournaments`).
 */

const player = authUser({ id: 2, roles: [] });
const prod = authUser({ id: 5, roles: ["PROD"] });
const arbitre = authUser({ id: 3, roles: ["ARBITRE"] });

const params = (matchId: string) => ({ params: Promise.resolve({ matchId }) });

function jsonRequest(method: string, body?: unknown) {
  return new Request("http://localhost/api/matches/42/prod", {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

const PANEL: ProdPanel = {
  matchId: 42,
  prod: null,
  candidates: [{ userId: 5, pseudo: "Prod", block: null }],
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe("POST / DELETE /api/matches/[matchId]/prod", () => {
  it("POST_prod_unauthenticated_returns401", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(null);

    expect((await prodPost(jsonRequest("POST"), params("42"))).status).toBe(401);
    expect(claimMatchProd).not.toHaveBeenCalled();
  });

  it("POST_prod_playerView_returns403", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(authUser({ id: 1, isAdmin: true, playerView: true, roles: [] }));

    expect((await prodPost(jsonRequest("POST"), params("42"))).status).toBe(403);
    expect(claimMatchProd).not.toHaveBeenCalled();
  });

  it("POST_prod_invalidId_returns400", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(prod);

    expect((await prodPost(jsonRequest("POST"), params("abc"))).status).toBe(400);
  });

  it("POST_prod_withoutProdInDatabase_returns403", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(player);
    jest.mocked(claimMatchProd).mockRejectedValue(new Error("NOT_PROD"));

    const response = await prodPost(jsonRequest("POST"), params("42"));

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: "NOT_PROD" });
  });

  it("POST_prod_tournamentManager_passesManagesTrue", async () => {
    const admin = authUser({ id: 1, isAdmin: true, roles: [] });
    jest.mocked(getCurrentUser).mockResolvedValue(admin);
    jest.mocked(claimMatchProd).mockResolvedValue(undefined);

    expect((await prodPost(jsonRequest("POST"), params("42"))).status).toBe(200);
    expect(claimMatchProd).toHaveBeenCalledWith(42, admin, true);
  });

  it("POST_prod_taken_returns409", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(prod);
    jest.mocked(claimMatchProd).mockRejectedValue(new Error("MATCH_PROD_TAKEN"));

    expect((await prodPost(jsonRequest("POST"), params("42"))).status).toBe(409);
  });

  it("POST_prod_success_returns200", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(prod);
    jest.mocked(claimMatchProd).mockResolvedValue(undefined);

    const response = await prodPost(jsonRequest("POST"), params("42"));

    expect(response.status).toBe(200);
    expect(claimMatchProd).toHaveBeenCalledWith(42, prod, false);
  });

  it("POST_prod_suspended_returns403", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(prod);
    jest.mocked(claimMatchProd).mockRejectedValue(new Error("PROD_SUSPENDED"));

    const response = await prodPost(jsonRequest("POST"), params("42"));

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual(expect.objectContaining({ error: "PROD_SUSPENDED" }));
  });

  it("DELETE_prod_notOwn_returns403", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(prod);
    jest.mocked(releaseMatchProd).mockRejectedValue(new Error("NOT_MATCH_PROD"));

    expect((await prodDelete(jsonRequest("DELETE"), params("42"))).status).toBe(403);
  });

  it("DELETE_prod_roleLessSessionNotImpersonating_reachesService", async () => {
    // Rôle prod perdu, place gardée par un match lancé : elle se rend encore.
    jest.mocked(getCurrentUser).mockResolvedValue(player);
    jest.mocked(releaseMatchProd).mockResolvedValue(undefined);

    expect((await prodDelete(jsonRequest("DELETE"), params("42"))).status).toBe(200);
    expect(releaseMatchProd).toHaveBeenCalledWith(42, player);
  });

  it("DELETE_prod_impersonationWithoutProd_returns403", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(authUser({ id: 1, isAdmin: true, playerView: true, roles: [] }));

    expect((await prodDelete(jsonRequest("DELETE"), params("42"))).status).toBe(403);
    expect(releaseMatchProd).not.toHaveBeenCalled();
  });

  it("DELETE_prod_success_returns200", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(prod);
    jest.mocked(releaseMatchProd).mockResolvedValue(undefined);

    expect((await prodDelete(jsonRequest("DELETE"), params("42"))).status).toBe(200);
    expect(releaseMatchProd).toHaveBeenCalledWith(42, prod);
  });
});

describe("GET / PUT /api/admin/matches/[matchId]/prod", () => {
  it("adminPUT_unauthenticated_returns401", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(null);

    expect((await prodPut(jsonRequest("PUT", { userId: 5 }), params("42"))).status).toBe(401);
  });

  it("adminPUT_withoutTournaments_returns403", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(prod);

    expect((await prodPut(jsonRequest("PUT", { userId: 5 }), params("42"))).status).toBe(403);
    expect(assignMatchProd).not.toHaveBeenCalled();
  });

  it("adminPUT_invalidUserId_returns400", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(arbitre);

    expect((await prodPut(jsonRequest("PUT", { userId: "5" }), params("42"))).status).toBe(400);
  });

  it("adminPUT_missingUserIdKey_returns400", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(arbitre);

    const response = await prodPut(jsonRequest("PUT", { user_id: 5 }), params("42"));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual(expect.objectContaining({ error: "INVALID_USER_ID" }));
    expect(assignMatchProd).not.toHaveBeenCalled();
  });

  it("adminPUT_invalidExpected_returns400", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(arbitre);

    expect((await prodPut(jsonRequest("PUT", { userId: 5, expectedUserId: -1 }), params("42"))).status).toBe(400);
  });

  it("adminPUT_success_passesExpected", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(arbitre);
    jest.mocked(assignMatchProd).mockResolvedValue(undefined);

    const response = await prodPut(jsonRequest("PUT", { userId: 5, expectedUserId: 6 }), params("42"));

    expect(response.status).toBe(200);
    expect(assignMatchProd).toHaveBeenCalledWith(42, { id: 3, pseudo: arbitre.pseudo }, 5, 6);
  });

  it("adminPUT_removal_passesNull", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(arbitre);
    jest.mocked(assignMatchProd).mockResolvedValue(undefined);

    await prodPut(jsonRequest("PUT", { userId: null, expectedUserId: 5 }), params("42"));

    expect(assignMatchProd).toHaveBeenCalledWith(42, { id: 3, pseudo: arbitre.pseudo }, null, 5);
  });

  it("adminPUT_prodChanged_returns409", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(arbitre);
    jest.mocked(assignMatchProd).mockRejectedValue(new Error("PROD_CHANGED"));

    const response = await prodPut(jsonRequest("PUT", { userId: 5, expectedUserId: null }), params("42"));

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: "PROD_CHANGED" });
  });

  it("adminGET_withoutTournaments_returns403", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(prod);

    expect((await panelGet(jsonRequest("GET"), params("42"))).status).toBe(403);
  });

  it("adminGET_missingMatch_returns404", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(arbitre);
    jest.mocked(loadProdPanel).mockResolvedValue(null);

    expect((await panelGet(jsonRequest("GET"), params("42"))).status).toBe(404);
  });

  it("adminGET_success_returnsPanel", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(arbitre);
    jest.mocked(loadProdPanel).mockResolvedValue(PANEL);

    const response = await panelGet(jsonRequest("GET"), params("42"));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ panel: PANEL });
  });
});

describe("textes de la prod", () => {
  it("PROD_UNAVAILABLE_message_neverMentionsSuspension", () => {
    expect(frErrors.codes.PROD_UNAVAILABLE).not.toMatch(/suspendu/i);
    expect(enErrors.codes.PROD_UNAVAILABLE).not.toMatch(/suspend/i);
  });

  it("register_T16_declaresEveryAutomaticRemoval", () => {
    const t16 = PROCESSING_ACTIVITIES.find((activity) => activity.ref === "T16");

    expect(t16?.retention.join(" ")).toMatch(/Prod d'un match : conservée avec le match ; retirée des matchs pas encore lancés quand son compte perd ce rôle, est suspendu ou joue désormais le match/);
  });

  it("privacyChange_prodMatch_declaresAutomaticRemovalNotice", () => {
    const entry = PRIVACY_CHANGES.find((change) => change.id === "2026-11-prod-match");

    expect(entry?.details.join(" ")).toMatch(/quand sa place lui est retirée d'office, avec le motif/);
  });
});
