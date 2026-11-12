import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/database");
jest.mock("@/lib/server/bot-integration");

import type { PoolConnection } from "mysql2/promise";
import { flushBotLogBatch } from "@/lib/server/bot-integration";
import {
  BOT_LOG_RESOLVE_CONCURRENCY,
  BOT_LOG_RESOLVE_INFLIGHT_MAX,
  resetInFlightResolutions,
  BOT_LOG_RESOLVE_SLOTS,
  BOT_LOG_RESOLVE_TIMEOUT_MS,
  discardBotLogs,
  flushBotLogs,
  markResultValidatedByStaff,
  MAX_PENDING_PER_TRANSACTION,
  queueBotLog,
  resolveBotLogs,
  MATCH_READ_REUSE_MS,
  recentReads,
  ROUND_ALERT_READ_CONCURRENCY,
  type MatchReads,
} from "@/lib/server/tournaments/bot-logs";
import { sendBotLog } from "@/lib/server/bot-integration";
import { getDatabase } from "@/lib/server/database";
import { type SqlMock, fakePool } from "../../helpers/sql-double";

/** Une connexion ne sert ici que de clé : la file est indexée par identité. */
function fakeConnection(): PoolConnection {
  return {} as PoolConnection;
}

const TOURNAMENT_ROW = {
  id: 12,
  name: "Coupe BlueGenji",
  format: "SWISS",
  game: "OW",
  max_teams: 16,
  participant_type: "TEAM",
  start_at: new Date("2026-03-14T18:00:00.000Z"),
  organizer_id: 3,
  organizer_pseudo: "Kiro",
  registered_teams: 3,
  champion_name: null,
};

const MATCH_ROW = {
  id: 31,
  bracket: "UPPER",
  round_number: 2,
  team1_score: 2,
  team2_score: 1,
  forfeit_team_id: null,
  is_bye: 0,
  team1_name: "Les Renards",
  team2_name: "Team Nova",
  tournament_id: 12,
  tournament_name: "Coupe BlueGenji",
};

/**
 * Câble la base : chaque requête rend la première ligne restante. Les entrées se
 * résolvent par petits groupes (`BOT_LOG_RESOLVE_CONCURRENCY`) : l'ordre des appels
 * ne vaut que pour une seule entrée, ou des entrées d'une lecture chacune. Plusieurs
 * entrées à plusieurs lectures passent par {@link mockDbByParams}.
 */
function mockDb(rows: unknown[][]): SqlMock {
  const execute = jest.fn<() => Promise<unknown>>();
  for (const result of rows) execute.mockResolvedValueOnce([result]);
  execute.mockResolvedValue([[]]);
  jest.mocked(getDatabase).mockResolvedValue(fakePool({ execute }));
  return execute as unknown as SqlMock;
}

/**
 * Câble la base par le premier paramètre de la requête (identifiant lu), quel que
 * soit l'ordre des appels : sûr sous résolution concurrente.
 */
function mockDbByParams(rowsById: Record<number, unknown[]>): SqlMock {
  const execute = jest.fn<(sql: string, params?: unknown[]) => Promise<unknown>>(async (_sql, params) => [
    rowsById[Number(params?.[0])] ?? [],
  ]);
  jest.mocked(getDatabase).mockResolvedValue(fakePool({ execute }));
  return execute as unknown as SqlMock;
}

/** Requêtes en attente, relâchées à la main ; retient le plus grand nombre en vol. */
function heldQueries(answer: (params?: unknown[]) => unknown[]) {
  const pending: (() => void)[] = [];
  const state = { maxInFlight: 0 };
  const execute = jest.fn<(sql: string, params?: unknown[]) => Promise<unknown>>(
    (_sql, params) =>
      new Promise((resolve) => {
        pending.push(() => resolve([answer(params)]));
        state.maxInFlight = Math.max(state.maxInFlight, pending.length);
      }),
  );
  jest.mocked(getDatabase).mockResolvedValue(fakePool({ execute }));
  const drain = async (): Promise<void> => {
    for (let turn = 0; turn < 200; turn += 1) {
      await new Promise((resolve) => setImmediate(resolve));
      const next = pending.shift();
      if (!next) return;
      next();
    }
  };
  return { execute, state, drain };
}

const OPEN_MATCH_ROW = { ...MATCH_ROW, team1_score: null, team2_score: null, status: "PENDING", referee_user_id: null, self_managed: 0, participant_type: "TEAM" };

beforeEach(() => {
  jest.clearAllMocks();
  resetInFlightResolutions();
  jest.mocked(sendBotLog).mockReturnValue(undefined);
});

