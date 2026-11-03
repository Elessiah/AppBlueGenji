import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/database");
jest.mock("@/lib/server/bot-integration");

import { getDatabase } from "@/lib/server/database";
import { flushAllCoalescers } from "@/lib/server/coalescer";
import { isBotCircuitOpen, sendBotLog } from "@/lib/server/bot-integration";
import {
  announceStaffMatchAction,
  announceStaffTournamentAction,
  deliverStaffMatchAction,
  deliverStaffTournamentAction,
  flushStaffActionBursts,
  resetStaffActionBursts,
  staffActionAuthor,
  STAFF_LOG_BURST_WINDOW_MS,
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
      { tournamentId: 7, category: "admin" },
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
    await deliverStaffTournamentAction(7, "GHOST_TEAMS_REGISTERED", { count: 2 });
    expect(execute.mock.calls[0][1]).toEqual([7]);
    expect(sendBotLog).toHaveBeenCalledWith("🛠️ Équipes fantômes inscrites — « Coupe d'hiver » (#7) (2), par le staff.", { tournamentId: 7, category: "admin" });
  });

  it("n'écrit rien pour un tournoi disparu", async () => {
    mockRows(null);
    await deliverStaffTournamentAction(7, "EDITED");
    expect(sendBotLog).not.toHaveBeenCalled();
  });
});

describe("deliverStaffMatchAction — sans désigner le match", () => {
  it("n'envoie que le tournoi avec withoutMatch", async () => {
    mockRows(matchRow());
    await deliverStaffMatchAction(42, "SCORES_SAVED", "STAFF", { withoutMatch: true });
    expect(sendBotLog).toHaveBeenCalledWith("🛠️ Score enregistré — « Coupe d'hiver » (#7), par le staff.", { tournamentId: 7, category: "admin" });
  });

  it("transmet l'option depuis announceStaffMatchAction", async () => {
    mockRows(matchRow());
    announceStaffMatchAction(42, "SCORES_SAVED", "STAFF", { withoutMatch: true });
    await settle();
    expect(sendBotLog).toHaveBeenCalledWith("🛠️ Score enregistré — « Coupe d'hiver » (#7), par le staff.", { tournamentId: 7, category: "admin" });
  });
});

