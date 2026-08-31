import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/database");
jest.mock("@/lib/server/bot-integration");
jest.mock("@/lib/server/tournaments/registration");
jest.mock("@/lib/server/tournaments/repository");

import { reportTournamentIssue } from "@/lib/server/tournaments/issue-reports";
import { pushRefereeAlert } from "@/lib/server/bot-integration";
import { resolveUserEntrantTeamId } from "@/lib/server/tournaments/registration";
import { loadTournamentRow } from "@/lib/server/tournaments/repository";

const ENTRANT = [
  {
    tournament_name: "Coupe BlueGenji",
    entrant_name: "Les Renards",
    reporter_pseudo: "Kiro",
  },
];

const MATCH = [
  {
    bracket: "UPPER",
    round_number: 2,
    team1_name: "Les Renards",
    team2_name: "Team Nova",
  },
];

const VALID_MESSAGE = "adversaire absent depuis 20 minutes";

/** Câble la base : `execute` sert la lecture de l'engagé puis celle du match. */
async function mockDb(rows: unknown[][]) {
  const execute = jest.fn<() => Promise<unknown>>();
  for (const result of rows) execute.mockResolvedValueOnce([result]);

  const { getDatabase, withConnection } = await import("@/lib/server/database");
  (getDatabase as jest.Mock).mockResolvedValue({ execute });
  (withConnection as jest.Mock).mockImplementation(
    (run: unknown) => (run as (c: unknown) => Promise<unknown>)({}),
  );
  return execute;
}

beforeEach(async () => {
  jest.clearAllMocks();
  (loadTournamentRow as jest.Mock).mockResolvedValue({ participant_type: "TEAM" });
  (resolveUserEntrantTeamId as jest.Mock).mockResolvedValue(101);
  (pushRefereeAlert as jest.Mock).mockResolvedValue({ sent: 3, unresolved: [], failed: [] });
});

describe("reportTournamentIssue", () => {
  it("relaie un signalement de tournoi et rend le nombre d'arbitres joints", async () => {
    await mockDb([ENTRANT]);

    const result = await reportTournamentIssue(7, 42, VALID_MESSAGE, null);

    expect(result).toEqual({ notifiedReferees: 3 });
    const [message, context] = (pushRefereeAlert as jest.Mock).mock.calls[0] as [string, string];
    expect(context).toBe("issue-report");
    expect(message).toContain("Tournoi : Coupe BlueGenji");
    expect(message).toContain("Auteur : Kiro (Les Renards)");
    expect(message).toContain("Portée : tournoi entier");
    expect(message).toContain(VALID_MESSAGE);
  });

  it("décrit la manche visée quand le signalement porte sur un match", async () => {
    await mockDb([ENTRANT, MATCH]);

    await reportTournamentIssue(7, 42, VALID_MESSAGE, 31);

    const [message] = (pushRefereeAlert as jest.Mock).mock.calls[0] as [string];
    expect(message).toContain("Match : Manche 2 — Les Renards vs Team Nova (#31)");
  });

  it("refuse un message hors bornes avant toute lecture", async () => {
    const execute = await mockDb([ENTRANT]);

    await expect(reportTournamentIssue(7, 42, "???", null)).rejects.toThrow(
      "INVALID_ISSUE_MESSAGE",
    );
    expect(execute).not.toHaveBeenCalled();
    expect(pushRefereeAlert).not.toHaveBeenCalled();
  });

  it("refuse un tournoi inexistant", async () => {
    await mockDb([]);
    (loadTournamentRow as jest.Mock).mockResolvedValue(null);

    await expect(reportTournamentIssue(7, 42, VALID_MESSAGE, null)).rejects.toThrow(
      "TOURNAMENT_NOT_FOUND",
    );
  });

  it("refuse un joueur qui n'a rien à engager", async () => {
    await mockDb([]);
    (resolveUserEntrantTeamId as jest.Mock).mockResolvedValue(null);

    await expect(reportTournamentIssue(7, 42, VALID_MESSAGE, null)).rejects.toThrow(
      "NOT_REGISTERED",
    );
    expect(pushRefereeAlert).not.toHaveBeenCalled();
  });

  it("refuse un engagé dont l'inscription à CE tournoi n'existe pas", async () => {
    await mockDb([[]]);

    await expect(reportTournamentIssue(7, 42, VALID_MESSAGE, null)).rejects.toThrow(
      "NOT_REGISTERED",
    );
  });

  it("refuse un match qui n'appartient pas au tournoi", async () => {
    await mockDb([ENTRANT, []]);

    await expect(reportTournamentIssue(7, 42, VALID_MESSAGE, 31)).rejects.toThrow(
      "MATCH_NOT_FOUND",
    );
    expect(pushRefereeAlert).not.toHaveBeenCalled();
  });

  it("remonte l'injoignabilité du bot plutôt que de rassurer à tort", async () => {
    await mockDb([ENTRANT]);
    (pushRefereeAlert as jest.Mock).mockResolvedValue(null);

    await expect(reportTournamentIssue(7, 42, VALID_MESSAGE, null)).rejects.toThrow(
      "BOT_INTERNAL_UNREACHABLE",
    );
  });

  it("accepte un signalement même si aucun arbitre n'a pu être joint", async () => {
    await mockDb([ENTRANT]);
    (pushRefereeAlert as jest.Mock).mockResolvedValue({
      sent: 0,
      unresolved: [],
      failed: ["arbitre"],
    });

    // Le canal de logs, lui, a bien reçu le signalement : c'est un succès.
    expect(await reportTournamentIssue(7, 42, VALID_MESSAGE, null)).toEqual({
      notifiedReferees: 0,
    });
  });
});
