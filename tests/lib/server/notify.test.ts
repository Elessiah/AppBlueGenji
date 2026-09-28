import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/database");
jest.mock("@/lib/server/bot-integration");
jest.mock("@/lib/server/push-subscriptions");

import { getDatabase } from "@/lib/server/database";
import { pushDiscordDirectMessages } from "@/lib/server/bot-integration";
import { pushToUsers, subscribedStaffCandidates } from "@/lib/server/push-subscriptions";
import {
  loadEntrantManagerIds,
  loadEntrantPlayerIds,
  loadNotificationRecipients,
  notifyStaff,
  notifyUsers,
  toNotificationRecipient,
} from "@/lib/server/notify";
import { fakePool, type SqlQuery } from "../../helpers/sql-double";

const PUSH = { title: "t", body: "b", url: "/" };

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(pushToUsers).mockResolvedValue(2);
  jest.mocked(pushDiscordDirectMessages).mockResolvedValue({ sent: 1, unresolved: [], failed: [] });
});

describe("notifyUsers", () => {
  it("envoie le message privé à qui Discord joint, et le push à tous", async () => {
    const report = await notifyUsers(
      [
        { userId: 1, discord: { discordId: "1", handle: null, label: "A" } },
        { userId: 2, discord: null },
      ],
      { topic: "TEAM_JOIN_REQUEST", push: PUSH, discord: { message: "m", context: "ctx" } },
    );

    expect(pushDiscordDirectMessages).toHaveBeenCalledWith("m", [{ discordId: "1", handle: null, label: "A" }], "ctx");
    expect(pushToUsers).toHaveBeenCalledWith([1, 2], "TEAM_JOIN_REQUEST", PUSH, undefined);
    expect(report).toEqual({ discord: { sent: 1, unresolved: [], failed: [] }, pushed: 2 });
  });

  it("n'appelle pas le bot quand personne n'est joignable sur Discord, ou sans message", async () => {
    await notifyUsers([{ userId: 2, discord: null }], {
      topic: "MODERATION",
      push: PUSH,
      discord: { message: "m", context: "ctx" },
    });
    await notifyUsers([{ userId: 2, discord: { discordId: "9", handle: null, label: "X" } }], {
      topic: "MATCH_START",
      push: PUSH,
      pushOptions: { urgency: "high" },
    });

    expect(pushDiscordDirectMessages).not.toHaveBeenCalled();
    expect(jest.mocked(pushToUsers).mock.calls[1][3]).toEqual({ urgency: "high" });
  });

  it("remonte un bot injoignable", async () => {
    jest.mocked(pushDiscordDirectMessages).mockResolvedValue(null);
    const report = await notifyUsers([{ userId: 1, discord: { discordId: "1", handle: null, label: "A" } }], {
      topic: "PRIVACY_CHANGE",
      push: PUSH,
      discord: { message: "m", context: "ctx" },
    });
    expect(report.discord).toBeNull();
    expect(report.pushed).toBe(2);
  });
});

describe("notifyStaff", () => {
  it("pousse aux seuls comptes qui détiennent la permission du sujet", async () => {
    jest.mocked(subscribedStaffCandidates).mockResolvedValue([
      { userId: 1, isAdmin: true, rolesJson: null },
      { userId: 2, isAdmin: false, rolesJson: JSON.stringify(["ARBITRE"]) },
      { userId: 3, isAdmin: false, rolesJson: JSON.stringify(["CASTER"]) },
      { userId: 4, isAdmin: false, rolesJson: "illisible" },
    ]);
    const discord = jest.fn(async () => ({ sent: 3, unresolved: [], failed: [] }));

    const report = await notifyStaff({ topic: "REFEREE_ALERT", push: PUSH, discord });

    expect(discord).toHaveBeenCalledTimes(1);
    expect(pushToUsers).toHaveBeenCalledWith([1, 2], "REFEREE_ALERT", PUSH, undefined);
    expect(report.discord).toEqual({ sent: 3, unresolved: [], failed: [] });
  });

  it("ne donne la modération qu'aux administrateurs", async () => {
    jest.mocked(subscribedStaffCandidates).mockResolvedValue([
      { userId: 1, isAdmin: true, rolesJson: null },
      { userId: 2, isAdmin: false, rolesJson: JSON.stringify(["ARBITRE", "COMMUNITY_MANAGER"]) },
    ]);
    await notifyStaff({ topic: "STAFF_REPORT", push: PUSH });
    expect(pushToUsers).toHaveBeenCalledWith([1], "STAFF_REPORT", PUSH, undefined);
  });

  it("ne vise aucun staff pour un sujet destiné à tous les joueurs", async () => {
    await notifyStaff({ topic: "MATCH_START", push: PUSH });
    expect(subscribedStaffCandidates).not.toHaveBeenCalled();
  });

  it("garde le bilan Discord même si le push échoue", async () => {
    jest.mocked(subscribedStaffCandidates).mockRejectedValue(new Error("panne"));
    const report = await notifyStaff({
      topic: "REFEREE_ALERT",
      push: PUSH,
      discord: async () => ({ sent: 1, unresolved: [], failed: [] }),
    });
    expect(report).toEqual({ discord: { sent: 1, unresolved: [], failed: [] }, pushed: 0 });
  });
});

