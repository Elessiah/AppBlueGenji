// tests/services/UsersService.test.ts
import { describe, it, expect, beforeEach, jest } from "@jest/globals";
import bcrypt from "bcrypt";
import crypto from "node:crypto";
import { UsersService } from "../../lib/data/services/UsersService";
import { UsersRepository } from "../../lib/data/repositories/UsersRepository";
import type { User } from "../../lib/types";

jest.mock("bcrypt", () => ({
    __esModule: true,
    default: {
        hash: jest.fn(),
        compare: jest.fn(),
    },
}));

jest.mock("node:crypto", () => ({
    __esModule: true,
    default: {
        randomBytes: jest.fn(),
    },
}));

const makeUser = (overrides: Partial<User> = {}): User => ({
    id_user: 1,
    username: "alice",
    password_hash: "hash",
    token: crypto.randomBytes(48).toString("hex"),
    is_admin: false,
    created_at: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides,
});

describe("UsersService", () => {
    let repo: jest.Mocked<UsersRepository>;
    let service: UsersService;

    beforeEach(() => {
        repo = {
            create: jest.fn(),
            getById: jest.fn(),
            getByUsername: jest.fn(),
            getByToken: jest.fn(),
            setToken: jest.fn(),
            revokeToken: jest.fn(),
            setPasswordHash: jest.fn(),
            setAdmin: jest.fn(),
            delete: jest.fn(),
        } as unknown as jest.Mocked<UsersRepository>;

        service = new UsersService(repo);

        (bcrypt.hash as unknown as jest.Mock).mockReset();
        (bcrypt.compare as unknown as jest.Mock).mockReset();
        (crypto.randomBytes as unknown as jest.Mock).mockReset();

        // deterministic token: Buffer filled with 0x01 -> "01" repeated (length = 2 * size)
        (crypto.randomBytes as unknown as jest.Mock).mockImplementation((size) =>
            Buffer.alloc(size as number, 1)
        );
    });

    it("getById delegates to repository", async () => {
        repo.getById.mockResolvedValueOnce(makeUser({ id_user: 2 }));

        const u = await service.getById(2);

        expect(repo.getById).toHaveBeenCalledWith(2);
        expect(u?.id_user).toBe(2);
    });

    it("getByUsername delegates to repository", async () => {
        repo.getByUsername.mockResolvedValueOnce(makeUser({ username: "bob" }));

        const u = await service.getByUsername("bob");

        expect(repo.getByUsername).toHaveBeenCalledWith("bob");
        expect(u?.username).toBe("bob");
    });

    it("create fails when username length is invalid", async () => {
        const r = await service.create("ab", "password123", false);

        expect(r.success).toBe(false);
        expect(r.message).toBe("Username doesn't match rules");
        expect(repo.create).not.toHaveBeenCalled();
    });

    it("create fails when username already exists", async () => {
        repo.getByUsername.mockResolvedValueOnce(makeUser({ username: "alice" }));

        const r = await service.create("alice", "password123", false);

        expect(repo.getByUsername).toHaveBeenCalledWith("alice");
        expect(r.success).toBe(false);
        expect(r.message).toBe("Username doesn't match rules");
        expect(repo.create).not.toHaveBeenCalled();
    });

    it("create fails when password length is invalid", async () => {
        repo.getByUsername.mockResolvedValueOnce(null);

        const r = await service.create("alice", "short", false);

        expect(r.success).toBe(false);
        expect(r.message).toBe("Password doesn't match rules");
        expect(repo.create).not.toHaveBeenCalled();
    });

    it("create hashes password and calls repository.create", async () => {
        repo.getByUsername.mockResolvedValueOnce(null);

        // @ts-expect-error Problème de conversion
        (bcrypt.hash as unknown as jest.Mock).mockResolvedValueOnce("hashed_pw");
        repo.create.mockResolvedValueOnce(makeUser({ id_user: 10 }));

        console.log("Juste avant la mort");
        const r = await service.create("alice", "password1234", false);

        expect(bcrypt.hash).toHaveBeenCalledWith("password1234", 12);
        expect(repo.create).toHaveBeenCalledWith("alice", "hashed_pw", false);
        expect(r.success).toBe(true);
    });

    it("authenticate returns null when user not found", async () => {
        repo.getByUsername.mockResolvedValueOnce(null);

        const token = await service.authenticate("alice", "password123");

        expect(token).toBeNull();
        expect(bcrypt.compare).not.toHaveBeenCalled();
        expect(repo.setToken).not.toHaveBeenCalled();
    });

    it("authenticate returns null when password is invalid", async () => {
        repo.getByUsername.mockResolvedValueOnce(makeUser());

        // @ts-expect-error Problème de conversion
        (bcrypt.compare as unknown as jest.Mock).mockResolvedValueOnce(false);

        const token = await service.authenticate("alice", "wrong");

        expect(bcrypt.compare).toHaveBeenCalledWith("wrong", "hash");
        expect(token).toBeNull();
        expect(repo.setToken).not.toHaveBeenCalled();
    });

    it("authenticate returns token and persists it when credentials are valid", async () => {
        repo.getByUsername.mockResolvedValueOnce(makeUser({ id_user: 5 }));

        // @ts-expect-error Problème de conversion
        (bcrypt.compare as unknown as jest.Mock).mockResolvedValueOnce(true);
        repo.setToken.mockResolvedValueOnce();

        const token = await service.authenticate("alice", "password123");

        expect(bcrypt.compare).toHaveBeenCalledWith("password123", "hash");
        expect(repo.setToken).toHaveBeenCalledWith(5, token);
        expect(typeof token).toBe("string");
        expect(token!.length).toBe(96); // 48 bytes hex -> 96 chars
    });

    it("authenticateToken delegates to repository.getByToken", async () => {
        repo.getByToken.mockResolvedValueOnce(makeUser({ id_user: 3 }));

        const u = await service.authenticateToken("t");

        expect(repo.getByToken).toHaveBeenCalledWith("t");
        expect(u?.id_user).toBe(3);
    });

    it("rotateToken generates and stores a new token", async () => {
        repo.setToken.mockResolvedValueOnce();

        const token = await service.rotateToken(7);

        expect(repo.setToken).toHaveBeenCalledWith(7, token);
        expect(token.length).toBe(96);
    });

    it("revokeToken delegates to repository", async () => {
        repo.revokeToken.mockResolvedValueOnce();

        await service.revokeToken(7);

        expect(repo.revokeToken).toHaveBeenCalledWith(7);
    });

    it("updatePassword fails when new password is invalid", async () => {
        const r = await service.updatePassword(1, "short");

        expect(r.success).toBe(false);
        expect(r.message).toBe("Password doesn't match rules");
        expect(bcrypt.hash).not.toHaveBeenCalled();
        expect(repo.setPasswordHash).not.toHaveBeenCalled();
    });

    it("updatePassword hashes and persists new password hash", async () => {
        // @ts-expect-error Problème de conversion
        (bcrypt.hash as unknown as jest.Mock).mockResolvedValueOnce("new_hash");
        repo.setPasswordHash.mockResolvedValueOnce();

        const r = await service.updatePassword(1, "newPassword123");

        expect(bcrypt.hash).toHaveBeenCalledWith("newPassword123", 12);
        expect(repo.setPasswordHash).toHaveBeenCalledWith(1, "new_hash");
        expect(r.success).toBe(true);
    });

    it("setAdmin delegates to repository", async () => {
        repo.setAdmin.mockResolvedValueOnce();

        await service.setAdmin(1, true);

        expect(repo.setAdmin).toHaveBeenCalledWith(1, true);
    });

    it("delete delegates to repository", async () => {
        repo.delete.mockResolvedValueOnce();

        await service.delete(1);

        expect(repo.delete).toHaveBeenCalledWith(1);
    });
});
