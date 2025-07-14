import {TournamentEntity} from "./TournamentEntity";
import {TeamEntity} from "./TeamEntity";
import {status, getMatchsServer, id, TeamMatch, TeamAndMatch, MatchTeams} from "../types";
import {Database} from "./database";
import mysql from "mysql2/promise";

export class MatchEntity {
    public id: number | undefined;
    public tournament: TournamentEntity | undefined;
    public teams: TeamMatch[] | undefined;
    public id_victory_team: number | null | undefined;
    public start_date: Date | undefined;
    public is_loaded: boolean = false;

    constructor(match: MatchEntity | null = null) {
        if (match == null || !match.id || !match.teams || !match.tournament)
            this.is_loaded = false;
        else {
            this.id = match.id;
            this.tournament = new TournamentEntity(match.tournament);
            this.teams = Array.from(match.teams)
            this.id_victory_team = match.id_victory_team;
            this.start_date = match.start_date;
            this.is_loaded = true;
        }
    }

    public async fetch(id: number): Promise<status> {
        const database: Database = await Database.getInstance();
        const [rows] = await database.db!.execute(`SELECT m.id_match, m.id_victory_team, m.id_tournament, m.start_date, team_match.id_team, team_match.score
                                                   FROM (SELECT *
                                                         FROM \`match\`
                                                         WHERE id_match = ?) as m
                                                            LEFT JOIN team_match ON m.id_match = team_match.id_match`, [id]);
        if ((rows as unknown[]).length == 0)
            return ({success: false, error: "This match does not exist!"});
        const match: MatchTeams = (await MatchEntity.groupByMatchID((rows as TeamAndMatch[])))[0];
        this.id = match.id_match;
        this.tournament = new TournamentEntity();
        const status: status = await this.tournament.fetch(match.id_tournament);
        if (!status.success) {
            return ({success: false, error: status.error});
        }
        this.teams = [];
        for (const team of match.teams) {
            this.teams.push({...team, id_match: this.id})
        }
        this.id_victory_team = match.id_victory_team;
        this.start_date = new Date(match.start_date);
        this.is_loaded = true;
        return ({success: true, error: ""});
    }

    public compare(other: MatchEntity): boolean {
        if (!this.is_loaded || other.is_loaded)
            return false;
        return (this.id == other.id
        && this.tournament!.compare(other.tournament!)
        && this.teams!.length === other.teams!.length
            && this.teams!.every((val, index) => val.id_team === other.teams![index].id_team)
            && this.id_victory_team == other.id_victory_team
            && this.start_date == other.start_date
        )
    }

    public async create(tournament: TournamentEntity,
                        host: TeamEntity | null,
                        guest: TeamEntity | null,
                        date: Date): Promise<status & id> {
        if (!tournament.is_loaded || !tournament.id)
            return ({success: false, error: "Tournament object is empty !", id: -1});
        if (!(await TournamentEntity.isExist(tournament.id)))
            return ({success: false, error: "The tournament does not exist!", id: -1});
        let id_victory_team: number | null = null;
        if (host == null)
            id_victory_team = -1;
        else {
            if (!host.is_loaded || !host.id)
                return ({success: false, error: "Team host object is empty !", id: -1});
            if (await TeamEntity.isExist(host.id, true) == -1)
                return ({success: false, error: "The host team does not exist!", id: -1});
            if (!await tournament.isTeamRegister(host, true))
                return ({success: false, error: "The host team is not register or has been eliminated!", id: -1});
        }
        if (guest == null) {
            if (id_victory_team != -1)
                id_victory_team = host!.id!;
        } else {
            if (!guest.is_loaded || !guest.id)
                return ({success: false, error: "Team guest object is empty !", id: -1});
            if (id_victory_team == -1)
                id_victory_team = guest.id;
            if (await TeamEntity.isExist(guest.id, true) == -1)
                return ({success: false, error: "The guest team does not exist!", id: -1});
            if (!await tournament.isTeamRegister(guest, true))
                return ({success: false, error: "The guest team is not register or has been eliminated!", id: -1});
        }
        const now = new Date();
        now.setMinutes(now.getMinutes() - 1);
        if (now > date)
            return ({success: false, error: "The date must not be in the past!", id: -1});
        const database: Database = await Database.getInstance();
        const [result] = await database.db!.execute<mysql.ResultSetHeader>(`INSERT INTO \`match\` (id_tournament, id_victory_team, start_date)
                                                                       VALUES (?, ?, ?)`,
            [
                tournament.id, id_victory_team, date
            ]);
        if (host)
            await database.db!.execute(`INSERT INTO team_match (id_match, id_team) VALUES (?, ?)`, [result.insertId, host.id]);
        if (guest)
            await database.db!.execute(`INSERT INTO team_match (id_match, id_team) VALUES (?, ?)`, [result.insertId, guest.id])
        if (id_victory_team)
            await this.manageTournamentWinner();
        await this.fetch(result.insertId); // Mise à jour de l'objet
        return ({success: true, error: "", id: result.insertId});
    }

