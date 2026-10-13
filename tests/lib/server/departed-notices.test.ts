import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/tournaments/match-reminders");
jest.mock("@/lib/server/tournaments/schedule-notices");

import {
  departuresBetween,
  discardDepartedNotices,
  flushDepartedNotices,
  holdDepartures,
  noteDeletedMatches,
  noteDepartedEntrants,
  settleDepartures,
  withoutSettledLater,
} from "@/lib/server/tournaments/departed-notices";
import { announceEntrantsWithdrawn } from "@/lib/server/tournaments/match-reminders";
import { announceDeletedMatchesToStaff } from "@/lib/server/tournaments/schedule-notices";
import { connectionMock, fakeConnection } from "../../helpers/sql-double";

const AHEAD = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
const DEPARTURE = { matchId: 31, teamId: 101, opponentId: 102 };

/** Ligne de contexte d'une manche, telle que la lit `loadWithdrawnMatches`. */
function contextRow(id: number, overrides: Record<string, unknown> = {}) {
  return {
    id,
    tournament_id: 7,
    phase_id: 0,
    tournament_name: "Coupe BlueGenji",
    participant_type: "TEAM",
    referee_scheduling: 1,
    bracket: "UPPER",
    round_number: 2,
    swiss_round: 0,
    ...overrides,
  };
}

const MATCH_31 = {
  tournamentId: 7,
  tournamentName: "Coupe BlueGenji",
  phaseId: 0,
  solo: false,
  refereeScheduling: true,
  bracket: "UPPER",
  roundNumber: 2,
  swiss: false,
};

/**
 * Connexion dont la lecture des marques `TOLD` rend `held` (manche → horaire),
 * la lecture des manches à supprimer `doomed`, et celle du contexte une ligne
 * par manche demandée.
 */
function connectionHolding(
  held: Record<number, Date | string | null>,
  options: {
    doomed?: object[];
    contexts?: Record<number, Record<string, unknown>>;
    /** Horaires poussés aux arbitres (marque `STAFF`), par manche. */
    staff?: Record<number, Date | string>;
  } = {},
) {
  const mock = connectionMock();
  mock.execute.mockImplementation(async (sql: string, params?: unknown) => {
    if (sql.startsWith("SELECT match_id, start_at")) {
      const values = params as unknown[];
      const source = values[values.length - 1] === "STAFF" ? (options.staff ?? {}) : held;
      return [Object.entries(source).map(([matchId, startAt]) => ({ match_id: Number(matchId), start_at: startAt }))];
    }
    if (sql.startsWith("SELECT id, team1_id, team2_id, status, start_at FROM bg_matches")) {
      // Par défaut, une manche à jouer qui tient l'horaire poussé aux arbitres.
      return [(options.doomed ?? []).map((row) => ({ status: "READY", start_at: options.staff?.[Number((row as { id: number }).id)] ?? null, ...row }))];
    }
    if (sql.startsWith("SELECT m.id, m.tournament_id")) {
      const ids = (params as number[]).filter((id) => held[id] !== undefined || options.staff?.[id] !== undefined);
      return [ids.map((id) => contextRow(id, options.contexts?.[id]))];
    }
    return [[]];
  });
  return { mock, connection: fakeConnection(mock) };
}

function sqlOf(mock: ReturnType<typeof connectionMock>, index: number): [string, unknown[]] {
  return mock.execute.mock.calls[index] as unknown as [string, unknown[]];
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(announceEntrantsWithdrawn).mockResolvedValue(1);
  jest.mocked(announceDeletedMatchesToStaff).mockResolvedValue(undefined);
});

