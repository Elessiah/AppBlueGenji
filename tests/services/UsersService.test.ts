// __tests__/UserService.test.ts
import type { Connection } from "mysql2/promise";
import crypto from "node:crypto";
import bcrypt from "bcrypt";
import { UserService } from "../../lib/services/UsersService";
import { describe, it, expect, beforeEach, jest } from "@jest/globals";

jest.mock("bcrypt", () => ({
    __esModule: true,
    default: {
        hash: jest.fn(),
        compare: jest.fn(),
    },
}));

function mockConn() {
    const db: Partial<Connection> = {
        execute: jest.fn() as unknown as Connection["execute"],
    };
    return db as Connection & { execute: jest.Mock };
}

describe("UserService", () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe("createUser", () => {
        it("crée un user et le retourne via getById", async () => {
            const db = mockConn();
            const service = new UserService(db);
            
            // @ts-expect-error Problème de conversion
            (bcrypt.hash as jest.Mock).mockResolvedValue("hashed_pw");

            // 1) INSERT -> insertId
            db.execute.mockImplementationOnce(
                async () => [{ insertId: 42 } as unknown, undefined] as unknown
            );

            // 2) SELECT (getById) -> row
            const createdAt = new Date("2026-02-01T10:00:00.000Z");
            db.execute.mockImplementationOnce(
                async () =>
                    [
                        [
                            {
                                id_user: 42,
                                username: "alice",
                                password_hash: "hashed_pw",
                                token: null,
                                is_admin: 0,
                                created_at: createdAt,
                            },
                        ],
                        undefined,
                    ] as unknown
            );

            const user = await service.createUser("alice", "pw", false);

            expect(bcrypt.hash).toHaveBeenCalledWith("pw", 12);

            expect(db.execute).toHaveBeenNthCalledWith(
                1,
                expect.stringContaining("INSERT INTO " + "users"),
                ["alice", "hashed_pw", false]
            );
            expect(db.execute).toHaveBeenNthCalledWith(
                2,
                expect.stringContaining("WHERE id_user = ?"),
                [42]
            );

            expect(user).toEqual({
                id_user: 42,
                username: "alice",
                is_admin: false,
                created_at: new Date(createdAt),
            });
        });

        it("throw USER_CREATE_FAILED si getById renvoie null", async () => {
            const db = mockConn();
            const service = new UserService(db);

            // @ts-expect-error Problème de conversion
            (bcrypt.hash as unknown as jest.Mock).mockResolvedValue("hashed_pw");

            db.execute.mockImplementationOnce(
                async () => [{ insertId: 42 } as unknown, undefined] as unknown
            );
            db.execute.mockImplementationOnce(async () => [[], undefined] as unknown);

            await expect(service.createUser("alice", "pw")).rejects.toThrow(
                "USER_CREATE_FAILED"
            );
        });
    });

    describe("authenticate", () => {
        it("retourne null si username introuvable", async () => {
            const db = mockConn();
            const service = new UserService(db);

            db.execute.mockImplementationOnce(async () => [[], undefined] as unknown);

            const res = await service.authenticate("alice", "pw");
            expect(res).toBeNull();
        });

        it("retourne null si password invalide", async () => {
            const db = mockConn();
            const service = new UserService(db);

            db.execute.mockImplementationOnce(
                async () =>
                    [
                        [
                            {
                                id_user: 1,
                                username: "alice",
                                password_hash: "hashed",
                                token: null,
                                is_admin: 0,
                                created_at: new Date("2026-02-01T10:00:00.000Z"),
                            },
                        ],
                        undefined,
                    ] as unknown
            );

            // @ts-expect-error Problème de conversion
            (bcrypt.compare as unknown as jest.Mock).mockResolvedValue(false);

            const res = await service.authenticate("alice", "badpw");

            expect(bcrypt.compare).toHaveBeenCalledWith("badpw", "hashed");
            expect(res).toBeNull();
            expect(db.execute).toHaveBeenCalledTimes(1);
        });

        it("retourne {user, token} et met à jour le token si password ok", async () => {
            const db = mockConn();
            const service = new UserService(db);

            const createdAt = new Date("2026-02-01T10:00:00.000Z");

            db.execute.mockImplementationOnce(
                async () =>
                    [
                        [
                            {
                                id_user: 1,
                                username: "alice",
                                password_hash: "hashed",
                                token: null,
                                is_admin: 1,
                                created_at: createdAt,
                            },
                        ],
                        undefined,
                    ] as unknown
            );

            // @ts-expect-error Problème de conversion
            (bcrypt.compare as unknown as jest.Mock).mockResolvedValue(true);

            jest
                .spyOn(crypto, "randomBytes")
                // @ts-expect-error Problème de conversion
                .mockReturnValue(Buffer.from("a".repeat(48)) as unknown); // 48 bytes -> 96 chars hex

            db.execute.mockImplementationOnce(
                async () => [{ affectedRows: 1 } as unknown, undefined] as unknown
            );

            const res = await service.authenticate("alice", "pw");

            expect(res).not.toBeNull();
            expect(res!.user).toEqual({
                id_user: 1,
                username: "alice",
                is_admin: true,
                created_at: new Date(createdAt),
            });
            expect(res!.token).toHaveLength(96);

            expect(db.execute).toHaveBeenNthCalledWith(
                1,
                expect.stringContaining("FROM users"),
                ["alice"]
            );
            expect(db.execute).toHaveBeenNthCalledWith(
                2,
                expect.stringContaining("UPDATE users SET" +" token"),
                [res!.token, 1]
            );
        });
    });

    describe("getters", () => {
        it("getById: null si pas de rows", async () => {
            const db = mockConn();
            const service = new UserService(db);

            db.execute.mockImplementationOnce(async () => [[], undefined] as unknown);

            await expect(service.getById(1)).resolves.toBeNull();
        });

        it("getByUsername: normalize si trouvé", async () => {
            const db = mockConn();
            const service = new UserService(db);

            const createdAt = new Date("2026-02-02T11:00:00.000Z");
            db.execute.mockImplementationOnce(
                async () =>
                    [
                        [
                            {
                                id_user: 9,
                                username: "bob",
                                password_hash: "x",
                                token: null,
                                is_admin: 0,
                                created_at: createdAt,
                            },
                        ],
                        undefined,
                    ] as unknown
            );

            await expect(service.getByUsername("bob")).resolves.toEqual({
                id_user: 9,
                username: "bob",
                is_admin: false,
                created_at: new Date(createdAt),
            });
        });

        it("getByToken: null si pas de rows", async () => {
            const db = mockConn();
            const service = new UserService(db);

            db.execute.mockImplementationOnce(async () => [[], undefined] as unknown);

            await expect(service.getByToken("t")).resolves.toBeNull();
        });
    });

    describe("rotateToken", () => {
        it("retourne un nouveau token si update ok", async () => {
            const db = mockConn();
            const service = new UserService(db);

            jest
                .spyOn(crypto, "randomBytes")
                // @ts-expect-error Problème de conversion
                .mockReturnValue(Buffer.from("b".repeat(48)) as unknown);

            db.execute.mockImplementationOnce(
                async () => [{ affectedRows: 1 } as unknown, undefined] as unknown
            );

            const token = await service.rotateToken(1);
            expect(token).toHaveLength(96);

            expect(db.execute).toHaveBeenCalledWith(
                expect.stringContaining("UPDATE users SET "+ "token"),
                [token, 1]
            );
        });

        it("throw USER_NOT_FOUND si affectedRows != 1", async () => {
            const db = mockConn();
            const service = new UserService(db);

            db.execute.mockImplementationOnce(
                async () => [{ affectedRows: 0 } as unknown, undefined] as unknown
            );

            await expect(service.rotateToken(999)).rejects.toThrow("USER_NOT_FOUND");
        });
    });

    describe("revokeToken", () => {
        it("ok si affectedRows == 1", async () => {
            const db = mockConn();
            const service = new UserService(db);

            db.execute.mockImplementationOnce(
                async () => [{ affectedRows: 1 } as unknown, undefined] as unknown
            );

            await expect(service.revokeToken(1)).resolves.toBeUndefined();
        });

        it("throw USER_NOT_FOUND si affectedRows != 1", async () => {
            const db = mockConn();
            const service = new UserService(db);

            db.execute.mockImplementationOnce(
                async () => [{ affectedRows: 0 } as unknown, undefined] as unknown
            );

            await expect(service.revokeToken(2)).rejects.toThrow("USER_NOT_FOUND");
        });
    });

    describe("changePassword", () => {
        it("hash puis update ok", async () => {
            const db = mockConn();
            const service = new UserService(db);

            // @ts-expect-error Problème de conversion
            (bcrypt.hash as unknown as jest.Mock).mockResolvedValue("new_hash");
            db.execute.mockImplementationOnce(
                async () => [{ affectedRows: 1 } as unknown, undefined] as unknown
            );

            await expect(service.changePassword(1, "newpw")).resolves.toBeUndefined();
            expect(bcrypt.hash).toHaveBeenCalledWith("newpw", 12);
            expect(db.execute).toHaveBeenCalledWith(
                expect.stringContaining("UPDATE users SET " + "hash"),
                ["new_hash", 1]
            );
        });

        it("throw USER_NOT_FOUND si affectedRows != 1", async () => {
            const db = mockConn();
            const service = new UserService(db);

            // @ts-expect-error Problème de conversion
            (bcrypt.hash as unknown as jest.Mock).mockResolvedValue("new_hash");
            db.execute.mockImplementationOnce(
                async () => [{ affectedRows: 0 } as unknown, undefined] as unknown
            );

            await expect(service.changePassword(999, "pw")).rejects.toThrow(
                "USER_NOT_FOUND"
            );
        });
    });

    describe("setAdmin", () => {
        it("update ok", async () => {
            const db = mockConn();
            const service = new UserService(db);

            db.execute.mockImplementationOnce(
                async () => [{ affectedRows: 1 } as unknown, undefined] as unknown
            );

            await expect(service.setAdmin(1, true)).resolves.toBeUndefined();
            expect(db.execute).toHaveBeenCalledWith(
                expect.stringContaining("UPDATE users SET " + "is_admin"),
                [true, 1]
            );
        });

        it("throw USER_NOT_FOUND si affectedRows != 1", async () => {
            const db = mockConn();
            const service = new UserService(db);

            db.execute.mockImplementationOnce(
                async () => [{ affectedRows: 0 } as unknown, undefined] as unknown
            );

            await expect(service.setAdmin(1, true)).rejects.toThrow("USER_NOT_FOUND");
        });
    });

    describe("deleteUser", () => {
        it("delete ok", async () => {
            const db = mockConn();
            const service = new UserService(db);

            db.execute.mockImplementationOnce(
                async () => [{ affectedRows: 1 } as unknown, undefined] as unknown
            );

            await expect(service.deleteUser(1)).resolves.toBeUndefined();
            expect(db.execute).toHaveBeenCalledWith(
                expect.stringContaining("DELETE FROM users"),
                [1]
            );
        });

        it("throw USER_NOT_FOUND si affectedRows != 1", async () => {
            const db = mockConn();
            const service = new UserService(db);

            db.execute.mockImplementationOnce(
                async () => [{ affectedRows: 0 } as unknown, undefined] as unknown
            );

            await expect(service.deleteUser(999)).rejects.toThrow("USER_NOT_FOUND");
        });
    });
});
