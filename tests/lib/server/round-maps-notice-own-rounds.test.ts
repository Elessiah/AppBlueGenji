import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/database");
jest.mock("@/lib/server/bot-integration");

import { getDatabase } from "@/lib/server/database";
import { flushBotLogBatch, sendBotLog } from "@/lib/server/bot-integration";
import { flushRoundMapsNotice, resetRoundMapsNoticeState } from "@/lib/server/tournaments/round-maps-notice";
import { fakePool, type SqlQuery } from "../../helpers/sql-double";

/**
 * Signal de fermeture de l'écran des cartes : ne devance que les manches que
 * cet écran a écrites (`docs/features/ROUND_MAPS.md`).
 */

const row = (rounds: unknown) => ({
  tournament_id: 7,
  rounds_json: JSON.stringify(rounds),
  changes: 1,
  name: "Coupe",
  format: "SINGLE",
});
const R2 = { phaseId: 0, bracket: "UPPER", roundNumber: 2 };
const R3 = { phaseId: 0, bracket: "UPPER", roundNumber: 3 };

function pool(select: unknown[]) {
  const execute = jest.fn<SqlQuery>(async (sql) => (/^\s*SELECT/.test(sql) ? [select, []] : [{ affectedRows: 1 }, []]));
  jest.mocked(getDatabase).mockResolvedValue(fakePool({ execute }));
}

beforeEach(() => {
  jest.clearAllMocks();
  resetRoundMapsNoticeState();
  jest.mocked(sendBotLog).mockReturnValue(undefined);
  jest.mocked(flushBotLogBatch).mockResolvedValue();
});

afterEach(() => resetRoundMapsNoticeState());

describe("flushRoundMapsNotice — own rounds", () => {
  it("flushRoundMapsNotice_pendingRoundsAllOwn_sends", async () => {
    pool([row([R2, R3])]);

    await expect(flushRoundMapsNotice(7, ["0:UPPER:2", "0:UPPER:3", "0:UPPER:4"])).resolves.toBe(true);
  });

  it("flushRoundMapsNotice_pendingHasForeignRound_sendsNothing", async () => {
    pool([row([R2, R3])]);

    await expect(flushRoundMapsNotice(7, ["0:UPPER:2"])).resolves.toBe(false);
    expect(sendBotLog).not.toHaveBeenCalled();
  });

  it("flushRoundMapsNotice_foreignRoundRefused_releasesTheCapForTheNextFlush", async () => {
    pool([row([R2, R3])]);
    await flushRoundMapsNotice(7, ["0:UPPER:2"]);

    await expect(flushRoundMapsNotice(7, ["0:UPPER:2", "0:UPPER:3"])).resolves.toBe(true);
  });

  it("flushRoundMapsNotice_emptyOwnList_sendsNothing", async () => {
    pool([row([R2])]);

    await expect(flushRoundMapsNotice(7, [])).resolves.toBe(false);
  });

  it("flushRoundMapsNotice_noListGiven_sendsEverything", async () => {
    pool([row([R2, R3])]);

    await expect(flushRoundMapsNotice(7)).resolves.toBe(true);
  });

  it("flushRoundMapsNotice_secondCloseDuringTheFirstRead_waitsAndSendsItsOwnRounds", async () => {
    let resolveFirst = (_value: [unknown[], unknown[]]): void => undefined;
    let selects = 0;
    const execute = jest.fn<SqlQuery>(async (sql) => {
      if (!/^\s*SELECT/.test(sql)) return [{ affectedRows: 1 }, []];
      selects += 1;
      if (selects === 1) return new Promise<[unknown[], unknown[]]>((resolve) => (resolveFirst = resolve));
      return [[row([R3])], []];
    });
    jest.mocked(getDatabase).mockResolvedValue(fakePool({ execute }));

    const first = flushRoundMapsNotice(7, ["0:UPPER:2"]);
    const second = flushRoundMapsNotice(7, ["0:UPPER:3"]);
    await new Promise((resolve) => setImmediate(resolve));
    resolveFirst([[row([R3])], []]);

    await expect(first).resolves.toBe(false);
    await expect(second).resolves.toBe(true);
  });

  it("flushRoundMapsNotice_firstCloseSent_secondOneIsCapped", async () => {
    pool([row([R2])]);
    await flushRoundMapsNotice(7, ["0:UPPER:2"]);

    await expect(flushRoundMapsNotice(7, ["0:UPPER:2"])).resolves.toBe(false);
  });
});

