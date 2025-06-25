import {NextResponse} from "next/server";
import {Controller} from "../../../lib/controller";

export async function updatePassword(body: {old_password: string | undefined, new_password: string | undefined},
                                    user_id: number) : Promise<NextResponse> {
    if (body.old_password === undefined || body.new_password === undefined)
        return (NextResponse.json({error: "'old_password' and 'new_password' are required!"}, {status: 400}));
    const database = Controller.getInstance();
    const status = await database.updatePasswordUser(user_id, body.old_password, body.new_password);
    if (!status.success)
        return (NextResponse.json({error: status.error}, {status: 400}));
    const response = NextResponse.json({}, {status: 200});
    response.headers.set('token', status.token);
    return (response);
}