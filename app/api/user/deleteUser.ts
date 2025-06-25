import {Controller} from "../../../lib/controller";
import {NextResponse} from "next/server";

export async function deleteUser(body: {user_id: number | undefined},
                                 caller_id: number): Promise<NextResponse> {
    if (body.user_id === undefined)
        return (NextResponse.json({error: "'user_id' is required!"}, {status: 400}));
    const database = Controller.getInstance();
    if (caller_id != body.user_id && !(await database.isAdmin(caller_id)).result)
        return (NextResponse.json({error: "Only admin can delete users!"}, {status: 403}));
    const status = await database.deleteUser(body.user_id);
    if (!status.success)
        return (NextResponse.json({error: status.error}, {status: 400}));
    return (NextResponse.json({}, {status: 200}));
}