describe("file par transaction", () => {
  it("n'envoie rien tant que la transaction n'a pas abouti", async () => {
    const connection = fakeConnection();
    mockDb([[TOURNAMENT_ROW]]);

    queueBotLog(connection, { kind: "tournament_started", tournamentId: 12 });
    await Promise.resolve();

    expect(sendBotLog).not.toHaveBeenCalled();
  });

  it("jette les lignes d'une transaction annulée", async () => {
    const connection = fakeConnection();
    mockDb([[TOURNAMENT_ROW]]);

    queueBotLog(connection, { kind: "tournament_started", tournamentId: 12 });
    discardBotLogs(connection);
    flushBotLogs(connection);
    await new Promise((resolve) => setImmediate(resolve));

    expect(sendBotLog).not.toHaveBeenCalled();
  });

  it("envoie les lignes réservées une fois la transaction validée", async () => {
    const connection = fakeConnection();
    mockDb([[TOURNAMENT_ROW]]);

    queueBotLog(connection, { kind: "tournament_started", tournamentId: 12 });
    flushBotLogs(connection);
    await new Promise((resolve) => setImmediate(resolve));

    expect(sendBotLog).toHaveBeenCalledTimes(1);
    expect(jest.mocked(sendBotLog).mock.calls[0][0]).toContain("Coup d'envoi");
  });

  it("flushBotLogs_tournamentFinished_flushesEveryBatchOfTheTournamentFirst", async () => {
    const connection = fakeConnection();
    mockDb([[TOURNAMENT_ROW]]);
    const order: string[] = [];
    jest.mocked(flushBotLogBatch).mockImplementation(async () => {
      order.push("flush-results");
    });
    jest.mocked(sendBotLog).mockImplementation(async () => {
      order.push("send");
    });

    queueBotLog(connection, { kind: "tournament_finished", tournamentId: 12 });
    flushBotLogs(connection);
    await new Promise((resolve) => setImmediate(resolve));

    // Tous les lots du tournoi (résultats, lancement, forfait), pas les seuls résultats.
    expect(flushBotLogBatch).toHaveBeenCalledWith({ tournamentId: 12 });
    expect(order).toEqual(["flush-results", "send"]);
  });

  it("flushBotLogs_matchResult_tournamentBatchFlushedBeforeTheResult", async () => {
    const connection = fakeConnection();
    mockDb([[MATCH_ROW]]);
    const order: string[] = [];
    jest.mocked(flushBotLogBatch).mockImplementation(async () => {
      order.push("flush-tournament");
    });
    jest.mocked(sendBotLog).mockImplementation(() => {
      order.push("send");
    });

    queueBotLog(connection, { kind: "match_finished", matchId: 31 });
    flushBotLogs(connection);
    await new Promise((resolve) => setImmediate(resolve));

    expect(flushBotLogBatch).toHaveBeenCalledWith({ tournamentId: 12, category: "tournament" });
    expect(order).toEqual(["flush-tournament", "send"]);
  });

  it("flushBotLogs_twoCommits_secondLinesWaitForTheFirstCommitsLines", async () => {
    let releaseTournament: () => void = () => undefined;
    const execute = jest.fn<(sql: string, params?: unknown[]) => Promise<unknown>>((_sql, params) =>
      params?.[0] === 12
        ? new Promise((resolve) => {
            releaseTournament = () => resolve([[TOURNAMENT_ROW]]);
          })
        : Promise.resolve([[MATCH_ROW]]),
    );
    jest.mocked(getDatabase).mockResolvedValue(fakePool({ execute }));
    const first = fakeConnection();
    const second = fakeConnection();

    queueBotLog(first, { kind: "tournament_started", tournamentId: 12 });
    queueBotLog(second, { kind: "match_finished", matchId: 31 });
    flushBotLogs(first);
    flushBotLogs(second);
    await new Promise((resolve) => setImmediate(resolve));
    expect(sendBotLog).not.toHaveBeenCalled();

    releaseTournament();
    await new Promise((resolve) => setImmediate(resolve));
    const messages = jest.mocked(sendBotLog).mock.calls.map(([message]) => message);
    expect(messages).toHaveLength(2);
    expect(messages[0]).toContain("Coup d'envoi");
    expect(messages[1]).toContain("Match terminé");
  });

  it("flushBotLogs_tournamentIdReadAsString_batchedInItsTournament", async () => {
    const connection = fakeConnection();
    mockDb([[{ ...MATCH_ROW, tournament_id: "12" }]]);

    queueBotLog(connection, { kind: "match_finished", matchId: 31 });
    flushBotLogs(connection);
    await new Promise((resolve) => setImmediate(resolve));

    expect(jest.mocked(sendBotLog).mock.calls[0][1]).toEqual({ tournamentId: 12, category: "results" });
  });

  it("markResultValidatedByStaff_resultLineSaysTheStaffValidatedIt", async () => {
    const connection = fakeConnection();
    mockDb([[MATCH_ROW]]);

    markResultValidatedByStaff(connection, 31);
    flushBotLogs(connection);
    await new Promise((resolve) => setImmediate(resolve));

    expect(sendBotLog).toHaveBeenCalledTimes(1);
    expect(jest.mocked(sendBotLog).mock.calls[0][0]).toContain("résultat validé par le staff");
  });

  it("markResultValidatedByStaff_queueFull_validationStillLogged", async () => {
    const connection = fakeConnection();
    const execute = jest.fn<(sql: string, params?: unknown[]) => Promise<unknown>>(async (_sql, params) =>
      params?.includes(31) ? [[MATCH_ROW]] : [[]],
    );
    jest.mocked(getDatabase).mockResolvedValue(fakePool({ execute }));
    for (let teamId = 1; teamId <= MAX_PENDING_PER_TRANSACTION; teamId += 1) {
      queueBotLog(connection, { kind: "forfeit", tournamentId: 12, teamId });
    }

    markResultValidatedByStaff(connection, 31);
    flushBotLogs(connection);
    await new Promise((resolve) => setImmediate(resolve));

    const messages = jest.mocked(sendBotLog).mock.calls.map(([message]) => message);
    expect(messages.some((message) => message.includes("résultat validé par le staff"))).toBe(true);
  });

  it("markResultValidatedByStaff_resultAlreadyQueued_oneLineOnly", async () => {
    const connection = fakeConnection();
    mockDb([[MATCH_ROW]]);

    queueBotLog(connection, { kind: "match_finished", matchId: 31 });
    markResultValidatedByStaff(connection, 31);
    flushBotLogs(connection);
    await new Promise((resolve) => setImmediate(resolve));

    expect(sendBotLog).toHaveBeenCalledTimes(1);
    expect(jest.mocked(sendBotLog).mock.calls[0][0]).toContain("résultat validé par le staff");
  });

  it("discardBotLogs_staffValidation_forgottenWithTheTransaction", async () => {
    const connection = fakeConnection();
    mockDb([[MATCH_ROW]]);

    markResultValidatedByStaff(connection, 31);
    discardBotLogs(connection);
    queueBotLog(connection, { kind: "match_finished", matchId: 31 });
    flushBotLogs(connection);
    await new Promise((resolve) => setImmediate(resolve));

    expect(jest.mocked(sendBotLog).mock.calls[0][0]).not.toContain("validé");
  });

  it("flushBotLogs_tournamentStarted_noResultsFlush", async () => {
    const connection = fakeConnection();
    mockDb([[TOURNAMENT_ROW]]);

    queueBotLog(connection, { kind: "tournament_started", tournamentId: 12 });
    flushBotLogs(connection);
    await new Promise((resolve) => setImmediate(resolve));

    expect(flushBotLogBatch).not.toHaveBeenCalled();
  });

  it("flushBotLogs_tournamentEntry_queuedInItsTournamentBatch", async () => {
    const connection = fakeConnection();
    mockDb([[TOURNAMENT_ROW]]);

    queueBotLog(connection, { kind: "tournament_started", tournamentId: 12 });
    flushBotLogs(connection);
    await new Promise((resolve) => setImmediate(resolve));

    expect(jest.mocked(sendBotLog).mock.calls[0][1]).toEqual({ tournamentId: 12, category: "tournament" });
  });

  it("flushBotLogs_matchResult_queuedInTheTournamentBatchReadFromTheMatch", async () => {
    const connection = fakeConnection();
    mockDb([[MATCH_ROW]]);

    queueBotLog(connection, { kind: "match_finished", matchId: 31 });
    flushBotLogs(connection);
    await new Promise((resolve) => setImmediate(resolve));

    expect(jest.mocked(sendBotLog).mock.calls[0][1]).toEqual({ tournamentId: Number(MATCH_ROW.tournament_id), category: "results" });
  });

  it("ne vide la file qu'une fois : deux flushs ne dupliquent pas la ligne", async () => {
    const connection = fakeConnection();
    mockDb([[TOURNAMENT_ROW]]);

    queueBotLog(connection, { kind: "tournament_started", tournamentId: 12 });
    flushBotLogs(connection);
    flushBotLogs(connection);
    await new Promise((resolve) => setImmediate(resolve));

    expect(sendBotLog).toHaveBeenCalledTimes(1);
  });

  it("ne retient qu'une fois un évènement réservé deux fois dans la même transaction", async () => {
    const connection = fakeConnection();
    mockDb([[TOURNAMENT_ROW]]);

    queueBotLog(connection, { kind: "tournament_finished", tournamentId: 12 });
    queueBotLog(connection, { kind: "tournament_finished", tournamentId: 12 });
    flushBotLogs(connection);
    await new Promise((resolve) => setImmediate(resolve));

    expect(sendBotLog).toHaveBeenCalledTimes(1);
  });

  it("sépare les files de deux transactions concurrentes", async () => {
    const first = fakeConnection();
    const second = fakeConnection();
    mockDb([[TOURNAMENT_ROW]]);

    queueBotLog(first, { kind: "tournament_started", tournamentId: 12 });
    flushBotLogs(second);
    await new Promise((resolve) => setImmediate(resolve));

    expect(sendBotLog).not.toHaveBeenCalled();
  });

  it("plafonne la file, pour qu'un rejeu massif ne la fasse pas enfler", () => {
    const connection = fakeConnection();

    for (let matchId = 1; matchId <= 200; matchId += 1) {
      queueBotLog(connection, { kind: "match_finished", matchId });
    }

    mockDb([]);
    flushBotLogs(connection);
    // La file est plafonnée à 32 entrées : au-delà, rien n'est retenu.
    expect(jest.mocked(sendBotLog).mock.calls.length).toBeLessThanOrEqual(32);
  });

  it("n'échoue jamais quand le bot est injoignable", async () => {
    const connection = fakeConnection();
    mockDb([[TOURNAMENT_ROW]]);
    jest.mocked(sendBotLog).mockImplementation(() => {
      throw new Error("ECONNREFUSED");
    });

    queueBotLog(connection, { kind: "tournament_started", tournamentId: 12 });
    expect(() => flushBotLogs(connection)).not.toThrow();
    await new Promise((resolve) => setImmediate(resolve));
  });
});

