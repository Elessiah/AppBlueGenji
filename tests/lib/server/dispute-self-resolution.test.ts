import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/database");
jest.mock("@/lib/server/notify");
jest.mock("@/lib/server/staff-audit");

import { getDatabase } from "@/lib/server/database";
import { loadEntrantPlayerIds, notifyStaff } from "@/lib/server/notify";
import { publishStaffAction } from "@/lib/server/staff-audit";
import {
  alertSelfResolvedDispute,
  resolvedOutcome,
  selfResolvedDisputeLog,
} from "@/lib/server/tournaments/dispute-self-resolution";
import { selfResolvedDisputePush, type SelfResolvedDispute } from "@/lib/shared/push-messages";
import { fakePool, type SqlQuery } from "../../helpers/sql-double";

/**
 * Arbitre qui tranche le litige d'une manche qu'il joue
 * (`docs/features/SCORE_DISPUTE_LOCK.md` § Arbitre qui joue) : les **autres**
 * membres du staff sont avertis, le geste est journalisé (anonyme sur Discord,
 * nommé dans pm2).
 */

const dispute = { matchId: 70, tournamentId: 8, team1Id: 3, team2Id: 4 };
const actor = { id: 9, pseudo: "Sifflet" };

let execute: jest.Mock<SqlQuery>;

function matchRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    tournament_name: "Coupe d'hiver",
    swiss_round: 0,
    participant_type: "TEAM",
    bracket: "UPPER",
    round_number: 2,
    team1_score: 2,
    team2_score: 1,
    forfeit_team_id: null,
    double_forfeit: 0,
    team1_name: "Alpha",
    team2_name: "Bravo",
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  execute = jest.fn<SqlQuery>().mockResolvedValue([[matchRow()], undefined]);
  jest.mocked(getDatabase).mockResolvedValue(fakePool({ execute }));
  jest.mocked(notifyStaff).mockResolvedValue({ discord: null, pushed: 2 });
  // L'arbitre 9 joue dans l'équipe 3.
  jest.mocked(loadEntrantPlayerIds).mockResolvedValue(new Map([[3, [9, 10]], [4, [11]]]));
});

describe("alertSelfResolvedDispute", () => {
  it("avertit les autres membres du staff, jamais l'auteur", async () => {
    await expect(alertSelfResolvedDispute(dispute, actor)).resolves.toBe(true);

    expect(loadEntrantPlayerIds).toHaveBeenCalledWith([3, 4]);
    expect(notifyStaff).toHaveBeenCalledTimes(1);
    const [notification] = jest.mocked(notifyStaff).mock.calls[0];
    expect(notification.topic).toBe("REFEREE_SELF_RESOLUTION");
    expect(notification.excludeUserIds).toEqual([9]);
    // Pas de second envoi Discord : le journal (`publishStaffAction`) suffit.
    expect(notification.discord).toBeUndefined();
    const push = notification.push("fr");
    expect(push.body).toBe(
      "Un membre du staff qui joue ce match a tranché son litige · Coupe d'hiver, Manche 2 : Alpha 2 – 1 Bravo.",
    );
    expect(push.body).not.toContain("Sifflet");
    expect(notification.push("en").body).toBe(
      "A staff member who plays in this match settled its dispute · Coupe d'hiver, Round 2: Alpha 2 – 1 Bravo.",
    );
  });

  it("journalise le geste : anonyme sur Discord, auteur transmis pour pm2", async () => {
    await alertSelfResolvedDispute(dispute, actor);

    expect(publishStaffAction).toHaveBeenCalledTimes(1);
    const [line, author] = jest.mocked(publishStaffAction).mock.calls[0];
    expect(line).toBe(
      "⚠️ Litige tranché par un membre du staff qui joue ce match · « Coupe d'hiver », Manche 2 : Alpha 2 – 1 Bravo.",
    );
    expect(line).not.toContain("Sifflet");
    expect(author).toEqual(actor);
  });

  it("phase suisse d'un MULTI : « Ronde N », comme la page et les autres alertes (FR + EN)", async () => {
    execute.mockResolvedValue([[matchRow({ swiss_round: 1, round_number: 3 })], undefined]);

    await alertSelfResolvedDispute(dispute, actor);

    // La ronde se lit par `swissRoundSql` (tournoi SWISS ou phase suisse), pas par le seul format.
    expect(String(execute.mock.calls[0][0])).toContain("AS swiss_round");
    const [line] = jest.mocked(publishStaffAction).mock.calls[0];
    expect(line).toContain("Ronde 3");
    const [notification] = jest.mocked(notifyStaff).mock.calls[0];
    expect(notification.push("fr").body).toContain("Ronde 3");
    // L'anglais dit « Round » dans les deux cas (`round.swiss` = `round.default`).
    expect(notification.push("en").body).toContain("Coupe d'hiver, Round 3:");
  });

  it("reconnaît le joueur d'une entrée solo", async () => {
    jest.mocked(loadEntrantPlayerIds).mockResolvedValue(new Map([[3, [12]], [4, [9]]]));

    await expect(alertSelfResolvedDispute(dispute, actor)).resolves.toBe(true);
    expect(notifyStaff).toHaveBeenCalledTimes(1);
  });

  it("ne dit rien quand l'arbitre ne joue pas la manche", async () => {
    jest.mocked(loadEntrantPlayerIds).mockResolvedValue(new Map([[3, [10]], [4, [11]]]));

    await expect(alertSelfResolvedDispute(dispute, actor)).resolves.toBe(false);
    expect(notifyStaff).not.toHaveBeenCalled();
    expect(publishStaffAction).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
  });

  it("ne nomme aucun engagé en tournoi individuel (ce serait un pseudo)", async () => {
    execute.mockResolvedValue([[matchRow({ participant_type: "SOLO", team1_name: "Joueur1", team2_name: "Joueur2" })], undefined]);

    await alertSelfResolvedDispute(dispute, actor);

    const [line] = jest.mocked(publishStaffAction).mock.calls[0];
    expect(line).not.toMatch(/Joueur1|Joueur2/);
    expect(line).toContain(": 2 – 1.");
    const [notification] = jest.mocked(notifyStaff).mock.calls[0];
    expect(notification.push("fr").body).not.toMatch(/Joueur1|Joueur2/);
    expect(notification.push("en").body).not.toMatch(/Joueur1|Joueur2/);
  });

  it("ne lève jamais : l'arbitrage est acquis, une alerte perdue ne le défait pas", async () => {
    jest.mocked(loadEntrantPlayerIds).mockRejectedValue(new Error("ECONNRESET"));

    await expect(alertSelfResolvedDispute(dispute, actor)).resolves.toBe(false);
    expect(notifyStaff).not.toHaveBeenCalled();
  });

  it("se tait si la manche a disparu entre-temps", async () => {
    execute.mockResolvedValue([[], undefined]);

    await expect(alertSelfResolvedDispute(dispute, actor)).resolves.toBe(false);
    expect(publishStaffAction).not.toHaveBeenCalled();
  });
});

