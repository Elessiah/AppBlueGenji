import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/database");
jest.mock("@/lib/server/bot-integration");
jest.mock("@/lib/server/push-subscriptions");

import { getDatabase } from "@/lib/server/database";
import { loadNotificationRecipients } from "@/lib/server/notify";
import { matchDmEnabled, recordMatchDmPreference } from "@/lib/server/users/match-dm-preference";
import { fakePool, type SqlQuery } from "../../helpers/sql-double";

/** Messages privés de match : le droit d'opposition du joueur (`bg_users.match_dm_enabled`). */

beforeEach(() => {
  jest.clearAllMocks();
});

describe("matchDmEnabled", () => {
  it("lit 0 comme coupé, tout le reste comme activé", () => {
    expect(matchDmEnabled(0)).toBe(false);
    expect(matchDmEnabled("0")).toBe(false);
    expect(matchDmEnabled(1)).toBe(true);
    // Base qui n'a pas encore joué l'ALTER : le comportement d'avant.
    expect(matchDmEnabled(undefined)).toBe(true);
    expect(matchDmEnabled(null)).toBe(true);
  });
});

describe("recordMatchDmPreference", () => {
  function mockExecute(affectedRows: number) {
    const execute = jest.fn<SqlQuery>().mockResolvedValue([{ affectedRows }, []]);
    jest.mocked(getDatabase).mockResolvedValue(fakePool({ execute }));
    return execute;
  }

  it("écrit le choix en une instruction, sur un compte vivant seulement", async () => {
    const execute = mockExecute(1);
    expect(await recordMatchDmPreference(7, false)).toBe(true);
    const [sql, params] = execute.mock.calls[0];
    expect(sql).toMatch(/UPDATE bg_users SET match_dm_enabled = \? WHERE id = \? AND is_deleted = 0/);
    expect(params).toEqual([0, 7]);
    await recordMatchDmPreference(7, true);
    expect(execute.mock.calls[1][1]).toEqual([1, 7]);
  });

  it("rend false quand aucune ligne vivante ne correspond", async () => {
    mockExecute(0);
    expect(await recordMatchDmPreference(7, true)).toBe(false);
  });

  it("n'écrit rien pour un identifiant ou une valeur invalides", async () => {
    const execute = mockExecute(1);
    expect(await recordMatchDmPreference(0, true)).toBe(false);
    expect(await recordMatchDmPreference(1.5, true)).toBe(false);
    expect(await recordMatchDmPreference(7, "false" as unknown as boolean)).toBe(false);
    expect(execute).not.toHaveBeenCalled();
  });
});

describe("loadNotificationRecipients — option matchDm", () => {
  const ROWS = [
    { id: 1, pseudo: "Kiro", discord_id: "555", discord_pseudo: "kiro", discord_verified_at: null, match_dm_enabled: 1 },
    { id: 2, pseudo: "Ayla", discord_id: null, discord_pseudo: "ayla", discord_verified_at: null, match_dm_enabled: 0 },
  ];

  function mockQuery() {
    const query = jest.fn<SqlQuery>().mockResolvedValue([ROWS, []]);
    jest.mocked(getDatabase).mockResolvedValue(fakePool({ query }));
    return query;
  }

  it("retire le canal Discord d'un joueur opposé, sans le retirer des destinataires", async () => {
    const query = mockQuery();
    const recipients = await loadNotificationRecipients([1, 2], "declared", { matchDm: true });
    expect(String(query.mock.calls[0][0])).toMatch(/match_dm_enabled/);
    expect(recipients).toEqual([
      { userId: 1, discord: { discordId: "555", handle: "kiro", label: "Kiro" } },
      { userId: 2, discord: null },
    ]);
  });

  it("n'en tient pas compte hors messages de match (modération, données, staff)", async () => {
    mockQuery();
    const recipients = await loadNotificationRecipients([1, 2], "declared");
    expect(recipients[1]).toEqual({ userId: 2, discord: { discordId: null, handle: "ayla", label: "Ayla" } });
  });
});
