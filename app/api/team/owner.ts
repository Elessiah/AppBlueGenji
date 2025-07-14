import {NextResponse} from "next/server";
import {status} from "../../../lib/types";
import {UserEntity} from "../../../lib/database/UserEntity";

export async function owner(body: {
                                owner: number | string | undefined,
                                new_owner: number | string | undefined
                            },
                            user_id: number) : Promise<NextResponse>
{
    if (body.owner === undefined || body.new_owner === undefined)
        return (NextResponse.json({error: "'owner' and 'new_owner' are required!"}, {status: 400}));
    const caller: UserEntity = new UserEntity();
    let status: status = await caller.fetch(user_id);
    if (!status.success)
        return (NextResponse.json({error: status.error}, {status: 400}));
    const owner: UserEntity = new UserEntity();
    status = await owner.fetch(body.owner);
    if (!status.success)
        return (NextResponse.json({error: status.error}, {status: 400}));
    const new_owner: UserEntity = new UserEntity();
    status = await new_owner.fetch(body.new_owner);
    if (!status.success)
        return (NextResponse.json({error: status.error}, {status: 400}));
    if (!caller.compare(owner) && !caller.is_admin)
        return (NextResponse.json({error: "You don't have the right to do this !"}, {status: 403}));
    status = await owner.team!.giveOwnership(owner, new_owner);
    if (!status.success)
        return (NextResponse.json({error: status.error}, {status: 400}));
    return (NextResponse.json({}, {status: 200}));
}