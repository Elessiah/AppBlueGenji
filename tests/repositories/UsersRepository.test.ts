// tests/repositories/UsersRepository.test.ts
import { describe, it, expect, beforeEach, jest } from "@jest/globals";
import type { Connection } from "mysql2/promise";
import { UsersRepository } from "../../lib/data/repositories/UsersRepository";
import type { UserRow } from "../../lib/types";

type ExecuteMock = jest.MockedFunction<
    (sql: string, params?: unknown[]) => Promise<unknown>
>;

const makeDb = () => {
    const execute: ExecuteMock = jest.fn();
    return { execute } as unknown as Connection;
};

const userRow = (overrides: Partial<UserRow> = {}): UserRow =>
    ({
        id_user: 1,
        username: "alice",
        password_hash: "hash",
        token: null,
        is_admin: 0,
        created_at: "2026-01-01T00:00:00.000Z",
        ...overrides,
    }) as unknown as UserRow;

describe("UsersRepository", () => {
    let db: Connection;
    let execute: ExecuteMock;
    let repo: UsersRepository;

    beforeEach(() => {
        db = makeDb();
        execute = db.execute as unknown as ExecuteMock;
        repo = new UsersRepository(db);
    });

    it("getById returns normalized user when found", async () => {
        execute.mockResolvedValueOnce([[userRow({ is_admin: 1 } as unknown as UserRow)]]);

        const user = await repo.getById(1);

        expect(execute).toHaveBeenCalledTimes(1);
        expect(execute).toHaveBeenCalledWith(
            expect.stringContaining("FROM users"),
            [1]
        );
        expect(user).not.toBeNull();
        expect(user!.id_user).toBe(1);
        expect(user!.username).toBe("alice");
        expect(user!.password_hash).toBe("hash");
        expect(user!.is_admin).toBe(true);
        expect(user!.created_at instanceof Date).toBe(true);
    });

    it("getById returns null when not found", async () => {
        execute.mockResolvedValueOnce([[]]);

        const user = await repo.getById(999);

        expect(user).toBeNull();
    });

    it("getByUsername returns normalized user when found", async () => {
        execute.mockResolvedValueOnce([[userRow({ username: "bob" } as unknown as UserRow)]]);

        const user = await repo.getByUsername("bob");

        expect(execute).toHaveBeenCalledWith(
            expect.stringContaining("WHERE username = ?"),
            ["bob"]
        );
        expect(user).not.toBeNull();
        expect(user!.username).toBe("bob");
    });

    it("getByUsername returns null when not found", async () => {
        execute.mockResolvedValueOnce([[]]);

        const user = await repo.getByUsername("missing");

        expect(user).toBeNull();
    });

    it("getByToken returns normalized user when found", async () => {
        execute.mockResolvedValueOnce([[userRow({ token: "t" } as unknown as UserRow)]]);

        const user = await repo.getByToken("t");

        expect(execute).toHaveBeenCalledWith(
            expect.stringContaining("WHERE token = ?"),
            ["t"]
        );
        expect(user).not.toBeNull();
        expect(user!.token).toBeDefined();
    });

    it("getByToken returns null when not found", async () => {
        execute.mockResolvedValueOnce([[]]);

        const user = await repo.getByToken("nope");

        expect(user).toBeNull();
    });

    it("create inserts and returns created user", async () => {
        execute
            .mockResolvedValueOnce([{ insertId: 7 }]) // INSERT
            .mockResolvedValueOnce([[userRow({ id_user: 7 } as unknown as UserRow)]]); // SELECT getById

        const created = await repo.create("alice", "hashed_pw", false);

        expect(execute).toHaveBeenNthCalledWith(
            1,
            expect.stringContaining("INSERT INTO " + "users"),
            ["alice", "hashed_pw", false]
        );
        expect(execute).toHaveBeenNthCalledWith(
            2,
            expect.stringContaining("WHERE id_user = ?"),
            [7]
        );
        expect(created.id_user).toBe(7);
        expect(created.username).toBe("alice");
        expect(created.password_hash).toBe("hash"); // from mocked row
    });

    it("create throws USER_CREATE_FAILED if created user cannot be fetched", async () => {
        execute
            .mockResolvedValueOnce([{ insertId: 7 }])
            .mockResolvedValueOnce([[]]);

        await expect(repo.create("alice", "hashed_pw", false)).rejects.toThrow(
            "USER_CREATE_FAILED"
        );
    });

    it("setToken updates token", async () => {
        execute.mockResolvedValueOnce([{ affectedRows: 1 }]);

        await repo.setToken(1, "newtoken");

        expect(execute).toHaveBeenCalledWith(
            expect.stringContaining("UPDATE users SET " + "token"),
            ["newtoken", 1]
        );
    });

    it("setToken throws USER_NOT_FOUND when affectedRows != 1", async () => {
        execute.mockResolvedValueOnce([{ affectedRows: 0 }]);

        await expect(repo.setToken(1, "x")).rejects.toThrow("USER_NOT_FOUND");
    });

    it("revokeToken sets token to NULL", async () => {
        execute.mockResolvedValueOnce([{ affectedRows: 1 }]);

        await repo.revokeToken(1);

        expect(execute).toHaveBeenCalledWith(
            expect.stringContaining("UPDATE users SET " + "token"),
            [null, 1]
        );
    });

    it("setPasswordHash updates hash", async () => {
        execute.mockResolvedValueOnce([{ affectedRows: 1 }]);

        await repo.setPasswordHash(1, "newhash");

        expect(execute).toHaveBeenCalledWith(
            expect.stringContaining("UPDATE users SET " + "hash"),
            ["newhash", 1]
        );
    });

    it("setPasswordHash throws USER_NOT_FOUND when affectedRows != 1", async () => {
        execute.mockResolvedValueOnce([{ affectedRows: 0 }]);

        await expect(repo.setPasswordHash(1, "h")).rejects.toThrow(
            "USER_NOT_FOUND"
        );
    });

    it("setAdmin updates admin flag", async () => {
        execute.mockResolvedValueOnce([{ affectedRows: 1 }]);

        await repo.setAdmin(1, true);

        expect(execute).toHaveBeenCalledWith(
            expect.stringContaining("UPDATE users SET " + "is_admin"),
            [true, 1]
        );
    });

    it("setAdmin throws USER_NOT_FOUND when affectedRows != 1", async () => {
        execute.mockResolvedValueOnce([{ affectedRows: 0 }]);

        await expect(repo.setAdmin(1, true)).rejects.toThrow("USER_NOT_FOUND");
    });

    it("delete removes user", async () => {
        execute.mockResolvedValueOnce([{ affectedRows: 1 }]);

        await repo.delete(1);

        expect(execute).toHaveBeenCalledWith(
            expect.stringContaining("DELETE FROM users"),
            [1]
        );
    });

    it("delete throws USER_NOT_FOUND when affectedRows != 1", async () => {
        execute.mockResolvedValueOnce([{ affectedRows: 0 }]);

        await expect(repo.delete(1)).rejects.toThrow("USER_NOT_FOUND");
    });
});