describe("noteDepartedEntrants puis flushDepartedNotices", () => {
  it("prévient après le commit l'engagée qui tenait un horaire, avec cet horaire et sa manche", async () => {
    const { mock, connection } = connectionHolding({ 31: AHEAD });

    await noteDepartedEntrants(connection, [DEPARTURE]);
    expect(announceEntrantsWithdrawn).not.toHaveBeenCalled();
    const [sql, params] = sqlOf(mock, 0);
    // Lecture verrouillante, sans jointure (MariaDB) : l'état le plus récent.
    expect(sql).toMatch(
      /^SELECT match_id, start_at FROM bg_match_reminders\s+WHERE match_id IN \(\?\) AND offset_key = \?\s+FOR UPDATE$/,
    );
    expect(params).toEqual([31, "TOLD"]);
    // Le contexte de l'avis se relève dans la transaction, sans verrou.
    const [contextSql, contextParams] = sqlOf(mock, 1);
    expect(contextSql).not.toMatch(/FOR UPDATE/);
    expect(contextParams).toEqual([31]);

    flushDepartedNotices(connection);
    expect(announceEntrantsWithdrawn).toHaveBeenCalledWith([{ ...DEPARTURE, heldStartAt: AHEAD, match: MATCH_31 }]);
    // Une seule fois : la file est vidée.
    flushDepartedNotices(connection);
    expect(announceEntrantsWithdrawn).toHaveBeenCalledTimes(1);
  });

  it("relève la manche en tournoi individuel et en ronde suisse", async () => {
    const { connection } = connectionHolding(
      { 31: AHEAD },
      { contexts: { 31: { participant_type: "SOLO", swiss_round: 1 } } },
    );
    await noteDepartedEntrants(connection, [DEPARTURE]);
    flushDepartedNotices(connection);
    expect(jest.mocked(announceEntrantsWithdrawn).mock.calls[0][0][0].match).toEqual({
      ...MATCH_31,
      solo: true,
      swiss: true,
    });
  });

  it("lit les marques de toutes les sortantes en une requête", async () => {
    const { mock, connection } = connectionHolding({ 31: AHEAD, 32: AHEAD });
    await noteDepartedEntrants(connection, [
      { matchId: 31, teamId: 101, opponentId: 102 },
      { matchId: 31, teamId: 102, opponentId: 101 },
      { matchId: 32, teamId: 103, opponentId: null },
    ]);
    // Marques, puis contexte : deux lectures pour toutes.
    expect(mock.execute).toHaveBeenCalledTimes(2);
    expect(sqlOf(mock, 0)[1]).toEqual([31, 32, "TOLD"]);
    expect(sqlOf(mock, 1)[1]).toEqual([31, 32]);
    flushDepartedNotices(connection);
    expect(jest.mocked(announceEntrantsWithdrawn).mock.calls[0][0]).toHaveLength(3);
  });

  it("donne pour adversaire l'autre sortante quand sa place était déjà vidée (cascade)", async () => {
    const { connection } = connectionHolding({ 31: AHEAD });
    await noteDepartedEntrants(connection, [
      { matchId: 31, teamId: 101, opponentId: 102 },
      { matchId: 31, teamId: 102, opponentId: null },
    ]);
    flushDepartedNotices(connection);
    const sent = jest.mocked(announceEntrantsWithdrawn).mock.calls[0][0];
    expect(sent.map(({ teamId, opponentId }) => [teamId, opponentId])).toEqual([
      [101, 102],
      [102, 101],
    ]);
  });

  it("ne lit rien sans sortante, ni le contexte sans horaire tenu", async () => {
    const empty = connectionHolding({});
    await noteDepartedEntrants(empty.connection, []);
    expect(empty.mock.execute).not.toHaveBeenCalled();

    await noteDepartedEntrants(empty.connection, [DEPARTURE]);
    expect(empty.mock.execute).toHaveBeenCalledTimes(1);
  });

  it("ne prévient de rien sans horaire reçu, ou après un retrait remis", async () => {
    const helds: Record<number, Date | string | null>[] = [{}, { 31: null }];
    for (const held of helds) {
      const { connection } = connectionHolding(held);
      await noteDepartedEntrants(connection, [DEPARTURE]);
      flushDepartedNotices(connection);
    }
    expect(announceEntrantsWithdrawn).not.toHaveBeenCalled();
  });

  it("ne prévient pas d'un horaire passé depuis plus de 12 heures, mais d'un horaire passé de peu", async () => {
    const old = connectionHolding({ 31: new Date(Date.now() - 13 * 60 * 60 * 1000) });
    await noteDepartedEntrants(old.connection, [DEPARTURE]);
    flushDepartedNotices(old.connection);
    expect(announceEntrantsWithdrawn).not.toHaveBeenCalled();

    const late = connectionHolding({ 31: new Date(Date.now() - 60 * 60 * 1000) });
    await noteDepartedEntrants(late.connection, [DEPARTURE]);
    flushDepartedNotices(late.connection);
    expect(announceEntrantsWithdrawn).toHaveBeenCalledTimes(1);
  });

  it("borne la file d'une transaction, assez haut pour une ronde suisse entière", async () => {
    const { connection } = connectionHolding({ 31: AHEAD });
    const many = Array.from({ length: 520 }, (_, index) => ({ matchId: 31, teamId: 200 + index, opponentId: null }));
    const warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
    await noteDepartedEntrants(connection, many);
    flushDepartedNotices(connection);
    expect(jest.mocked(announceEntrantsWithdrawn).mock.calls[0][0]).toHaveLength(512);
    // Le dépassement se dit dans pm2.
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("8 avis"));
    warn.mockRestore();
  });

  it("jette les avis d'un changement qui n'a pas abouti", async () => {
    const { connection } = connectionHolding({ 31: AHEAD });
    await noteDepartedEntrants(connection, [DEPARTURE]);
    discardDepartedNotices(connection);
    flushDepartedNotices(connection);
    expect(announceEntrantsWithdrawn).not.toHaveBeenCalled();
  });

  it("tolère une table absente, et laisse passer toute autre erreur", async () => {
    const missing = connectionMock();
    missing.execute.mockRejectedValue(Object.assign(new Error("no table"), { code: "ER_NO_SUCH_TABLE", errno: 1146 }));
    await expect(noteDepartedEntrants(fakeConnection(missing), [DEPARTURE])).resolves.toBeUndefined();

    const failing = connectionMock();
    failing.execute.mockRejectedValue(new Error("deadlock"));
    await expect(noteDepartedEntrants(fakeConnection(failing), [DEPARTURE])).rejects.toThrow("deadlock");
  });

  it("n'échoue jamais à l'envoi : l'erreur va dans les journaux", async () => {
    jest.mocked(announceEntrantsWithdrawn).mockRejectedValue(new Error("bot éteint"));
    const error = jest.spyOn(console, "error").mockImplementation(() => undefined);
    const { connection } = connectionHolding({ 31: AHEAD });
    await noteDepartedEntrants(connection, [DEPARTURE]);

    expect(() => flushDepartedNotices(connection)).not.toThrow();
    await new Promise((resolve) => setImmediate(resolve));
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });
});

