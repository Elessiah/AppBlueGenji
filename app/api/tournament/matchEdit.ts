import {NextResponse} from "next/server";
import {status} from "../../../lib/types";
import {UserEntity} from "../../../lib/database/UserEntity";
import { MatchEntity } from "../../../lib/database/MatchEntity";
import {TeamEntity} from "../../../lib/database/TeamEntity";

export async function matchEdit(body: {
                                    match_id: number | undefined,
                                    score_host: number | undefined,
                                    score_guest: number | undefined,
                                    id_victory_team: number | null | undefined,
                                },
                                user_id: number): Promise<NextResponse> {
    if (body.match_id === undefined || body.score_host === undefined || body.score_guest === undefined || body.id_victory_team === undefined)
        return (NextResponse.json({error: "'match_id' or 'score_host' or 'score_guest' or 'victory' is missing"}, {status: 400}));
    const match: MatchEntity = new MatchEntity();
    let status: status = await match.fetch(body.match_id);
    if (!status.success)
        return (NextResponse.json({error: status.error}, {status: 400}));
    const user: UserEntity = new UserEntity();
    status = await user.fetch(user_id);
    if (!status.success)
        return (NextResponse.json({error: status.error}, {status: 400}));
    const getTeamUser: status & {result: number} = await TeamEntity.isTeamOwner(user);
    if (!getTeamUser.success)
        return (NextResponse.json({error: getTeamUser.error}, {status: 500}));
    if (getTeamUser.result == -1)
        return (NextResponse.json({error: "You must own a team to update score!"}, {status: 403}));
    if (!match.teams!.find((element) => element.id_team == getTeamUser.result))
        return (NextResponse.json({error: "Your team does not play this match!"}, {status: 403}));
    status = await match.update([body.score_host, body.score_guest], body.id_victory_team);
    if (!status.success)
        return (NextResponse.json({error: status.error}, {status: 400}));
    return (NextResponse.json({}, {status: 200}));
}