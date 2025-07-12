import {NextResponse} from "next/server";
import {status, TeamInfo, UserInfo} from "../../../lib/types";
import {Database} from "../../../lib/database/database";
import {TeamEntity} from "../../../lib/database/TeamEntity";
import {UserEntity} from "../../../lib/database/UserEntity";

export async function erase(body: {id_team: number | undefined},
                            user_id: number): Promise<NextResponse> {
    if (body.id_team === undefined)
        return (NextResponse.json({error: "'id_team' is required!"}, {status: 400}));
    const team: TeamEntity = new TeamEntity();
    let status: status = await team.fetch(body.id_team);
    if (!status.success)
        return (NextResponse.json({error: status.error}, {status: 400}));
    const user: UserEntity = new UserEntity();
    status = await user.fetch(user_id);
    if (!status.success)
        return (NextResponse.json({error: status.error}, {status: 400}));
    if (team.id_user && team.id_user != user_id && !user.is_admin) {
        return (NextResponse.json({error: "You don't have the permission to do this!"}, {status: 403}));
    } else if (!team.id_user) {
        return (NextResponse.json({error: "Team already deactivated!"}, {status: 400}));
    }
    status = await team.softDelete();
    if (!status.success)
        return (NextResponse.json({error: status.error}, {status: 400}));
    return (NextResponse.json({}, {status: 200}));
}