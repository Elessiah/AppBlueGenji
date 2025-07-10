import {Database} from "../../../lib/database";
import {NextResponse} from "next/server";

export async function newUser(body: {username: string | undefined, password: string | undefined}): Promise<NextResponse> {
    if (body.username === undefined || body.password === undefined)
        return (NextResponse.json({error: "'username' and 'password' is requested!"}, {status: 400}));
    const database = Database.getInstance();
    const setUser = await database.newUser(body.username, body.password, false);
    if (!setUser.success)
        return (NextResponse.json({error: setUser.error}, {status: 400}));
    const response = NextResponse.json({id: setUser.id}, {status: 200})
    response.headers.set('token', setUser.token);
    response.headers.set('Cache-Control', 'no-cache');
    return response;
}