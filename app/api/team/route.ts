// app/api/team/route.ts
import {NextRequest, NextResponse} from "next/server";
import {getHistories, getTeamMembers, status} from "../../../lib/types";
import {secureRequest} from "../../../lib/API/secureRequest";
import {members} from "./members";
import {destruct} from "./destruct";
import {erase} from "./erase";
import {owner} from "./owner";
import {rename} from "./rename";
import {create} from "./create";
import {TeamEntity} from "../../../lib/database/TeamEntity";
import {UserEntity} from "../../../lib/database/UserEntity";

export async function GET(request: NextRequest): Promise<NextResponse> {
    const {searchParams} = new URL(request.url);
    const id: string | number | null = searchParams.get('id');
    const name: string | null = searchParams.get('name');
    const get: string | null = searchParams.get('g');
    if ((id === null && !name) || (id && name))
        return (NextResponse.json({error: "Need 'id' (X)OR 'name' to fetch a team!"}, {status: 400}));
    if (get && get != 'history' && get != 'members')
        return (NextResponse.json({error: "'g' must equal 'history' or 'members'"}, {status: 400}));
    const team: TeamEntity = new TeamEntity();
    let status: status = await team.fetch(id ? Number(id) : name!);
    if (!status.success)
        return (NextResponse.json({error: status.error}, {status: 400}));
    if (get == "history") {
        const getHistory: getHistories = await team.getHistory();
        if (!getHistory.success)
            return (NextResponse.json({error: getHistory.error}, {status: 400}));
        return (NextResponse.json({ histories: getHistory.histories}, {status: 200}));
    }
    if (get == "members") {
        const getTeamMembers: getTeamMembers = await team.getMembers();
        if (!getTeamMembers.success)
            return (NextResponse.json({error: getTeamMembers.error}, {status: 400}));
        return (NextResponse.json({members: getTeamMembers.members}, {status: 200}));
    }
    let user: UserEntity | null = new UserEntity();
    if (team.id_user == null)
        user = null;
    else
        status = await user.fetch(team.id_user!);
    if (!status.success)
        return (NextResponse.json({error: status.error}, {status: 400}));
    return (NextResponse.json({
        id_team: team.id,
        name: team.name,
        creation_date: team.creation_date,
        username: user ? user.name : "",
        id_user: user ? user.id : null,
        members_count: team.members_count,
    }, {status: 200}));
}

export async function POST(request: NextRequest): Promise<NextResponse> {
    return secureRequest(request, async (request, user_id): Promise<NextResponse> => {
        const body = await request.json();
        const command: string | null = body.command;
        if (!command)
            return (NextResponse.json({error: "'command' is required!"}, {status: 400}));
        if (command == "create")
            return await create(body, user_id);
        if (command == "rename")
            return await rename(body, user_id);
        if (command == "owner")
            return await owner(body, user_id);
        if (command == "erase")
            return await erase(body, user_id);
        if (command == "destruct")
            return await destruct(body, user_id);
        if (command == "add")
            return await members(body, user_id, false);
        if (command == "rm")
            return await members(body, user_id, true);
        return (NextResponse.json({error: "Unknown command!"}, {status: 400}));
    });
}