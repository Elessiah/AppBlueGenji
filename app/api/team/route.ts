import {NextRequest, NextResponse} from "next/server";
import {Database} from "../../../lib/database";
import {getHistories, getTeamMembers, status, Team, TeamInfo, History} from "../../../lib/types";
import {secureRequest} from "../../../lib/secureRequest";
import {members} from "./members";
import {destruct} from "./destruct";
import {erase} from "./erase";
import {owner} from "./owner";
import {rename} from "./rename";
import {create} from "./create";

export async function GET(request: NextRequest): Promise<NextResponse> {
    const {searchParams} = new URL(request.url);
    const id: string | number | null = searchParams.get('id');
    const name: string | null = searchParams.get('name');
    let team : string | number;
    const get: string | null = searchParams.get('g');
    if ((id === null && !name) || (id && name))
        return (NextResponse.json({error: "Need 'id' (X)OR 'name' to fetch a team!"}, {status: 400}));
    if (id)
        team = parseInt(id, 10);
    else
        team = name!;
    if (get && get != 'history' && get != 'members')
        return (NextResponse.json({error: "'g' must equal 'history' or 'members'"}, {status: 400}));
    const database = Database.getInstance();
    if (get == "history") {
        const getHistory: getHistories = await database.getTeamHistory(team);
        if (!getHistory.success)
            return (NextResponse.json({error: getHistory.error}, {status: 400}));
        return (NextResponse.json({ histories: getHistory.histories}, {status: 200}));
    }
    if (get == "members") {
        const getTeamMembers: getTeamMembers = await database.getTeamMembers(team);
        if (!getTeamMembers.success)
            return (NextResponse.json({error: getTeamMembers.error}, {status: 400}));
        return (NextResponse.json({members: getTeamMembers.members}, {status: 200}));
    }
    const getTeam: status & Partial<TeamInfo> = await database.getTeamInfo(team);
    if (!getTeam.success)
        return (NextResponse.json({error: getTeam.error}, {status: 400}));
    return (NextResponse.json({
        name: getTeam.name,
        creation_date: getTeam.creation_date,
        owner_name: getTeam.owner_name,
        id_owner: getTeam.id_owner,
        members_count: getTeam.members_count
    }));
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