import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/database");
jest.mock("@/lib/server/bot-integration");
jest.mock("@/lib/server/push-subscriptions");

import { getDatabase } from "@/lib/server/database";
import { pushDiscordDirectMessages } from "@/lib/server/bot-integration";
import { pushToUsers, subscribedStaffCandidates } from "@/lib/server/push-subscriptions";
import {
  loadEntrantMatchLeaderIds,
  loadEntrantPlayerIds,
  loadNotificationRecipients,
  notifyStaff,
  notifyUsers,
  toNotificationRecipient,
} from "@/lib/server/notify";
import { fakePool, type SqlQuery } from "../../helpers/sql-double";

const PUSH = () => ({ title: "t", body: "b", url: "/" });
/** Message privé de test : sa langue se lit dans le texte. */
const DM = (locale: string) => `m-${locale}`;

/** Langue des comptes (`bg_users.locale`) telle que la base la rend. */
function accountLocales(rows: { id: number; locale: string }[]) {
  const query = jest.fn<SqlQuery>().mockResolvedValue([rows]);
  jest.mocked(getDatabase).mockResolvedValue(fakePool({ query }));
  return query;
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(pushToUsers).mockResolvedValue(2);
  jest.mocked(pushDiscordDirectMessages).mockResolvedValue({ sent: 1, unresolved: [], failed: [] });
  accountLocales([{ id: 1, locale: "fr" }]);
});

