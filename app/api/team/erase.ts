import {NextResponse} from "next/server";
import {status, TeamInfo, UserInfo} from "../../../lib/types";
import {Database} from "../../../lib/database/database";

export async function erase(body: {id_team: number | undefined},
                            user_id: number): Promise<NextResponse> {
    if (body.id_team === undefined)
        return (NextResponse.json({error: "'id_team' is required!"}, {status: 400}));
    const database = Database.getInstance();
    const getTeamInfo: status & Partial<TeamInfo> = await database.getTeamInfo(body.id_team);
    if (!getTeamInfo.success)
        return (NextResponse.json({error: getTeamInfo.error}, {status: 400}));
    if (getTeamInfo.id_owner != user_id) {
        const checkStatus: status & {result: boolean} = await database.isAdmin(user_id);
        if (!checkStatus.success)
            return (NextResponse.json({error: checkStatus.error}, {status: 400}));
        if (!checkStatus.result)
            return (NextResponse.json({error: "You don't have the permission to do this!"}, {status: 403}));
    }
    const status: status = await database.softDeleteTeam(body.id_team);
    if (!status.success)
        return (NextResponse.json({error: status.error}, {status: 400}));
    return (NextResponse.json({}, {status: 200}));
}