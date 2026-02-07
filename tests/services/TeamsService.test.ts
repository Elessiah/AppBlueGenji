// tests/services/TeamsService.test.ts
import { describe, it, expect, beforeEach, jest } from "@jest/globals";
import type { Connection } from "mysql2/promise";
import { TeamService } from "../../lib/services/TeamsService";

function mockConn() {
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

describe("TeamService", () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe("createTeam", () => {
        it("crée une équipe, crée le membership OWNER, commit, puis retourne getById", async () => {
            const db = mockConn();
            const service = new TeamService(db);

            // beginTransaction
            // @ts-expect-error Problème de conversion
            db.beginTransaction.mockResolvedValueOnce(undefined);

            // INSERT teams -> insertId
            db.execute.mockImplementationOnce(async () => [{ insertId: 7 } as unknown, []] as unknown);

            // INSERT memberships OWNER -> ok
            db.execute.mockImplementationOnce(async () => [{ affectedRows: 1 } as unknown, []] as unknown);

            // commit
            // @ts-expect-error Problème de conversion
            db.commit.mockResolvedValueOnce(undefined);

            // getById (appelé à la fin de createTeam)
            const createdAt = new Date("2026-02-01T10:00:00.000Z");
            db.execute.mockImplementationOnce(
                async () =>
                    [[{ id_team: 7, name: "Alpha", created_at: createdAt }] as unknown, []] as unknown
            );

            const team = await service.createTeam("Alpha", 42);

            expect(db.beginTransaction).toHaveBeenCalledTimes(1);
            expect(db.execute).toHaveBeenNthCalledWith(
                1,
                expect.stringContaining("INSERT INTO " + "teams"),
                ["Alpha"]
            );
            expect(db.execute).toHaveBeenNthCalledWith(
                2,
                expect.stringContaining("INSERT INTO" + " memberships"),
                [42, 7]
            );
            expect(db.commit).toHaveBeenCalledTimes(1);
            expect(db.rollback).not.toHaveBeenCalled();

            expect(team).toEqual({
                id_team: 7,
                name: "Alpha",
                created_at: new Date(createdAt),
            });

            // finally
            expect(db.end).toHaveBeenCalledTimes(1);
        });

        it("rollback si erreur pendant l'insert membership", async () => {
            const db = mockConn();
            const service = new TeamService(db);

            // @ts-expect-error Problème de conversion
            db.beginTransaction.mockResolvedValueOnce(undefined);

            db.execute.mockImplementationOnce(async () => [{ insertId: 7 } as unknown, []] as unknown);

            db.execute.mockImplementationOnce(async () => {
                throw new Error("SQL_FAIL");
            });

            // @ts-expect-error Problème de conversion
            db.rollback.mockResolvedValueOnce(undefined);

            await expect(service.createTeam("Alpha", 42)).rejects.toThrow("SQL_FAIL");

            expect(db.commit).not.toHaveBeenCalled();
            expect(db.rollback).toHaveBeenCalledTimes(1);
            expect(db.end).toHaveBeenCalledTimes(1);
        });

        it("throw TEAM_CREATE_FAILED si getById renvoie null", async () => {
            const db = mockConn();
            const service = new TeamService(db);

            // @ts-expect-error Problème de conversion
            db.beginTransaction.mockResolvedValueOnce(undefined);

            db.execute.mockImplementationOnce(async () => [{ insertId: 7 } as unknown, []] as unknown);
            db.execute.mockImplementationOnce(async () => [{ affectedRows: 1 } as unknown, []] as unknown);

            // @ts-expect-error Problème de conversion
            db.commit.mockResolvedValueOnce(undefined);

            // getById -> rows vides
            db.execute.mockImplementationOnce(async () => [[] as unknown, []] as unknown);

            // @ts-expect-error Problème de conversion
            db.rollback.mockResolvedValueOnce(undefined);

            await expect(service.createTeam("Alpha", 42)).rejects.toThrow("TEAM_CREATE_FAILED");

            // Comme l'erreur est levée après commit, le catch rollback quand même
            expect(db.rollback).toHaveBeenCalledTimes(1);
            expect(db.end).toHaveBeenCalledTimes(1);
        });
    });

    describe("getById / getByName", () => {
        it("getById: null si pas de row", async () => {
            const db = mockConn();
            const service = new TeamService(db);

            db.execute.mockImplementationOnce(async () => [[] as unknown, []] as unknown);

            await expect(service.getById(1)).resolves.toBeNull();
        });

        it("getById: normalize", async () => {
            const db = mockConn();
            const service = new TeamService(db);

            const createdAt = new Date("2026-02-01T10:00:00.000Z");
            db.execute.mockImplementationOnce(
                async () => [[{ id_team: 1, name: "Alpha", created_at: createdAt }] as unknown, []] as unknown
            );

            await expect(service.getById(1)).resolves.toEqual({
                id_team: 1,
                name: "Alpha",
                created_at: new Date(createdAt),
            });
        });

        it("getByName: normalize", async () => {
            const db = mockConn();
            const service = new TeamService(db);

            const createdAt = new Date("2026-02-01T10:00:00.000Z");
            db.execute.mockImplementationOnce(
                async () => [[{ id_team: 2, name: "Beta", created_at: createdAt }] as unknown, []] as unknown
            );

            await expect(service.getByName("Beta")).resolves.toEqual({
                id_team: 2,
                name: "Beta",
                created_at: new Date(createdAt),
            });
        });
    });

    describe("listTeams", () => {
        it("map normalize + tri géré côté SQL", async () => {
            const db = mockConn();
            const service = new TeamService(db);

            const d1 = new Date("2026-02-02T10:00:00.000Z");
            const d2 = new Date("2026-02-01T10:00:00.000Z");
            db.execute.mockImplementationOnce(
                async () =>
                    [
                        [
                            { id_team: 1, name: "A", created_at: d1 },
                            { id_team: 2, name: "B", created_at: d2 },
                        ] as unknown,
                        [],
                    ] as unknown
            );

            const teams = await service.listTeams();
            expect(teams).toEqual([
                { id_team: 1, name: "A", created_at: new Date(d1) },
                { id_team: 2, name: "B", created_at: new Date(d2) },
            ]);
        });
    });

    describe("addMember", () => {
        it("throw MEMBERSHIP_ALREADY_ACTIVE si membership actif existe", async () => {
            const db = mockConn();
            const service = new TeamService(db);

            // SELECT active -> une row
            db.execute.mockImplementationOnce(async () => [[{ 1: 1 }] as unknown, []] as unknown);

            await expect(service.addMember(1, 2, "MEMBER")).rejects.toThrow(
                "MEMBERSHIP_ALREADY_ACTIVE"
            );

            expect(db.execute).toHaveBeenCalledTimes(1);
        });

        it("insert membership si pas actif", async () => {
            const db = mockConn();
            const service = new TeamService(db);

            // SELECT active -> vide
            db.execute.mockImplementationOnce(async () => [[] as unknown, []] as unknown);

            // INSERT membership
            db.execute.mockImplementationOnce(async () => [{ affectedRows: 1 } as unknown, []] as unknown);

            await expect(service.addMember(1, 2, "OWNER")).resolves.toBeUndefined();

            expect(db.execute).toHaveBeenNthCalledWith(
                2,
                expect.stringContaining("INSERT INTO " + "memberships"),
                [2, 1, "OWNER"]
            );
        });
    });

    describe("leaveTeam", () => {
        it("ok si affectedRows > 0", async () => {
            const db = mockConn();
            const service = new TeamService(db);

            db.execute.mockImplementationOnce(async () => [{ affectedRows: 1 } as unknown, []] as unknown);

            await expect(service.leaveTeam(1, 2)).resolves.toBeUndefined();
        });

        it("throw NO_ACTIVE_MEMBERSHIP si affectedRows == 0", async () => {
            const db = mockConn();
            const service = new TeamService(db);

            db.execute.mockImplementationOnce(async () => [{ affectedRows: 0 } as unknown, []] as unknown);

            await expect(service.leaveTeam(1, 2)).rejects.toThrow("NO_ACTIVE_MEMBERSHIP");
        });
    });

    describe("setMemberRole", () => {
        it("ok si affectedRows > 0", async () => {
            const db = mockConn();
            const service = new TeamService(db);

            db.execute.mockImplementationOnce(async () => [{ affectedRows: 1 } as unknown, []] as unknown);

            await expect(service.setMemberRole(1, 2, "OWNER")).resolves.toBeUndefined();
        });

        it("throw NO_ACTIVE_MEMBERSHIP si affectedRows == 0", async () => {
            const db = mockConn();
            const service = new TeamService(db);

            db.execute.mockImplementationOnce(async () => [{ affectedRows: 0 } as unknown, []] as unknown);

            await expect(service.setMemberRole(1, 2, "OWNER")).rejects.toThrow("NO_ACTIVE_MEMBERSHIP");
        });
    });

    describe("listMembers / getActiveMembers", () => {
        it("listMembers: normalizeMembership (left_at peut être null)", async () => {
            const db = mockConn();
            const service = new TeamService(db);

            const joined = new Date("2026-02-01T10:00:00.000Z");
            const left = new Date("2026-02-02T10:00:00.000Z");

            db.execute.mockImplementationOnce(
                async () =>
                    [
                        [
                            {
                                id_membership: 1,
                                id_user: 10,
                                id_team: 5,
                                joined_at: joined,
                                left_at: null,
                                role: "MEMBER",
                            },
                            {
                                id_membership: 2,
                                id_user: 11,
                                id_team: 5,
                                joined_at: joined,
                                left_at: left,
                                role: "ADMIN",
                            },
                        ] as unknown,
                        [],
                    ] as unknown
            );

            const members = await service.listMembers(5);
            expect(members).toEqual([
                {
                    id_membership: 1,
                    id_user: 10,
                    id_team: 5,
                    joined_at: new Date(joined),
                    left_at: null,
                    role: "MEMBER",
                },
                {
                    id_membership: 2,
                    id_user: 11,
                    id_team: 5,
                    joined_at: new Date(joined),
                    left_at: new Date(left),
                    role: "ADMIN",
                },
            ]);
        });

        it("getActiveMembers: normalizeMembership", async () => {
            const db = mockConn();
            const service = new TeamService(db);

            const joined = new Date("2026-02-01T10:00:00.000Z");

            db.execute.mockImplementationOnce(
                async () =>
                    [
                        [
                            {
                                id_membership: 1,
                                id_user: 10,
                                id_team: 5,
                                joined_at: joined,
                                left_at: null,
                                role: "OWNER",
                            },
                        ] as unknown,
                        [],
                    ] as unknown
            );

            const members = await service.getActiveMembers(5);
            expect(members).toEqual([
                {
                    id_membership: 1,
                    id_user: 10,
                    id_team: 5,
                    joined_at: new Date(joined),
                    left_at: null,
                    role: "OWNER",
                },
            ]);
        });
    });

    describe("isMemberActive", () => {
        it("true si row existe", async () => {
            const db = mockConn();
            const service = new TeamService(db);

            db.execute.mockImplementationOnce(async () => [[{ 1: 1 }] as unknown, []] as unknown);

            await expect(service.isMemberActive(1, 2)).resolves.toBe(true);
        });

        it("false si aucune row", async () => {
            const db = mockConn();
            const service = new TeamService(db);

            db.execute.mockImplementationOnce(async () => [[] as unknown, []] as unknown);

            await expect(service.isMemberActive(1, 2)).resolves.toBe(false);
        });
    });

    describe("deleteTeam", () => {
        it("ok si affectedRows == 1", async () => {
            const db = mockConn();
            const service = new TeamService(db);

            db.execute.mockImplementationOnce(async () => [{ affectedRows: 1 } as unknown, []] as unknown);

            await expect(service.deleteTeam(1)).resolves.toBeUndefined();
        });

        it("throw TEAM_NOT_FOUND si affectedRows != 1", async () => {
            const db = mockConn();
            const service = new TeamService(db);

            db.execute.mockImplementationOnce(async () => [{ affectedRows: 0 } as unknown, []] as unknown);

            await expect(service.deleteTeam(999)).rejects.toThrow("TEAM_NOT_FOUND");
        });
    });
});
