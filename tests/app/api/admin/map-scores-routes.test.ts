import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/auth");
jest.mock("@/lib/server/tournaments-service");

import { POST as resolveRoute } from "@/app/api/admin/matches/[matchId]/resolve/route";
import { PATCH as scoresRoute } from "@/app/api/admin/matches/[matchId]/scores/route";
import { getCurrentUser } from "@/lib/server/auth";
import { adminResolveMatch, adminSaveMatchScores } from "@/lib/server/tournaments-service";
import { authUser } from "../../../helpers/auth-user";

const arbitre = authUser({ id: 3, isAdmin: false, roles: ["ARBITRE"] });
const MAPS = [
  { replayCode: "aaa111", team1Score: 2, team2Score: 0 },
  { replayCode: "BBB222", team1Score: 1, team2Score: 1 },
];
const NORMALIZED = [
  { replayCode: "AAA111", team1Score: 2, team2Score: 0 },
  { replayCode: "BBB222", team1Score: 1, team2Score: 1 },
];

function req(method: string, body: unknown) {
  return new Request("http://localhost/api/admin/matches/42/x", {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const params = { params: Promise.resolve({ matchId: "42" }) };

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(getCurrentUser).mockResolvedValue(arbitre);
  jest.mocked(adminResolveMatch).mockResolvedValue(undefined);
  jest.mocked(adminSaveMatchScores).mockResolvedValue(undefined);
});

describe("arbitrage — détail map par map (MAP_SCORES.md)", () => {
  it("« Valider le résultat » transmet les maps et l'arbitre ; le score se dérive dans le service", async () => {
    const res = await resolveRoute(req("POST", { maps: MAPS }), params);
    expect(res.status).toBe(200);
    expect(adminResolveMatch).toHaveBeenCalledWith(42, 0, 0, undefined, false, { maps: NORMALIZED, userId: 3 });
  });

  it("un score à la main efface le détail retenu (maps vides)", async () => {
    await resolveRoute(req("POST", { team1Score: 3, team2Score: 1 }), params);
    expect(adminResolveMatch).toHaveBeenCalledWith(42, 3, 1, undefined, false, { maps: [], userId: 3 });
  });

  it("« Enregistrer » transmet les maps ; une liste vide efface le détail, un champ absent n'y touche pas", async () => {
    await scoresRoute(req("PATCH", { maps: MAPS }), params);
    expect(adminSaveMatchScores).toHaveBeenCalledWith(42, 0, 0, undefined, { maps: NORMALIZED, userId: 3 });
    await scoresRoute(req("PATCH", { team1Score: 1, team2Score: 0, maps: [] }), params);
    // Liste explicitement vide : score à la main qui efface le détail retenu.
    expect(adminSaveMatchScores).toHaveBeenLastCalledWith(42, 1, 0, undefined, { maps: [], userId: 3 });
    await scoresRoute(req("PATCH", { team1Score: 1, team2Score: 0 }), params);
    expect(adminSaveMatchScores).toHaveBeenLastCalledWith(42, 1, 0, undefined, undefined);
  });

  it("refuse un détail mal formé en 400 INVALID_MAPS, sans atteindre le service", async () => {
    for (const route of [() => resolveRoute(req("POST", { maps: "x" }), params), () => scoresRoute(req("PATCH", { maps: [1] }), params)]) {
      const res = await route();
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "INVALID_MAPS" });
    }
    expect(adminResolveMatch).not.toHaveBeenCalled();
    expect(adminSaveMatchScores).not.toHaveBeenCalled();
  });

  it("un double forfait ne se mêle pas d'un détail de maps", async () => {
    const res = await resolveRoute(req("POST", { doubleForfeit: true, maps: MAPS }), params);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "DOUBLE_FORFEIT_EXCLUSIVE" });
  });

  it("rend les refus de règle du service en 400, code seul", async () => {
    jest.mocked(adminResolveMatch).mockRejectedValueOnce(new Error("MAP_REPLAY_CODE_INVALID"));
    const resolved = await resolveRoute(req("POST", { maps: MAPS }), params);
    expect(resolved.status).toBe(400);
    expect(await resolved.json()).toEqual({ error: "MAP_REPLAY_CODE_INVALID" });

    jest.mocked(adminSaveMatchScores).mockRejectedValueOnce(new Error("MAP_COUNT_EXCEEDED"));
    const saved = await scoresRoute(req("PATCH", { maps: MAPS }), params);
    expect(saved.status).toBe(400);
    expect(await saved.json()).toEqual({ error: "MAP_COUNT_EXCEEDED" });
  });
});
