import {NextResponse} from "next/server";
import {Database} from "../../../lib/database/database";
import {status} from "../../../lib/types";

export async function registration(body: {id_tournament: number | undefined},
                                   user_id: number,
                                   unregistration: boolean): Promise<NextResponse> {
    if (body.id_tournament === undefined)
        return (NextResponse.json({error: "'id_tournament' is required!"}, {status: 400}));
    const database = Database.getInstance();
    const statusID: status & {result: number} = await database.isTeamOwner(user_id);
    if (!statusID.success)
        return (NextResponse.json({error: statusID.error}, {status: 400}));
    if (statusID.result == -1)
        return (NextResponse.json({error: "You need to own a team to register !"}, {status: 403}));
    let status: status | (status & {id_team_tournament: number, id_user_history: number});
    if (unregistration)
        status = await database.tournamentUnregistration(body.id_tournament, statusID.result);
    else
        status = await database.tournamentRegistration(body.id_tournament, statusID.result);
    if (!status.success)
        return (NextResponse.json({error: status.error}, {status: 400}));
    return (NextResponse.json({}, {status: 200}));
}