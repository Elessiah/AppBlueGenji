import {NextResponse} from "next/server";
import {status} from "../../../lib/types";
import {Controller} from "../../../lib/controller";

export async function rename(body: {id_team: number | undefined, new_name: string | undefined},
                             user_id: number): Promise<NextResponse> {
    if (body.id_team === undefined || body.new_name === undefined)
        return (NextResponse.json({error: "'id_team' and 'new_name' are required!"}, {status: 400}));
    const database = Controller.getInstance();
    const adminCheck: status & {result: boolean} = await database.isAdmin(user_id);
    if (!adminCheck.success)
        return (NextResponse.json({error: adminCheck.error}, {status: 400}));
    if (!adminCheck.result) {
        const ownerCheck: status & {result: number} = await database.isTeamOwner(user_id);
        if (!ownerCheck.success)
            return (NextResponse.json({error: ownerCheck.error}, {status: 400}));
        if (ownerCheck.result != body.id_team)
            return (NextResponse.json({error: "You don't have the permission to do this!"}, {status: 403}));
    }
    const status: status = await database.renameTeam(body.id_team, body.new_name);
    if (!status.success)
        return (NextResponse.json({error: status.error}, {status: 400}));
    return (NextResponse.json({}, {status: 200}));
}