describe("departuresBetween", () => {
  it("rend les engagées absentes de l'affiche d'après, avec leur adversaire d'avant", () => {
    const before = new Map([
      [1, { team1Id: 10, team2Id: 20 }],
      [2, { team1Id: 30, team2Id: 40 }],
      [3, { team1Id: 50, team2Id: null }],
    ]);
    const after = new Map([
      // 10 reste (dans l'autre place), 20 sort.
      [1, { team1Id: 99, team2Id: 10 }],
      // Inchangée.
      [2, { team1Id: 40, team2Id: 30 }],
    ]);
    expect(departuresBetween(before, after)).toEqual([
      { matchId: 1, teamId: 20, opponentId: 10 },
      // Manche absente d'après (supprimée) : tout le monde sort.
      { matchId: 3, teamId: 50, opponentId: null },
    ]);
  });
});

describe("noteDeletedMatches", () => {
  it("note les deux engagées des manches supprimées qui tenaient un horaire", async () => {
    const { mock, connection } = connectionHolding(
      { 31: AHEAD },
      { doomed: [{ id: 31, team1_id: 101, team2_id: 102 }] },
    );

    await noteDeletedMatches(connection, "tournament_id = ? AND round_number = ?", [7, 3]);

    const [sql, params] = sqlOf(mock, 0);
    // Sous verrou, une seule table : une marque posée par un envoi concurrent
    // n'échappe pas à la lecture qui suit, et l'envoi qui n'a pas encore posé
    // la sienne attend la suppression.
    expect(sql).toBe(
      "SELECT id, team1_id, team2_id, status, start_at FROM bg_matches WHERE tournament_id = ? AND round_number = ? FOR UPDATE",
    );
    expect(params).toEqual([7, 3]);
    expect(sqlOf(mock, 1)[0]).toMatch(/^SELECT match_id, start_at FROM bg_match_reminders[\s\S]*FOR UPDATE$/);
    flushDepartedNotices(connection);
    expect(jest.mocked(announceEntrantsWithdrawn).mock.calls[0][0].map(({ teamId, opponentId }) => [teamId, opponentId])).toEqual([
      [101, 102],
      [102, 101],
    ]);
  });

  it("ne lit rien de plus sans manche visée ni horaire tenu, et tolère une table des marques absente", async () => {
    const { mock, connection } = connectionHolding({});
    await noteDeletedMatches(connection, "tournament_id = ?", [7]);
    expect(mock.execute).toHaveBeenCalledTimes(1);

    const unheld = connectionHolding({}, { doomed: [{ id: 31, team1_id: 101, team2_id: 102 }] });
    await noteDepartedEntrants(unheld.connection, []);
    await noteDeletedMatches(unheld.connection, "tournament_id = ?", [7]);
    // Les places, les marques des joueurs et celle des arbitres ; pas de
    // contexte : aucun horaire tenu.
    expect(unheld.mock.execute).toHaveBeenCalledTimes(3);

    // Table des marques absente : rien n'a jamais été reçu.
    const missing = connectionMock();
    missing.execute
      .mockResolvedValueOnce([[{ id: 31, team1_id: 101, team2_id: 102 }]])
      .mockRejectedValue(Object.assign(new Error("no table"), { code: "ER_NO_SUCH_TABLE", errno: 1146 }));
    await expect(noteDeletedMatches(fakeConnection(missing), "tournament_id = ?", [7])).resolves.toBeUndefined();

    const failing = connectionMock();
    failing.execute.mockRejectedValue(new Error("deadlock"));
    await expect(noteDeletedMatches(fakeConnection(failing), "tournament_id = ?", [7])).rejects.toThrow("deadlock");
  });
});

