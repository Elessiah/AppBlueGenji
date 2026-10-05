import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/database");
jest.mock("@/lib/server/tournaments/repository");
jest.mock("@/lib/server/tournaments/notifications");

import { loadSeedingBoard, reorderSeeding } from "@/lib/server/tournaments/seeding";
import { deleteAllMatches, getMatchRows, loadTournamentRow } from "@/lib/server/tournaments/repository";
import { publishUpdatedEvent } from "@/lib/server/tournaments/notifications";
import type { MatchRow, TournamentRow } from "@/lib/server/tournaments/_internal";
import { connectionMock, fakePool } from "../helpers/sql-double";
import type { RowOverrides } from "../helpers/row-overrides";
import { matchRow as baseMatchRow, tournamentRow } from "../helpers/tournament-rows";

const connection = connectionMock();

async function mockDb() {
  const { getDatabase } = await import("@/lib/server/database");
  jest.mocked(getDatabase).mockResolvedValue(fakePool({
    getConnection: jest.fn(async () => connection),
  }));
}

const DAY = 24 * 60 * 60 * 1000;

function tournament(overrides: RowOverrides<TournamentRow> = {}): TournamentRow {
  return tournamentRow({
    id: 5,
    state: "REGISTRATION",
    format: "SINGLE",
    manual_seeding: 0,
    // Dates relatives à l'horloge : la fenêtre se juge aussi sur l'heure
    // (`seedingWindowState`), et des dates figées finiraient dans le passé.
    registration_open_at: new Date(Date.now() - DAY),
    registration_close_at: new Date(Date.now() + DAY),
    start_at: new Date(Date.now() + 2 * DAY),
    ...overrides,
  });
}

/** Deux inscriptions : Alpha (seed 1) puis Beta (seed 2). */
function registrationRows() {
  return [
    [
      { team_id: 1, team_name: "Alpha", seed: 1, registered_at: new Date() },
      { team_id: 2, team_name: "Beta", seed: 2, registered_at: new Date() },
    ],
  ];
}

function matchRow(overrides: RowOverrides<MatchRow> = {}): MatchRow {
  return baseMatchRow({
    id: 100,
    round_number: 1,
    team1_id: 1,
    team2_id: 2,
    team1_score: null,
    team2_score: null,
    winner_team_id: null,
    forfeit_team_id: null,
    status: "READY",
    next_winner_match_id: null,
    next_loser_match_id: null,
    ...overrides,
  });
}

describe("loadSeedingBoard", () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    await mockDb();
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("renumérote un ordre à trous et signale l'ordre encore libre", async () => {
    jest.mocked(loadTournamentRow).mockResolvedValue(tournament());
    connection.execute.mockResolvedValue([
      [
        { team_id: 7, team_name: "Gamma", seed: null, registered_at: new Date() },
        { team_id: 8, team_name: "Delta", seed: 42, registered_at: new Date() },
      ],
    ]);
    jest.mocked(getMatchRows).mockResolvedValue([]);

    const board = await loadSeedingBoard(5);

    expect(board?.entries.map((e) => e.seed)).toEqual([1, 2]);
    expect(board?.lockReason).toBeNull();
    expect(board?.manualSeeding).toBe(false);
    expect(connection.release).toHaveBeenCalled();
  });

  it("signale le verrouillage dès qu'un score est saisi", async () => {
    jest.mocked(loadTournamentRow).mockResolvedValue(tournament({ state: "RUNNING" }));
    connection.execute.mockResolvedValue(registrationRows());
    jest.mocked(getMatchRows).mockResolvedValue([matchRow({ winner_team_id: 1 })]);

    expect((await loadSeedingBoard(5))?.lockReason).toBe("SCORES_ENTERED");
  });

  it("signale le verrouillage d'un tournoi lancé, même vierge de scores", async () => {
    jest.mocked(loadTournamentRow).mockResolvedValue(tournament({ state: "RUNNING" }));
    connection.execute.mockResolvedValue(registrationRows());
    jest.mocked(getMatchRows).mockResolvedValue([matchRow()]);

    expect((await loadSeedingBoard(5))?.lockReason).toBe("STARTED");
  });

  it("renvoie null pour un tournoi inconnu", async () => {
    jest.mocked(loadTournamentRow).mockResolvedValue(null);
    expect(await loadSeedingBoard(5)).toBeNull();
  });
});

