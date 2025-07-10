import {NextResponse} from "next/server";
import {Database} from "../../../lib/database/database";
import {status, Tournament} from "../../../lib/types";

export async function erase(body: {id_tournament: number | undefined},
                            user_id: number): Promise<NextResponse> {
    if (body.id_tournament === undefined)
        return (NextResponse.json({error: "'id_tournament' is required!"}, {status: 400}));
    const database = Database.getInstance();
    const getTournament: status & Partial<Tournament> = await database.getTournament(body.id_tournament);
    if (!getTournament.success)
        return (NextResponse.json({error: getTournament.error}, {status: 400}));
    if (getTournament.id_owner != user_id) {
        const checkAdmin: status & {result: boolean} = await database.isAdmin(user_id);
        if (!checkAdmin.success)
            return (NextResponse.json({error: checkAdmin.error}, {status: 400}));
        if (!checkAdmin.result)
            return (NextResponse.json({error: "You don't have the permission to do this!"}, {status: 403}));
    }
    const status: status = await database.deleteTournament(body.id_tournament);
    if (!status.success)
        return (NextResponse.json({error: status.error}, {status: 400}));
    return (NextResponse.json({}, {status: 200}));
}