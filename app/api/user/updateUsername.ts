import {NextResponse} from "next/server";
import {Database} from "../../../lib/database/database";

export async function updateUsername(body: {new_username: string | undefined},
                                     user_id: number): Promise<NextResponse> {
    if (body.new_username === undefined)
        return (NextResponse.json({error: "'new_username' is required!"}, {status: 400}));
    const database = Database.getInstance();
    const status = await database.editUsername(user_id, body.new_username);
    if (!status.success)
        return (NextResponse.json({error: status.error}, {status: 400}));
    return (NextResponse.json({}, {status: 200}));
}