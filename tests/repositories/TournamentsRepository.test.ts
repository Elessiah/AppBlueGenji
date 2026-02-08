// tests/repositories/TournamentsRepository.test.ts
import { describe, it, expect, beforeEach, jest } from "@jest/globals";
import type {Connection, Pool, PoolConnection} from "mysql2/promise";
import { TournamentsRepository } from "../../lib/data/repositories/TournamentsRepository";
import type { TournamentFormat, TournamentStatus } from "../../lib/types";

function mockPool() {
    const execute = jest.fn() as unknown as Pool["execute"];
    const query = jest.fn() as unknown as Connection["query"];
    const end = jest.fn() as unknown as Connection["end"];

    const db: Partial<Pool> = {
        execute,
        end,
        getConnection: jest.fn() as unknown as () => Promise<PoolConnection>,
        query,
    };

    return db as Pool & { execute: jest.Mock };
}

describe("TournamentService", () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe("createTournament", () => {
        it("insert puis getById (normalize dates + status DRAFT/current_round null)", async () => {
            const db = mockPool();
            const service = new TournamentsRepository(db);

            db.execute.mockImplementationOnce(async () => [{ insertId: 12 } as unknown, []] as unknown);

            const createdAt = new Date("2026-02-01T10:00:00.000Z");
            const startVis = new Date("2026-02-02T10:00:00.000Z");
            db.execute.mockImplementationOnce(
                async () =>
                    [
                        [
                            {
                                id_tournament: 12,
                                organizer_user_id: 5,
                                name: "Cup",
                                description: null,
                                format: "SIMPLE",
                                max_teams: 16,
                                created_at: createdAt,
                                start_visibility_at: startVis,
                                open_registration_at: null,
                                close_registration_at: null,
                                start_at: null,
                                status: "DRAFT",
                                current_round: null,
                            },
                        ] as unknown,
                        [],
                    ] as unknown
            );

            const t = await service.createTournament({
                organizer_user_id: 5,
                name: "Cup",
                format: "SIMPLE" as TournamentFormat,
                max_teams: 16,
                start_visibility_at: startVis,
            });

            expect(db.execute).toHaveBeenNthCalledWith(
                1,
                expect.stringContaining("INSERT INTO " + "tournaments"),
                [5, "Cup", null, "SIMPLE", 16, startVis, null, null, null]
            );
            expect(db.execute).toHaveBeenNthCalledWith(
                2,
                expect.stringContaining("WHERE id_tournament = ?"),
                [12]
            );

            expect(t).toEqual({
                id_tournament: 12,
                organizer_user_id: 5,
                name: "Cup",
                description: null,
                format: "SIMPLE",
                max_teams: 16,
                created_at: new Date(createdAt),
                start_visibility_at: new Date(startVis),
                open_registration_at: null,
                close_registration_at: null,
                start_at: null,
                status: "DRAFT",
                current_round: null,
            });
        });

        it("throw TOURNAMENT_CREATE_FAILED si getById renvoie null", async () => {
            const db = mockPool();
            const service = new TournamentsRepository(db);

            db.execute.mockImplementationOnce(async () => [{ insertId: 12 } as unknown, []] as unknown);
            db.execute.mockImplementationOnce(async () => [[] as unknown, []] as unknown);

            await expect(
                service.createTournament({
                    organizer_user_id: 5,
                    name: "Cup",
                    format: "SIMPLE" as TournamentFormat,
                    max_teams: 16,
                })
            ).rejects.toThrow("TOURNAMENT_CREATE_FAILED");
        });
    });

    describe("getById", () => {
        it("null si pas trouvé", async () => {
            const db = mockPool();
            const service = new TournamentsRepository(db);

            db.execute.mockImplementationOnce(async () => [[] as unknown, []] as unknown);

            await expect(service.getById(1)).resolves.toBeNull();
        });

        it("normalize: dates null + current_round number", async () => {
            const db = mockPool();
            const service = new TournamentsRepository(db);

            const createdAt = new Date("2026-02-01T10:00:00.000Z");

            db.execute.mockImplementationOnce(
                async () =>
                    [
                        [
                            {
                                id_tournament: 1,
                                organizer_user_id: 5,
                                name: "Cup",
                                description: "desc",
                                format: "DOUBLE",
                                max_teams: 8,
                                created_at: createdAt,
                                start_visibility_at: null,
                                open_registration_at: null,
                                close_registration_at: null,
                                start_at: null,
                                status: "READY",
                                current_round: "2",
                            },
                        ] as unknown,
                        [],
                    ] as unknown
            );

            await expect(service.getById(1)).resolves.toEqual({
                id_tournament: 1,
                organizer_user_id: 5,
                name: "Cup",
                description: "desc",
                format: "DOUBLE",
                max_teams: 8,
                created_at: new Date(createdAt),
                start_visibility_at: null,
                open_registration_at: null,
                close_registration_at: null,
                start_at: null,
                status: "READY",
                current_round: 2,
            });
        });
    });

    describe("listByStatus / listVisible", () => {
        it("listByStatus: map normalize", async () => {
            const db = mockPool();
            const service = new TournamentsRepository(db);

            const d = new Date("2026-02-01T10:00:00.000Z");
            db.execute.mockImplementationOnce(
                async () =>
                    [
                        [
                            {
                                id_tournament: 1,
                                organizer_user_id: 1,
                                name: "A",
                                description: null,
                                format: "SIMPLE",
                                max_teams: 16,
                                created_at: d,
                                start_visibility_at: null,
                                open_registration_at: null,
                                close_registration_at: null,
                                start_at: null,
                                status: "DRAFT",
                                current_round: null,
                            },
                        ] as unknown,
                        [],
                    ] as unknown
            );

            const res = await service.listByStatus("DRAFT" as TournamentStatus);

            expect(db.execute).toHaveBeenCalledWith(
                expect.stringContaining("WHERE status = ?"),
                ["DRAFT"]
            );

            expect(res).toEqual([
                {
                    id_tournament: 1,
                    organizer_user_id: 1,
                    name: "A",
                    description: null,
                    format: "SIMPLE",
                    max_teams: 16,
                    created_at: new Date(d),
                    start_visibility_at: null,
                    open_registration_at: null,
                    close_registration_at: null,
                    start_at: null,
                    status: "DRAFT",
                    current_round: null,
                },
            ]);
        });

        it("listVisible: passe now en param", async () => {
            const db = mockPool();
            const service = new TournamentsRepository(db);

            const now = new Date("2026-02-08T00:00:00.000Z");
            db.execute.mockImplementationOnce(async () => [[] as unknown, []] as unknown);

            await service.listVisible(now);

            expect(db.execute).toHaveBeenCalledWith(
                expect.stringContaining("start_visibility_at <= ?"),
                [now]
            );
        });
    });

    describe("updateTournament", () => {
        it("ne fait rien si patch vide", async () => {
            const db = mockPool();
            const service = new TournamentsRepository(db);

            await service.updateTournament(1, {});
            expect(db.execute).not.toHaveBeenCalled();
        });

        it("update ok", async () => {
            const db = mockPool();
            const service = new TournamentsRepository(db);

            db.execute.mockImplementationOnce(async () => [{ affectedRows: 1 } as unknown, []] as unknown);

            const startAt = new Date("2026-02-10T10:00:00.000Z");
            await service.updateTournament(3, { name: "X", start_at: startAt });

            expect(db.execute).toHaveBeenCalledWith(
                expect.stringContaining("UPDATE tournaments SET name = ?, start_at = ?"),
                ["X", startAt, 3]
            );
        });

        it("throw TOURNAMENT_NOT_FOUND si affectedRows != 1", async () => {
            const db = mockPool();
            const service = new TournamentsRepository(db);

            db.execute.mockImplementationOnce(async () => [{ affectedRows: 0 } as unknown, []] as unknown);

            await expect(service.updateTournament(999, { name: "X" })).rejects.toThrow(
                "TOURNAMENT_NOT_FOUND"
            );
        });
    });

    describe("setStatus / setCurrentRound / deleteTournament", () => {
        it("setStatus ok", async () => {
            const db = mockPool();
            const service = new TournamentsRepository(db);

            db.execute.mockImplementationOnce(async () => [{ affectedRows: 1 } as unknown, []] as unknown);

            await expect(service.setStatus(1, "READY" as TournamentStatus)).resolves.toBeUndefined();
        });

        it("setStatus: throw TOURNAMENT_NOT_FOUND", async () => {
            const db = mockPool();
            const service = new TournamentsRepository(db);

            db.execute.mockImplementationOnce(async () => [{ affectedRows: 0 } as unknown, []] as unknown);

            await expect(service.setStatus(1, "READY" as TournamentStatus)).rejects.toThrow(
                "TOURNAMENT_NOT_FOUND"
            );
        });

        it("setCurrentRound ok (null accepté)", async () => {
            const db = mockPool();
            const service = new TournamentsRepository(db);

            db.execute.mockImplementationOnce(async () => [{ affectedRows: 1 } as unknown, []] as unknown);

            await expect(service.setCurrentRound(1, null)).resolves.toBeUndefined();
        });

        it("deleteTournament ok", async () => {
            const db = mockPool();
            const service = new TournamentsRepository(db);

            db.execute.mockImplementationOnce(async () => [{ affectedRows: 1 } as unknown, []] as unknown);

            await expect(service.deleteTournament(1)).resolves.toBeUndefined();
        });
    });

    describe("registrations", () => {
        it("registerTeam ok (seed null par défaut)", async () => {
            const db = mockPool();
            const service = new TournamentsRepository(db);

            db.execute.mockImplementationOnce(async () => [{ affectedRows: 1 } as unknown, []] as unknown);

            await expect(service.registerTeam(1, 2)).resolves.toBeUndefined();

            expect(db.execute).toHaveBeenCalledWith(
                expect.stringContaining("INSERT INTO " + "registrations"),
                [1, 2, null]
            );
        });

        it("registerTeam: throw REGISTRATION_FAILED", async () => {
            const db = mockPool();
            const service = new TournamentsRepository(db);

            db.execute.mockImplementationOnce(async () => [{ affectedRows: 0 } as unknown, []] as unknown);

            await expect(service.registerTeam(1, 2)).rejects.toThrow("REGISTRATION_FAILED");
        });

        it("unregisterTeam ok", async () => {
            const db = mockPool();
            const service = new TournamentsRepository(db);

            db.execute.mockImplementationOnce(async () => [{ affectedRows: 1 } as unknown, []] as unknown);

            await expect(service.unregisterTeam(1, 2)).resolves.toBeUndefined();
        });

        it("unregisterTeam: throw REGISTRATION_NOT_FOUND", async () => {
            const db = mockPool();
            const service = new TournamentsRepository(db);

            db.execute.mockImplementationOnce(async () => [{ affectedRows: 0 } as unknown, []] as unknown);

            await expect(service.unregisterTeam(1, 2)).rejects.toThrow("REGISTRATION_NOT_FOUND");
        });

        it("listRegisteredTeams: map normalize (seed/final_position null/number)", async () => {
            const db = mockPool();
            const service = new TournamentsRepository(db);

            const regAt = new Date("2026-02-01T10:00:00.000Z");

            db.execute.mockImplementationOnce(
                async () =>
                    [
                        [
                            {
                                id_registration: 1,
                                id_tournament: 9,
                                id_team: 3,
                                registered_at: regAt,
                                final_position: null,
                                seed: "2",
                            },
                        ] as unknown,
                        [],
                    ] as unknown
            );

            const res = await service.listRegisteredTeams(9);

            expect(res).toEqual([
                {
                    id_registration: 1,
                    id_tournament: 9,
                    id_team: 3,
                    registered_at: new Date(regAt),
                    final_position: null,
                    seed: 2,
                },
            ]);
        });

        it("setTeamSeed ok", async () => {
            const db = mockPool();
            const service = new TournamentsRepository(db);

            db.execute.mockImplementationOnce(async () => [{ affectedRows: 1 } as unknown, []] as unknown);

            await expect(service.setTeamSeed(1, 2, 5)).resolves.toBeUndefined();
        });

        it("setTeamSeed: throw REGISTRATION_NOT_FOUND", async () => {
            const db = mockPool();
            const service = new TournamentsRepository(db);

            db.execute.mockImplementationOnce(async () => [{ affectedRows: 0 } as unknown, []] as unknown);

            await expect(service.setTeamSeed(1, 2, 5)).rejects.toThrow("REGISTRATION_NOT_FOUND");
        });

        it("setFinalPosition ok", async () => {
            const db = mockPool();
            const service = new TournamentsRepository(db);

            db.execute.mockImplementationOnce(async () => [{ affectedRows: 1 } as unknown, []] as unknown);

            await expect(service.setFinalPosition(1, 2, 1)).resolves.toBeUndefined();
        });

        it("setFinalPosition: throw REGISTRATION_NOT_FOUND", async () => {
            const db = mockPool();
            const service = new TournamentsRepository(db);

            db.execute.mockImplementationOnce(async () => [{ affectedRows: 0 } as unknown, []] as unknown);

            await expect(service.setFinalPosition(1, 2, 1)).rejects.toThrow("REGISTRATION_NOT_FOUND");
        });
    });

    describe("helpers", () => {
        it("countRegistrations: 0 si rows[0] absent", async () => {
            const db = mockPool();
            const service = new TournamentsRepository(db);

            db.execute.mockImplementationOnce(async () => [[] as unknown, []] as unknown);

            await expect(service.countRegistrations(1)).resolves.toBe(0);
        });

        it("countRegistrations: number", async () => {
            const db = mockPool();
            const service = new TournamentsRepository(db);

            db.execute.mockImplementationOnce(async () => [[{ c: 3 }] as unknown, []] as unknown);

            await expect(service.countRegistrations(1)).resolves.toBe(3);
        });

        it("isTeamRegistered: true si une row existe", async () => {
            const db = mockPool();
            const service = new TournamentsRepository(db);

            db.execute.mockImplementationOnce(async () => [[{ 1: 1 }] as unknown, []] as unknown);

            await expect(service.isTeamRegistered(1, 2)).resolves.toBe(true);
        });

        it("isTeamRegistered: false si aucune row", async () => {
            const db = mockPool();
            const service = new TournamentsRepository(db);

            db.execute.mockImplementationOnce(async () => [[] as unknown, []] as unknown);

            await expect(service.isTeamRegistered(1, 2)).resolves.toBe(false);
        });
    });
});