describe("holdDepartures puis settleDepartures (retour en arrière)", () => {
  it("relève l'horaire avant le geste, ignore les poses intermédiaires, et note les sorties de l'état d'arrivée", async () => {
    const { connection } = connectionHolding({ 31: AHEAD });
    const held = await holdDepartures(connection, [31]);

    // Une exemption tranchée pendant la réconciliation remplace l'occupante
    // intermédiaire : elle n'avait reçu aucun horaire, rien n'est noté.
    await noteDepartedEntrants(connection, [{ matchId: 31, teamId: 109, opponentId: 102 }]);
    settleDepartures(connection, held, [DEPARTURE]);
    flushDepartedNotices(connection);

    expect(announceEntrantsWithdrawn).toHaveBeenCalledWith([{ ...DEPARTURE, heldStartAt: AHEAD, match: MATCH_31 }]);
  });

  it("rend la main une fois réglé, ou quand la transaction échoue", async () => {
    const settled = connectionHolding({ 31: AHEAD });
    settleDepartures(settled.connection, await holdDepartures(settled.connection, [31]), []);
    await noteDepartedEntrants(settled.connection, [DEPARTURE]);
    flushDepartedNotices(settled.connection);
    expect(announceEntrantsWithdrawn).toHaveBeenCalledTimes(1);

    const failed = connectionHolding({ 31: AHEAD });
    await holdDepartures(failed.connection, [31]);
    discardDepartedNotices(failed.connection);
    await noteDepartedEntrants(failed.connection, [DEPARTURE]);
    flushDepartedNotices(failed.connection);
    expect(announceEntrantsWithdrawn).toHaveBeenCalledTimes(2);
  });

  it("ne lit rien sans manche détachée", async () => {
    const { mock, connection } = connectionHolding({});
    expect(await holdDepartures(connection, [])).toEqual({ matchIds: [], held: new Map() });
    expect(mock.execute).not.toHaveBeenCalled();
  });
});

