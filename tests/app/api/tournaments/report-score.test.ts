import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/auth");
jest.mock("@/lib/server/tournaments-service");

import { POST } from "@/app/api/tournaments/[id]/matches/[matchId]/report/route";
import { getCurrentUser } from "@/lib/server/auth";
import { reportMatchScore } from "@/lib/server/tournaments-service";
import { authUser } from "../../../helpers/auth-user";

const params = { params: Promise.resolve({ id: "7", matchId: "42" }) };

function req() {
  return new Request("http://localhost/api/tournaments/7/matches/42/report", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ myScore: 3, opponentScore: 1 }),
  });
}

beforeEach(() => {
  jest.clearAllMocks();
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
    expect(reportMatchScore).toHaveBeenCalledWith(7, 42, 2, 3, 1);
  });
});
