import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/auth");
jest.mock("@/lib/server/tournaments-service");
jest.mock("@/lib/server/tournaments/write-visibility");

import { POST } from "@/app/api/tournaments/[id]/matches/[matchId]/forfeit/route";
import { canActOnTournament } from "@/lib/server/tournaments/write-visibility";
import { getCurrentUser } from "@/lib/server/auth";
import { forfeitOwnMatch } from "@/lib/server/tournaments-service";
import { authUser } from "../../../helpers/auth-user";

const params = (id = "7", matchId = "42") => ({ params: Promise.resolve({ id, matchId }) });
const req = () =>
  new Request("http://localhost/api/tournaments/7/matches/42/forfeit", { method: "POST" });

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(canActOnTournament).mockResolvedValue(true);
  jest.mocked(getCurrentUser).mockResolvedValue(authUser({ id: 2 }));
  jest.mocked(forfeitOwnMatch).mockResolvedValue(undefined);
});

describe("POST .../matches/[matchId]/forfeit", () => {
  it("exige une session", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(null);
    expect((await POST(req(), params())).status).toBe(401);
    expect(forfeitOwnMatch).not.toHaveBeenCalled();
  });

  it("refuse des identifiants invalides, chacun sous son code", async () => {
    const badTournament = await POST(req(), params("abc"));
    expect(badTournament.status).toBe(400);
    await expect(badTournament.json()).resolves.toMatchObject({ error: "INVALID_TOURNAMENT_ID" });
    const badMatch = await POST(req(), params("7", "0"));
    await expect(badMatch.json()).resolves.toMatchObject({ error: "INVALID_MATCH_ID" });
  });

  it("déclare le forfait du joueur connecté, sans rien lire du corps", async () => {
    const res = await POST(req(), params());
    expect(res.status).toBe(200);
    expect(forfeitOwnMatch).toHaveBeenCalledWith(7, 42, 2);
  });

  it.each<[string, number]>([
    ["NO_ACTIVE_TEAM", 400],
    ["TOURNAMENT_NOT_RUNNING", 400],
    ["MATCH_NOT_READY", 400],
    ["NOT_IN_MATCH", 400],
    ["NOT_TEAM_MANAGER", 403],
    ["MATCH_ALREADY_COMPLETED", 409],
    ["CANNOT_MODIFY_COMPLETED_DEPENDENT_MATCHES", 409],
    ["TOURNAMENT_NOT_FOUND", 404],
    ["MATCH_NOT_FOUND", 404],
    ["BOOM", 500],
  ])("traduit %s en %i", async (code, status) => {
    jest.mocked(forfeitOwnMatch).mockRejectedValue(new Error(code));
    const res = await POST(req(), params());
    expect(res.status).toBe(status);
    await expect(res.json()).resolves.toMatchObject({ error: code });
  });
});

describe("tournoi non publié", () => {
  it("répond le même 404 qu'un identifiant inexistant, sans atteindre le service", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(authUser({ id: 2 }));
    jest.mocked(canActOnTournament).mockResolvedValue(false);
    const res = await POST(req(), params());
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: "TOURNAMENT_NOT_FOUND" });
    expect(forfeitOwnMatch).not.toHaveBeenCalled();
  });
});
