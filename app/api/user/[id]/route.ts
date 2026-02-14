import {NextRequest} from "next/server";
import {badRequest, forbidden, getServices, json, notFound, requireUser, serverError, unauthorized} from "../../utils";
import {ApiError, ApiSuccess} from "../../types";
import {patchRequest} from "../types";
import {PublicUser, status, User} from "../../../../lib/types";

export async function PATCH(req: NextRequest, {params}: {params: {id: string}}) {
    const target_id: number = Number(params.id);

    if (!Number.isInteger(target_id)) {
        return badRequest("Invalid id");
    }
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
        if (!me.is_admin) return forbidden();

        if (body.password) {
            const res: status = await usersService.updatePassword(target_id, body.password);
            if (!res.success) return badRequest(res.message ?? "PASSWORD_INVALID");
        }

        if (body.username) {
            const res: status = await usersService.updateUsername(target_id, body.username);
            if (!res.success) return badRequest(res.message ?? "USERNAME_INVALID");
        }

        if (body.isAdmin != undefined) {
            await usersService.setAdmin(target_id, body.isAdmin);
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

export async function GET(req: NextRequest, {params}: {params: {id: string}}) {
    const target_id: number = Number(params.id);

    if (!Number.isInteger(target_id)) {
        return badRequest("Invalid id");
    }

    try {
        const usersService = await getServices();

        const user: PublicUser | null = await usersService.getPublicById(target_id);

        if (!user) return notFound("User not found");

        return json<ApiSuccess<{ user: PublicUser }>>({ user });
    } catch (e: unknown) {
        // mapping simple d'erreurs repo
        const err: TypeError = e as TypeError;
        const msg: string = err.message ?? "UNKNOWN_ERROR";
        if (msg === "USER_NOT_FOUND") return json<ApiError>({ error: msg }, 404);
        if (msg === "USER_CREATE_FAILED") return serverError(msg);
        return serverError(msg);
    }
}