describe("notifyUsers", () => {
  it("envoie le message privé à qui Discord joint, et le push à tous", async () => {
    const report = await notifyUsers(
      [
        { userId: 1, discord: { discordId: "1", handle: null, label: "A" } },
        { userId: 2, discord: null },
      ],
      { topic: "TEAM_JOIN_REQUEST", push: PUSH, discord: { message: DM, context: "ctx" } },
    );

    expect(pushDiscordDirectMessages).toHaveBeenCalledWith("m-fr", [{ discordId: "1", handle: null, label: "A" }], "ctx");
    expect(pushToUsers).toHaveBeenCalledWith([1, 2], "TEAM_JOIN_REQUEST", PUSH, undefined);
    expect(report).toEqual({ discord: { sent: 1, unresolved: [], failed: [] }, discordUnreachedUserIds: [], pushed: 2 });
  });

  it("écrit à chacun dans la langue de son compte : un appel au bot par langue", async () => {
    const query = accountLocales([
      { id: 1, locale: "fr" },
      { id: 2, locale: "en" },
      { id: 3, locale: "en" },
    ]);
    jest
      .mocked(pushDiscordDirectMessages)
      .mockResolvedValueOnce({ sent: 1, unresolved: [], failed: [] })
      .mockResolvedValueOnce({ sent: 1, unresolved: ["C"], failed: [] });
    const a = { discordId: "1", handle: null, label: "A" };
    const b = { discordId: "2", handle: null, label: "B" };
    const c = { discordId: null, handle: "c", label: "C" };

    const report = await notifyUsers(
      [
        { userId: 1, discord: a },
        { userId: 2, discord: b },
        { userId: 3, discord: c },
      ],
      { topic: "MATCH_REMINDER", push: PUSH, discord: { message: DM, context: "match-reminder" } },
    );

    // La langue est lue pour les destinataires de l'envoi, et pour eux seuls.
    expect(query.mock.calls[0][0]).toMatch(/SELECT id, locale FROM bg_users/);
    expect(query.mock.calls[0][1]).toEqual([1, 2, 3]);
    expect(jest.mocked(pushDiscordDirectMessages).mock.calls).toEqual([
      ["m-fr", [a], "match-reminder"],
      ["m-en", [b, c], "match-reminder"],
    ]);
    expect(report.discord).toEqual({ sent: 2, unresolved: ["C"], failed: [] });
    expect(report.discordUnreachedUserIds).toEqual([]);
  });

  it("langue illisible ou compte absent : un seul message bilingue, français d'abord", async () => {
    jest.mocked(getDatabase).mockRejectedValue(new Error("ECONNREFUSED"));
    jest.spyOn(console, "error").mockImplementation(() => undefined);
    await notifyUsers([{ userId: 1, discord: { discordId: "1", handle: null, label: "A" } }], {
      topic: "MODERATION",
      push: PUSH,
      discord: { message: DM, context: "ctx" },
    });
    accountLocales([]);
    await notifyUsers([{ userId: 7, discord: { discordId: "7", handle: null, label: "G" } }], {
      topic: "MODERATION",
      push: PUSH,
      discord: { message: DM, context: "ctx" },
    });

    const bilingual = "m-fr\n\n**— English —**\nm-en";
    expect(jest.mocked(pushDiscordDirectMessages).mock.calls.map(([message]) => message)).toEqual([bilingual, bilingual]);
  });

  it("un appel perdu (une langue) nomme ses comptes, les autres restent remis", async () => {
    accountLocales([
      { id: 1, locale: "fr" },
      { id: 2, locale: "en" },
    ]);
    jest
      .mocked(pushDiscordDirectMessages)
      .mockResolvedValueOnce({ sent: 1, unresolved: [], failed: [] })
      .mockResolvedValueOnce(null);

    const report = await notifyUsers(
      [
        { userId: 1, discord: { discordId: "1", handle: null, label: "A" } },
        { userId: 2, discord: { discordId: "2", handle: null, label: "B" } },
      ],
      { topic: "PRIVACY_CHANGE", push: PUSH, discord: { message: DM, context: "ctx" } },
    );

    expect(report.discord).toEqual({ sent: 1, unresolved: [], failed: [] });
    expect(report.discordUnreachedUserIds).toEqual([2]);
  });

  it("bot perdu au premier appel : les autres langues ne sont pas tentées, leurs comptes rendus non joints", async () => {
    accountLocales([
      { id: 1, locale: "fr" },
      { id: 2, locale: "en" },
      { id: 3, locale: "fr" },
    ]);
    jest.mocked(pushDiscordDirectMessages).mockResolvedValueOnce(null);

    const report = await notifyUsers(
      [
        { userId: 1, discord: { discordId: "1", handle: null, label: "A" } },
        { userId: 2, discord: { discordId: "2", handle: null, label: "B" } },
        { userId: 3, discord: { discordId: "3", handle: null, label: "C" } },
      ],
      { topic: "MATCH_REMINDER", push: PUSH, discord: { message: DM, context: "ctx" } },
    );

    // Un seul appel vers un bot tombé, comme avant le découpage par langue :
    // le coupe-circuit ne s'ouvre pas sur une seule notification.
    expect(pushDiscordDirectMessages).toHaveBeenCalledTimes(1);
    expect(report.discord).toBeNull();
    expect(report.discordUnreachedUserIds).toEqual([1, 3, 2]);
  });

  it("les langues partent l'une après l'autre, jamais deux appels au bot en même temps", async () => {
    accountLocales([
      { id: 1, locale: "fr" },
      { id: 2, locale: "en" },
    ]);
    let inFlight = 0;
    let maxInFlight = 0;
    jest.mocked(pushDiscordDirectMessages).mockImplementation(async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await Promise.resolve();
      inFlight -= 1;
      return { sent: 1, unresolved: [], failed: [] };
    });

    const report = await notifyUsers(
      [
        { userId: 1, discord: { discordId: "1", handle: null, label: "A" } },
        { userId: 2, discord: { discordId: "2", handle: null, label: "B" } },
      ],
      { topic: "MATCH_REMINDER", push: PUSH, discord: { message: DM, context: "ctx" } },
    );

    expect(pushDiscordDirectMessages).toHaveBeenCalledTimes(2);
    expect(maxInFlight).toBe(1);
    expect(report.discord).toEqual({ sent: 2, unresolved: [], failed: [] });
  });

  it("n'appelle pas le bot quand personne n'est joignable sur Discord, ou sans message", async () => {
    await notifyUsers([{ userId: 2, discord: null }], {
      topic: "MODERATION",
      push: PUSH,
      discord: { message: DM, context: "ctx" },
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
      discord: { message: DM, context: "ctx" },
    });
    expect(report.discord).toBeNull();
    expect(report.discordUnreachedUserIds).toEqual([1]);
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

  it("prévient les arbitres d'un match programmé, sauf l'auteur du geste", async () => {
    jest.mocked(subscribedStaffCandidates).mockResolvedValue([
      { userId: 1, isAdmin: true, rolesJson: null },
      { userId: 2, isAdmin: false, rolesJson: JSON.stringify(["ARBITRE"]) },
      { userId: 3, isAdmin: false, rolesJson: JSON.stringify(["CASTER"]) },
      { userId: 5, isAdmin: false, rolesJson: JSON.stringify(["ARBITRE"]) },
    ]);
    await notifyStaff({ topic: "MATCH_SCHEDULED", push: PUSH, excludeUserIds: [2] });
    expect(pushToUsers).toHaveBeenCalledWith([1, 5], "MATCH_SCHEDULED", PUSH, undefined);
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
    expect(report).toEqual({ discord: { sent: 1, unresolved: [], failed: [] }, discordUnreachedUserIds: [], pushed: 0 });
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

  it("n'écrit jamais à un tag saisi, quelle que soit la portée", () => {
    expect(toNotificationRecipient(row, "proven")).toEqual({ userId: 5, discord: null });
    expect(toNotificationRecipient(row, "certified")).toEqual({ userId: 5, discord: null });
  });

  it("certified : un tag certifié seul ouvre le canal, avec l'identifiant du compte qui l'a certifié", () => {
    const certified = { ...row, discord_id: "1", discord_verified_at: "2026-09-01" } as typeof row;
    expect(toNotificationRecipient(certified, "certified")).toEqual({
      userId: 5,
      discord: { discordId: "1", handle: "nova", label: "Nova" },
    });
    // Identifiant rattaché sans tag certifié : pas de message de match (contre le spam).
    expect(toNotificationRecipient({ ...row, discord_id: "1" } as typeof row, "certified")).toEqual({
      userId: 5,
      discord: null,
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

describe("loadEntrantMatchLeaderIds", () => {
  it("ne garde que ceux qui mènent le match — capitaine, manager, propriétaire — et le joueur d'une entrée solo", async () => {
    const query = jest.fn<SqlQuery>().mockResolvedValue([
      [
        { team_id: 1, user_id: 10, roles_json: JSON.stringify(["OWNER", "TANK"]), solo: 0 },
        { team_id: 1, user_id: 11, roles_json: JSON.stringify(["COACH", "DPS"]), solo: 0 },
        { team_id: 1, user_id: 13, roles_json: JSON.stringify(["CAPITAINE", "HEAL"]), solo: 0 },
        { team_id: 1, user_id: 12, roles_json: JSON.stringify(["MANAGER"]), solo: 0 },
        { team_id: 2, user_id: 20, roles_json: null, solo: 1 },
      ],
    ]);
    jest.mocked(getDatabase).mockResolvedValue(fakePool({ query }));

    const byTeam = await loadEntrantMatchLeaderIds([1, 2, 1]);

    expect(byTeam.get(1)).toEqual([10, 13, 12]);
    expect(byTeam.get(2)).toEqual([20]);
    expect(query.mock.calls[0][0]).toMatch(/left_at IS NULL/);
    expect(query.mock.calls[0][0]).toMatch(/solo_user_id IS NOT NULL/);
    expect(query.mock.calls[0][1]).toEqual([1, 2, 1, 2]);
    expect((await loadEntrantMatchLeaderIds([])).size).toBe(0);
  });
});
