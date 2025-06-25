import {NextResponse} from "next/server";
import {Controller} from "../../../lib/controller";

export async function create(body: {name: string | undefined},
                             user_id: number): Promise<NextResponse> {
    if (body.name == undefined)
        return (NextResponse.json({error: "'name' is required!"}, {status: 400}));
    const database = Controller.getInstance();
    const setStatus = await database.createTeam(body.name, user_id);
    if (!setStatus.success)
        return (NextResponse.json({error: setStatus.error}, {status: 400}));
    return (NextResponse.json({id: setStatus.id}, {status: 200}));
}