    public async update(scores: number[],
                        id_victory_team: number | null = null): Promise<status> {
        if (!this.is_loaded || !this.id || !this.tournament || !this.teams)
            return ({success: false, error: "Empty Object!"});
        if (!(await MatchEntity.isExist(this.id, true)))
            return ({success: false, error: "Match does not exist or is ended!"});
        if (id_victory_team && !this.teams.find((team) => team.id_team == id_victory_team))
            return ({success: false, error: "The victory team, does not play the match or does not exist !"});
        if (scores.length != this.teams.length)
            return ({success: false, error: "The number of scores does not match the teams number"});
        const database: Database = await Database.getInstance();
        for (let i = 0; i < this.teams.length; i++) {
            await database.db!.execute(`UPDATE team_match
                                        SET score = ?
                                        WHERE id_team = ?`, [scores[i], this.teams[i].id_team]);
            this.teams[i].score = scores[i];
        }
        if (id_victory_team) {
            await database.db!.execute(`UPDATE \`match\` SET id_victory_team = ? WHERE id_match = ?`, [id_victory_team, this.id]);
            this.id_victory_team = id_victory_team;
            const status = await this.setLoserPosition();
            if (!status.success)
                return ({ success: false, error: status.error });
        }
        await this.manageTournamentWinner();
        if (await this.tournament.isAllMatchEnded()) {
            const getMatchs: getMatchsServer = await this.tournament.setupNextRound();
            if (!getMatchs.success)
                return ({success: false, error: getMatchs.error});
        }
        return ({success: true, error: ""});
    }

    // Static
    public static async groupByMatchID(teamsMatch: TeamAndMatch[]): Promise<MatchTeams[]> {
        const matchs: MatchTeams[] = [];
        for (const team of teamsMatch) {
            if (matchs.length == 0 || team.id_match != matchs[matchs.length - 1].id_match) {
                matchs.push({id_match: team.id_match, id_tournament: team.id_tournament, id_victory_team: team.id_victory_team, start_date: team.start_date, teams: []});
            }
            matchs[matchs.length - 1].teams.push({id_team: team.id_team, score: team.score});
        }
        return (matchs);
    }

    public static async isExist(id_match: number,
                                checkStillRunning: boolean = false): Promise<boolean> {
        let filter: string = "";
        if (checkStillRunning)
            filter = ' AND id_victory_team IS NULL ';
        const database: Database = await Database.getInstance();
        const [rows] = await database.db!.execute(`SELECT id_match
                                              FROM \`match\`
                                              WHERE id_match = ? ${filter}`, [id_match])
        const ids = rows as {tournament_match_id: number}[];
        return (!!ids.length);
    }

    // Private
    private async setLoserPosition(): Promise<status> {
        const database: Database = await Database.getInstance();
        const position: number = (this.tournament!.size! / 2 ** this.tournament!.current_round!);
        const id_loser: number = this.teams![0].id_team == this.id_victory_team ? this.teams![1].id_team : this.teams![0].id_team;
        await database.db!.execute(`UPDATE team_tournament
                                    SET position = ?
                                    WHERE id_team = ? AND id_tournament = ?`, [position, id_loser, this.tournament?.id]);
        return ({success: true, error: ""});
    }

    private async manageTournamentWinner(): Promise<status> {
        if (!this.is_loaded || !this.id)
            return ({success: false, error: "Broken Object!"});
        const status: status = await this.fetch(this.id);
        if (!status.success || !this.tournament || !this.tournament.id)
            return ({success: false, error: status.error.length ? status.error : "Object broken, please try again."});
        const database: Database = await Database.getInstance();
        const [rows] = await database.db!.execute(`SELECT COUNT(*) as nbTeams FROM team_tournament WHERE id_tournament = ? && position = -1`, [this.tournament.id]);
        if ((rows as unknown[]).length == 0)
            return ({success: true, error: ""}); // Pas d'équipes inscrites ou tournois terminé. Bizarre voire impossible ici, mais au cas où
        const nbTeams: number = ((rows as unknown[])[0] as {nbTeams: number}).nbTeams;
        if (nbTeams > 1)
            return ({success: true, error: ""});
        await database.db!.execute(`UPDATE team_tournament SET position=1 WHERE id_tournament=? AND position=-1`, [this.tournament?.id]);
        return ({success: true, error: ""});
    }

}