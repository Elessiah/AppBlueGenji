// tests/repositories/MatchesRepository.test.ts
import { describe, it, expect, beforeEach, jest } from "@jest/globals";
import type { Connection } from "mysql2/promise";
import { MatchRepository } from "../../lib/data/repositories/MatchesRepository";

function mockConn(){
    const execute = jest.fn() as unknown as Connection["execute"];
    const beginTransaction = jest.fn() as unknown as Connection["beginTransaction"];
    const commit = jest.fn() as unknown as Connection["commit"];
    const rollback = jest.fn() as unknown as Connection["rollback"];
    const end = jest.fn() as unknown as Connection["end"];

    const db: Partial<Connection> = {
        execute,
        beginTransaction,
        commit,
        rollback,
        end,
    };

    return db as Connection & {
        execute: jest.Mock;
        beginTransaction: jest.Mock;
        commit: jest.Mock;
        rollback: jest.Mock;
        end: jest.Mock;
    };
}

describe("MatchService", () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe("createMatch", () => {
        it("insert puis getById", async () => {
            const db = mockConn();
            const service = new MatchRepository(db);

            db.execute.mockImplementationOnce(async () => [{ insertId: 10 } as unknown, []] as unknown);

            const startAt = new Date("2026-02-01T10:00:00.000Z");
            db.execute.mockImplementationOnce(
                async () =>
                    [
                        [
                            {
                                id_match: 10,
                                id_tournament: 2,
                                start_at: startAt,
                                round: 1,
                                bracket: "UPPER",
                                match_index: 0,
                            },
                        ] as unknown,
                        [],
                    ] as unknown
            );

            const m = await service.createMatch({
                id_tournament: 2,
                round: 1,
                bracket: "UPPER",
                match_index: 0,
                start_at: startAt,
            });

            expect(db.execute).toHaveBeenNthCalledWith(
                1,
                expect.stringContaining("INSERT INTO " + "matches"),
                [2, startAt, 1, "UPPER", 0]
            );
            expect(db.execute).toHaveBeenNthCalledWith(
                2,
                expect.stringContaining("WHERE id_match = ?"),
                [10]
            );

            expect(m).toEqual({
                id_match: 10,
                id_tournament: 2,
                start_at: new Date(startAt),
                round: 1,
                bracket: "UPPER",
                match_index: 0,
            });
        });

        it("throw MATCH_CREATE_FAILED si getById renvoie null", async () => {
            const db = mockConn();
            const service = new MatchRepository(db);

            db.execute.mockImplementationOnce(async () => [{ insertId: 10 } as unknown, []] as unknown);
            db.execute.mockImplementationOnce(async () => [[] as unknown, []] as unknown);

            await expect(
                service.createMatch({ id_tournament: 2, round: 1 })
            ).rejects.toThrow("MATCH_CREATE_FAILED");
        });
    });

    describe("getById", () => {
        it("null si pas trouvé", async () => {
            const db = mockConn();
            const service = new MatchRepository(db);

            db.execute.mockImplementationOnce(async () => [[] as unknown, []] as unknown);

            await expect(service.getById(1)).resolves.toBeNull();
        });

        it("normalize start_at null + types", async () => {
            const db = mockConn();
            const service = new MatchRepository(db);

            db.execute.mockImplementationOnce(
                async () =>
                    [
                        [
                            {
                                id_match: 1,
                                id_tournament: 3,
                                start_at: null,
                                round: "2",
                                bracket: null,
                                match_index: null,
                            },
                        ] as unknown,
                        [],
                    ] as unknown
            );

            await expect(service.getById(1)).resolves.toEqual({
                id_match: 1,
                id_tournament: 3,
                start_at: null,
                round: 2,
                bracket: null,
                match_index: null,
            });
        });
    });

    describe("listByTournament / listByRound", () => {
        it("listByTournament: map normalize", async () => {
            const db = mockConn();
            const service = new MatchRepository(db);

            const d = new Date("2026-02-01T10:00:00.000Z");
            db.execute.mockImplementationOnce(
                async () =>
                    [
                        [
                            {
                                id_match: 1,
                                id_tournament: 9,
                                start_at: d,
                                round: 1,
                                bracket: "UPPER",
                                match_index: 0,
                            },
                            {
                                id_match: 2,
                                id_tournament: 9,
                                start_at: null,
                                round: 2,
                                bracket: null,
                                match_index: null,
                            },
                        ] as unknown,
                        [],
                    ] as unknown
            );

            const res = await service.listByTournament(9);

            expect(db.execute).toHaveBeenCalledWith(
                expect.stringContaining("FROM matches"),
                [9]
            );

            expect(res).toEqual([
                {
                    id_match: 1,
                    id_tournament: 9,
                    start_at: new Date(d),
                    round: 1,
                    bracket: "UPPER",
                    match_index: 0,
                },
                {
                    id_match: 2,
                    id_tournament: 9,
                    start_at: null,
                    round: 2,
                    bracket: null,
                    match_index: null,
                },
            ]);
        });

        it("listByRound: passe bracket null par défaut", async () => {
            const db = mockConn();
            const service = new MatchRepository(db);

            db.execute.mockImplementationOnce(async () => [[] as unknown, []] as unknown);

            await service.listByRound(1, 2);

            expect(db.execute).toHaveBeenCalledWith(
                expect.stringContaining("WHERE id_tournament = ? AND round = ?"),
                [1, 2, null, null]
            );
        });
    });

    describe("updateMatch", () => {
        it("ne fait rien si patch vide", async () => {
            const db = mockConn();
            const service = new MatchRepository(db);

            await service.updateMatch(1, {});
            expect(db.execute).not.toHaveBeenCalled();
        });

        it("update ok", async () => {
            const db = mockConn();
            const service = new MatchRepository(db);

            db.execute.mockImplementationOnce(async () => [{ affectedRows: 1 } as unknown, []] as unknown);

            const d = new Date("2026-02-01T10:00:00.000Z");
            await service.updateMatch(5, { start_at: d, match_index: 3 });

            expect(db.execute).toHaveBeenCalledWith(
                expect.stringContaining("UPDATE matches SET"),
                [d, 3, 5]
            );
        });

        it("throw MATCH_NOT_FOUND si affectedRows != 1", async () => {
            const db = mockConn();
            const service = new MatchRepository(db);

            db.execute.mockImplementationOnce(async () => [{ affectedRows: 0 } as unknown, []] as unknown);

            await expect(service.updateMatch(5, { round: 2 })).rejects.toThrow("MATCH_NOT_FOUND");
        });
    });

    describe("deleteMatch", () => {
        it("ok", async () => {
            const db = mockConn();
            const service = new MatchRepository(db);

            db.execute.mockImplementationOnce(async () => [{ affectedRows: 1 } as unknown, []] as unknown);
            await expect(service.deleteMatch(1)).resolves.toBeUndefined();
        });

        it("throw MATCH_NOT_FOUND", async () => {
            const db = mockConn();
            const service = new MatchRepository(db);

            db.execute.mockImplementationOnce(async () => [{ affectedRows: 0 } as unknown, []] as unknown);
            await expect(service.deleteMatch(1)).rejects.toThrow("MATCH_NOT_FOUND");
        });
    });

    describe("participations", () => {
        it("addTeamToMatch: insert puis getParticipationById", async () => {
            const db = mockConn();
            const service = new MatchRepository(db);

            db.execute.mockImplementationOnce(async () => [{ insertId: 55 } as unknown, []] as unknown);
            db.execute.mockImplementationOnce(
                async () =>
                    [
                        [
                            {
                                id_participation: 55,
                                id_match: 9,
                                id_team: 3,
                                score: "0",
                                is_winner: 0,
                            },
                        ] as unknown,
                        [],
                    ] as unknown
            );

            const p = await service.addTeamToMatch(9, 3);

            expect(p).toEqual({
                id_participation: 55,
                id_match: 9,
                id_team: 3,
                score: 0,
                is_winner: false,
            });
        });

        it("addTeamToMatch: throw PARTICIPATION_CREATE_FAILED si getParticipationById null", async () => {
            const db = mockConn();
            const service = new MatchRepository(db);

            db.execute.mockImplementationOnce(async () => [{ insertId: 55 } as unknown, []] as unknown);
            db.execute.mockImplementationOnce(async () => [[] as unknown, []] as unknown);

            await expect(service.addTeamToMatch(9, 3)).rejects.toThrow("PARTICIPATION_CREATE_FAILED");
        });

        it("getParticipationById: null si pas trouvé", async () => {
            const db = mockConn();
            const service = new MatchRepository(db);

            db.execute.mockImplementationOnce(async () => [[] as unknown, []] as unknown);

            await expect(service.getParticipationById(1)).resolves.toBeNull();
        });

        it("listParticipations: map normalize", async () => {
            const db = mockConn();
            const service = new MatchRepository(db);

            db.execute.mockImplementationOnce(
                async () =>
                    [
                        [
                            { id_participation: 1, id_match: 2, id_team: 3, score: 1, is_winner: 0 },
                            { id_participation: 2, id_match: 2, id_team: 4, score: "2", is_winner: 1 },
                        ] as unknown,
                        [],
                    ] as unknown
            );

            const res = await service.listParticipations(2);

            expect(res).toEqual([
                { id_participation: 1, id_match: 2, id_team: 3, score: 1, is_winner: false },
                { id_participation: 2, id_match: 2, id_team: 4, score: 2, is_winner: true },
            ]);
        });

        it("setScore: ok", async () => {
            const db = mockConn();
            const service = new MatchRepository(db);

            db.execute.mockImplementationOnce(async () => [{ affectedRows: 1 } as unknown, []] as unknown);

            await expect(service.setScore(1, 2, 5)).resolves.toBeUndefined();
        });

        it("setScore: throw PARTICIPATION_NOT_FOUND", async () => {
            const db = mockConn();
            const service = new MatchRepository(db);

            db.execute.mockImplementationOnce(async () => [{ affectedRows: 0 } as unknown, []] as unknown);

            await expect(service.setScore(1, 2, 5)).rejects.toThrow("PARTICIPATION_NOT_FOUND");
        });

        it("removeTeamFromMatch: ok", async () => {
            const db = mockConn();
            const service = new MatchRepository(db);

            db.execute.mockImplementationOnce(async () => [{ affectedRows: 1 } as unknown, []] as unknown);

            await expect(service.removeTeamFromMatch(1, 2)).resolves.toBeUndefined();
        });

        it("removeTeamFromMatch: throw PARTICIPATION_NOT_FOUND", async () => {
            const db = mockConn();
            const service = new MatchRepository(db);

            db.execute.mockImplementationOnce(async () => [{ affectedRows: 0 } as unknown, []] as unknown);

            await expect(service.removeTeamFromMatch(1, 2)).rejects.toThrow("PARTICIPATION_NOT_FOUND");
        });
    });

    describe("setWinner", () => {
        it("transaction ok: update all false, update winner true, commit, end", async () => {
            const db = mockConn();
            const service = new MatchRepository(db);

            // @ts-expect-error Problème de conversion
            db.beginTransaction.mockResolvedValueOnce(undefined);

            // update all false
            db.execute.mockImplementationOnce(async () => [{ affectedRows: 2 } as unknown, []] as unknown);

            // update winner true
            db.execute.mockImplementationOnce(async () => [{ affectedRows: 1 } as unknown, []] as unknown);

            // @ts-expect-error Problème de conversion
            db.commit.mockResolvedValueOnce(undefined);
            // @ts-expect-error Problème de conversion
            db.end.mockResolvedValueOnce(undefined);

            await expect(service.setWinner(10, 7)).resolves.toBeUndefined();

            expect(db.beginTransaction).toHaveBeenCalledTimes(1);
            expect(db.commit).toHaveBeenCalledTimes(1);
            expect(db.rollback).not.toHaveBeenCalled();
            expect(db.end).toHaveBeenCalledTimes(1);

            expect(db.execute).toHaveBeenNthCalledWith(
                1,
                expect.stringContaining("SET is_winner = false"),
                [10]
            );
            expect(db.execute).toHaveBeenNthCalledWith(
                2,
                expect.stringContaining("SET is_winner = true"),
                [10, 7]
            );
        });

        it("rollback si winner pas dans le match + end appelé", async () => {
            const db = mockConn();
            const service = new MatchRepository(db);

            // @ts-expect-error Problème de conversion
            db.beginTransaction.mockResolvedValueOnce(undefined);

            // update all false ok
            db.execute.mockImplementationOnce(async () => [{ affectedRows: 2 } as unknown, []] as unknown);

            // update winner true => 0 rows
            db.execute.mockImplementationOnce(async () => [{ affectedRows: 0 } as unknown, []] as unknown);

            // @ts-expect-error Problème de conversion
            db.rollback.mockResolvedValueOnce(undefined);
            // @ts-expect-error Problème de conversion
            db.end.mockResolvedValueOnce(undefined);

            await expect(service.setWinner(10, 999)).rejects.toThrow("WINNER_TEAM_NOT_IN_MATCH");

            expect(db.commit).not.toHaveBeenCalled();
            expect(db.rollback).toHaveBeenCalledTimes(1);
            expect(db.end).toHaveBeenCalledTimes(1);
        });

        it("rollback si erreur SQL sur update all false + end appelé", async () => {
            const db = mockConn();
            const service = new MatchRepository(db);

            // @ts-expect-error Problème de conversion
            db.beginTransaction.mockResolvedValueOnce(undefined);

            db.execute.mockImplementationOnce(async () => {
                throw new Error("SQL_FAIL");
            });

            // @ts-expect-error Problème de conversion
            db.rollback.mockResolvedValueOnce(undefined);
            // @ts-expect-error Problème de conversion
            db.end.mockResolvedValueOnce(undefined);

            await expect(service.setWinner(10, 7)).rejects.toThrow("SQL_FAIL");

            expect(db.rollback).toHaveBeenCalledTimes(1);
            expect(db.end).toHaveBeenCalledTimes(1);
        });
    });

    describe("helpers", () => {
        it("getWinnerTeamId: null si pas de winner", async () => {
            const db = mockConn();
            const service = new MatchRepository(db);

            db.execute.mockImplementationOnce(async () => [[] as unknown, []] as unknown);

            await expect(service.getWinnerTeamId(1)).resolves.toBeNull();
        });

        it("getWinnerTeamId: number", async () => {
            const db = mockConn();
            const service = new MatchRepository(db);

            db.execute.mockImplementationOnce(async () => [[{ id_team: "7" }] as unknown, []] as unknown);

            await expect(service.getWinnerTeamId(1)).resolves.toBe(7);
        });

        it("setMatchStartAt: ok", async () => {
            const db = mockConn();
            const service = new MatchRepository(db);

            db.execute.mockImplementationOnce(async () => [{ affectedRows: 1 } as unknown, []] as unknown);

            const d = new Date("2026-02-01T10:00:00.000Z");
            await expect(service.setMatchStartAt(1, d)).resolves.toBeUndefined();
        });

        it("setMatchStartAt: throw MATCH_NOT_FOUND", async () => {
            const db = mockConn();
            const service = new MatchRepository(db);

            db.execute.mockImplementationOnce(async () => [{ affectedRows: 0 } as unknown, []] as unknown);

            await expect(service.setMatchStartAt(1, null)).rejects.toThrow("MATCH_NOT_FOUND");
        });
    });
});