describe("destinataires", () => {
  const row = {
    id: 5,
    pseudo: "Nova",
    discord_id: null,
    discord_pseudo: "nova",
    discord_verified_at: null,
  } as unknown as Parameters<typeof toNotificationRecipient>[0];

  it("n'écrit à un tag saisi que pour un message qui n'engage rien (declared)", () => {
    expect(toNotificationRecipient(row, "proven")).toEqual({ userId: 5, discord: null });
    expect(toNotificationRecipient(row, "declared")).toEqual({
      userId: 5,
      discord: { discordId: null, handle: "nova", label: "Nova" },
    });
  });

  it("prend le tag certifié et l'identifiant comme preuves", () => {
    expect(toNotificationRecipient({ ...row, discord_verified_at: "2026-09-01" } as typeof row, "proven").discord?.handle).toBe(
      "nova",
    );
    expect(toNotificationRecipient({ ...row, discord_id: "1" } as typeof row, "proven").discord).toEqual({
      discordId: "1",
      handle: null,
      label: "Nova",
    });
  });

  it("lit les comptes vivants, sans doublon", async () => {
    const query = jest.fn<SqlQuery>().mockResolvedValue([[row]]);
    jest.mocked(getDatabase).mockResolvedValue(fakePool({ query }));

    expect(await loadNotificationRecipients([], "proven")).toEqual([]);
    await loadNotificationRecipients([5, 5, 6], "proven");

    expect(query.mock.calls[0][0]).toMatch(/is_deleted = 0/);
    expect(query.mock.calls[0][1]).toEqual([5, 6]);
  });

  it("réunit membres actuels et joueur d'une entrée solo, par engagée", async () => {
    const query = jest.fn<SqlQuery>().mockResolvedValue([
      [
        { team_id: 1, user_id: 10 },
        { team_id: 1, user_id: 11 },
        { team_id: 2, user_id: 20 },
      ],
    ]);
    jest.mocked(getDatabase).mockResolvedValue(fakePool({ query }));

    const byTeam = await loadEntrantPlayerIds([1, 2, 1]);

    expect(byTeam.get(1)).toEqual([10, 11]);
    expect(byTeam.get(2)).toEqual([20]);
    expect(query.mock.calls[0][0]).toMatch(/left_at IS NULL/);
    expect(query.mock.calls[0][0]).toMatch(/solo_user_id IS NOT NULL/);
    expect(query.mock.calls[0][1]).toEqual([1, 2, 1, 2]);
    expect((await loadEntrantPlayerIds([])).size).toBe(0);
  });
});

describe("loadEntrantManagerIds", () => {
  it("ne garde que OWNER et MANAGER d'une équipe, et le joueur d'une entrée solo", async () => {
    const query = jest.fn<SqlQuery>().mockResolvedValue([
      [
        { team_id: 1, user_id: 10, roles_json: JSON.stringify(["OWNER", "TANK"]), solo: 0 },
        { team_id: 1, user_id: 11, roles_json: JSON.stringify(["CAPITAINE", "DPS"]), solo: 0 },
        { team_id: 1, user_id: 12, roles_json: JSON.stringify(["MANAGER"]), solo: 0 },
        { team_id: 2, user_id: 20, roles_json: null, solo: 1 },
      ],
    ]);
    jest.mocked(getDatabase).mockResolvedValue(fakePool({ query }));

    const byTeam = await loadEntrantManagerIds([1, 2, 1]);

    expect(byTeam.get(1)).toEqual([10, 12]);
    expect(byTeam.get(2)).toEqual([20]);
    expect(query.mock.calls[0][0]).toMatch(/left_at IS NULL/);
    expect(query.mock.calls[0][0]).toMatch(/solo_user_id IS NOT NULL/);
    expect(query.mock.calls[0][1]).toEqual([1, 2, 1, 2]);
    expect((await loadEntrantManagerIds([])).size).toBe(0);
  });
});
