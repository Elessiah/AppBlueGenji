import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/database");
jest.mock("@/lib/server/bot-integration");
jest.mock("@/lib/server/push-subscriptions");
jest.mock("@/lib/server/site-url", () => ({ siteCanonicalBase: () => "https://site.test" }));

import { getDatabase } from "@/lib/server/database";
import { pushDiscordDirectMessages } from "@/lib/server/bot-integration";
import { pushToUsers } from "@/lib/server/push-subscriptions";
import { notifyTeamJoinRequest } from "@/lib/server/team-join-notifications";
import { fakePool, type SqlQuery } from "../../helpers/sql-double";

type Rows = { requests?: number; team?: { name: string } | null; members?: Record<string, unknown>[] };

function mockDb({ requests = 1, team = { name: "Les Glaciers" }, members = [] }: Rows) {
  const execute = jest.fn<SqlQuery>(async (sql) => {
    if (sql.includes("COUNT(*)")) return [[{ n: requests }], []];
    if (sql.includes("FROM bg_teams")) return [team === null ? [] : [team], []];
    if (sql.includes("FROM bg_team_members")) return [members, []];
    throw new Error(`requête inattendue : ${sql}`);
  });
  jest.mocked(getDatabase).mockResolvedValue(fakePool({ execute }));
  return execute;
}

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    pseudo: "Owner",
    roles_json: JSON.stringify(["OWNER"]),
    discord_id: "100000000000000001",
    discord_pseudo: "owner",
    discord_verified_at: "2026-09-01 10:00:00",
    ...overrides,
  };
}

describe("notifyTeamJoinRequest", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(pushDiscordDirectMessages).mockResolvedValue({ sent: 1, unresolved: [], failed: [] });
    jest.mocked(pushToUsers).mockResolvedValue(0);
  });

  it("écrit au propriétaire et aux managers, avec le lien de la fiche", async () => {
    mockDb({
      members: [
        row(),
        row({ pseudo: "Manager", roles_json: ["MANAGER", "COACH"], discord_id: "2" }),
        row({ pseudo: "Joueur", roles_json: ["DPS"], discord_id: "3" }),
      ],
    });

    await notifyTeamJoinRequest(5, 42);

    expect(pushDiscordDirectMessages).toHaveBeenCalledTimes(1);
    const [message, recipients, context] = jest.mocked(pushDiscordDirectMessages).mock.calls[0];
    expect(message).toContain("« Les Glaciers »");
    expect(message).toContain("https://site.test/equipes/5");
    expect(recipients.map((r) => r.label)).toEqual(["Owner", "Manager"]);
    expect(context).toBe("team-join-request");
  });

  it("se tait sur une demande redéposée dans la fenêtre", async () => {
    const execute = mockDb({ requests: 2, members: [row()] });

    await notifyTeamJoinRequest(5, 42);

    expect(pushDiscordDirectMessages).not.toHaveBeenCalled();
    // La borne est posée avant toute autre lecture.
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("n'écrit pas sur Discord à une gestion sans moyen prouvé, mais la prévient en push", async () => {
    mockDb({ members: [row({ id: 9, discord_id: null, discord_verified_at: null })] });
    await notifyTeamJoinRequest(5, 42);
    expect(pushDiscordDirectMessages).not.toHaveBeenCalled();
    const [userIds, topic, content] = jest.mocked(pushToUsers).mock.calls[0];
    expect(userIds).toEqual([9]);
    expect(topic).toBe("TEAM_JOIN_REQUEST");
    expect(content.url).toBe("/equipes/5");
    // Aucun pseudo de joueur dans la notification.
    expect(content.body).not.toContain("Owner");
  });

  it("ne prévient personne quand l'équipe n'a aucune gestion", async () => {
    mockDb({ members: [row({ roles_json: ["DPS"] })] });
    await notifyTeamJoinRequest(5, 42);
    expect(pushDiscordDirectMessages).not.toHaveBeenCalled();
    expect(pushToUsers).not.toHaveBeenCalled();
  });

  it("ne fait rien pour une équipe dissoute entre-temps", async () => {
    mockDb({ team: null, members: [row()] });
    await notifyTeamJoinRequest(5, 42);
    expect(pushDiscordDirectMessages).not.toHaveBeenCalled();
  });

  it("compte les demandes du joueur à cette équipe, et ne lit que la gestion vivante", async () => {
    const execute = mockDb({ members: [row()] });

    await notifyTeamJoinRequest(5, 42);

    const count = execute.mock.calls.find(([sql]) => sql.includes("COUNT(*)"))!;
    expect(count[0]).toMatch(/kind = 'REQUEST'/);
    expect(count[0]).toMatch(/INTERVAL 24 HOUR/);
    expect(count[1]).toEqual([5, 42]);
    const members = execute.mock.calls.find(([sql]) => sql.includes("FROM bg_team_members"))!;
    expect(members[0]).toMatch(/left_at IS NULL/);
    expect(members[0]).toMatch(/is_deleted = 0/);
  });
});
