import {NextResponse} from "next/server";
import {status} from "../../../lib/types";
import { UserEntity } from "../../../lib/database/UserEntity";

export async function updateUsername(body: {new_username: string | undefined},
                                     user_id: number): Promise<NextResponse> {
    if (body.new_username === undefined)
        return (NextResponse.json({error: "'new_username' is required!"}, {status: 400}));
    const user: UserEntity = new UserEntity();
    let status: status = await user.fetch(user_id);
    if (!status.success)
        return (NextResponse.json({error: status.error}, {status: 400}));
    status = await user.editUsername(body.new_username);
    if (!status.success)
        return (NextResponse.json({error: status.error}, {status: 400}));
    return (NextResponse.json({}, {status: 200}));
}