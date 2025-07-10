import {NextResponse} from "next/server";
import {status, Tournament} from "../../../lib/types";
import {Database} from "../../../lib/database/database";
import {TournamentEntity} from "../../../lib/database/TournamentEntity";
import {UserEntity} from "../../../lib/database/UserEntity";

export async function edit(body: {  id_tournament: number | undefined,
                                    name: string | undefined,
                                    description: string | undefined,
                                    format: 'SIMPLE' | undefined,
                                    size: number | undefined,
                                    start_visibility: string | undefined,
                                    open_registration: string | undefined,
                                    close_registration: string | undefined,
                                    start: string | undefined},
                           user_id: number): Promise<NextResponse> {
    if (body.id_tournament === undefined)
        return (NextResponse.json({error: "'id_tournament' is required!"}, {status: 400}));
    const tournament: TournamentEntity = new TournamentEntity();
    let status: status = await tournament.fetch(body.id_tournament);
    if (!status.success)
        return (NextResponse.json({error: status.error}, {status: 400}));
    const user: UserEntity = new UserEntity();
    status = await user.fetch(user_id);
    if (!status.success)
        return (NextResponse.json({error: status.error}, {status: 400}));
    if (!user.compare(tournament.owner!) && !user.is_admin) {
        return (NextResponse.json({error: "You don't have the permission to do this !"}, {status: 403}));
    }
    status = await tournament.edit(
        body.name === undefined ? null : body.name,
        body.description === undefined ? null : body.description,
        body.format === undefined ? null : body.format,
        body.size === undefined ? null : body.size,
        !body.start_visibility ? undefined : new Date(body.start_visibility),
        !body.open_registration ? undefined : new Date(body.open_registration),
        !body.close_registration ? undefined : new Date(body.close_registration),
        !body.start ? undefined : new Date(body.start)
    );
    if (!status.success)
        return (NextResponse.json({error: status.error}, {status: 400}));
    return (NextResponse.json({}, {status: 200}));
}