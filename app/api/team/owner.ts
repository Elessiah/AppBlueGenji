import {NextResponse} from "next/server";
import {status} from "../../../lib/types";
import {Controller} from "../../../lib/controller";

export async function owner(body: {owner: number | string | undefined, new_owner: number | string | undefined},
                            user_id: number) : Promise<NextResponse>
{
    if (body.owner === undefined || body.new_owner === undefined)
        return (NextResponse.json({error: "'owner' and 'new_owner' are required!"}, {status: 400}));
    const database = Controller.getInstance();
    const checkAdmin: status & {result: boolean} = await database.isAdmin(user_id);
    if (!checkAdmin.success)
        return (NextResponse.json({error: checkAdmin.error}, {status: 400}));
    if (!checkAdmin.result)
        body.owner = user_id;
    const status: status = await database.giveTeamOwnership(body.owner, body.new_owner);
    if (!status.success)
        return (NextResponse.json({error: status.error}, {status: 400}));
    return (NextResponse.json({}, {status: 200}));
}