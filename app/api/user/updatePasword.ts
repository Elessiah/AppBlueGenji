import {NextResponse} from "next/server";
import {status} from "../../../lib/types";
import {UserEntity} from "../../../lib/database/UserEntity";

export async function updatePassword(body: {old_password: string | undefined, new_password: string | undefined},
                                    user_id: number) : Promise<NextResponse> {
    if (body.old_password === undefined || body.new_password === undefined)
        return (NextResponse.json({error: "'old_password' and 'new_password' are required!"}, {status: 400}));
    const user: UserEntity = new UserEntity();
    let status: status = await user.fetch(user_id);
    if (!status.success)
        return (NextResponse.json({error: status.error}, {status: 400}));
    const statusToken: status & {token: string} = await user.updatePassword(body.old_password, body.new_password);
    if (!statusToken.success)
        return (NextResponse.json({error: statusToken.error}, {status: 400}));
    const response = NextResponse.json({}, {status: 200});
    response.headers.set('token', statusToken.token);
    return (response);
}