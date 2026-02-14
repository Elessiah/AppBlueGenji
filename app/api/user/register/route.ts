// app/api/user/register/route.ts
import { NextRequest } from "next/server";
import {status, User} from "../../../../lib/types";
import {badRequest, getServices, json, requireUser, serverError, unauthorized} from "../../utils";
import {ApiError, ApiSuccess} from "../../types";
import {registerRequest} from "../types";

export async function POST(req: NextRequest) {
    let body: registerRequest;
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

        const res: status = await usersService.create(body.username, body.password, body.isAdmin ?? false);
        if (!res.success) return badRequest(res.message ?? "USER_CREATE_FAILED");

        return json<ApiSuccess>({ success: true }, 201);
    } catch (e: unknown) {
        // mapping simple d'erreurs repo
        const msg: string = typeof (e as TypeError)?.message === "string" ? (e as TypeError).message : "UNKNOWN_ERROR";
        if (msg === "USER_NOT_FOUND") {
            return json<ApiError>({ error: msg }, 404);
        }
        if (msg === "USER_CREATE_FAILED"){
            return serverError(msg);
        }
        return serverError(msg);
    }
}

export async function DELETE(req: NextRequest) {
    try {
        const usersService = await getServices();

        const token: string | undefined = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
        const me: User | null = await requireUser(usersService, token);
        if (!me) return unauthorized();

        await usersService.delete(me.id_user);
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