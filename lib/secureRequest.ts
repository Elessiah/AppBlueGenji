import { NextRequest, NextResponse } from "next/server";
import {status, token_payload} from "./types";
import {Database} from "./database";

export async function secureRequest(
    req: NextRequest,
    handler: (req: NextRequest, user_id: number) => Promise<NextResponse>
) {
    let token: string | null = req.headers.get('token');
    if (token == null)
        return NextResponse.json({ error: 'Non authorized!' }, { status: 401 });
    let payload: token_payload;
    try {
        payload = JSON.parse(Buffer.from(token, "base64url").toString("utf-8")) as token_payload;
    } catch (e) {
        return NextResponse.json({ error: 'Non authorized!' }, { status: 401 });
    }
    const user_id = payload.user_id;
    const database = Database.getInstance();
    const tokenStatus: status & {token: string} = await database.authTokenUser(user_id, token);
    if (!tokenStatus.success)
        return NextResponse.json({error: tokenStatus.error}, {status: 500});
    if (tokenStatus.token.length == 0)
        return NextResponse.json({ error: 'Non authorized!' }, { status: 401 });
    const response = await handler(req, user_id);
    if (response.headers.get('token') == null)
        response.headers.set('token', tokenStatus.token);
    response.headers.set('Cache-Control', 'no-cache');
    response.headers.set('Access-Control-Allow-Origin', '*');
    response.headers.set("Access-Control-Expose-Headers", 'token')
    return response;
}