describe("issue décrite", () => {
  const base = { team1_score: null, team2_score: null, forfeit_team_id: null, double_forfeit: 0 };

  it("score, forfait nominatif et double forfait", () => {
    expect(resolvedOutcome({ ...base, team1_score: 3, team2_score: 0 }, 3)).toEqual({
      kind: "score",
      team1Score: 3,
      team2Score: 0,
    });
    expect(resolvedOutcome({ ...base, forfeit_team_id: 4 }, 3)).toEqual({ kind: "forfeit", forfeitSide: 2 });
    expect(resolvedOutcome({ ...base, forfeit_team_id: 3 }, 3)).toEqual({ kind: "forfeit", forfeitSide: 1 });
    expect(resolvedOutcome({ ...base, double_forfeit: 1, forfeit_team_id: 3 }, 3)).toEqual({ kind: "doubleForfeit" });
  });

  const input = (outcome: SelfResolvedDispute["outcome"], solo = false): SelfResolvedDispute => ({
    tournamentId: 8,
    tournamentName: "Coupe",
    matchId: 70,
    bracket: "UPPER",
    roundNumber: 1,
    team1Name: "Alpha",
    team2Name: "Bravo",
    solo,
    outcome,
  });

  it("FR et EN, forfaits compris", () => {
    expect(selfResolvedDisputePush(input({ kind: "forfeit", forfeitSide: 2 }), "fr").body).toContain(": forfait de Bravo.");
    expect(selfResolvedDisputePush(input({ kind: "forfeit", forfeitSide: 2 }), "en").body).toContain(": forfeit by Bravo.");
    expect(selfResolvedDisputePush(input({ kind: "doubleForfeit" }), "fr").body).toContain(": double forfait.");
    expect(selfResolvedDisputePush(input({ kind: "doubleForfeit" }), "en").body).toContain(": double forfeit.");
    expect(selfResolvedDisputePush(input({ kind: "forfeit", forfeitSide: 1 }, true), "fr").body).toContain(
      ": forfait d'un joueur.",
    );
    expect(selfResolvedDisputePush(input({ kind: "forfeit", forfeitSide: 1 }, true), "en").body).toContain(
      ": forfeit by a player.",
    );
  });

  it("titre, lien vers la manche, étiquette par match", () => {
    const fr = selfResolvedDisputePush(input({ kind: "doubleForfeit" }), "fr");
    const en = selfResolvedDisputePush(input({ kind: "doubleForfeit" }), "en");
    expect(fr.title).toBe("Litige tranché par un joueur du match");
    expect(en.title).toBe("Dispute settled by a player of the match");
    expect(fr.url).toContain("/tournois/8");
    expect(en.url).toMatch(/^\/en\/tournois\/8/);
    expect(fr.tag).toBe("self-resolved-70");
  });

  it("neutralise un nom d'équipe dans le journal Discord", () => {
    const line = selfResolvedDisputeLog({ ...input({ kind: "score", team1Score: 2, team2Score: 0 }), team1Name: "**@everyone**" });
    expect(line).not.toContain("**@everyone**");
  });
});
