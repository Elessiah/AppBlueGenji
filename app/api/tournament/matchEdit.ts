import {NextResponse} from "next/server";
import {Database} from "../../../lib/database/database";
import {status, TeamTournament, Match} from "../../../lib/types";
import {TournamentEntity} from "../../../lib/database/TournamentEntity";
import {UserEntity} from "../../../lib/database/UserEntity";
import { MatchEntity } from "../../../lib/database/MatchEntity";

export async function matchEdit(body: {
                                    match_id: number | undefined,
                                    score_host: number | undefined,
                                    score_guest: number | undefined,
                                    victory: "host" | "guest" | null | undefined,
                                },
                                user_id: number): Promise<NextResponse> {
    if (body.match_id === undefined || body.score_host === undefined || body.score_guest === undefined || body.victory === undefined)
        return (NextResponse.json({error: "'match_id' or 'score_host' or 'score_guest' or 'victory' is missing"}, {status: 400}));
    const match: MatchEntity = new MatchEntity();
    let status: status = await match.fetch(body.match_id);
    if (!status.success)
        return (NextResponse.json({error: status.error}, {status: 400}));
    const user: UserEntity = new UserEntity();
    status = await user.fetch(user_id);
    if (!status.success)
        return (NextResponse.json({error: status.error}, {status: 400}));
    const database = Database.getInstance();
    const getTeamUser: status & {result: number} = await match.team_host!.isTeamOwner(user);
    if (!getTeamUser.success)
        return (NextResponse.json({error: getTeamUser.error}, {status: 500}));
    if (getTeamUser.result == -1)
        return (NextResponse.json({error: "You must own a team to update score!"}, {status: 403}));
    if (getTeamUser.result != match.team_host!.id
        && getTeamUser.result != match.team_guest!.id)
        return (NextResponse.json({error: "Your team does not play this match!"}, {status: 403}));
    status = await match.update(body.score_host, body.score_guest, body.victory);
    if (!status.success)
        return (NextResponse.json({error: status.error}, {status: 400}));
    return (NextResponse.json({}, {status: 200}));
}