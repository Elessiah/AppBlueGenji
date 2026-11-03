import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/database");
jest.mock("@/lib/server/bot-integration");
jest.mock("@/lib/server/push-subscriptions");
jest.mock("@/lib/server/site-url", () => ({ siteCanonicalBase: () => "https://site.test" }));

import { getDatabase } from "@/lib/server/database";
import { pushDiscordDirectMessages } from "@/lib/server/bot-integration";
import { pushToUsers } from "@/lib/server/push-subscriptions";
import { notifyTeamInvite, notifyTeamInviteInBackground } from "@/lib/server/team-invite-notifications";
import { fakePool, type SqlQuery } from "../../helpers/sql-double";
import { resolvePush } from "../../helpers/push";

/** TEAM-INVITE-NOTIFY : lecture et envoi de l'avis au joueur visé. */

const TEAM_ID = 7;
const PLAYER_ID = 42;
const ACTOR_ID = 1;

type Scenario = {
  thisPlayer?: number;
  team?: Record<string, unknown> | null;
  account?: Record<string, unknown> | null;
  locale?: string;
};

function teamRow(overrides: Record<string, unknown> = {}) {
  return { name: "Les Glaciers", is_ghost: 0, solo_user_id: null, deleted_at: null, ...overrides };
}

function accountRow(overrides: Record<string, unknown> = {}) {
  return {
    id: PLAYER_ID,
    pseudo: "NovaSecretPseudo",
    is_deleted: 0,
    suspended: 0,
    discord_id: "100000000000000042",
    discord_pseudo: "nova",
    discord_verified_at: "2026-09-01 10:00:00",
    ...overrides,
  };
}

function mockDb({ thisPlayer = 1, team = teamRow(), account = accountRow(), locale = "fr" }: Scenario = {}) {
  const execute = jest.fn<SqlQuery>(async (sql) => {
    if (sql.includes("AS any_player")) return [[{ this_player: String(thisPlayer), any_player: 1 }], []];
    if (sql.includes("FROM bg_teams")) return [team === null ? [] : [team], []];
    if (sql.includes("FROM bg_users u")) return [account === null ? [] : [account], []];
    throw new Error(`requête inattendue : ${sql}`);
  });
  const query = jest.fn<SqlQuery>(async () => [[{ id: PLAYER_ID, locale }], []]);
  jest.mocked(getDatabase).mockResolvedValue(fakePool({ execute, query }));
  return execute;
}