describe("une engagée n'est prévenue qu'une fois par transaction", () => {
  it("ignore une seconde sortie de la même engagée sur la même manche", async () => {
    const { connection } = connectionHolding({ 31: AHEAD });
    await noteDepartedEntrants(connection, [DEPARTURE]);
    await noteDepartedEntrants(connection, [DEPARTURE, { ...DEPARTURE, teamId: 102, opponentId: 101 }]);
    flushDepartedNotices(connection);
    expect(jest.mocked(announceEntrantsWithdrawn).mock.calls[0][0].map(({ teamId }) => teamId)).toEqual([101, 102]);
  });
});

describe("une manche n'est lue qu'une fois par transaction", () => {
  it("une seconde sortie d'une détentrice retrouve l'horaire lu par la première, même après l'effacement des marques", async () => {
    const { mock, connection } = connectionHolding({ 31: AHEAD });
    // 101 quitte la place 1 (adversaire 102) : l'affiche qui a reçu l'horaire est 101-102.
    await noteDepartedEntrants(connection, [DEPARTURE]);
    // Les marques ont été effacées entre-temps (forgetMatchReminders) : relire ne trouverait rien.
    mock.execute.mockResolvedValue([[]]);
    // Puis 102 quitte la place 2 ; l'autre place porte déjà la remplaçante 109.
    await noteDepartedEntrants(connection, [{ matchId: 31, teamId: 102, opponentId: 109 }]);
    expect(mock.execute).toHaveBeenCalledTimes(2);
    flushDepartedNotices(connection);
    const sent = jest.mocked(announceEntrantsWithdrawn).mock.calls[0][0];
    // L'adversaire de l'horaire reçu, pas la remplaçante.
    expect(sent.map(({ teamId, opponentId }) => [teamId, opponentId])).toEqual([
      [101, 102],
      [102, 101],
    ]);
  });

  it("ne prévient pas une engagée posée puis retirée dans la même transaction : elle n'avait rien reçu", async () => {
    const { connection } = connectionHolding({ 31: AHEAD });
    await noteDepartedEntrants(connection, [DEPARTURE]);
    // 109 a pris la place de 101, puis la quitte à son tour.
    await noteDepartedEntrants(connection, [{ matchId: 31, teamId: 109, opponentId: 102 }]);
    flushDepartedNotices(connection);
    expect(jest.mocked(announceEntrantsWithdrawn).mock.calls[0][0].map(({ teamId }) => teamId)).toEqual([101]);
  });

  it("oublie ce qu'elle a lu à la fin de la transaction", async () => {
    const { mock, connection } = connectionHolding({ 31: AHEAD });
    await noteDepartedEntrants(connection, [DEPARTURE]);
    discardDepartedNotices(connection);
    await noteDepartedEntrants(connection, [DEPARTURE]);
    expect(mock.execute.mock.calls.filter(([sql]) => String(sql).startsWith("SELECT match_id"))).toHaveLength(2);
  });
});

describe("withoutSettledLater", () => {
  it("écarte les manches qu'un retour en arrière réglera lui-même, jusqu'à leur règlement", async () => {
    const { connection } = connectionHolding({});
    expect(withoutSettledLater(connection, [31, 32])).toEqual([31, 32]);
    const held = await holdDepartures(connection, [31]);
    expect(withoutSettledLater(connection, [31, 32])).toEqual([32]);
    settleDepartures(connection, held, []);
    expect(withoutSettledLater(connection, [31, 32])).toEqual([31, 32]);
  });
});

