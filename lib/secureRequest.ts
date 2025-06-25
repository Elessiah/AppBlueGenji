import { NextRequest, NextResponse } from "next/server";
import {status, token_payload} from "./types";
import {Controller} from "./controller";

export async function secureRequest(
    req: NextRequest,
    handler: (req: NextRequest, user_id: number) => Promise<NextResponse>
) {
    let token: string | null = req.headers.get('token');
    if (!token)
        return NextResponse.json({ error: 'Non authorized!' }, { status: 401 });
    let payload: token_payload = JSON.parse(Buffer.from(token, "base64url").toString("utf-8")) as token_payload;
    const user_id = payload.user_id;
    const database = Controller.getInstance();
    const tokenStatus: status & {token: string} = await database.authTokenUser(user_id, token);
    if (!tokenStatus.success)
        return NextResponse.json({error: tokenStatus.error}, {status: 500});
    if (tokenStatus.token.length == 0)
        return NextResponse.json({ error: 'Non authorized!' }, { status: 401 });
    const response = await handler(req, user_id);
    if (response.headers.get('token') == null)
        response.headers.set('token', tokenStatus.token);
    response.headers.set('Cache-Control', 'no-cache');
    return response;
}