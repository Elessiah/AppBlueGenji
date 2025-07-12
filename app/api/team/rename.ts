import {NextResponse} from "next/server";
import {status} from "../../../lib/types";
import {Database} from "../../../lib/database/database";
import {TeamEntity} from "../../../lib/database/TeamEntity";
import {UserEntity} from "../../../lib/database/UserEntity";

export async function rename(body: {
                                 id_team: number | undefined,
                                 new_name: string | undefined
                             },
                             user_id: number): Promise<NextResponse> {
    if (body.id_team === undefined || body.new_name === undefined)
        return (NextResponse.json({error: "'id_team' and 'new_name' are required!"}, {status: 400}));
    const team: TeamEntity = new TeamEntity();
    let status: status = await team.fetch(body.id_team);
    if (!status.success)
        return (NextResponse.json({error: status.error}, {status: 400}));
    const user: UserEntity = new UserEntity();
    status = await user.fetch(user_id);
    if (!status.success)
        return (NextResponse.json({error: status.error}, {status: 400}));
    if (team.id_user != user_id && !user.is_admin) {
        return (NextResponse.json({error: "You don't have the permission to do this!"}, {status: 403}));
    }
    status = await team.rename(body.new_name);
    if (!status.success)
        return (NextResponse.json({error: status.error}, {status: 400}));
    return (NextResponse.json({}, {status: 200}));
}