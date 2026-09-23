import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/auth");
jest.mock("@/lib/server/bot-integration");
jest.mock("@/lib/server/tournaments/registration-removal");

import { DELETE } from "@/app/api/admin/tournaments/[id]/registrations/[teamId]/route";
import { getCurrentUser } from "@/lib/server/auth";
import { sendBotLog } from "@/lib/server/bot-integration";
import { removeTournamentEntrant } from "@/lib/server/tournaments/registration-removal";

type SessionUser = Awaited<ReturnType<typeof getCurrentUser>>;

const admin = { id: 1, pseudo: "Root", isAdmin: true, roles: ["ADMIN"] } as unknown as SessionUser;
const arbitre = {
  id: 2,
  pseudo: "Sifflet",
  isAdmin: false,
  roles: ["ARBITRE"],
} as unknown as SessionUser;
const caster = {
  id: 3,
  pseudo: "Micro",
  isAdmin: false,
  roles: ["CASTER"],
} as unknown as SessionUser;
const player = { id: 4, pseudo: "Joueur", isAdmin: false, roles: [] } as unknown as SessionUser;

const removed = {
  tournamentId: 7,
  tournamentName: "BlueGenji Open",
  teamId: 102,
  entrantName: "Team Nova",
  registeredTeams: 15,
  maxTeams: 16,
  participantType: "TEAM" as const,
};

function remove(id: string, teamId: string) {
  return DELETE(
    new Request(`http://localhost/api/admin/tournaments/${id}/registrations/${teamId}`, {
      method: "DELETE",
    }),
    { params: Promise.resolve({ id, teamId }) },
  );
}

describe("DELETE /api/admin/tournaments/[id]/registrations/[teamId]", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (removeTournamentEntrant as jest.Mock).mockResolvedValue(removed as never);
    (sendBotLog as jest.Mock).mockResolvedValue(undefined as never);
  });
  afterEach(() => jest.restoreAllMocks());

  it.each([
    ["un administrateur", admin],
    // Retirer une inscription avant le coup d'envoi est un acte d'arbitrage, au
    // même titre que la correction d'un score : seule la suppression définitive
    // d'un tournoi exige `isAdmin`.
    ["un arbitre", arbitre],
  ])("retire l'engagé pour %s", async (_label, user) => {
    (getCurrentUser as jest.Mock).mockResolvedValue(user as never);

    const res = await remove("7", "102");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ removed });
    expect(removeTournamentEntrant).toHaveBeenCalledWith(7, 102);
  });

  it("journalise le retrait : anonyme sur Discord, auteur nommé dans pm2", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(arbitre as never);
    const info = jest.spyOn(console, "info").mockImplementation(() => {});

    await remove("7", "102");

    expect(sendBotLog).toHaveBeenCalledTimes(1);
    const line = (sendBotLog as jest.Mock).mock.calls[0][0] as string;
    // Le canal est la **seule** trace qui subsiste d'une inscription effacée :
    // elle porte le tournoi, l'engagé et l'effectif restant — l'auteur y est
    // « le staff », jamais son pseudo.
    expect(line).toContain("BlueGenji Open");
    expect(line).toContain("#7");
    expect(line).toContain("Team Nova");
    expect(line).toContain("15/16");
    expect(line).toContain("par le staff");
    expect(line).not.toContain("Sifflet");
    // La modération retrouve l'auteur dans les journaux du serveur.
    const audit = String(info.mock.calls[0]?.[0]);
    expect(audit).toContain("[staff-audit]");
    expect(audit).toContain("Sifflet (#2)");
    expect(audit).toContain(line);
    info.mockRestore();
  });

  it("répond malgré un bot injoignable", async () => {
    // Le bot est optionnel, et la ligne est déjà effacée : rien à annuler.
    (getCurrentUser as jest.Mock).mockResolvedValue(admin as never);
    (sendBotLog as jest.Mock).mockRejectedValue(new Error("ECONNREFUSED") as never);

    const res = await remove("7", "102");

    expect(res.status).toBe(200);
  });

  it("rejette un visiteur anonyme avec 401", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(null as never);

    const res = await remove("7", "102");

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "UNAUTHORIZED" });
    expect(removeTournamentEntrant).not.toHaveBeenCalled();
  });

  it.each([
    ["un caster", caster],
    ["un joueur", player],
  ])("rejette %s avec 403", async (_label, user) => {
    // Un `CASTER` lit l'aperçu du plateau ; il ne touche pas aux inscriptions.
    (getCurrentUser as jest.Mock).mockResolvedValue(user as never);

    const res = await remove("7", "102");

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "FORBIDDEN" });
    expect(removeTournamentEntrant).not.toHaveBeenCalled();
  });

  it.each([
    ["un tournoi non entier", "abc", "102", "INVALID_TOURNAMENT_ID"],
    ["un tournoi négatif", "-3", "102", "INVALID_TOURNAMENT_ID"],
    ["un engagé non entier", "7", "abc", "INVALID_TEAM"],
    ["un engagé nul", "7", "0", "INVALID_TEAM"],
  ])("refuse %s en 400", async (_label, id, teamId, code) => {
    (getCurrentUser as jest.Mock).mockResolvedValue(admin as never);

    const res = await remove(id, teamId);

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: code });
    expect(removeTournamentEntrant).not.toHaveBeenCalled();
  });

  it.each(["TOURNAMENT_NOT_FOUND", "TEAM_NOT_IN_TOURNAMENT"])(
    "rend 404 sur %s",
    async (code) => {
      (getCurrentUser as jest.Mock).mockResolvedValue(admin as never);
      (removeTournamentEntrant as jest.Mock).mockRejectedValue(new Error(code) as never);

      const res = await remove("7", "102");

      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: code });
      expect(sendBotLog).not.toHaveBeenCalled();
    },
  );

  it.each(["ENTRANT_REMOVAL_TOURNAMENT_STARTED", "ENTRANT_REMOVAL_TOURNAMENT_FINISHED"])(
    "rend 409 sur %s",
    async (code) => {
      // La demande est bien formée : c'est l'état du tournoi qui la contredit.
      (getCurrentUser as jest.Mock).mockResolvedValue(admin as never);
      (removeTournamentEntrant as jest.Mock).mockRejectedValue(new Error(code) as never);

      const res = await remove("7", "102");

      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({ error: code });
    },
  );

  it("masque une panne du moteur derrière un code du site", async () => {
    // Le texte d'une erreur mysql2 est anglais et parle du moteur : il reste au
    // journal du serveur, pas dans un toast français.
    (getCurrentUser as jest.Mock).mockResolvedValue(admin as never);
    (removeTournamentEntrant as jest.Mock).mockRejectedValue(
      new Error("Deadlock found when trying to get lock") as never,
    );
    const logged = jest.spyOn(console, "error").mockImplementation(() => {});

    const res = await remove("7", "102");

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "ENTRANT_REMOVAL_FAILED" });
    expect(logged).toHaveBeenCalled();
  });
});
