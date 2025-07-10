import {NextResponse} from "next/server";
import {UserEntity} from "../../../lib/database/UserEntity";
import {TeamEntity} from "../../../lib/database/TeamEntity";
import {id, status} from "../../../lib/types";

export async function create(body: {name: string | undefined},
                             user_id: number): Promise<NextResponse> {
    if (body.name == undefined)
        return (NextResponse.json({error: "'name' is required!"}, {status: 400}));
    const team: TeamEntity = new TeamEntity();
    const user: UserEntity = new UserEntity();
    const status: status = await user.fetch(user_id);
    if (!status.success)
        return (NextResponse.json({error: status.error}, {status: 400}));
    const setStatus: status & id = await team.create(body.name, user);
    if (!setStatus.success)
        return (NextResponse.json({error: status.error}, {status: 400}));
    return (NextResponse.json({id: setStatus.id}, {status: 200}));
}