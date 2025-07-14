import {NextResponse} from "next/server";
import {status} from "../../../lib/types";
import {TournamentEntity} from "../../../lib/database/TournamentEntity";
import {UserEntity} from "../../../lib/database/UserEntity";

export async function erase(body: {id_tournament: number | undefined},
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
        return (NextResponse.json({error: "You don't have the permission to do this!"}, {status: 403}));
    }
    status = await tournament.delete();
    if (!status.success)
        return (NextResponse.json({error: status.error}, {status: 400}));
    return (NextResponse.json({}, {status: 200}));
}