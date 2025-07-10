import {NextResponse} from "next/server";
import {Database} from "../../../lib/database/database";
import {status, User, TeamInfo} from "../../../lib/types";

export async function members(body: {user: number | string | undefined,
                                  id_team: number | undefined},
                              id_user: number,
                              is_remove: boolean = false) : Promise<NextResponse> {
    if (body.user === undefined || body.id_team === undefined)
        return (NextResponse.json({error: "'id_user' and 'id_team' are required!"}, {status: 400}));
    const database = Database.getInstance();
    const caller: status & Partial<User> = await database.getUser(id_user);
    if (!caller.success)
        return (NextResponse.json({error: caller.error}, {status: 400}));
    const targetTeam: status & Partial<TeamInfo> = await database.getTeamInfo(body.id_team);
    if (!targetTeam.success)
        return (NextResponse.json({error: targetTeam.error}, {status: 400}));
    if (!caller.is_admin && caller.user_id != targetTeam.id_owner)
        return (NextResponse.json({error: "You don't have the permission to do this! Ask the team owner !"}, {status: 403}));
    let status: status;
    if (is_remove)
        status = await database.rmTeamMember(body.user);
    else
        status = await database.addTeamMember(body.user, body.id_team);
    if (!status.success)
        return (NextResponse.json({error: status.error}, {status: 400}));
    return (NextResponse.json({}, {status: 200}));
}