describe("notifyTeamInvite", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(pushDiscordDirectMessages).mockResolvedValue({ sent: 1, unresolved: [], failed: [] });
    jest.mocked(pushToUsers).mockResolvedValue(1);
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("notifyTeamInvite_invite_sendsPushAndDmWithoutPseudo", async () => {
    mockDb();

    await notifyTeamInvite("INVITE", TEAM_ID, PLAYER_ID, ACTOR_ID);

    const [message, recipients, context] = jest.mocked(pushDiscordDirectMessages).mock.calls[0];
    expect(message).toContain("« Les Glaciers »");
    expect(message).toContain("https://site.test/profil#invitations");
    expect(message).not.toContain("NovaSecretPseudo");
    expect(message).not.toContain("#42");
    expect(recipients).toEqual([{ discordId: "100000000000000042", handle: "nova", label: "NovaSecretPseudo" }]);
    expect(context).toBe("team-invitation");
    const [userIds, topic, content] = jest.mocked(pushToUsers).mock.calls[0];
    expect(userIds).toEqual([PLAYER_ID]);
    expect(topic).toBe("TEAM_INVITATION");
    expect(resolvePush(content).url).toBe("/profil#invitations");
  });

  it("notifyTeamInvite_englishAccount_dmInEnglishWithEnglishLink", async () => {
    mockDb({ locale: "en" });

    await notifyTeamInvite("OWNERSHIP", TEAM_ID, PLAYER_ID, ACTOR_ID);

    const [message] = jest.mocked(pushDiscordDirectMessages).mock.calls[0];
    expect(message).toContain("Ownership of your team “Les Glaciers”");
    expect(message).toContain("https://site.test/en/equipes/7");
  });

  it("notifyTeamInvite_reinviteWithinCooldown_sendsNothing", async () => {
    mockDb({ thisPlayer: 2 });

    await notifyTeamInvite("INVITE", TEAM_ID, PLAYER_ID, ACTOR_ID);

    expect(pushDiscordDirectMessages).not.toHaveBeenCalled();
    expect(pushToUsers).not.toHaveBeenCalled();
  });

  it("notifyTeamInvite_invite_budgetIgnoresGhostTakeoverRows", async () => {
    const execute = mockDb();

    await notifyTeamInvite("INVITE", TEAM_ID, PLAYER_ID, ACTOR_ID);

    const budgetSql = execute.mock.calls.map(([sql]) => sql).find((sql) => sql.includes("AS any_player"));
    expect(budgetSql).toContain(`NOT LIKE '%"OWNER"%'`);
  });

  it("notifyTeamInvite_ghostClaim_skipsBudgetQuery", async () => {
    const execute = mockDb({ thisPlayer: 5, team: teamRow({ is_ghost: 1 }) });

    await notifyTeamInvite("GHOST_CLAIM", TEAM_ID, PLAYER_ID, ACTOR_ID);

    expect(execute.mock.calls.some(([sql]) => sql.includes("AS any_player"))).toBe(false);
    expect(pushDiscordDirectMessages).toHaveBeenCalledTimes(1);
    expect(pushToUsers).toHaveBeenCalledTimes(1);
  });

  it("notifyTeamInvite_suspendedAccount_sendsNothing", async () => {
    const execute = mockDb({ account: accountRow({ suspended: 1 }) });

    await notifyTeamInvite("INVITE", TEAM_ID, PLAYER_ID, ACTOR_ID);

    const accountSql = execute.mock.calls.map(([sql]) => sql).find((sql) => sql.includes("FROM bg_users u"));
    expect(accountSql).toContain("bg_account_suspensions");
    expect(pushDiscordDirectMessages).not.toHaveBeenCalled();
    expect(pushToUsers).not.toHaveBeenCalled();
  });

  it("notifyTeamInvite_teamMissing_sendsNothing", async () => {
    mockDb({ team: null });

    await notifyTeamInvite("INVITE", TEAM_ID, PLAYER_ID, ACTOR_ID);

    expect(pushToUsers).not.toHaveBeenCalled();
  });

  it("notifyTeamInvite_accountMissing_sendsNothing", async () => {
    mockDb({ account: null });

    await notifyTeamInvite("OWNERSHIP", TEAM_ID, PLAYER_ID, ACTOR_ID);

    expect(pushToUsers).not.toHaveBeenCalled();
  });

  it("notifyTeamInvite_noProvenDiscord_pushOnly", async () => {
    mockDb({ account: accountRow({ discord_id: null, discord_verified_at: null }) });

    await notifyTeamInvite("INVITE", TEAM_ID, PLAYER_ID, ACTOR_ID);

    expect(pushDiscordDirectMessages).not.toHaveBeenCalled();
    expect(pushToUsers).toHaveBeenCalledTimes(1);
  });

  it("notifyTeamInvite_botDown_logsWithoutPlayerDataAndStillPushes", async () => {
    mockDb();
    jest.mocked(pushDiscordDirectMessages).mockResolvedValue(null);
    const warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);

    await notifyTeamInvite("INVITE", TEAM_ID, PLAYER_ID, ACTOR_ID);

    expect(warn).toHaveBeenCalledTimes(1);
    const line = warn.mock.calls[0].join(" ");
    expect(line).not.toContain("NovaSecretPseudo");
    expect(line).not.toContain(String(PLAYER_ID));
    expect(line).not.toContain("100000000000000042");
    expect(pushToUsers).toHaveBeenCalledTimes(1);
  });
});

describe("notifyTeamInviteInBackground", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("notifyTeamInviteInBackground_dbFails_logsAndDoesNotThrow", async () => {
    jest.mocked(getDatabase).mockRejectedValue(new Error("DB_DOWN"));
    const error = jest.spyOn(console, "error").mockImplementation(() => undefined);

    expect(() => notifyTeamInviteInBackground("INVITE", TEAM_ID, PLAYER_ID, ACTOR_ID)).not.toThrow();
    await new Promise((resolve) => setImmediate(resolve));

    expect(error).toHaveBeenCalledTimes(1);
    expect(error.mock.calls[0][0]).toBe("[teams] joueur non prévenu (INVITE)");
  });
});
