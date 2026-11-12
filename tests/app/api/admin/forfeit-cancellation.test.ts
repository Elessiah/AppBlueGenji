import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/auth");
jest.mock("@/lib/server/bot-integration");
jest.mock("@/lib/server/tournaments/forfeit-cancellation");

import { DELETE } from "@/app/api/admin/tournaments/[id]/forfeits/[teamId]/route";
import { getCurrentUser } from "@/lib/server/auth";
import { sendBotLog } from "@/lib/server/bot-integration";
import { cancelTournamentForfeit } from "@/lib/server/tournaments/forfeit-cancellation";
import { authUser } from "../../../helpers/auth-user";
import { CONCURRENT_UPDATE_RETRY } from "@/lib/shared/api-error-code";

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
    jest.mocked(sendBotLog).mockReturnValue(undefined);
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

    const [line, scope] = jest.mocked(sendBotLog).mock.calls[0];
    // Le lot du tournoi, à la suite de ses autres lignes d'inscription.
    expect(scope).toEqual({ category: "registrations", tournamentId: 7 });
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
    ["FORFEIT_ROUND_PASSED", 409],
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

  it("rend une contention persistante en refus « réessaie », sans trace d'erreur", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(admin);
    jest.mocked(cancelTournamentForfeit).mockRejectedValue(
      new Error("Deadlock found when trying to get lock; try restarting transaction"),
    );
    const error = jest.spyOn(console, "error").mockImplementation(() => {});
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});

    const res = await cancel("7", "102");

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: CONCURRENT_UPDATE_RETRY });
    expect(error).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalled();
    expect(sendBotLog).not.toHaveBeenCalled();
  });

  // ERREUR.txt EF-15 : le délai d'attente court de l'annulation (5 s) dépassé
  // est une contention, pas une panne — et le journal dit quel tournoi.
  it("DELETE_lockWaitTimeout_returns409AndLogsTournamentAndTeam", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(admin);
    jest.mocked(cancelTournamentForfeit).mockRejectedValue(
      Object.assign(new Error("Lock wait timeout exceeded; try restarting transaction"), {
        code: "ER_LOCK_WAIT_TIMEOUT",
        errno: 1205,
      }),
    );
    const error = jest.spyOn(console, "error").mockImplementation(() => {});
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});

    const res = await cancel("7", "102");

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: CONCURRENT_UPDATE_RETRY });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain("102 au tournoi 7");
    expect(error).not.toHaveBeenCalled();
    expect(sendBotLog).not.toHaveBeenCalled();
  });

  it("DELETE_checkreadWithLocalizedMessage_returns409ByCode", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(admin);
    jest.mocked(cancelTournamentForfeit).mockRejectedValue(
      Object.assign(new Error("L'enregistrement a changé depuis la dernière lecture"), { code: "ER_CHECKREAD", errno: 1020 }),
    );
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});

    const res = await cancel("7", "102");

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: CONCURRENT_UPDATE_RETRY });
    warn.mockRestore();
  });

  // Revue sécurité #542 (cycle 3) : le journal garde l'erreur du moteur
  // (interblocage ou délai borné), la réponse n'en garde que le code.
  it("DELETE_contention_logsEngineError", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(admin);
    const checkread = Object.assign(new Error("L'enregistrement a changé depuis la dernière lecture"), {
      code: "ER_CHECKREAD",
      errno: 1020,
    });
    jest.mocked(cancelTournamentForfeit).mockRejectedValue(checkread);
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});

    await cancel("7", "102");

    // Le code seul, jamais l'objet (ni son message localisé) : ERREUR.txt, revue sécurité #541.
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("écriture concurrente"));
    expect(String(warn.mock.calls[0][0])).toContain("ER_CHECKREAD");
    expect(String(warn.mock.calls[0][0])).not.toContain("enregistrement");
  });

  it("rend un instantané périmé de MariaDB (1020) en refus « réessaie »", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(admin);
    jest.mocked(cancelTournamentForfeit).mockRejectedValue(
      Object.assign(new Error("Record has changed since last read in table 'bg_matches'"), {
        code: "ER_CHECKREAD",
        errno: 1020,
      }),
    );
    const error = jest.spyOn(console, "error").mockImplementation(() => {});
    jest.spyOn(console, "warn").mockImplementation(() => {});

    const res = await cancel("7", "102");

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: CONCURRENT_UPDATE_RETRY });
    expect(error).not.toHaveBeenCalled();
  });
});
