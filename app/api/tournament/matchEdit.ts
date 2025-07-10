import {NextResponse} from "next/server";
import {Database} from "../../../lib/database/database";
import {status, TeamTournament, Match} from "../../../lib/types";

export async function matchEdit(body: {
                                    match_id: number | undefined,
                                    score_host: number | undefined,
                                    score_guest: number | undefined,
                                    victory: "host" | "guest" | null | undefined,
                                },
                                user_id: number): Promise<NextResponse> {
    if (body.match_id === undefined || body.score_host === undefined || body.score_guest === undefined || body.victory === undefined)
        return (NextResponse.json({error: "'match_id' or 'score_host' or 'score_guest' or 'victory' is missing"}, {status: 400}));
    const database = Database.getInstance();
    const getTeamUser: status & {result: number} = await database.isTeamOwner(user_id);
    if (!getTeamUser.success)
        return (NextResponse.json({error: getTeamUser.error}, {status: 500}));
    if (getTeamUser.result == -1)
        return (NextResponse.json({error: "You must own a team to update score!"}, {status: 403}));
    const getMatch: status & Partial<Match> = await database.getMatch(body.match_id);
    if (!getMatch.success)
        return (NextResponse.json({error: getMatch.error}, {status: 400}));
    const getRegistration: status & Partial<TeamTournament> = await database.getTeamRegistration(getTeamUser.result, getMatch.id_tournament!);
    if (!getRegistration.success)
        return (NextResponse.json({error: getRegistration.error}, {status: 400}));
    if (getRegistration.team_tournament_id != getMatch.id_team_tournament_guest
        && getRegistration.team_tournament_id != getMatch.id_team_tournament_host)
        return (NextResponse.json({error: "Your team does not play this match!"}, {status: 403}));
    const status: status = await database.updateScore(body.match_id, body.score_host, body.score_guest, body.victory);
    if (!status.success)
        return (NextResponse.json({error: status.error}, {status: 400}));
    return (NextResponse.json({}, {status: 200}));
}