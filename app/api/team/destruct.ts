import {NextResponse} from "next/server";
import {status} from "../../../lib/types";
import {Database} from "../../../lib/database/database";
import {UserEntity} from "../../../lib/database/UserEntity";
import {TeamEntity} from "../../../lib/database/TeamEntity";

export async function destruct(body: {id_team: number | undefined},
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
    if (!user.is_admin)
        return (NextResponse.json({error: "Only admin can totally delete a team!"}, {status: 403}));
    status = await team.hardDelete();
    if (!status.success)
        return (NextResponse.json({error: status.error}, {status: 400}));
    return (NextResponse.json({}, {status: 200}));
}