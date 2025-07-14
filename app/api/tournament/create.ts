import {NextResponse} from "next/server";
import {status, id} from "../../../lib/types";
import {TournamentEntity} from "../../../lib/database/TournamentEntity";
import {UserEntity} from "../../../lib/database/UserEntity";

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
    const tournament: TournamentEntity = new TournamentEntity();
    const owner: UserEntity = new UserEntity();
    const strictStatus: status = await owner.fetch(user_id);
    if (!strictStatus.success)
        return (NextResponse.json({error: strictStatus.error}, {status: 400}));
    const status: status & id = await tournament.create(body.name,
        body.description,
        body.format,
        body.size,
        owner,
        new Date(body.start_visibility),
        new Date(body.open_registration),
        new Date(body.close_registration),
        new Date(body.start));
    if (!status.success)
        return (NextResponse.json({error: status.error}, {status: 400}));
    return (NextResponse.json({id: status.id}, {status: 200}));
}
