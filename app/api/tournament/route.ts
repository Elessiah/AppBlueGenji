// app/api/tournament/route.ts
import {NextRequest, NextResponse} from "next/server";
import {getMatchsClient, getMatchsServer, getTournamentTeams, Match, status} from "../../../lib/types";
import {secureRequest} from "../../../lib/API/secureRequest";
import {create} from "./create";
import {edit} from "./edit";
import {erase} from "./erase";
import {registration} from "./registration";
import {matchEdit} from "./matchEdit";
import {TournamentEntity} from "../../../lib/database/TournamentEntity";

export async function GET(request: NextRequest): Promise<NextResponse> {
    const {searchParams} = new URL(request.url);
    let id: string | number | null = searchParams.get('id');
    const get: string | null = searchParams.get('g');
    if (id === null && !get && get != "list")
        return (NextResponse.json({error: "'id' is required!"}, {status: 400}));
    id = parseInt(id as string, 10);
    if (get && get != "teams" && get != "matchs" && get != "list")
        return (NextResponse.json({error: "'g' must equal to 'teams', 'list' or 'matchs' to fetch it!"}, {status: 400}));
    const tournament: TournamentEntity = new TournamentEntity();
    if (!get || get != "list") {
        const status: status = await tournament.fetch(id);
        if (!status.success)
            return (NextResponse.json({error: status.error}, {status: 400}));
    }
    if (get == "teams") {
        const teamsRegistration: getTournamentTeams = await tournament.getRegisterTeams();
        if (!teamsRegistration.success)
            return (NextResponse.json({error: teamsRegistration.error}, {status: 400}));
        return (NextResponse.json({ teams: teamsRegistration.teams}, {status: 200}));
    }
    if (get == "matchs") {
        const getMatchs: getMatchsServer = await tournament.getMatchs(id);
        if (!getMatchs.success)
            return (NextResponse.json({error: getMatchs.error}, {status: 400}));
        const clientVersion: Match[] = [];
        for (const match of getMatchs.matchs) {
            clientVersion.push({
                    id_match: match.id!,
                    tournament: {
                        id_tournament: match.tournament!.id!,
                        name: match.tournament!.name!,
                        description: match.tournament!.description!,
                        format: match.tournament!.format!,
                        size: match.tournament!.size!,
                        current_round: match.tournament!.current_round!,
                        id_user: match.tournament!.owner!.id!,
                        creation_date: match.tournament!.creation_date!,
                        start_visibility: match.tournament!.start_visibility!,
                        open_registration: match.tournament!.open_registration!,
                        close_registration: match.tournament!.close_registration!,
                        start: match.tournament!.start!
                    },
                    teams: match.teams!,
                    id_victory_team: match.id_victory_team!,
                    start_date: match.start_date!,
                });
        }
        return (NextResponse.json({ matchs: clientVersion}, {status: 200}));
    }
    if (get == "list") {
        return (NextResponse.json({...(await tournament.getAll())}, {status: 200}));
    }
    return (NextResponse.json({
        tournament_id: tournament.id,
            name: tournament.name,
            description: tournament.description,
            format: tournament.format,
            size: tournament.size,
            id_owner: tournament.owner!.id!,
            creation_date: tournament.creation_date,
            start_visibility: tournament.start_visibility,
            open_registration: tournament.open_registration,
            close_registration: tournament.close_registration,
            start: tournament.start
    },
        {status: 200}));
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