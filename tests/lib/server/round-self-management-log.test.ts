import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/database");
jest.mock("@/lib/server/bot-integration");
jest.mock("@/lib/server/tournaments/notifications");
jest.mock("@/lib/server/tournaments/referee-notices");
jest.mock("@/lib/server/tournaments/transaction", () => ({ inTransaction: jest.fn() }));
jest.mock("@/lib/server/tournaments/match-log-subject", () => ({
  ...jest.requireActual<object>("@/lib/server/tournaments/match-log-subject"),
  loadMatchLogRow: jest.fn(),
}));

import { sendBotLog } from "@/lib/server/bot-integration";
import { setRoundSelfManaged } from "@/lib/server/tournaments/match-launch";
import { loadMatchLogRow, type MatchLogRow } from "@/lib/server/tournaments/match-log-subject";
import { inTransaction } from "@/lib/server/tournaments/transaction";
import { fakeConnection, type SqlQuery } from "../../helpers/sql-double";

/**
 * Ligne de journal de l'autogestion d'une manche (EF-31) : quand le geste
 * touche plusieurs tableaux, elle dit « Manche N » sans nommer le tableau du
 * premier match changé.
 */
const LOG_ROW = {
  id: 41,
  bracket: "LOWER",
  round_number: 2,
  swiss_round: null,
  team1_name: "Renards",
  team2_name: "Nova",
  tournament_id: 7,
  tournament_name: "Coupe d'hiver",
  participant_type: "TEAM",
} as MatchLogRow;

function roundConnection(matches: { id: number; bracket: string }[], refereeUserId: number | null = null) {
  const execute = jest.fn<SqlQuery>(async (sql: string) => {
    if (sql.startsWith("SELECT state FROM bg_tournaments")) return [[{ state: "REGISTRATION" }], []];
    if (sql.startsWith("SELECT id FROM bg_matches")) return [matches.map(({ id }) => ({ id })), []];
    if (sql.startsWith("SELECT id, bracket, self_managed")) {
      return [matches.map((match) => ({ ...match, self_managed: 0, referee_user_id: refereeUserId, status: "READY", is_bye: 0 })), []];
    }
    return [{ affectedRows: 1 }, []];
  });
  return fakeConnection({ execute });
}

const settle = () => new Promise((resolve) => setImmediate(resolve));

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(loadMatchLogRow).mockResolvedValue(LOG_ROW);
  jest.mocked(sendBotLog).mockReturnValue(undefined);
});

describe("setRoundSelfManaged — ligne de journal", () => {
  it("setRoundSelfManaged_allBracketsMixed_logOmitsBracketName", async () => {
    const connection = roundConnection([
      { id: 41, bracket: "LOWER" },
      { id: 42, bracket: "UPPER" },
    ]);
    jest.mocked(inTransaction).mockImplementation((run) => run(connection));

    await setRoundSelfManaged(7, { phaseId: 0, roundNumber: 2, bracket: null }, true, 3);
    await settle();

    const [message] = jest.mocked(sendBotLog).mock.calls[0];
    expect(message).toContain("Manche 2");
    expect(message).not.toContain("Tableau perdants");
  });

  it("setRoundSelfManaged_singleBracket_logNamesIt", async () => {
    const connection = roundConnection([{ id: 41, bracket: "LOWER" }]);
    jest.mocked(inTransaction).mockImplementation((run) => run(connection));

    await setRoundSelfManaged(7, { phaseId: 0, roundNumber: 2, bracket: "LOWER" }, true, 3);
    await settle();

    const [message] = jest.mocked(sendBotLog).mock.calls[0];
    expect(message).toContain("Tableau perdants · manche 2");
  });

  it("setRoundSelfManaged_noRefereeRemoved_refereesBatchOfTheTournament", async () => {
    const connection = roundConnection([{ id: 41, bracket: "LOWER" }]);
    jest.mocked(inTransaction).mockImplementation((run) => run(connection));

    await setRoundSelfManaged(7, { phaseId: 0, roundNumber: 2, bracket: "LOWER" }, true, 3);
    await settle();

    expect(jest.mocked(sendBotLog).mock.calls[0][1]).toEqual({ tournamentId: 7, category: "referees" });
  });

  it("setRoundSelfManaged_refereeRemoved_staffRemovalAlert", async () => {
    const connection = roundConnection([{ id: 41, bracket: "LOWER" }], 9);
    jest.mocked(inTransaction).mockImplementation((run) => run(connection));

    await setRoundSelfManaged(7, { phaseId: 0, roundNumber: 2, bracket: "LOWER" }, true, 3);
    await settle();

    expect(jest.mocked(sendBotLog).mock.calls[0][1]).toEqual({ tournamentId: 7, category: "staff-removal" });
  });
});
