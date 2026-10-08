import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/auth");
jest.mock("@/lib/server/tournaments-service");

import { POST as resolveRoute } from "@/app/api/admin/matches/[matchId]/resolve/route";
import { PATCH as scoresRoute } from "@/app/api/admin/matches/[matchId]/scores/route";
import { getCurrentUser } from "@/lib/server/auth";
import { adminResolveMatch, adminSaveMatchScores } from "@/lib/server/tournaments-service";
import { authUser } from "../../../helpers/auth-user";
import { mapsFor } from "../../../helpers/match-maps";

const arbitre = authUser({ id: 3, isAdmin: false, roles: ["ARBITRE"] });

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

async function errorOf(res: Response): Promise<string> {
  return ((await res.json()) as { error: string }).error;
}

const routes = [
  { name: "PATCH .../scores", call: (body: unknown) => scoresRoute(req("PATCH", body), params), service: adminSaveMatchScores },
  { name: "POST .../resolve", call: (body: unknown) => resolveRoute(req("POST", body), params), service: adminResolveMatch },
] as const;

describe.each(routes)("$name — lecture du corps", ({ call, service }) => {
  it("transmet le détail map par map avec l'arbitre courant", async () => {
    const res = await call({ maps: mapsFor(3, 1) });
    expect(res.status).toBe(200);
    expect(service).toHaveBeenCalledWith(42, { maps: mapsFor(3, 1), userId: 3 });
  });

  it("transmet un forfait nominatif, qui l'emporte sur les maps", async () => {
    const res = await call({ forfeitTeamId: "7", maps: mapsFor(2, 0) });
    expect(res.status).toBe(200);
    expect(service).toHaveBeenCalledWith(42, { forfeitTeamId: 7 });
  });

  it.each<[unknown]>([[0], [-2], [1.5], ["abc"]])("refuse le forfait %p", async (forfeitTeamId) => {
    const res = await call({ forfeitTeamId, maps: mapsFor(1, 0) });
    expect(res.status).toBe(400);
    expect(await errorOf(res)).toBe("INVALID_FORFEIT_TEAM_ID");
    expect(service).not.toHaveBeenCalled();
  });

  it("refuse l'ancienne saisie à la main { team1Score, team2Score } en 400 MAP_LIST_EMPTY", async () => {
    const res = await call({ team1Score: 2, team2Score: 1 });
    expect(res.status).toBe(400);
    expect(await errorOf(res)).toBe("MAP_LIST_EMPTY");
    expect(service).not.toHaveBeenCalled();
  });

  it.each<[Record<string, unknown>]>([[{}], [{ maps: [] }], [{ maps: null }], [{ forfeitTeamId: null }], [{ forfeitTeamId: null, maps: [] }]])(
    "refuse un corps sans forfait ni maps %p en MAP_LIST_EMPTY",
    async (body) => {
      const res = await call(body);
      expect(res.status).toBe(400);
      expect(await errorOf(res)).toBe("MAP_LIST_EMPTY");
      expect(service).not.toHaveBeenCalled();
    },
  );

  it.each<[unknown]>([["x"], [{}], [[1]], [[{ replayCode: "AAA111", team1Score: "2", team2Score: 0 }]]])(
    "refuse le détail mal formé %p en INVALID_MAPS",
    async (maps) => {
      const res = await call({ maps });
      expect(res.status).toBe(400);
      expect(await errorOf(res)).toBe("INVALID_MAPS");
      expect(service).not.toHaveBeenCalled();
    },
  );

  it.each<[string, number]>([
    ["MATCH_NOT_FOUND", 404],
    ["MATCH_ALREADY_COMPLETED", 409],
    ["MATCH_NOT_READY", 409],
    ["MATCH_NOT_IN_LAUNCH", 409],
    ["CANNOT_MODIFY_COMPLETED_DEPENDENT_MATCHES", 409],
    ["SCORE_EXCEEDS_MATCH_FORMAT", 400],
    ["SCORE_BELOW_MATCH_FORMAT", 400],
    ["INVALID_FORFEIT_TEAM_ID", 400],
    ["UNEXPECTED", 500],
  ])("traduit le refus %s en %i", async (code, status) => {
    jest.mocked(service).mockRejectedValue(new Error(code));
    const res = await call({ maps: mapsFor(1, 0) });
    expect(res.status).toBe(status);
  });
});

describe("codes propres à chaque route", () => {
  it("« Valider » rend DRAW_NOT_ALLOWED et INVALID_REQUEST en 400", async () => {
    for (const code of ["DRAW_NOT_ALLOWED", "INVALID_REQUEST"]) {
      jest.mocked(adminResolveMatch).mockRejectedValueOnce(new Error(code));
      const res = await resolveRoute(req("POST", { maps: mapsFor(1, 1) }), params);
      expect(res.status).toBe(400);
    }
  });

  it("« Enregistrer » ne connaît pas DRAW_NOT_ALLOWED : 500", async () => {
    jest.mocked(adminSaveMatchScores).mockRejectedValueOnce(new Error("DRAW_NOT_ALLOWED"));
    const res = await scoresRoute(req("PATCH", { maps: mapsFor(1, 1) }), params);
    expect(res.status).toBe(500);
  });
});
