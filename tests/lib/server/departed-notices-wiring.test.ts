import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/database");
jest.mock("@/lib/server/bot-integration");
jest.mock("@/lib/server/tournaments/departed-notices");
jest.mock("@/lib/server/tournaments/reminder-marks");

import { discardBotLogs, flushBotLogs } from "@/lib/server/tournaments/bot-logs";
import {
  discardDepartedNotices,
  flushDepartedNotices,
  noteDepartedEntrant,
} from "@/lib/server/tournaments/departed-notices";
import { forgetMatchReminders } from "@/lib/server/tournaments/reminder-marks";
import { pushTeamToTarget } from "@/lib/server/tournaments/scoring";
import { connectionMock, fakeConnection } from "../../helpers/sql-double";

/**
 * Avis aux engagées retirées par une correction de score : notés là où une
 * engagée quitte une manche (`pushTeamToTarget`), envoyés ou jetés avec le
 * journal de la transaction (`flushBotLogs` / `discardBotLogs`).
 */
beforeEach(() => {
  jest.clearAllMocks();
});

function slotConnection(previous: { team1_id: number | null; team2_id: number | null }) {
  const mock = connectionMock();
  mock.execute.mockImplementation(async (sql: string) => {
    if (sql.startsWith("SELECT team1_id, team2_id")) return [[previous]];
    return [{ affectedRows: 1 }];
  });
  return fakeConnection(mock);
}

describe("pushTeamToTarget — engagée remplacée", () => {
  it("note l'avis de la sortante, avant d'effacer les marques de la manche", async () => {
    const connection = slotConnection({ team1_id: 7, team2_id: 10 });
    const order: string[] = [];
    jest.mocked(noteDepartedEntrant).mockImplementation(async () => {
      order.push("note");
    });
    jest.mocked(forgetMatchReminders).mockImplementation(async () => {
      order.push("forget");
    });

    await pushTeamToTarget(connection, 2, 1, 9);

    expect(noteDepartedEntrant).toHaveBeenCalledWith(connection, 2, 7, 1);
    expect(order).toEqual(["note", "forget"]);
  });

  it("ne note rien quand la place était vide, ou garde la même engagée", async () => {
    await pushTeamToTarget(slotConnection({ team1_id: null, team2_id: 10 }), 2, 1, 9);
    await pushTeamToTarget(slotConnection({ team1_id: 9, team2_id: 10 }), 2, 1, 9);
    expect(noteDepartedEntrant).not.toHaveBeenCalled();
  });
});

describe("flushBotLogs / discardBotLogs", () => {
  it("envoient ou jettent les avis notés par la même transaction", () => {
    const connection = fakeConnection({});
    flushBotLogs(connection);
    expect(flushDepartedNotices).toHaveBeenCalledWith(connection);
    discardBotLogs(connection);
    expect(discardDepartedNotices).toHaveBeenCalledWith(connection);
  });
});
