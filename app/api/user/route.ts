// app/api/user/route.ts
import { NextRequest } from "next/server";
import {status, User} from "../../../lib/types";
import {patchRequest} from "./types";
import {badRequest, getServices, json, requireUser, serverError, unauthorized} from "../utils";
import {ApiError, ApiSuccess} from "../types";

export async function POST(req: NextRequest) {
    try {
        const usersService = await getServices();
        const token: string | undefined = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
        const user = await requireUser(usersService, token);
        if (!user) return unauthorized();

        const newToken = await usersService.rotateToken(user.id_user);
        return json<ApiSuccess<{ token: string }>>({ token: newToken });
    } catch (e: unknown) {
        // mapping simple d'erreurs repo
        const err: TypeError = e as TypeError;
        const msg: string = err.message ?? "UNKNOWN_ERROR";
        if (msg === "USER_NOT_FOUND") return json<ApiError>({ error: msg }, 404);
        if (msg === "USER_CREATE_FAILED") return serverError(msg);
        return serverError(msg);
    }
}

export async function PATCH(req: NextRequest) {
    let body: patchRequest;
    try {
        body = await req.json();
    } catch {
        return badRequest("Invalid JSON body");
    }
    try {
        const usersService = await getServices();
        const token: string | undefined = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
        const me: User | null = await requireUser(usersService, token);
        if (!me) return unauthorized();

        if (body.password) {
            const res: status = await usersService.updatePassword(me.id_user, body.password);
            if (!res.success) return badRequest(res.message ?? "PASSWORD_INVALID");
        }

        if (body.username) {
            const res: status = await usersService.updateUsername(me.id_user, body.username);
            if (!res.success) return badRequest(res.message ?? "USERNAME_INVALID");
        }

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