import {NextResponse} from "next/server";
import {Database} from "../../../lib/database";
import {status, id} from "../../../lib/types";

export async function create(body: {
                                 name: string | undefined,
                                 description: string | undefined,
                                 format: 'SIMPLE' | undefined,
                                 size: number | undefined,
                                 start_visibility: string | undefined,
                                 open_registration: string | undefined,
                                 close_registration: string | undefined,
                                 start: string | undefined
                             },
                             user_id: number): Promise<NextResponse> {
    if (body.name === undefined
        || body.description === undefined
        || body.format === undefined
        || body.size === undefined
        || body.start_visibility === undefined
        || body.open_registration === undefined
        || body.close_registration === undefined
        || body.start === undefined) {
        return (NextResponse.json({error: "At least one parameter is missing! ('name', 'description', 'format', 'size', 'start_visibility', 'open_registration', 'close_registration', 'start'"}, {status: 400}));
    }
    const database = Database.getInstance();
    const status: status & id = await database.createTournament(body.name,
        body.description,
        body.format,
        body.size,
        user_id,
        new Date(body.start_visibility),
        new Date(body.open_registration),
        new Date(body.close_registration),
        new Date(body.start));
    if (!status.success)
        return (NextResponse.json({error: status.error}, {status: 400}));
    return (NextResponse.json({id: status.id}, {status: 200}));
}
