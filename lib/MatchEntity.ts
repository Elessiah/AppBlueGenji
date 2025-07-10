import {TournamentEntity} from "./TournamentEntity";
import {TeamEntity} from "./TeamEntity";
import {status, getMatchs, Match, id} from "./types";
import {Database} from "./database";
import mysql from "mysql2/promise";

export class MatchEntity {
    public id: number | undefined;
    public tournament: TournamentEntity | undefined;
    public team_host: TeamEntity | null | undefined;
    public id_host_registration: number | null | undefined;
    public team_guest: TeamEntity | null | undefined;
    public id_guest_registration: number | null | undefined;
    public score_host: number | undefined;
    public score_guest: number | undefined;
    public victory: 'guest' | 'host' | null | undefined;
    public start_date: Date | undefined;
    public is_loaded: boolean = false;

    constructor(match: MatchEntity | null = null) {
        if (match == null)
            this.is_loaded = false;
        else {
            this.id = match.id;
            this.tournament = new TournamentEntity(match.tournament);
            this.team_host = new TeamEntity(match.team_host);
            this.id_host_registration = match.id_host_registration
            this.team_guest = new TeamEntity(match.team_guest);
            this.id_guest_registration = match.id_guest_registration
            this.score_host = match.score_host;
            this.score_guest = match.score_guest;
            this.victory = match.victory;
            this.start_date = match.start_date;
            this.is_loaded = true;
        }
    }

    public async fetch(id: number): Promise<status> {
        const database: Database = await Database.getInstance();
        const [rows] = await database.db!.execute(`SELECT \`match\`.*,
                                                          host.id_team  as id_host,
                                                          guest.id_team as id_guest
                                                   FROM \`match\`
                                                            LEFT JOIN blueTournament.team_tournament host
                                                                      on \`match\`.id_team_tournament_host = host.team_tournament_id
                                                            LEFT JOIN blueTournament.team_tournament guest
                                                                      on \`match\`.id_team_tournament_guest = guest.team_tournament_id
                                                   WHERE \`match\`.match_id = ?`, [id]);
        if ((rows as unknown[]).length == 0)
            return ({success: false, error: "This match does not exist!"});
        const match = (rows as (Match & {id_host: number, id_guest: number})[])[0];
        this.id = match.tournament_match_id;
        this.tournament = new TournamentEntity();
        let status: status = await this.tournament.fetch(match.id_tournament);
        if (!status.success) {
            return ({success: false, error: status.error});
        }
        if (match.id_host != -1) {
            this.team_host = new TeamEntity();
            status = await this.team_host.fetch(match.id_host);
            if (!status.success)
                return ({success: false, error: status.error});
        } else {
            this.team_host = null;
        }
        this.id_host_registration = match.id_team_tournament_host;
        if (match.id_guest != -1) {
            this.team_guest = new TeamEntity();
            status = await this.team_guest.fetch(match.id_guest);
            if (!status.success)
                return ({success: false, error: status.error});
        } else {
            this.team_guest = null;
        }
        this.id_guest_registration = match.id_team_tournament_guest;
        this.victory = match.victory;
        this.start_date = new Date(match.start_date);
        return ({success: true, error: ""});
    }

