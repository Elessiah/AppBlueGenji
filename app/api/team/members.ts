import {NextResponse} from "next/server";
import {Database} from "../../../lib/database/database";
import {status, User, TeamInfo} from "../../../lib/types";
import {TeamEntity} from "../../../lib/database/TeamEntity";
import {UserEntity} from "../../../lib/database/UserEntity";

export async function members(body: {user: number | string | undefined,
                                  id_team: number | undefined},
                              id_user: number,
                              is_remove: boolean = false) : Promise<NextResponse> {
    if (body.user === undefined || body.id_team === undefined)
        return (NextResponse.json({error: "'id_user' and 'id_team' are required!"}, {status: 400}));
    const team: TeamEntity = new TeamEntity();
    let status: status = await team.fetch(body.id_team);
    if (!status.success)
        return (NextResponse.json({error: status.error}, {status: 400}));
    const caller: UserEntity = new UserEntity();
    status = await caller.fetch(id_user);
    if (!status.success)
        return (NextResponse.json({error: status.error}, {status: 400}));
    if (!caller.is_admin) {
        if (!caller.team)
            return (NextResponse.json({error: "You need to be in a team to manage its members."}, {status: 400}));
        if (caller.team.id! != team.id)
            return (NextResponse.json({error: "You need to be in your team to manage its members."}, {status: 400}));
        if (caller.id != team.id_user)
            return (NextResponse.json({error: "You need to be the owner of the team to manage it."}, {status: 400}));
    }
    const target: UserEntity = new UserEntity();
    status = await target.fetch(body.user);
    if (!status.success)
        return (NextResponse.json({error: status.error}, {status: 400}));
    if (target.team)
        return (NextResponse.json({error: "The member is already in another team."}, {status: 400}))
    if (!caller.is_admin && caller.id != team.id_user)
        return (NextResponse.json({error: "You don't have the permission to do this! Ask the team owner !"}, {status: 403}));
    if (is_remove)
        status = await team.rmMember(target);
    else
        status = await team.addMember(target);
    if (!status.success)
        return (NextResponse.json({error: status.error}, {status: 400}));
    return (NextResponse.json({}, {status: 200}));
}