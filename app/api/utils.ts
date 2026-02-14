import {NextResponse} from "next/server";
import {ApiError} from "./types";
import {Connection} from "mysql2/promise";
import Database from "../../lib/data/Database";
import {UsersRepository} from "../../lib/data/repositories/UsersRepository";
import {UsersService} from "../../lib/data/services/UsersService";
import {User} from "../../lib/types";

export function json<T>(data: T, status = 200) {
    return NextResponse.json(data, { status });
}

export function badRequest(msg = "Bad request") {
    return json<ApiError>({ error: msg }, 400);
}

export function unauthorized(msg = "Unauthorized") {
    return json<ApiError>({ error: msg }, 401);
}

export function forbidden(msg = "Forbidden") {
    return json<ApiError>({ error: msg }, 403);
}

export function notFound(msg = "Not Found") {
    return json<ApiError>({ error: msg }, 404);
}

export function serverError(msg = "Internal error") {
    return json<ApiError>({ error: msg }, 500);
}

export async function getServices(): Promise<UsersService> {
    const db: Connection = await Database.getConnection();
    const usersRepo = new UsersRepository(db);
    return (new UsersService(usersRepo));
}

export async function requireUser(usersService: UsersService, token?: string): Promise<User | null> {
    if (!token) return null;
    return usersService.authenticateToken(token);
}