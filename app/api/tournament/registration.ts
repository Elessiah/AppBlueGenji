import {NextResponse} from "next/server";
import {status} from "../../../lib/types";
import {TournamentEntity} from "../../../lib/database/TournamentEntity";
import {UserEntity} from "../../../lib/database/UserEntity";
import { TeamEntity } from "../../../lib/database/TeamEntity";

export async function registration(body: {id_tournament: number | undefined},
                                   user_id: number,
                                   unregistration: boolean): Promise<NextResponse> {
    if (body.id_tournament === undefined)
        return (NextResponse.json({error: "'id_tournament' is required!"}, {status: 400}));
    const tournament: TournamentEntity = new TournamentEntity();
    let status: status;
    status = await tournament.fetch(body.id_tournament);
    if (!status.success)
        return (NextResponse.json({error: status.error}, {status: 400}));
    const user: UserEntity = new UserEntity();
    status = await user.fetch(user_id);
    if (!status.success)
        return (NextResponse.json({error: status.error}, {status: 400}));
    const team: TeamEntity = new TeamEntity();
    if (user.team == null)
        return (NextResponse.json({error: "You need to own a team to register to a tournament!"}, {status: 403}));
    status = await team.fetch(user.team.id!);
    if (!status.success)
        return (NextResponse.json({error: status.error}, {status: 400}));
    if (team.id_user != user.id)
        return (NextResponse.json({error: "You need to own a team to register !"}, {status: 403}));
    if (unregistration)
        status = await tournament.unregistration(team);
    else
        status = await tournament.registration(team);
    if (!status.success)
        return (NextResponse.json({error: status.error}, {status: 400}));
    return (NextResponse.json({}, {status: 200}));
}