describe("reorderSeeding", () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    await mockDb();
    connection.execute.mockResolvedValue(registrationRows());
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("écrit les seeds dans le nouvel ordre et marque le seeding manuel", async () => {
    jest.mocked(loadTournamentRow).mockResolvedValue(tournament());
    jest.mocked(getMatchRows).mockResolvedValue([]);

    await reorderSeeding(5, [2, 1]);

    const updates = connection.execute.mock.calls.filter(([sql]) =>
      String(sql).includes("SET seed = ?"),
    );
    expect(updates.map(([, params]) => params)).toEqual([
      [1, 5, 2],
      [2, 5, 1],
    ]);
    expect(
      connection.execute.mock.calls.some(([sql]) => String(sql).includes("manual_seeding = 1")),
    ).toBe(true);
    expect(connection.commit).toHaveBeenCalled();
    expect(publishUpdatedEvent).toHaveBeenCalledWith(5);
    // Aucun match généré : rien à reconstruire.
    expect(deleteAllMatches).not.toHaveBeenCalled();
  });

  it("refuse un plateau resté avant le coup d'envoi, sans le détruire", async () => {
    // Un plateau ne naît qu'au lancement : des matchs ici décriraient un tirage
    // déjà fait. Le détruire puis amorcer les manches lancerait de fait un
    // tournoi que la fenêtre dit encore ouvert.
    jest.mocked(loadTournamentRow).mockResolvedValue(tournament({ state: "REGISTRATION" }));
    jest.mocked(getMatchRows).mockResolvedValue([matchRow()]);

    await expect(reorderSeeding(5, [2, 1])).rejects.toThrow(/^SEEDING_LOCKED_STARTED$/);
    expect(deleteAllMatches).not.toHaveBeenCalled();
    expect(connection.commit).not.toHaveBeenCalled();
    expect(publishUpdatedEvent).not.toHaveBeenCalled();
  });

  it("verrouille le tournoi puis ses matchs avant toute lecture ordinaire", async () => {
    // Sous REPEATABLE READ, la première lecture ordinaire fige l'instantané :
    // posés après, les verrous laisseraient juger la fenêtre sur un état
    // d'avant l'attente, et un lancement concurrent passerait inaperçu.
    const order: string[] = [];
    connection.execute.mockImplementation(async (sql: unknown) => {
      const text = String(sql);
      if (/FROM bg_tournaments WHERE id = \? FOR UPDATE/.test(text)) order.push("lock-tournament");
      else if (/FROM bg_matches WHERE tournament_id = \? FOR UPDATE/.test(text)) order.push("lock-matches");
      else if (text.includes("FROM bg_tournament_registrations")) {
        order.push("entries");
        return registrationRows();
      }
      return [[]];
    });
    jest.mocked(loadTournamentRow).mockImplementation(async () => {
      order.push("tournament");
      return tournament({ state: "REGISTRATION" });
    });
    jest.mocked(getMatchRows).mockImplementation(async () => {
      order.push("matches");
      return [];
    });

    await reorderSeeding(5, [2, 1]);

    // Tournoi d'abord, comme les gestes du staff qui écrivent des matchs sous
    // ce verrou (avancée, retour en arrière, inscription).
    expect(order.slice(0, 4)).toEqual(["lock-tournament", "lock-matches", "tournament", "entries"]);
    expect(order).toContain("matches");
    expect(order.indexOf("lock-matches")).toBeLessThan(order.indexOf("matches"));
  });

  it("rejoue la transaction défaite par un interblocage, puis refuse sur la saisie vue", async () => {
    // Une saisie de score croise le réordonnancement (match puis tournoi contre
    // tournoi puis matchs) : InnoDB défait l'un des deux. Rejoué, le
    // réordonnancement relit les matchs et voit le score désormais commité.
    const deadlock = Object.assign(new Error("Deadlock found"), { code: "ER_LOCK_DEADLOCK" });
    let matchLocks = 0;
    connection.execute.mockImplementation(async (sql: unknown) => {
      const text = String(sql);
      if (/FROM bg_matches WHERE tournament_id = \? FOR UPDATE/.test(text)) {
        matchLocks += 1;
        if (matchLocks === 1) throw deadlock;
      }
      if (text.includes("FROM bg_tournament_registrations")) return registrationRows();
      return [[]];
    });
    jest.mocked(loadTournamentRow).mockResolvedValue(tournament({ state: "RUNNING" }));
    jest.mocked(getMatchRows).mockResolvedValue([matchRow({ team1_score: 1, team2_score: 0 })]);

    await expect(reorderSeeding(5, [2, 1])).rejects.toThrow("SEEDING_LOCKED");

    expect(connection.beginTransaction).toHaveBeenCalledTimes(2);
    expect(connection.rollback).toHaveBeenCalledTimes(2);
    expect(connection.release).toHaveBeenCalledTimes(2);
    expect(deleteAllMatches).not.toHaveBeenCalled();
  });

  it("abandonne après trois interblocages et remonte l'erreur", async () => {
    const deadlock = Object.assign(new Error("Deadlock found"), { code: "ER_LOCK_DEADLOCK" });
    connection.execute.mockImplementation(async (sql: unknown) => {
      if (/FOR UPDATE/.test(String(sql))) throw deadlock;
      return [[]];
    });

    await expect(reorderSeeding(5, [2, 1])).rejects.toBe(deadlock);
    expect(connection.beginTransaction).toHaveBeenCalledTimes(3);
    expect(connection.commit).not.toHaveBeenCalled();
  });

  it("ne rejoue pas une autre erreur", async () => {
    connection.execute.mockImplementation(async (sql: unknown) => {
      if (/FOR UPDATE/.test(String(sql))) throw new Error("ER_LOCK_WAIT_TIMEOUT");
      return [[]];
    });

    await expect(reorderSeeding(5, [2, 1])).rejects.toThrow("ER_LOCK_WAIT_TIMEOUT");
    expect(connection.beginTransaction).toHaveBeenCalledTimes(1);
  });

  it("refuse un report enregistré pendant l'attente du verrou", async () => {
    // Le report concurrent a été validé avant que les verrous soient obtenus :
    // la relecture des matchs, faite après, le voit et ferme la fenêtre.
    jest.mocked(loadTournamentRow).mockResolvedValue(tournament({ state: "RUNNING" }));
    jest.mocked(getMatchRows).mockResolvedValue([
      matchRow({ status: "AWAITING_CONFIRMATION", team1_score: 2, team2_score: 1 }),
    ]);

    await expect(reorderSeeding(5, [2, 1])).rejects.toThrow("SEEDING_LOCKED");
    expect(deleteAllMatches).not.toHaveBeenCalled();
    expect(connection.rollback).toHaveBeenCalled();
  });

  it("refuse un tournoi lancé, même sans aucun score (SEEDING_LOCKED_STARTED)", async () => {
    // Coup d'envoi donné : la première manche est `READY`, les joueurs la
    // voient. Un réordonnancement la régénérerait sous leurs yeux.
    jest.mocked(loadTournamentRow).mockResolvedValue(tournament({ state: "RUNNING" }));
    jest.mocked(getMatchRows).mockResolvedValue([matchRow()]);

    await expect(reorderSeeding(5, [2, 1])).rejects.toThrow(/^SEEDING_LOCKED_STARTED$/);
    expect(deleteAllMatches).not.toHaveBeenCalled();
    expect(connection.commit).not.toHaveBeenCalled();
    expect(
      connection.execute.mock.calls.some(([sql]) => String(sql).includes("SET seed = ?")),
    ).toBe(false);
  });

  it("refuse dès l'heure de début passée, même si l'état stocké n'a pas encore basculé", async () => {
    // Personne n'a écrit ni ouvert la liste depuis l'heure : la colonne dit
    // encore REGISTRATION. Accepter ici ferait lancer le tournoi, par la
    // synchronisation que l'écriture déclenche, avec un ordre posé trop tard.
    jest.mocked(loadTournamentRow).mockResolvedValue(
      tournament({
        state: "REGISTRATION",
        registration_close_at: new Date(Date.now() - 2 * 60_000),
        start_at: new Date(Date.now() - 60_000),
      }),
    );
    jest.mocked(getMatchRows).mockResolvedValue([]);

    await expect(reorderSeeding(5, [2, 1])).rejects.toThrow(/^SEEDING_LOCKED_STARTED$/);
    expect(connection.commit).not.toHaveBeenCalled();
  });

  it("refuse un tournoi lancé par anticipation, avant son heure de début", async () => {
    jest.mocked(loadTournamentRow).mockResolvedValue(tournament({ state: "RUNNING" }));
    jest.mocked(getMatchRows).mockResolvedValue([]);

    await expect(reorderSeeding(5, [2, 1])).rejects.toThrow(/^SEEDING_LOCKED_STARTED$/);
  });

  it("refuse un tournoi lancé dont le plateau n'est pas encore généré", async () => {
    jest.mocked(loadTournamentRow).mockResolvedValue(tournament({ state: "RUNNING" }));
    jest.mocked(getMatchRows).mockResolvedValue([]);

    await expect(reorderSeeding(5, [2, 1])).rejects.toThrow(/^SEEDING_LOCKED_STARTED$/);
  });

  it("refuse dès qu'un score est saisi", async () => {
    jest.mocked(loadTournamentRow).mockResolvedValue(tournament({ state: "RUNNING" }));
    jest.mocked(getMatchRows).mockResolvedValue([matchRow({ team1_score: 0 })]);

    await expect(reorderSeeding(5, [2, 1])).rejects.toThrow(/^SEEDING_LOCKED$/);
    expect(connection.rollback).toHaveBeenCalled();
    expect(connection.commit).not.toHaveBeenCalled();
  });

  it("refuse un ordre qui n'est pas une permutation des inscrites", async () => {
    jest.mocked(loadTournamentRow).mockResolvedValue(tournament());
    jest.mocked(getMatchRows).mockResolvedValue([]);

    await expect(reorderSeeding(5, [2, 99])).rejects.toThrow("INVALID_SEED_ORDER");
    expect(connection.rollback).toHaveBeenCalled();
  });

  it("refuse un tournoi inconnu", async () => {
    jest.mocked(loadTournamentRow).mockResolvedValue(null);

    await expect(reorderSeeding(5, [1, 2])).rejects.toThrow("TOURNAMENT_NOT_FOUND");
    expect(connection.release).toHaveBeenCalled();
  });
});
