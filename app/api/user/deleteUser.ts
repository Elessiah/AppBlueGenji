import {NextResponse} from "next/server";
import {UserEntity} from "../../../lib/database/UserEntity";
import {status} from "../../../lib/types";

export async function deleteUser(body: {user_id: number | undefined},
                                 caller_id: number): Promise<NextResponse> {
    if (body.user_id === undefined)
        return (NextResponse.json({error: "'user_id' is required!"}, {status: 400}));
    const user: UserEntity = new UserEntity();
    let status: status = await user.fetch(caller_id);
    if (!status.success)
        return (NextResponse.json({error: status.error}, {status: 400}))
    if (caller_id != body.user_id && !user.is_admin)
        return (NextResponse.json({error: "Only admin can delete users!"}, {status: 403}));
    status = await user.fetch(body.user_id);
    if (!status.success)
        return (NextResponse.json({error: status.error}, {status: 400}));
    status = await user.delete();
    if (!status.success)
        return (NextResponse.json({error: status.error}, {status: 400}));
    return (NextResponse.json({}, {status: 200}));
}