    public async create(tournament: TournamentEntity,
                        host: TeamEntity | null,
                        guest: TeamEntity | null,
                        date: Date): Promise<status & id> {
        if (!tournament.is_loaded || !tournament.id)
            return ({success: false, error: "Tournament object is empty !", id: -1});
        if (!(await tournament.isExist(tournament.id)))
            return ({success: false, error: "The tournament does not exist!", id: -1});
        let victory: 'host' | 'guest' | null = null;
        let id_host_register: number = -1;
        if (host == null)
            victory = 'guest';
        else {
            if (!host.is_loaded || !host.id)
                return ({success: false, error: "Team host object is empty !", id: -1});
            if (await host.isExist(host.id, true) == -1)
                return ({success: false, error: "The host team does not exist!", id: -1});
            id_host_register = await tournament.isTeamRegister(host, true);
            if (id_host_register == -1)
                return ({success: false, error: "The host team is not register or has been eliminated!", id: -1});
        }
        let id_guest_register = -1;
        if (guest == null) {
            victory = 'host';
        } else {
            if (!guest.is_loaded || !guest.id)
                return ({success: false, error: "Team guest object is empty !", id: -1});
            if (await guest.isExist(guest.id, true) == -1)
                return ({success: false, error: "The guest team does not exist!", id: -1});
            id_guest_register = await tournament.isTeamRegister(guest, true);
            if (id_guest_register == -1)
                return ({success: false, error: "The guest team is not register or has been eliminated!", id: -1});
        }
        const now = new Date();
        now.setMinutes(now.getMinutes() - 1);
        if (now > date)
            return ({success: false, error: "The date must not be in the past!", id: -1});
        const database: Database = await Database.getInstance();
        const [result] = await database.db!.execute<mysql.ResultSetHeader>(`INSERT INTO \`match\` (id_tournament, id_team_tournament_host, id_team_tournament_guest, victory, start_date)
                                                                       VALUES (?, ?, ?, ?, ?)`,
            [
                tournament.id, id_host_register, id_guest_register, victory, date
            ]);
        if (victory)
            await this.manageTournamentWinner();
        await this.fetch(result.insertId); // Mise à jour de l'objet
        return ({success: true, error: "", id: result.insertId});
    }

    public async update(host_score: number,
                        guest_score: number,
                        victory: 'host' | 'guest' | null = null): Promise<status> {
        if (!this.is_loaded || !this.id || !this.tournament)
            return ({success: false, error: "Empty Object!"});
        if (!(await this.isExist(this.id, true)))
            return ({success: false, error: "Match does not exist or is ended!"});
        const database: Database = await Database.getInstance();
        await database.db!.execute(`UPDATE \`match\`
                               SET score_host  = ?,
                                   score_guest = ?,
                                   victory     = ?
                               WHERE match_id = ?`, [host_score, guest_score, victory, this.id]);
        if (victory) {
            const status = await this.setLoserPosition();
            if (!status.success)
                return ({ success: false, error: status.error });
        }
        await this.manageTournamentWinner();
        if (await this.tournament.isAllMatchEnded()) {
            const getMatchs: getMatchs = await this.tournament.setupNextRound();
            if (!getMatchs.success)
                return ({success: false, error: getMatchs.error});
        }
        return ({success: true, error: ""});
    }

    // Private
    private async isExist(id_match: number,
                               checkStillRunning: boolean = false): Promise<boolean> {
        let filter: string = "";
        if (checkStillRunning)
            filter = ' AND victory IS NULL ';
        const database: Database = await Database.getInstance();
        const [rows] = await database.db!.execute(`SELECT match_id
                                              FROM \`match\`
                                              WHERE match_id = ? ${filter}`, [id_match])
        const ids = rows as {tournament_match_id: number}[];
        return (!!ids.length);
    }

    private async setLoserPosition(): Promise<status> {
        if (!this.is_loaded || !this.id || this.id_host_registration == undefined || this.id_guest_registration == undefined)
            return ({success: false, error: "Broken Object!"});
        let status: status = await this.fetch(this.id);
        if (!status.success || !this.tournament || !this.tournament.id || !this.tournament.size || !this.tournament.current_round)
            return ({success: false, error: status.error.length ? status.error : "Object broken, please try again."});
        if (!this.victory)
            return ({success: false, error: "No loser found for this match"});
        const database: Database = await Database.getInstance();
        const position: number = (this.tournament.size / 2 ** this.tournament.current_round);
        const id_loser: number = this.victory == 'host' ? this.id_guest_registration : this.id_host_registration;
        await database.db!.execute(`UPDATE team_tournament
                                    SET position = ?
                                    WHERE team_tournament_id = ?`, [position, id_loser]);
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