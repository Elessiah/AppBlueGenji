import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/auth");
jest.mock("@/lib/server/bot-integration");
jest.mock("@/lib/server/tournaments/forfeit-cancellation");

import { DELETE } from "@/app/api/admin/tournaments/[id]/forfeits/[teamId]/route";
import { getCurrentUser } from "@/lib/server/auth";
import { sendBotLog } from "@/lib/server/bot-integration";
import { cancelTournamentForfeit } from "@/lib/server/tournaments/forfeit-cancellation";
import { authUser } from "../../../helpers/auth-user";

const admin = authUser({ id: 1, pseudo: "Root", isAdmin: true, roles: ["ADMIN"] });
const arbitre = authUser({ id: 2, pseudo: "Sifflet", isAdmin: false, roles: ["ARBITRE"] });
const player = authUser({ id: 4, pseudo: "Joueur", isAdmin: false, roles: [] });

const cancelled = {
  tournamentId: 7,
  tournamentName: "BlueGenji Open",
  teamId: 102,
  entrantName: "Team Nova",
  participantType: "TEAM" as const,
};

function cancel(id: string, teamId: string) {
  return DELETE(
    new Request(`http://localhost/api/admin/tournaments/${id}/forfeits/${teamId}`, { method: "DELETE" }),
    { params: Promise.resolve({ id, teamId }) },
  );
}

describe("DELETE /api/admin/tournaments/[id]/forfeits/[teamId]", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(cancelTournamentForfeit).mockResolvedValue(cancelled);
    jest.mocked(sendBotLog).mockResolvedValue(undefined);
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("remet l'engagé en lice pour un administrateur", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(admin);
    jest.spyOn(console, "info").mockImplementation(() => {});

    const res = await cancel("7", "102");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ cancelled });
    expect(cancelTournamentForfeit).toHaveBeenCalledWith(7, 102);
  });

  it("journalise : anonyme sur Discord, auteur nommé dans pm2", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(admin);
    const info = jest.spyOn(console, "info").mockImplementation(() => {});

    await cancel("7", "102");

    const line = jest.mocked(sendBotLog).mock.calls[0][0] as string;
    expect(line).toContain("Team Nova");
    expect(line).toContain("par le staff");
    expect(line).not.toContain("Root");
    expect(String(info.mock.calls[0]?.[0])).toContain("Root (#1)");
  });

  it("rejette un visiteur anonyme avec 401", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(null);

    const res = await cancel("7", "102");

    expect(res.status).toBe(401);
    expect(cancelTournamentForfeit).not.toHaveBeenCalled();
  });

  it.each([
    // Décision du propriétaire du site : l'arbitre déclare un abandon, il ne
    // remet pas en lice.
    ["un arbitre", arbitre],
    ["un joueur", player],
  ])("rejette %s avec 403", async (_label, user) => {
    jest.mocked(getCurrentUser).mockResolvedValue(user);

    const res = await cancel("7", "102");

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "FORBIDDEN" });
    expect(cancelTournamentForfeit).not.toHaveBeenCalled();
  });

  it.each([
    ["0", "102", "INVALID_TOURNAMENT_ID"],
    ["abc", "102", "INVALID_TOURNAMENT_ID"],
    ["7", "-1", "INVALID_TEAM"],
    ["7", "1.5", "INVALID_TEAM"],
  ])("refuse les identifiants %s / %s en 400", async (id, teamId, code) => {
    jest.mocked(getCurrentUser).mockResolvedValue(admin);

    const res = await cancel(id, teamId);

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: code });
  });

  it.each([
    ["TOURNAMENT_NOT_FOUND", 404],
    ["TEAM_NOT_IN_TOURNAMENT", 404],
    ["TOURNAMENT_NOT_RUNNING", 409],
    ["FORMAT_WITHOUT_FORFEIT", 409],
    ["ENDURANCE_PLAYOFFS_STARTED", 409],
    ["TEAM_NOT_FORFEITED", 409],
  ])("traduit %s en %d", async (code, status) => {
    jest.mocked(getCurrentUser).mockResolvedValue(admin);
    jest.mocked(cancelTournamentForfeit).mockRejectedValue(new Error(code));

    const res = await cancel("7", "102");

    expect(res.status).toBe(status);
    expect(await res.json()).toEqual({ error: code });
    expect(sendBotLog).not.toHaveBeenCalled();
  });

  it("masque une panne inattendue derrière un code générique", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(admin);
    jest.mocked(cancelTournamentForfeit).mockRejectedValue(new Error("ER_LOCK_DEADLOCK"));
    const error = jest.spyOn(console, "error").mockImplementation(() => {});

    const res = await cancel("7", "102");

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "FORFEIT_CANCEL_FAILED" });
    expect(error).toHaveBeenCalled();
  });
});