describe("announceStaffMatchAction / announceStaffTournamentAction", () => {
  it("announceStaffTournamentAction_noPendingBurst_startsDeliveryInTheSameTick", () => {
    jest.mocked(getDatabase).mockRejectedValue(new Error("down"));
    const error = jest.spyOn(console, "error").mockImplementation(() => undefined);
    announceStaffTournamentAction(7, "EDITED");
    expect(getDatabase).toHaveBeenCalled();
    error.mockRestore();
  });

  it("announceStaffTournamentAction_shutdownFlush_waitsImmediateDelivery", async () => {
    let finishRead: () => void = () => undefined;
    const execute = jest.fn<SqlQuery>(
      () => new Promise((resolve) => (finishRead = () => resolve([[{ id: 7, name: "Coupe d'hiver" }], []]))),
    );
    jest.mocked(getDatabase).mockResolvedValue(fakePool({ execute }));
    announceStaffTournamentAction(7, "EDITED");
    const flushed = flushAllCoalescers();
    await settle();
    expect(sendBotLog).not.toHaveBeenCalled();
    finishRead();
    await flushed;
    expect(sendBotLog).toHaveBeenCalledTimes(1);
  });

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

describe("échecs du journal du staff", () => {
  it("announceStaffMatchAction_deliveryFails_logsOneLineWithoutErrorObject", async () => {
    const error = jest.spyOn(console, "error").mockImplementation(() => undefined);
    jest.mocked(getDatabase).mockRejectedValue(Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" }));
    announceStaffMatchAction(42, "HOST_SET");
    await settle();
    expect(error).toHaveBeenCalledWith("[staff-log] geste HOST_SET sur le match #42 non journalisé : ECONNREFUSED");
    error.mockRestore();
  });
});

describe("coupe-circuit du bot ouvert", () => {
  it("deliverStaffMatchAction_circuitOpen_readsNothing", async () => {
    jest.mocked(isBotCircuitOpen).mockReturnValue(true);
    const execute = mockRows(matchRow());
    await deliverStaffMatchAction(42, "HOST_SET");
    expect(execute).not.toHaveBeenCalled();
    expect(sendBotLog).not.toHaveBeenCalled();
    jest.mocked(isBotCircuitOpen).mockReturnValue(false);
  });

  it("deliverStaffTournamentAction_circuitOpen_readsNothing", async () => {
    jest.mocked(isBotCircuitOpen).mockReturnValue(true);
    const execute = mockRows({ id: 7, name: "Coupe d'hiver" });
    await deliverStaffTournamentAction(7, "EDITED");
    expect(execute).not.toHaveBeenCalled();
    expect(sendBotLog).not.toHaveBeenCalled();
    jest.mocked(isBotCircuitOpen).mockReturnValue(false);
  });
});

describe("deliverStaffTournamentAction — précisions", () => {
  it("deliverStaffTournamentAction_advancedWithTarget_namesStep", async () => {
    mockRows({ id: 7, name: "Coupe d'hiver" });
    await deliverStaffTournamentAction(7, "ADVANCED", { target: "REGISTRATION" });
    expect(sendBotLog).toHaveBeenCalledWith(
      "🛠️ Étape suivante avancée — « Coupe d'hiver » (#7) (ouverture des inscriptions), par le staff.",
      { tournamentId: 7, category: "admin" },
    );
  });

  it("deliverStaffTournamentAction_renamed_citesOldName", async () => {
    mockRows({ id: 7, name: "Coupe d'hiver" });
    await deliverStaffTournamentAction(7, "EDITED", { previousName: "Coupe d'automne" });
    expect(sendBotLog).toHaveBeenCalledWith(
      "🛠️ Tournoi modifié — « Coupe d'hiver » (#7) (ancien nom : « Coupe d'automne »), par le staff.",
      { tournamentId: 7, category: "admin" },
    );
  });
});

describe("announceStaffTournamentAction — rafales", () => {
  beforeEach(() => {
    resetStaffActionBursts();
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it("announceStaffTournamentAction_seedingBurst_onlyOneLine", async () => {
    const execute = mockRows({ id: 7, name: "Coupe d'hiver" });
    for (let i = 0; i < 15; i += 1) announceStaffTournamentAction(7, "SEEDING_REORDERED");
    expect(execute).not.toHaveBeenCalled();
    jest.advanceTimersByTime(STAFF_LOG_BURST_WINDOW_MS);
    jest.useRealTimers();
    await settle();
    expect(sendBotLog).toHaveBeenCalledTimes(1);
    expect(jest.mocked(sendBotLog).mock.calls[0][0]).toContain("Têtes de série réordonnées");
  });

  it("announceStaffTournamentAction_twoTournaments_twoLines", async () => {
    mockRows({ id: 7, name: "Coupe d'hiver" });
    announceStaffTournamentAction(7, "SEEDING_REORDERED");
    announceStaffTournamentAction(8, "SEEDING_REORDERED");
    flushStaffActionBursts();
    jest.useRealTimers();
    await settle();
    expect(sendBotLog).toHaveBeenCalledTimes(2);
  });

  it("announceStaffTournamentAction_nonBurstAction_deliversImmediately", async () => {
    const execute = mockRows({ id: 7, name: "Coupe d'hiver" });
    announceStaffTournamentAction(7, "EDITED");
    jest.useRealTimers();
    await settle();
    expect(execute).toHaveBeenCalledTimes(1);
    expect(sendBotLog).toHaveBeenCalledTimes(1);
  });

  it("announceStaffTournamentAction_advanceAfterPendingSeeding_seedingLoggedFirst", async () => {
    mockRows({ id: 7, name: "Coupe d'hiver" });
    announceStaffTournamentAction(7, "SEEDING_REORDERED");
    announceStaffTournamentAction(7, "ADVANCED", { target: "RUNNING" });
    jest.useRealTimers();
    await settle();
    await settle();
    const lines = jest.mocked(sendBotLog).mock.calls.map((call) => String(call[0]));
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain("Têtes de série réordonnées");
    expect(lines[1]).toContain("coup d'envoi");
  });

  it("announceStaffTournamentAction_advanceOtherTournament_seedingStaysPending", async () => {
    mockRows({ id: 8, name: "Coupe d'été" });
    announceStaffTournamentAction(7, "SEEDING_REORDERED");
    announceStaffTournamentAction(8, "ADVANCED", { target: "RUNNING" });
    jest.useRealTimers();
    await settle();
    await settle();
    expect(sendBotLog).toHaveBeenCalledTimes(1);
    expect(String(jest.mocked(sendBotLog).mock.calls[0][0])).toContain("coup d'envoi");
  });
});