describe("lecture des marques par paquets", () => {
  it("borne la liste IN (…) d'une suppression de plateau entier", async () => {
    const doomed = Array.from({ length: 1200 }, (_, index) => ({
      id: index + 1,
      team1_id: 10_000 + index,
      team2_id: null,
      start_at: AHEAD,
    }));
    const { mock, connection } = connectionHolding({}, { doomed });
    await noteDeletedMatches(connection, "tournament_id = ?", [7]);
    for (const key of ["TOLD", "STAFF"]) {
      const reads = mock.execute.mock.calls.filter(
        ([sql, params]) => String(sql).startsWith("SELECT match_id") && (params as unknown[]).at(-1) === key,
      );
      expect(reads.map(([, params]) => (params as unknown[]).length)).toEqual([501, 501, 201]);
    }
  });
});

describe("noteDeletedMatches et retour en arrière", () => {
  it("ne lit ni ne verrouille les marques des manches qu'un retour en arrière règle lui-même", async () => {
    const { mock, connection } = connectionHolding({}, { doomed: [{ id: 31, team1_id: 101, team2_id: 102 }] });
    await holdDepartures(connection, [31]);
    mock.execute.mockClear();
    await noteDeletedMatches(connection, "id IN (?)", [31]);
    // Les places et la marque des arbitres ; pas celle des joueurs, déjà relevée.
    expect(mock.execute.mock.calls.some(([, params]) => (params as unknown[]).at(-1) === "TOLD")).toBe(false);
  });
});

describe("manche supprimée dont l'horaire avait été poussé aux arbitres", () => {
  it("leur pousse le retrait après le commit, avec la manche relevée avant la suppression", async () => {
    const { connection } = connectionHolding(
      {},
      { doomed: [{ id: 31, team1_id: 101, team2_id: 102 }], staff: { 31: AHEAD } },
    );
    await noteDeletedMatches(connection, "tournament_id = ? AND round_number = ?", [7, 3]);
    expect(announceDeletedMatchesToStaff).not.toHaveBeenCalled();
    flushDepartedNotices(connection);
    expect(announceDeletedMatchesToStaff).toHaveBeenCalledWith([
      { matchId: 31, startAt: AHEAD, match: MATCH_31, team1Id: 101, team2Id: 102 },
    ]);
  });

  it("ne pousse rien pour une manche jouée", async () => {
    const played = connectionHolding(
      {},
      { doomed: [{ id: 31, team1_id: 101, team2_id: 102, status: "COMPLETED" }], staff: { 31: AHEAD } },
    );
    await noteDeletedMatches(played.connection, "id IN (?)", [31]);
    flushDepartedNotices(played.connection);

    expect(announceDeletedMatchesToStaff).not.toHaveBeenCalled();
  });

  it("retire l'horaire que montrent leurs appareils, même si la manche en a changé sans les atteindre", async () => {
    // Le changement vers T+1 h n'a atteint personne : la marque est revenue à T.
    const moved = connectionHolding(
      {},
      { doomed: [{ id: 31, team1_id: 101, team2_id: 102, start_at: new Date(AHEAD.getTime() + 3_600_000) }], staff: { 31: AHEAD } },
    );
    await noteDeletedMatches(moved.connection, "id IN (?)", [31]);
    flushDepartedNotices(moved.connection);
    expect(jest.mocked(announceDeletedMatchesToStaff).mock.calls[0][0][0].startAt).toBe(AHEAD);
  });

  it("ne pousse rien pour un horaire trop ancien, ni si la transaction échoue", async () => {
    const old = connectionHolding(
      {},
      { doomed: [{ id: 31, team1_id: 101, team2_id: 102 }], staff: { 31: new Date(Date.now() - 13 * 60 * 60 * 1000) } },
    );
    await noteDeletedMatches(old.connection, "tournament_id = ?", [7]);
    flushDepartedNotices(old.connection);

    const failed = connectionHolding({}, { doomed: [{ id: 31, team1_id: 101, team2_id: 102 }], staff: { 31: AHEAD } });
    await noteDeletedMatches(failed.connection, "tournament_id = ?", [7]);
    discardDepartedNotices(failed.connection);
    flushDepartedNotices(failed.connection);
    expect(announceDeletedMatchesToStaff).not.toHaveBeenCalled();
  });
});
