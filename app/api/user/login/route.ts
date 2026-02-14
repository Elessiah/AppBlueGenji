// app/api/user/login/route.ts
import { NextRequest } from "next/server";
import {loginRequest} from "../types";
import {badRequest, getServices, json, requireUser, serverError, unauthorized} from "../../utils";
import {ApiError, ApiSuccess} from "../../types";
import { User } from "../../../../lib/types";

export async function POST(req: NextRequest) {
    let body: loginRequest;
    try {
        body = await req.json();
        if (!body.username || !body.password) {
            return badRequest("Invalid JSON body");
        }
    } catch {
        return badRequest("Invalid JSON body");
    }

    try {
        const usersService = await getServices();

        const token = await usersService.authenticate(body.username, body.password);
        if (!token) return unauthorized("Invalid credentials");

        return json<ApiSuccess<{ token: string }>>({ token }, 200);
    } catch (e: unknown) {
        // mapping simple d'erreurs repo
        const err: TypeError = e as TypeError;
        const msg: string = err.message ?? "UNKNOWN_ERROR";
        if (msg === "USER_NOT_FOUND") return json<ApiError>({ error: msg }, 404);
        if (msg === "USER_CREATE_FAILED") return serverError(msg);
        return serverError(msg);
    }
}

export async function DELETE(req: NextRequest) {
    try {
        const usersService = await getServices();

        const token: string | undefined = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
        const user: User | null = await requireUser(usersService, token);
        if (!user) return unauthorized();

        await usersService.revokeToken(user.id_user);
        return json<ApiSuccess>({ success: true });
    } catch (e: unknown) {
        // mapping simple d'erreurs repo
        const err: TypeError = e as TypeError;
        const msg: string = err.message ?? "UNKNOWN_ERROR";
        if (msg === "USER_NOT_FOUND") return json<ApiError>({ error: msg }, 404);
        if (msg === "USER_CREATE_FAILED") return serverError(msg);
        return serverError(msg);
    }
}
