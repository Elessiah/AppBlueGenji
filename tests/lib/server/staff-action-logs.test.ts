import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/database");
jest.mock("@/lib/server/bot-integration");

import { getDatabase } from "@/lib/server/database";
import { sendBotLog } from "@/lib/server/bot-integration";
import {
  announceStaffMatchAction,
  announceStaffTournamentAction,
  deliverStaffMatchAction,
  deliverStaffTournamentAction,
  staffActionAuthor,
} from "@/lib/server/tournaments/staff-action-logs";
import { fakePool, type SqlQuery } from "../../helpers/sql-double";
import { authUser } from "../../helpers/auth-user";

function matchRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 42,
    bracket: "UPPER",
    round_number: 2,
    swiss_round: 0,
    team1_name: "Renards",
    team2_name: "Nova",
    tournament_id: 7,
    tournament_name: "Coupe d'hiver",
    participant_type: "TEAM",
    ...overrides,
  };
}

function mockRows(row: Record<string, unknown> | null) {
  const execute = jest.fn<SqlQuery>(async () => [row === null ? [] : [row], []]);
  jest.mocked(getDatabase).mockResolvedValue(fakePool({ execute }));
  return execute;
}

/** Laisse filer les promesses lancées sans attendre. */
async function settle(): Promise<void> {
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(sendBotLog).mockResolvedValue();
});

describe("deliverStaffMatchAction", () => {
  it("envoie une ligne au journal, sans personne nommée", async () => {
    const execute = mockRows(matchRow());
    await deliverStaffMatchAction(42, "FORCE_LAUNCHED");
    expect(execute.mock.calls[0][1]).toEqual([42]);
    expect(sendBotLog).toHaveBeenCalledWith(
      "🛠️ Lancement forcé — « Coupe d'hiver » (#7) : Manche 2 — Renards vs Nova (#42), par le staff.",
    );
  });

  it("écrit « un joueur » en tournoi individuel", async () => {
    mockRows(matchRow({ participant_type: "SOLO", team1_name: "Alice", team2_name: "Bob" }));
    await deliverStaffMatchAction(42, "RESULT_VALIDATED");
    const line = jest.mocked(sendBotLog).mock.calls[0][0];
    expect(line).toContain("un joueur vs un joueur");
    expect(line).not.toMatch(/Alice|Bob/);
  });

  it("n'écrit rien pour un match disparu", async () => {
    mockRows(null);
    await deliverStaffMatchAction(42, "ON_AIR");
    expect(sendBotLog).not.toHaveBeenCalled();
  });
});

describe("staffActionAuthor", () => {
  it("« le staff » avec la permission tournois, « un caster » avec la seule diffusion", () => {
    expect(staffActionAuthor(authUser({ id: 1, isAdmin: true, roles: ["ADMIN"] }))).toBe("STAFF");
    expect(staffActionAuthor(authUser({ id: 3, isAdmin: false, roles: ["ARBITRE"] }))).toBe("STAFF");
    expect(staffActionAuthor(authUser({ id: 4, isAdmin: false, roles: ["CASTER"] }))).toBe("CASTER");
  });

  it("transmet l'auteur à la ligne", async () => {
    mockRows(matchRow());
    await deliverStaffMatchAction(42, "REPLAY_REMOVED", "CASTER");
    expect(jest.mocked(sendBotLog).mock.calls[0][0]).toMatch(/Rediffusion retirée .*, par un caster\.$/);
  });
});

describe("deliverStaffTournamentAction", () => {
  it("envoie le geste et le compte", async () => {
    const execute = mockRows({ id: 7, name: "Coupe d'hiver" });
    await deliverStaffTournamentAction(7, "GHOST_TEAMS_REGISTERED", 2);
    expect(execute.mock.calls[0][1]).toEqual([7]);
    expect(sendBotLog).toHaveBeenCalledWith("🛠️ Équipes fantômes inscrites — « Coupe d'hiver » (#7) (2), par le staff.");
  });

  it("n'écrit rien pour un tournoi disparu", async () => {
    mockRows(null);
    await deliverStaffTournamentAction(7, "EDITED");
    expect(sendBotLog).not.toHaveBeenCalled();
  });
});

describe("announceStaffMatchAction / announceStaffTournamentAction", () => {
  it("ne lèvent jamais quand la base est indisponible", async () => {
    const error = jest.spyOn(console, "error").mockImplementation(() => undefined);
    jest.mocked(getDatabase).mockRejectedValue(new Error("down"));
    expect(() => announceStaffMatchAction(42, "HOST_SET")).not.toThrow();
    expect(() => announceStaffTournamentAction(7, "EDITED")).not.toThrow();
    await settle();
    expect(error).toHaveBeenCalledTimes(2);
    const messages = error.mock.calls.map((call) => String(call[0]));
    expect(messages.some((message) => message.includes("HOST_SET") && message.includes("#42"))).toBe(true);
    expect(messages.some((message) => message.includes("EDITED") && message.includes("#7"))).toBe(true);
    expect(sendBotLog).not.toHaveBeenCalled();
    error.mockRestore();
  });

  it("ne lèvent jamais quand le bot est injoignable", async () => {
    const error = jest.spyOn(console, "error").mockImplementation(() => undefined);
    mockRows(matchRow());
    jest.mocked(sendBotLog).mockRejectedValue(new Error("bot down"));
    announceStaffMatchAction(42, "REPLAY_SET");
    await settle();
    expect(sendBotLog).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledTimes(1);
    error.mockRestore();
  });
});
