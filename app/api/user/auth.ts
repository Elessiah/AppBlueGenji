import {NextResponse} from "next/server";
import {status} from "../../../lib/types";
import {UserEntity} from "../../../lib/database/UserEntity";

export async function auth(body: {user: number | string | undefined, password: string | undefined}): Promise<NextResponse> {
    if (body.user === undefined || body.password === undefined)
        return (NextResponse.json({error: "'user' and 'password' are required!"}, {status: 400}));
    const user: UserEntity = new UserEntity();
    const status: status = await user.fetch(body.user);
    if (!status.success)
        return NextResponse.json({error: "Wrong password or username"}, {status: 401});
    const auth: status & {token: string} = await user.authPassword(body.password);
    if (!auth.success || auth.token.length == 0)
        return NextResponse.json({error: "Wrong password or username"}, {status: 401});
    const response = NextResponse.json({}, {status: 200});
    response.headers.set('token', auth.token);
    response.headers.set('Cache-Control', 'no-cache');
    return response;
}