describe("resolveBotLogs", () => {
  it("relit les noms après coup, plutôt que de les faire porter au moteur", async () => {
    const execute = mockDb([[{ ...TOURNAMENT_ROW, champion_name: "Les Renards" }]]);

    const [entry] = await resolveBotLogs([{ kind: "tournament_finished", tournamentId: 12 }]);

    expect(entry.message).toContain("Les Renards l'emporte");
    // Le renvoi ne portait que l'identifiant : tout le reste vient de la base.
    expect(execute.mock.calls[0][1]).toEqual([12]);
  });

  it("décrit une inscription avec l'effectif atteint", async () => {
    mockDb([[TOURNAMENT_ROW], [{ name: "Les Renards" }]]);

    const [entry] = await resolveBotLogs([
      { kind: "registration", tournamentId: 12, teamId: 101, byStaff: false },
    ]);

    expect(entry.message).toContain("Les Renards");
    expect(entry.message).toContain("3/16 équipes");
  });

  it("décrit un match tranché avec son score", async () => {
    mockDb([[MATCH_ROW]]);

    const [entry] = await resolveBotLogs([{ kind: "match_finished", matchId: 31 }]);

    expect(entry.message).toContain("Les Renards 2–1 Team Nova");
  });

  it("une alerte arbitre emporte sa manche, que le push nomme et vers laquelle il mène (lot 9-3)", async () => {
    mockDb([[{ ...MATCH_ROW, team1_score: null, team2_score: null, participant_type: "TEAM" }]]);

    const [entry] = await resolveBotLogs([{ kind: "score_conflict", matchId: 31 }]);

    expect(entry.channel).toBe("REFEREE");
    expect(entry.refereeMatch).toEqual({
      tournamentId: 12,
      tournamentName: "Coupe BlueGenji",
      matchId: 31,
      bracket: "UPPER",
      roundNumber: 2,
      swiss: false,
    });
  });

  it("nomme « Ronde N » la manche d'une ronde suisse, au journal comme dans l'alerte", async () => {
    const execute = mockDb([[{ ...MATCH_ROW, swiss_round: 1, team1_score: null, team2_score: null, participant_type: "TEAM" }]]);

    const [entry] = await resolveBotLogs([{ kind: "score_conflict", matchId: 31 }]);

    expect(entry.message).toContain("Ronde 2");
    expect(entry.message).not.toContain("Manche 2");
    expect(entry.refereeMatch).toMatchObject({ swiss: true });
    expect(String(execute.mock.calls[0][0])).toContain("AS swiss_round");
  });

  it("une ligne de journal n'emporte aucune manche", async () => {
    mockDb([[MATCH_ROW]]);

    const [entry] = await resolveBotLogs([{ kind: "match_finished", matchId: 31 }]);

    expect(entry).not.toHaveProperty("refereeMatch");
  });

  it("ignore les byes, dont le score est posé par le moteur", async () => {
    mockDb([[{ ...MATCH_ROW, is_bye: 1 }]]);

    const messages = await resolveBotLogs([{ kind: "match_finished", matchId: 31 }]);

    expect(messages).toEqual([]);
  });

  it("décrit un forfait arbitré, qui ne porte aucun score", async () => {
    mockDb([[{ ...MATCH_ROW, team1_score: null, team2_score: null, forfeit_team_id: 102 }]]);

    const [entry] = await resolveBotLogs([{ kind: "match_finished", matchId: 31 }]);

    expect(entry.message).toContain("Les Renards vs Team Nova");
    expect(entry.message).toContain("(forfait)");
  });

  it("ignore un match sans score enregistré", async () => {
    mockDb([[{ ...MATCH_ROW, team1_score: null, team2_score: null }]]);

    const messages = await resolveBotLogs([{ kind: "match_finished", matchId: 31 }]);

    expect(messages).toEqual([]);
  });

  it("ignore un match dont un engagé manque", async () => {
    mockDb([[{ ...MATCH_ROW, team2_name: null }]]);

    const messages = await resolveBotLogs([{ kind: "match_finished", matchId: 31 }]);

    expect(messages).toEqual([]);
  });

  it("ignore une entrée dont la ligne a disparu entre-temps", async () => {
    mockDb([[]]);

    const messages = await resolveBotLogs([{ kind: "tournament_started", tournamentId: 12 }]);

    expect(messages).toEqual([]);
  });

  it("resolveBotLogs_moreEntriesThanConcurrency_neverMoreThanFourQueriesInFlight", async () => {
    const { state, drain } = heldQueries(() => [TOURNAMENT_ROW]);
    const entries = Array.from({ length: 10 }, () => ({ kind: "tournament_started" as const, tournamentId: 12 }));

    const resolving = resolveBotLogs(entries);
    await drain();

    expect(await resolving).toHaveLength(10);
    expect(BOT_LOG_RESOLVE_CONCURRENCY).toBe(4);
    expect(state.maxInFlight).toBe(4);
  });

  it("resolveBotLogs_sameCallSameMatch_readsOnce", async () => {
    const execute = mockDbByParams({ 31: [OPEN_MATCH_ROW] });
    const reads: MatchReads = new Map();

    const lines = await resolveBotLogs(
      [
        { kind: "score_conflict", matchId: 31 },
        { kind: "score_report_stalled", matchId: 31 },
      ],
      reads,
    );

    expect(lines).toHaveLength(2);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("resolveBotLogs_concurrentCallsBeyondSlots_atMostSixResolutionsInFlight", async () => {
    const { state, drain } = heldQueries(() => [TOURNAMENT_ROW]);
    const batch = () => Array.from({ length: 4 }, () => ({ kind: "tournament_started" as const, tournamentId: 12 }));

    // Trois vidages qui se chevauchent : chacun prendrait 4 places à lui seul.
    const resolving = Promise.all([resolveBotLogs(batch()), resolveBotLogs(batch()), resolveBotLogs(batch())]);
    await drain();
    const lines = await resolving;

    expect(BOT_LOG_RESOLVE_SLOTS).toBe(6);
    expect(state.maxInFlight).toBe(6);
    expect(lines.flat()).toHaveLength(12);
  });

  it("resolveBotLogs_sharedReadsAcrossCalls_reusesEarlierRead", async () => {
    const execute = mockDbByParams({ 31: [OPEN_MATCH_ROW] });
    const reads: MatchReads = new Map();

    await resolveBotLogs([{ kind: "score_conflict", matchId: 31 }], reads);
    const escalations = await resolveBotLogs([{ kind: "score_report_stalled", matchId: 31 }], reads);

    expect(escalations).toHaveLength(1);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("resolveBotLogs_withoutSharedReads_eachCallReadsAgain", async () => {
    const execute = mockDbByParams({ 31: [OPEN_MATCH_ROW] });

    await resolveBotLogs([{ kind: "score_conflict", matchId: 31 }]);
    await resolveBotLogs([{ kind: "score_report_stalled", matchId: 31 }]);

    expect(execute).toHaveBeenCalledTimes(2);
  });

  it("resolveBotLogs_failedReadInSharedMap_laterCallRetries", async () => {
    const execute = jest.fn<() => Promise<unknown>>();
    execute.mockRejectedValueOnce(new Error("ER_LOCK_WAIT_TIMEOUT"));
    execute.mockResolvedValue([[OPEN_MATCH_ROW]]);
    jest.mocked(getDatabase).mockResolvedValue(fakePool({ execute }));
    const reads: MatchReads = new Map();

    const first = await resolveBotLogs([{ kind: "score_conflict", matchId: 31 }], reads);
    const second = await resolveBotLogs([{ kind: "score_conflict", matchId: 31 }], reads);

    expect(first).toEqual([]);
    expect(second).toHaveLength(1);
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it("resolveBotLogs_reusedReadRejected_rereadsTheMatch", async () => {
    // Copie de `recentReads` : l'échec de la lecture d'origine ne l'efface que de la table du vidage.
    const execute = mockDbByParams({ 31: [OPEN_MATCH_ROW] });
    const failed = Promise.reject(new Error("ER_LOCK_WAIT_TIMEOUT"));
    failed.catch(() => undefined);
    const reads: MatchReads = new Map([[31, { startedAt: Date.now(), reading: failed }]]);

    const escalations = await resolveBotLogs([{ kind: "score_report_stalled", matchId: 31 }], reads);

    expect(escalations).toHaveLength(1);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("resolveBotLogs_refereeEntryQueuedBehindLogLines_resolvesFirst", async () => {
    const { execute, drain } = heldQueries((params) => (Number(params?.[0]) === 31 ? [OPEN_MATCH_ROW] : [TOURNAMENT_ROW]));
    const batch = () => Array.from({ length: 4 }, () => ({ kind: "tournament_started" as const, tournamentId: 12 }));

    // Huit lignes de journal : six en cours, deux en attente ; l'alerte arrive après elles.
    const lines = Promise.all([resolveBotLogs(batch()), resolveBotLogs(batch())]);
    await new Promise((resolve) => setImmediate(resolve));
    const alert = resolveBotLogs([{ kind: "score_conflict", matchId: 31 }]);
    await drain();
    await Promise.all([lines, alert]);

    expect(execute.mock.calls[6]?.[1]).toEqual([31]);
  });

  it("resolveBotLogs_resolutionsHangPastTimeout_releaseTheirSlots", async () => {
    jest.useFakeTimers();
    try {
      const execute = jest.fn<(sql: string, params?: unknown[]) => Promise<unknown>>((_sql, params) =>
        Number(params?.[0]) === 13 ? Promise.resolve([[{ ...TOURNAMENT_ROW, id: 13 }]]) : new Promise(() => undefined),
      );
      jest.mocked(getDatabase).mockResolvedValue(fakePool({ execute }));
      const stuck = (count: number) => Array.from({ length: count }, () => ({ kind: "tournament_started" as const, tournamentId: 12 }));

      // Six résolutions qui ne reviendront jamais : toutes les places du module.
      const hanging = Promise.all([resolveBotLogs(stuck(4)), resolveBotLogs(stuck(2))]);
      const later = resolveBotLogs([{ kind: "tournament_started", tournamentId: 13 }]);
      await jest.advanceTimersByTimeAsync(BOT_LOG_RESOLVE_TIMEOUT_MS - 1);
      expect(execute).not.toHaveBeenCalledWith(expect.anything(), [13]);

      await jest.advanceTimersByTimeAsync(1);

      expect(await later).toHaveLength(1);
      expect((await hanging).flat()).toEqual([]);
    } finally {
      jest.useRealTimers();
    }
  });

  it("resolveBotLogs_roundAlertWithManyMatches_readsAtMostThreeAtOnce", async () => {
    const { state, drain } = heldQueries((params) => [{ ...OPEN_MATCH_ROW, id: Number(params?.[0]) }]);
    const roundMatchIds = [31, 32, 33, 34, 35, 36];

    const resolving = resolveBotLogs([
      { kind: "match_no_referee", matchId: 31, pairing: "10:20", roundMatchIds, roundClaimIds: [1, 2, 3, 4, 5, 6] },
    ]);
    await drain();
    const [line] = await resolving;

    expect(ROUND_ALERT_READ_CONCURRENCY).toBe(3);
    expect(state.maxInFlight).toBe(3);
    expect(line.message).toContain("6 matchs");
  });

  it("resolveBotLogs_twoRoundAlertsResolvedConcurrently_eachGetsItsOwnMatches", async () => {
    mockDbByParams({
      31: [{ ...OPEN_MATCH_ROW, id: 31, team1_name: "Les Renards", team2_name: "Team Nova" }],
      32: [{ ...OPEN_MATCH_ROW, id: 32, team1_name: "Les Loups", team2_name: "Team Aube" }],
      41: [{ ...OPEN_MATCH_ROW, id: 41, team1_name: "Les Ours", team2_name: "Team Givre" }],
      42: [{ ...OPEN_MATCH_ROW, id: 42, team1_name: "Les Lynx", team2_name: "Team Brume" }],
    });

    const [first, second] = await resolveBotLogs([
      { kind: "match_no_referee", matchId: 31, pairing: "10:20", roundMatchIds: [31, 32], roundClaimIds: [1, 2] },
      { kind: "match_no_referee", matchId: 41, pairing: "30:40", roundMatchIds: [41, 42], roundClaimIds: [3, 4] },
    ]);

    expect(first.message).toContain("Les Renards vs Team Nova (match #31)");
    expect(first.message).toContain("Les Loups vs Team Aube (match #32)");
    expect(second.message).toContain("Les Ours vs Team Givre (match #41)");
    expect(second.message).toContain("Les Lynx vs Team Brume (match #42)");
  });

  it("resolveBotLogs_laterEntryResolvesFirst_keepsEntryOrder", async () => {
    let releaseFirst: () => void = () => undefined;
    const execute = jest.fn<(sql: string, params?: unknown[]) => Promise<unknown>>((_sql, params) =>
      params?.[0] === 12
        ? new Promise((resolve) => {
            releaseFirst = () => resolve([[TOURNAMENT_ROW]]);
          })
        : Promise.resolve([[{ ...TOURNAMENT_ROW, id: 13, name: "Coupe Nova" }]]),
    );
    jest.mocked(getDatabase).mockResolvedValue(fakePool({ execute }));

    const resolving = resolveBotLogs([
      { kind: "tournament_started", tournamentId: 12 },
      { kind: "tournament_started", tournamentId: 13 },
    ]);
    await new Promise((resolve) => setImmediate(resolve));
    releaseFirst();
    const messages = (await resolving).map((line) => line.message);

    expect(messages).toHaveLength(2);
    expect(messages[0]).toContain("Coupe BlueGenji");
    expect(messages[1]).toContain("Coupe Nova");
  });

  it("resolveBotLogs_noEntries_returnsEmptyWithoutQuery", async () => {
    const execute = mockDb([]);

    expect(await resolveBotLogs([])).toEqual([]);
    expect(execute).not.toHaveBeenCalled();
  });

  it("perd la ligne fautive, pas les suivantes", async () => {
    const execute = jest.fn<() => Promise<unknown>>();
    execute.mockRejectedValueOnce(new Error("ER_LOCK_WAIT_TIMEOUT"));
    execute.mockResolvedValueOnce([[TOURNAMENT_ROW]]);
    jest.mocked(getDatabase).mockResolvedValue(fakePool({ execute }));

    const messages = await resolveBotLogs([
      { kind: "tournament_started", tournamentId: 12 },
      { kind: "tournament_started", tournamentId: 13 },
    ]);

    expect(messages).toHaveLength(1);
  });

  it("ne nomme pas l'organisateur sur Discord, mais dans les journaux du serveur", async () => {
    mockDb([[TOURNAMENT_ROW]]);
    const info = jest.spyOn(console, "info").mockImplementation(() => {});

    const [entry] = await resolveBotLogs([{ kind: "tournament_created", tournamentId: 12 }]);

    expect(entry.message).not.toContain("Kiro");
    expect(entry.message).not.toContain("créé par");
    const audit = String(info.mock.calls[0]?.[0]);
    expect(audit).toContain("[staff-audit]");
    expect(audit).toContain("Kiro (#3)");
    info.mockRestore();
  });

  it("n'écrit pas d'audit quand l'organisateur a disparu, et jamais « null »", async () => {
    mockDb([[{ ...TOURNAMENT_ROW, organizer_id: null, organizer_pseudo: null }]]);
    const info = jest.spyOn(console, "info").mockImplementation(() => {});

    const [entry] = await resolveBotLogs([{ kind: "tournament_created", tournamentId: 12 }]);

    expect(entry.message).not.toContain("null");
    expect(info).not.toHaveBeenCalled();
    info.mockRestore();
  });

  it("n'écrit jamais le nom d'un engagé de tournoi individuel — c'est un pseudo", async () => {
    mockDb([[{ ...TOURNAMENT_ROW, participant_type: "SOLO" }], [{ name: "Nova" }]]);

    const [entry] = await resolveBotLogs([
      { kind: "registration", tournamentId: 12, teamId: 101, byStaff: false },
    ]);

    expect(entry.message).not.toContain("Nova");
    expect(entry.message).toContain("un joueur");
  });

  it("anonymise les deux joueurs d'un match individuel et la championne", async () => {
    mockDb([
      [{ ...MATCH_ROW, participant_type: "SOLO", team1_name: "Nova", team2_name: "Kiro" }],
      [{ ...TOURNAMENT_ROW, participant_type: "SOLO", champion_name: "Nova" }],
    ]);

    const [match, finished] = await resolveBotLogs([
      { kind: "match_finished", matchId: 31 },
      { kind: "tournament_finished", tournamentId: 12 },
    ]);

    for (const entry of [match, finished]) {
      expect(entry.message).not.toContain("Nova");
      expect(entry.message).not.toContain("Kiro");
    }
    expect(finished.message).toContain("un joueur l'emporte");
  });

  it("retombe sur le vocabulaire d'équipe quand le type de participant est douteux", async () => {
    mockDb([[{ ...TOURNAMENT_ROW, participant_type: null }], [{ name: "Les Renards" }]]);

    const [entry] = await resolveBotLogs([
      { kind: "registration", tournamentId: 12, teamId: 101, byStaff: true },
    ]);

    expect(entry.message).toContain("3/16 équipes");
    expect(entry.message).toContain("(ajout du staff)");
  });
});

describe("recentReads", () => {
  const read = (startedAt: number) => ({ startedAt, reading: Promise.resolve(null) });

  it("recentReads_readAtTheLimit_kept", () => {
    const reads: MatchReads = new Map([[31, read(1_000)]]);

    expect([...recentReads(reads, 1_000 + MATCH_READ_REUSE_MS).keys()]).toEqual([31]);
  });

  it("recentReads_readOneMsOverTheLimit_droppedWithoutTouchingTheFlushReads", () => {
    const reads: MatchReads = new Map([[31, read(1_000)]]);

    expect(recentReads(reads, 1_001 + MATCH_READ_REUSE_MS).size).toBe(0);
    expect(reads.size).toBe(1);
  });
});

describe("resolveBotLogs resource bounds", () => {
  it("resolveBotLogs_poolConstants_lookupsNeverExceedPool", () => {
    // Pool de 25 (`lib/server/database.ts`) : résolutions en cours (places + figées) × lectures de manche.
    expect(BOT_LOG_RESOLVE_INFLIGHT_MAX * ROUND_ALERT_READ_CONCURRENCY).toBeLessThanOrEqual(25 - 4);
    expect(BOT_LOG_RESOLVE_INFLIGHT_MAX).toBeGreaterThanOrEqual(BOT_LOG_RESOLVE_SLOTS);
  });

  it("resolveBotLogs_sixHangingResolutions_laterOnesAreShedBeyondInFlightMax", async () => {
    jest.useFakeTimers();
    try {
      const execute = jest.fn<(sql: string, params?: unknown[]) => Promise<unknown>>((_sql, params) =>
        Number(params?.[0]) === 13 ? Promise.resolve([[{ ...TOURNAMENT_ROW, id: 13 }]]) : new Promise(() => undefined),
      );
      jest.mocked(getDatabase).mockResolvedValue(fakePool({ execute }));
      const stuck = (count: number) => Array.from({ length: count }, () => ({ kind: "tournament_started" as const, tournamentId: 12 }));
      const hanging = Promise.all([resolveBotLogs(stuck(4)), resolveBotLogs(stuck(2))]);
      await jest.advanceTimersByTimeAsync(BOT_LOG_RESOLVE_TIMEOUT_MS);
      await hanging;

      // Six requêtes toujours en vol : une seule résolution de plus est lancée, l'autre est ignorée.
      const lines = await resolveBotLogs([
        { kind: "tournament_started", tournamentId: 13 },
        { kind: "tournament_started", tournamentId: 13 },
      ]);

      expect(lines).toHaveLength(1);
      expect(execute.mock.calls.filter(([, params]) => Number(params?.[0]) === 13)).toHaveLength(1);
    } finally {
      jest.useRealTimers();
    }
  });

  it("resolveBotLogs_roundAlertTimesOut_startsNoMoreMatchReads", async () => {
    jest.useFakeTimers();
    try {
      const execute = jest.fn<(sql: string, params?: unknown[]) => Promise<unknown>>(
        (_sql, params) =>
          new Promise((resolve) => {
            setTimeout(() => resolve([[{ ...OPEN_MATCH_ROW, id: Number(params?.[0]) }]]), BOT_LOG_RESOLVE_TIMEOUT_MS + 10_000);
          }),
      );
      jest.mocked(getDatabase).mockResolvedValue(fakePool({ execute }));

      const resolving = resolveBotLogs([
        { kind: "match_no_referee", matchId: 31, pairing: "10:20", roundMatchIds: [31, 32, 33, 34, 35, 36], roundClaimIds: [1, 2, 3, 4, 5, 6] },
      ]);
      await jest.advanceTimersByTimeAsync(BOT_LOG_RESOLVE_TIMEOUT_MS + 20_000);

      expect(await resolving).toEqual([]);
      // Les trois lectures déjà parties finissent ; les trois suivantes ne démarrent jamais.
      expect(execute).toHaveBeenCalledTimes(3);
    } finally {
      jest.useRealTimers();
    }
  });

  it("resolveBotLogs_roundAlertReadFails_stopsReadingTheRestOfTheRound", async () => {
    const execute = jest.fn<(sql: string, params?: unknown[]) => Promise<unknown>>(async (_sql, params) => {
      if (Number(params?.[0]) === 31) throw new Error("ER_CON_COUNT_ERROR");
      return [[{ ...OPEN_MATCH_ROW, id: Number(params?.[0]) }]];
    });
    jest.mocked(getDatabase).mockResolvedValue(fakePool({ execute }));

    const lines = await resolveBotLogs([
      { kind: "match_no_referee", matchId: 31, pairing: "10:20", roundMatchIds: [31, 32, 33, 34, 35, 36], roundClaimIds: [1, 2, 3, 4, 5, 6] },
    ]);

    expect(lines).toEqual([]);
    expect(execute).toHaveBeenCalledTimes(3);
  });

  it("resolveBotLogs_staleSharedRead_readsTheMatchAgain", async () => {
    const execute = mockDbByParams({ 31: [OPEN_MATCH_ROW] });
    const stale = Promise.resolve({ ...OPEN_MATCH_ROW, team1_name: "Ancien nom" } as never);
    const reads: MatchReads = new Map([[31, { startedAt: Date.now() - MATCH_READ_REUSE_MS - 1, reading: stale }]]);

    const lines = await resolveBotLogs([{ kind: "score_report_stalled", matchId: 31 }], reads);

    expect(execute).toHaveBeenCalledTimes(1);
    expect(lines[0]?.message).not.toContain("Ancien nom");
  });

  it("resolveBotLogs_sharedReadFailedForSeveralWaiters_retriesOnlyOnce", async () => {
    const execute = mockDbByParams({ 31: [OPEN_MATCH_ROW] });
    const failed = Promise.reject(new Error("ER_LOCK_WAIT_TIMEOUT"));
    failed.catch(() => undefined);
    const reads: MatchReads = new Map([[31, { startedAt: Date.now(), reading: failed }]]);

    const lines = await resolveBotLogs(
      [
        { kind: "score_report_stalled", matchId: 31 },
        { kind: "score_conflict", matchId: 31 },
      ],
      reads,
    );

    expect(lines).toHaveLength(2);
    expect(execute).toHaveBeenCalledTimes(1);
  });
});
