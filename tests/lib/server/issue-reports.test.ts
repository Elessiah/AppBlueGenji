import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/database");
jest.mock("@/lib/server/bot-integration");
jest.mock("@/lib/server/push-subscriptions");
jest.mock("@/lib/server/tournaments/registration");
jest.mock("@/lib/server/tournaments/repository");

import { reportTournamentIssue } from "@/lib/server/tournaments/issue-reports";
import { pushRefereeAlert } from "@/lib/server/bot-integration";
import { pushToUsers, subscribedStaffCandidates } from "@/lib/server/push-subscriptions";
import { resolveUserEntrantTeamId } from "@/lib/server/tournaments/registration";
import { loadTournamentRow } from "@/lib/server/tournaments/repository";
import { fakePool, fakeConnection } from "../../helpers/sql-double";
import { tournamentRow } from "../../helpers/tournament-rows";

const ENTRANT = [
  {
    tournament_name: "Coupe BlueGenji",
    participant_type: "TEAM",
    entrant_name: "Les Renards",
  },
];

const MATCH = [
  {
    team1_id: 101,
    team2_id: 202,
    bracket: "UPPER",
    round_number: 2,
    team1_name: "Les Renards",
    team2_name: "Team Nova",
  },
];

const VALID_MESSAGE = "adversaire absent depuis 20 minutes";

/** Câble la base : `execute` sert la lecture de l'engagé puis celle du match. */
async function mockDb(rows: unknown[][]) {
  const execute = jest.fn<(sql: string, params?: unknown[]) => Promise<unknown>>();
  for (const result of rows) execute.mockResolvedValueOnce([result]);

  const { getDatabase, withConnection } = await import("@/lib/server/database");
  jest.mocked(getDatabase).mockResolvedValue(fakePool({ execute }));
  jest.mocked(withConnection).mockImplementation((run) => run(fakeConnection({})));
  return execute;
}

beforeEach(async () => {
  jest.clearAllMocks();
  jest.mocked(subscribedStaffCandidates).mockResolvedValue([]);
  jest.mocked(pushToUsers).mockResolvedValue(0);
  jest.mocked(loadTournamentRow).mockResolvedValue(tournamentRow({ participant_type: "TEAM" }));
  jest.mocked(resolveUserEntrantTeamId).mockResolvedValue(101);
  jest.mocked(pushRefereeAlert).mockResolvedValue({ sent: 3, unresolved: [], failed: [] });
});

