// app/api/user/route.ts
import { NextRequest, NextResponse } from "next/server";
import {status, getHistories, UserInfo} from "../../../lib/types";
import {Controller} from "../../../lib/controller";
import {secureRequest} from "../../../lib/secureRequest";
import {newUser} from "./new";
import {updatePassword} from "./updatePasword";
import {updateUsername} from "./updateUsername";
import {deleteUser} from "./deleteUser";
import {auth} from "./auth";

export async function GET(request: NextRequest): Promise<NextResponse> {
    const {searchParams} = new URL(request.url);
    const username: string | null = searchParams.get('username');
    let id: string | number | null = searchParams.get('id');
    const get: string | null = searchParams.get('g');
    if (id !== null && username != null)
        return (NextResponse.json({error: "'id' and 'username' cannot be send together to get an user!"},
            {status: 400}));
    if (id === null && username == null)
        return (NextResponse.json({error: "Need `id` OR `username` to fetch an user!"}, {status: 400}));
    if (id)
        id = parseInt(id, 10);
    if (get && get != "history")
        return (NextResponse.json({error: "If you want to fetch history 'g' must equal 'history'!"}, {status: 400}));
    const database = Controller.getInstance();
    if (get == "history") {
        if (id == null)
            return (NextResponse.json({error: "'id' is required to fetch the history !"}, {status: 400}));
        const getHistory: getHistories = await database.getUserHistory(id as number);
        if (!getHistory.success)
            return (NextResponse.json({error: getHistory.error}, {status: 400}));
        return (NextResponse.json({...getHistory.histories}, {status: 200}));
    }
    const getUser: status & Partial<UserInfo> = await database.getUser(username ? username : id!);
    if (!getUser.success)
        return (NextResponse.json({error: getUser.error}, {status: 500}));
    return (NextResponse.json({
            user_id: getUser.user_id,
            username: getUser.username,
            id_team: getUser.id_team,
            is_admin: getUser.is_admin
        },
        {status: 200}));
}

export async function POST(request: NextRequest): Promise<NextResponse> {
    const body = await request.json();
    const command: string | null = body.command;
    if (!command)
        return (NextResponse.json({error: "'command' is required!"}, {status: 400}));
    if (command == "new")
        return await newUser(body);
    if (command == "auth")
        return await auth(body);
    return secureRequest(request, async (request, user_id): Promise<NextResponse> => {
        if (command == "update_password")
            return await updatePassword(body, user_id);
        if (command == "update_username")
            return await updateUsername(body, user_id);
        if (command == "delete")
            return await deleteUser(body, user_id);
        if (command == "auth_token")
            return (NextResponse.json({}, {status: 200}));
        return (NextResponse.json({error: "Unknown command!"}, {status: 400}));
    });
}