// app/api/tournament/route.ts
import {NextRequest, NextResponse} from "next/server";
import {Controller} from "../../../lib/controller";
import {getMatchs, getTournamentTeams, status, Tournament} from "../../../lib/types";
import {secureRequest} from "../../../lib/secureRequest";
import {create} from "./create";
import {edit} from "./edit";
import {erase} from "./erase";
import {registration} from "./registration";
import {matchEdit} from "./matchEdit";

export async function GET(request: NextRequest): Promise<NextResponse> {
    const {searchParams} = new URL(request.url);
    let id: string | number | null = searchParams.get('id');
    const get: string | null = searchParams.get('g');
    if (id === null && !get && get != "list")
        return (NextResponse.json({error: "'id' is required!"}, {status: 400}));
    id = parseInt(id as string, 10);
    if (get && get != "teams" && get != "matchs" && get != "list")
        return (NextResponse.json({error: "'g' must equal to 'teams', 'list' or 'matchs' to fetch it!"}, {status: 400}));
    const database = Controller.getInstance();
    if (get == "teams") {
        const teamsRegistration: getTournamentTeams = await database.getRegisterTeams(id);
        if (!teamsRegistration.success)
            return (NextResponse.json({error: teamsRegistration.error}, {status: 400}));
        return (NextResponse.json({ teams: teamsRegistration.teams}, {status: 200}));
    }
    if (get == "matchs") {
        const getMatchs: getMatchs = await database.getMatchs(id);
        if (!getMatchs.success)
            return (NextResponse.json({error: getMatchs.error}, {status: 400}));
        return (NextResponse.json({ matchs: getMatchs.matchs}, {status: 200}));
    }
    if (get == "list") {
        return (NextResponse.json({...(await database.getAllTournaments())}, {status: 200}));
    }
    const getTournament: status & Partial<Tournament> = await database.getTournament(id);
    if (!getTournament.success)
        return (NextResponse.json({error: getTournament.error}, {status: 400}));
    return (NextResponse.json({tournament_id: getTournament.tournament_id, name: getTournament.name, description: getTournament.description, format: getTournament.format, size: getTournament.size, id_owner: getTournament.id_owner, creation_date: getTournament.creation_date, start_visibility: getTournament.start_visibility, open_registration: getTournament.open_registration, close_registration: getTournament.close_registration, start: getTournament.start}, {status: 200}));
}

export async function POST(request: NextRequest): Promise<NextResponse> {
    return secureRequest(request, async (request, user_id): Promise<NextResponse> => {
        const body = await request.json();
        const command: string | null = body.command;
        if (!command)
            return (NextResponse.json({error: "'command' is required!"}, {status: 400}));
        if (command == "create")
            return await create(body, user_id);
        if (command == "edit")
            return await edit(body, user_id);
        if (command == "erase")
            return await erase(body, user_id);
        if (command == "register")
            return await registration(body, user_id, false);
        if (command == "unregister")
            return await registration(body, user_id, true);
        if (command == "match-edit")
            return await matchEdit(body, user_id);
        return (NextResponse.json({error: "Unknown command!"}, {status: 400}));
    });
}