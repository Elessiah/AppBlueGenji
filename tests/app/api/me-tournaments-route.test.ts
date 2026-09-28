import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/auth");
jest.mock("@/lib/server/tournaments/my-tournaments");

import { GET } from "@/app/api/me/tournaments/route";
import { getCurrentUser } from "@/lib/server/auth";
import { listMyActiveTournamentIds } from "@/lib/server/tournaments/my-tournaments";
import { authUser } from "../../helpers/auth-user";

// Un identifiant par test : le plafond de débit est réel et partagé par le module.
let nextUserId = 7000;

beforeEach(() => {
  jest.clearAllMocks();
});

describe("GET /api/me/tournaments", () => {
  it("refuse un visiteur anonyme sans rien lire", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(null);
    expect((await GET()).status).toBe(401);
    expect(listMyActiveTournamentIds).not.toHaveBeenCalled();
  });

  it("rend les tournois du joueur connecté, et de lui seul", async () => {
    const id = nextUserId++;
    jest.mocked(getCurrentUser).mockResolvedValue(authUser({ id }));
    jest.mocked(listMyActiveTournamentIds).mockResolvedValue([3, 5]);
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ tournamentIds: [3, 5] });
    expect(listMyActiveTournamentIds).toHaveBeenCalledWith(id);
  });

  it("une panne de lecture répond 500 avec un code, sans détail interne", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(authUser({ id: nextUserId++ }));
    jest.mocked(listMyActiveTournamentIds).mockRejectedValue(new Error("ER_BAD_FIELD_ERROR bg_x"));
    const spy = jest.spyOn(console, "error").mockImplementation(() => undefined);
    const res = await GET();
    spy.mockRestore();
    expect(res.status).toBe(500);
    const body = JSON.stringify(await res.json());
    expect(body).toContain("MY_TOURNAMENTS_READ_FAILED");
    expect(body).not.toContain("ER_BAD_FIELD_ERROR");
  });
});
