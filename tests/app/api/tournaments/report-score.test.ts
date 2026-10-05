import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/auth");
jest.mock("@/lib/server/tournaments-service");
jest.mock("@/lib/server/tournaments/write-visibility");

import { POST } from "@/app/api/tournaments/[id]/matches/[matchId]/report/route";
import { canActOnTournament } from "@/lib/server/tournaments/write-visibility";
import { getCurrentUser } from "@/lib/server/auth";
import { reportMatchScore } from "@/lib/server/tournaments-service";
import { authUser } from "../../../helpers/auth-user";

const params = { params: Promise.resolve({ id: "7", matchId: "42" }) };

const MAPS = [
  { replayCode: "abc123", team1Score: 2, team2Score: 1 },
  { replayCode: "DEF456", team1Score: 1, team2Score: 1 },
];

function req(body: unknown = { maps: MAPS }) {
  return new Request("http://localhost/api/tournaments/7/matches/42/report", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(canActOnTournament).mockResolvedValue(true);
  jest.mocked(getCurrentUser).mockResolvedValue(authUser({ id: 2 }));
});

describe("POST .../report — match pas encore lancé", () => {
  it("répond 409 : le score est bien formé, c'est l'état du match qui refuse", async () => {
    jest.mocked(reportMatchScore).mockRejectedValue(new Error("MATCH_NOT_LAUNCHED"));
    const res = await POST(req(), params);
    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toMatchObject({ error: "MATCH_NOT_LAUNCHED" });
  });

  it("garde les refus existants en 400", async () => {
    jest.mocked(reportMatchScore).mockRejectedValue(new Error("NOT_IN_MATCH"));
    expect((await POST(req(), params)).status).toBe(400);
  });

  it("accepte un report sur un match lancé", async () => {
    jest.mocked(reportMatchScore).mockResolvedValue();
    expect((await POST(req(), params)).status).toBe(200);
    // Codes normalisés (majuscules) avant d'atteindre le service.
    expect(reportMatchScore).toHaveBeenCalledWith(7, 42, 2, [
      { replayCode: "ABC123", team1Score: 2, team2Score: 1 },
      { replayCode: "DEF456", team1Score: 1, team2Score: 1 },
    ]);
  });
});

describe("POST .../report — détail map par map (MAP_SCORES.md)", () => {
  it("refuse l'ancien corps sans maps en 400 MAP_LIST_EMPTY", async () => {
    const res = await POST(req({ myScore: 3, opponentScore: 1 }), params);
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ error: "MAP_LIST_EMPTY" });
    expect(reportMatchScore).not.toHaveBeenCalled();
  });

  it("refuse une liste mal formée en 400 INVALID_MAPS", async () => {
    for (const maps of ["3-1", [{ replayCode: 12, team1Score: 1, team2Score: 0 }], [{ replayCode: "A", team1Score: "1", team2Score: 0 }]]) {
      const res = await POST(req({ maps }), params);
      expect(res.status).toBe(400);
      await expect(res.json()).resolves.toMatchObject({ error: "INVALID_MAPS" });
    }
    expect(reportMatchScore).not.toHaveBeenCalled();
  });

  it("rend chaque refus de règle du service en 400, code seul", async () => {
    for (const code of [
      "MAP_LIST_EMPTY",
      "MAP_COUNT_EXCEEDED",
      "MAP_REPLAY_CODE_REQUIRED",
      "MAP_REPLAY_CODE_INVALID",
      "MAP_REPLAY_CODE_DUPLICATE",
      "MAP_SCORE_INVALID",
      "MAP_AFTER_DECISION",
    ]) {
      jest.mocked(reportMatchScore).mockRejectedValueOnce(new Error(code));
      const res = await POST(req(), params);
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: code });
    }
  });
});

describe("POST .../report — qualité pour reporter", () => {
  it("répond 403 à un membre sportif du roster", async () => {
    jest.mocked(reportMatchScore).mockRejectedValue(new Error("NOT_TEAM_MATCH_LEADER"));
    const res = await POST(req(), params);
    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toMatchObject({ error: "NOT_TEAM_MATCH_LEADER" });
  });
});

describe("tournoi non publié", () => {
  it("répond le même 404 qu'un identifiant inexistant, sans atteindre le service", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(authUser({ id: 2 }));
    jest.mocked(canActOnTournament).mockResolvedValue(false);
    const res = await POST(req(), params);
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: "TOURNAMENT_NOT_FOUND" });
    expect(reportMatchScore).not.toHaveBeenCalled();
  });
});