describe("reportTournamentIssue", () => {
  it("relaie un signalement de tournoi et rend le nombre d'arbitres joints", async () => {
    await mockDb([ENTRANT]);

    const result = await reportTournamentIssue(7, 42, VALID_MESSAGE, null);

    expect(result).toEqual({ notifiedReferees: 3 });
    const [message, context] = jest.mocked(pushRefereeAlert).mock.calls[0] as [string, string];
    expect(context).toBe("issue-report");
    expect(message).toContain("Tournoi : Coupe BlueGenji");
    expect(message).toContain("Auteur : un joueur de l'équipe Les Renards");
    expect(message).toContain("Portée : tournoi entier");
    expect(message).toContain(VALID_MESSAGE);
  });

  it("ne lit ni n'envoie le pseudo de l'auteur", async () => {
    const execute = await mockDb([ENTRANT]);

    await reportTournamentIssue(7, 42, VALID_MESSAGE, null);

    // La requête ne va même plus chercher le compte : rien à filtrer ensuite.
    expect(String(execute.mock.calls[0]?.[0])).not.toContain("bg_users");
  });

  it("n'écrit que « un joueur » en tournoi individuel, auteur comme adversaires", async () => {
    await mockDb([
      [{ tournament_name: "Solo Cup", participant_type: "SOLO", entrant_name: "Kiro" }],
      [
        {
          team1_id: 303,
          team2_id: 101,
          bracket: "UPPER",
          round_number: 1,
          team1_name: "Nova",
          team2_name: "Kiro",
        },
      ],
    ]);

    await reportTournamentIssue(7, 42, VALID_MESSAGE, 31);

    const [message] = jest.mocked(pushRefereeAlert).mock.calls[0];
    expect(message).not.toContain("Kiro");
    expect(message).not.toContain("Nova");
    expect(message).toContain("Auteur : un joueur");
    expect(message).toContain("un joueur vs un joueur (#31)");
  });

  it("décrit la manche visée quand le signalement porte sur un match", async () => {
    await mockDb([ENTRANT, MATCH]);

    await reportTournamentIssue(7, 42, VALID_MESSAGE, 31);

    const [message] = jest.mocked(pushRefereeAlert).mock.calls[0];
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
    jest.mocked(loadTournamentRow).mockResolvedValue(null);

    await expect(reportTournamentIssue(7, 42, VALID_MESSAGE, null)).rejects.toThrow(
      "TOURNAMENT_NOT_FOUND",
    );
  });

  it("refuse un joueur qui n'a rien à engager", async () => {
    await mockDb([]);
    jest.mocked(resolveUserEntrantTeamId).mockResolvedValue(null);

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

  it("refuse un engagé qui ne joue pas la manche visée", async () => {
    await mockDb([ENTRANT, [{ ...MATCH[0], team1_id: 303, team2_id: 404 }]]);

    await expect(reportTournamentIssue(7, 42, VALID_MESSAGE, 31)).rejects.toThrow(
      "NOT_MATCH_PARTICIPANT",
    );
    expect(pushRefereeAlert).not.toHaveBeenCalled();
  });

  it("refuse une manche dont un seul créneau est garni, par un autre engagé", async () => {
    await mockDb([ENTRANT, [{ ...MATCH[0], team1_id: 303, team2_id: null }]]);

    await expect(reportTournamentIssue(7, 42, VALID_MESSAGE, 31)).rejects.toThrow(
      "NOT_MATCH_PARTICIPANT",
    );
  });

  it("accepte l'engagé placé en second sur la manche", async () => {
    await mockDb([ENTRANT, [{ ...MATCH[0], team1_id: 202, team2_id: 101 }]]);

    await expect(reportTournamentIssue(7, 42, VALID_MESSAGE, 31)).resolves.toEqual({
      notifiedReferees: 3,
    });
  });

  it("remonte l'injoignabilité du bot plutôt que de rassurer à tort", async () => {
    await mockDb([ENTRANT]);
    jest.mocked(pushRefereeAlert).mockResolvedValue(null);

    await expect(reportTournamentIssue(7, 42, VALID_MESSAGE, null)).rejects.toThrow(
      "BOT_INTERNAL_UNREACHABLE",
    );
  });

  it("ne se dit pas injoignable quand un arbitre a reçu la notification push", async () => {
    await mockDb([ENTRANT]);
    jest.mocked(pushRefereeAlert).mockResolvedValue(null);
    jest.mocked(subscribedStaffCandidates).mockResolvedValue([{ userId: 5, isAdmin: false, rolesJson: '["ARBITRE"]' }]);
    jest.mocked(pushToUsers).mockResolvedValue(1);

    await expect(reportTournamentIssue(7, 42, VALID_MESSAGE, null)).resolves.toEqual({ notifiedReferees: 0 });
    const [userIds, topic, content] = jest.mocked(pushToUsers).mock.calls[0];
    expect(userIds).toEqual([5]);
    expect(topic).toBe("REFEREE_ALERT");
    // Le texte du joueur reste sur Discord.
    expect(content.body).not.toContain(VALID_MESSAGE);
  });

  it("accepte un signalement même si aucun arbitre n'a pu être joint", async () => {
    await mockDb([ENTRANT]);
    jest.mocked(pushRefereeAlert).mockResolvedValue({
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
