import {NextResponse} from "next/server";
import {status} from "../../../lib/types";
import {Database} from "../../../lib/database/database";

export async function destruct(body: {id_team: number | undefined},
                               user_id: number): Promise<NextResponse> {
    if (body.id_team === undefined)
        return (NextResponse.json({error: "'id_team' is required!"}, {status: 400}));
    const database = Database.getInstance();
    const checkStatus: status & {result: boolean} = await database.isAdmin(user_id);
    if (!checkStatus.success)
        return (NextResponse.json({error: checkStatus.error}, {status: 400}));
    if (!checkStatus.result)
        return (NextResponse.json({error: "Only admin can totally delete a team!"}, {status: 403}));
    const status: status = await database.hardDeleteTeam(body.id_team);
    if (!status.success)
        return (NextResponse.json({error: status.error}, {status: 400}));
    return (NextResponse.json({}, {status: 200}));
}