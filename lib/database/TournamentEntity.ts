import {UserEntity} from "./UserEntity";
import {
    getMatchs,
    getTournamentTeams,
    id,
    status,
    Team,
    TeamTournament,
    Tournament, Match,
    TournamentTeamsCount, TeamAndMatch, MatchTeams
} from "../types";
import {Database} from "./database";
import mysql from "mysql2/promise";
import {TeamEntity} from "./TeamEntity";
import {MatchEntity} from "./MatchEntity";

export class TournamentEntity {
    public id: number | undefined;
    public name: string | undefined;
    public description: string | undefined;
    public format: 'SIMPLE' | 'DOUBLE' | undefined;
    public size: number | undefined;
    public current_round: number | undefined;
    public owner: UserEntity | undefined;
    public creation_date: Date | undefined;
    public start_visibility: Date | undefined;
    public open_registration: Date | undefined;
    public close_registration: Date | undefined;
    public start: Date | undefined;
    public is_loaded: boolean = false;

    constructor(tournament: TournamentEntity | null = null) {
        if (tournament == null)
            this.is_loaded = false;
        else {
            this.id = tournament.id;
            this.name = tournament.name;
            this.description = tournament.description;
            this.format = tournament.format;
            this.size = tournament.size;
            this.current_round = tournament.current_round;
            this.owner = new UserEntity(tournament.owner);
            this.creation_date = new Date(tournament.creation_date!);
            this.open_registration = new Date(tournament.open_registration!);
            this.close_registration = new Date(tournament.close_registration!);
            this.start = tournament.start;
            this.is_loaded = true;
        }
    }

    public async fetch(tournament_id: number): Promise<status> {
        const database: Database = await Database.getInstance();
        const [rows] = await database.db!.execute(`SELECT *
                                                   FROM tournament
                                                   WHERE id_tournament = ?`, [tournament_id]);
        if ((rows as unknown[]).length === 0)
            return ({success: false, error: "This tournament does not exist!"});
        const tournament_data: Tournament = (rows as Tournament[])[0];
        this.id = tournament_data.id_tournament;
        this.name = tournament_data.name;
        this.description = tournament_data.description;
        this.format = tournament_data.format;
        this.size = tournament_data.size;
        this.current_round = tournament_data.current_round;
        this.owner = new UserEntity();
        this.creation_date = new Date(tournament_data.creation_date!);
        this.open_registration = new Date(tournament_data.open_registration!);
        this.close_registration = new Date(tournament_data.close_registration!);
        this.start = tournament_data.start;
        const status: status = await this.owner.fetch(tournament_data.id_user);
        if (!status.success)
            return ({success: false, error: status.error});
        return ({success: true, error: ""});
    }

    public async create(name: string,
                        description: string,
                        format: 'SIMPLE',
                        size: number,
                        owner: UserEntity,
                        start_visibility: Date,
                        open_registration: Date,
                        close_registration: Date,
                        start: Date): Promise<status & id> {
        if (name.length < 5)
            return ({success: false, error: "Tournament name must be at least 5 characters!", id: -1});
        if (name.length > 25)
            return ({success: false, error: "Tournament name cannot exceed 25 characters!", id: -1});
        if (description.length > 500)
            return ({success: false, error: "Tournament description cannot exceed 500 characters!", id: -1});
        if (size < 4)
            return ({success: false, error: "The size of the tournament must be at least for 4 teams!", id: -1});
        if (!owner.is_loaded || !owner.id)
            return ({success: false, error: "Broken user!", id: -1});
        if (await UserEntity.isExist(owner.id) == -1)
            return ({success: false, error: "User does not exist!", id: -1});
        const now = new Date();
        now.setMinutes(now.getMinutes() - 5);
        if (start_visibility < now || open_registration < now)
            return ({success: false, error: "You cannot setup a date in the past !", id: -1});
        if (close_registration <= open_registration || close_registration <= start_visibility)
            return ({
                success: false,
                error: "You cannot setup the close registration date before or at the same time as the open registration date or the start of the visibility of the tournament!",
                id: -1
            });
        if (start < close_registration)
            return ({
                success: false,
                error: "You cannot start the tournament before the close registration date!",
                id: -1
            });
        const database: Database = await Database.getInstance();
        const [result] = await database.db!.execute<mysql.ResultSetHeader>(`INSERT INTO tournament
                                                                            (name,
                                                                             description,
                                                                             format,
                                                                             size,
                                                                             id_user,
                                                                             start_visibility,
                                                                             open_registration,
                                                                             close_registration,
                                                                             start)
                                                                            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                name,
                description,
                format,
                size,
                owner.id,
                start_visibility,
                open_registration,
                close_registration,
                start
            ]);
        await this.fetch(result.insertId); // Mise à jour de l'objet
        return ({success: true, error: "", id: result.insertId});
    }

    public async edit(name: string | null = null,
                      description: string | null = null,
                      format: 'SIMPLE' | 'DOUBLE' | null = null,
                      size: number | null = null,
                      start_visibility: Date | null = null,
                      open_registration: Date | null = null,
                      close_registration: Date | null = null,
                      start: Date | null = null): Promise<status> {
        if (!this.is_loaded || !this.id)
            return ({success: false, error: "Empty Object!"});
        if (!(await TournamentEntity.isExist(this.id)))
            return ({success: false, error: "This tournament does not exist!"});
        const database: Database = await Database.getInstance();
        const [open_rows] = await database.db!.execute(`SELECT tournament.start_visibility,
                                                               tournament.open_registration,
                                                               tournament.close_registration,
                                                               tournament.start
                                                        FROM tournament
                                                        WHERE id_tournament = ?`, [this.id]);
        const dates = (open_rows as unknown[])[0] as {
            start_visibility: Date,
            open_registration: Date,
            close_registration: Date,
            start: Date
        };
        const now = new Date;
        if (now > dates.open_registration)
            return ({success: false, error: "This is too late to edit the tournament. Registration has begin!"});
        let values: unknown[] = [];
        let updates: string = "";
        if (name) {
            if (name.length < 5)
                return ({success: false, error: "Tournament name must be at least 5 characters!"});
            if (name.length > 25)
                return ({success: false, error: "Tournament name cannot exceed 25 characters!"});
            updates = "name = ?";
            values.push(name);
        }
        if (description) {
            if (description.length > 500)
                return ({success: false, error: "Tournament description cannot exceed 500 characters!"});
            if (updates.length > 0)
                updates += ",";
            updates += "description = ?";
            values.push(description);
        }
        if (format) {
            if (updates.length > 0)
                updates += ","
            updates += "format = ?";
            values.push(format);
        }
        if (size) {
            if (size < 4)
                return ({success: false, error: "The size of the tournament must be at least for 4 teams!"});
            if (updates.length > 0)
                updates += ",";
            updates += "size = ?";
            values.push(size);
        }
        now.setMinutes(now.getMinutes() - 5);
        if (start_visibility) {
            if (start_visibility < now)
                return ({success: false, error: "Start_visibility cannot be set in the past!"});
            if ((close_registration && start_visibility >= close_registration) || (!close_registration && start_visibility >= dates.close_registration))
                return ({
                    success: false,
                    error: "Start_visibility cannot be set after the closure of the registration!"
                });
            if (updates.length > 0)
                updates += ",";
            updates += "start_visibility = ?";
            values.push(start_visibility);
        }
        if (open_registration != null) {
            if (open_registration < now)
                return ({success: false, error: "The opening of registration cannot be set in the past !"})
            if ((close_registration && open_registration >= close_registration) || (!close_registration && open_registration >= dates.close_registration))
                return ({success: false, error: "The opening of registration cannot be set after the closure!"});
            if (updates.length > 0)
                updates += ",";
            updates += "open_registration = ?";
            values.push(open_registration);
        }
        if (close_registration != null) {
            if (!open_registration && close_registration < dates.open_registration)
                return ({success: false, error: "The closure cannot be set before the opening!"});
            if (!start_visibility && close_registration < dates.start_visibility)
                return ({
                    success: false,
                    error: "The closure cannot be set before the start of the visibility of the tournament"
                });
            if ((start && close_registration > start) || (!start && close_registration > dates.start))
                return ({
                    success: false,
                    error: "The closure of the registration cannot be set after the start of the tournament!"
                });
            if (updates.length > 0)
                updates += ",";
            updates += "close_registration = ?";
            values.push(close_registration);
        }
        if (start != null) {
            if (!close_registration && start < dates.close_registration)
                return ({
                    success: false,
                    error: "The start of the tournament cannot be set before the start of the tournament!"
                });
            if (updates.length > 0)
                updates += ",";
            updates += "start = ?";
            values.push(start);
        }
        if (updates.length == 0)
            return ({success: false, error: "Nothing to update!"});
        values.push(this.id);
        await database.db!.execute(`UPDATE tournament
                                    SET ${updates}
                                    WHERE id_tournament = ?`, values);
        return ({success: true, error: ""});
    }

    public async getAll(): Promise<{
        pending: TournamentTeamsCount[],
        active: TournamentTeamsCount[],
        ended: TournamentTeamsCount[]
    }> {
        this.checkEvent();
        const database: Database = await Database.getInstance()
        let [rows] = await database.db!.execute(`SELECT tournament.*, COUNT(team_tournament.id_team) as nb_teams
                                                 FROM tournament
                                                          LEFT JOIN team_tournament
                                                                    ON team_tournament.id_tournament = tournament.id_tournament
                                                 WHERE close_registration > NOW()
                                                 GROUP BY tournament.id_tournament, tournament.close_registration
                                                 ORDER BY close_registration DESC`);
        const pending: TournamentTeamsCount[] = rows as TournamentTeamsCount[];
        [rows] = await database.db!.execute(`SELECT DISTINCT tournament.*,
                                                             COUNT(team_tournament.id_team) as nb_teams
                                             FROM tournament
                                                      JOIN team_tournament
                                                           ON team_tournament.id_tournament = tournament.id_tournament
                                             WHERE start < NOW()
                                               and EXISTS(SELECT 1
                                                          FROM team_tournament
                                                          WHERE team_tournament.id_tournament = tournament.id_tournament
                                                            AND team_tournament.position = -1)
                                             GROUP BY tournament.id_tournament, start
                                             ORDER BY start DESC`);
        const active: TournamentTeamsCount[] = rows as TournamentTeamsCount[];
        [rows] = await database.db!.execute(`SELECT DISTINCT tournament.*,
                                                             COUNT(team_tournament.id_team) as nb_teams
                                             FROM tournament
                                                      JOIN team_tournament
                                                           ON team_tournament.id_tournament = tournament.id_tournament
                                             WHERE start < NOW()
                                               and NOT EXISTS(SELECT 1
                                                              FROM team_tournament
                                                              WHERE team_tournament.id_tournament = tournament.id_tournament
                                                                AND team_tournament.position = -1)
                                             GROUP BY tournament.id_tournament, start
                                             ORDER BY start DESC
                                             LIMIT 5`);
        const ended: TournamentTeamsCount[] = rows as TournamentTeamsCount[];
        return ({pending: pending, active: active, ended: ended});
    }

    public async isEnded(): Promise<status & { result: boolean }> {
        if (!this.is_loaded || !this.id)
            return ({success: false, error: "Empty Object!", result: false});
        if (!(await TournamentEntity.isExist(this.id)))
            return ({success: false, error: "This tournament does not exist!", result: false});
        const database: Database = await Database.getInstance()
        const [count] = await database.db!.execute(`SELECT position
                                                    FROM team_tournament
                                                    WHERE id_tournament = ?
                                                    ORDER BY position`, [this.id]);
        const result = count as ({ position: number })[];
        if (result.length == 0) {
            const [rows] = await database.db!.execute(`SELECT close_registration
                                                       FROM tournament
                                                       WHERE id_tournament = ?`, [this.id]);
            const close_registration = ((rows as unknown[])[0] as { close_registration: Date }).close_registration;
            const now = new Date;
            if (now > close_registration)
                return ({success: true, error: "No team are register to this tournament!", result: true});
            else
                return ({success: true, error: "", result: false});
        }
        return ({success: true, error: "", result: result[0].position != -1});
    }

    public async delete(): Promise<status> {
        if (!this.is_loaded || !this.id)
            return ({success: false, error: "Empty Object!"});
        if (!(await TournamentEntity.isExist(this.id)))
            return ({success: false, error: "Tournament does not exist!"});
        const database: Database = await Database.getInstance();
        await database.db!.execute(`DELETE
                                    FROM tournament
                                    WHERE id_tournament = ?`, [this.id]);
        await database.db!.execute(`DELETE
                                    FROM \`match\`
                                    WHERE id_tournament = ?`, [this.id]);
        this.is_loaded = false;
        return ({success: true, error: ""});
    }

    public async getRegistration(team: TeamEntity): Promise<status & Partial<TeamTournament>> {
        if (!this.is_loaded || !this.id)
            return ({success: false, error: "Empty Object!"});
        if (!(await TournamentEntity.isExist(this.id)))
            return ({success: false, error: "Tournament does not exist!"});
        if (!team.is_loaded || !team.id)
            return ({success: false, error: "Parameter team is empty!"});
        if (await TeamEntity.isExist(team.id) == -1)
            return ({success: false, error: "Team does not exist!"});
        const database: Database = await Database.getInstance();
        const [rows] = await database.db!.execute(`SELECT *
                                                   FROM team_tournament
                                                   WHERE id_team = ?
                                                     AND id_tournament = ?`, [team, this.id]);
        if ((rows as unknown[]).length == 0)
            return ({success: false, error: "Team is not register to the tournament!"});
        return ({success: true, error: "", ...(rows as TeamTournament[])[0]});
    }

    public async unregistration(team: TeamEntity): Promise<status> {
        if (!this.is_loaded || !this.id)
            return ({success: false, error: "Empty Object!"});
        if (!team.is_loaded || !team.id)
            return ({success: false, error: "Broken object team"});
        if (await TeamEntity.isExist(team.id) == -1)
            return ({success: false, error: "This team does not exist !"});
        const result: status & { result: boolean } = await this.isRegistrationPeriod();
        if (!result.success)
            return ({success: false, error: result.error});
        if (!result.result)
            return ({success: false, error: "We are out of the registration period !"});
        if (!(await this.isTeamRegister(team)))
            return ({success: false, error: "This team is not register to this tournament!"});
        const database: Database = await Database.getInstance();
        await database.db!.execute(`DELETE
                                    FROM team_tournament
                                    WHERE id_team = ?`, [team.id]);
        return ({success: true, error: ""});
    }

    public async registration(team: TeamEntity): Promise<status> {
        if (!this.is_loaded || !this.id)
            return ({success: false, error: "Empty Object!"});
        if (!team.is_loaded || !team.id)
            return ({success: false, error: "Empty Object team!"});
        if (await TeamEntity.isExist(team.id) == -1)
            return ({success: false, error: "Team does not exist!"});
        // Vérifie que le tournoi existe et qu'il n'est pas complet
        if (!(await TournamentEntity.isExist(this.id, true)))
            return ({
                success: false,
                error: "Tournament does not exist or is full!"
            });
        if (await this.isTeamRegister(team))
            return ({success: false, error: "Team already registered!"});
        const status: status & { result: boolean } = await this.isRegistrationPeriod();
        if (!status.success)
            return ({success: false, error: status.error});
        if (!status.result)
            return ({
                success: false,
                error: "We are out of the registration period !",
            });
        const database: Database = await Database.getInstance();
        await database.db!.execute(`INSERT INTO team_tournament (id_tournament, id_team)
                                    VALUES (?, ?)`, [this.id, team.id]);
        return ({success: true, error: ""});
    }

    public async getRegisterTeams(): Promise<getTournamentTeams> {
        if (!this.is_loaded || !this.id)
            return ({success: false, error: "Empty Object!", teams: []});
        if (!(await TournamentEntity.isExist(this.id)))
            return ({success: false, error: "Tournament does not exist!", teams: []});
        const database: Database = await Database.getInstance();
        const [rows] = await database.db!.execute(`SELECT *
                                                   FROM team
                                                            INNER JOIN team_tournament ON team_tournament.id_team = team.id_team
                                                   WHERE team_tournament.id_tournament = ?`, [this.id]);
        const teams = rows as (Team & TeamTournament)[];
        return ({success: true, error: "", teams: teams});
    }

    public async setup(): Promise<getMatchs> {
        if (!this.is_loaded || !this.id)
            return ({success: false, error: "Empty Object!", matchs: []});
        const status: status & { result: boolean } = await this.isEnded();
        if (!status.success)
            return ({success: false, error: status.error, matchs: []});
        else if (status.result)
            return ({success: false, error: "Tournament has ended!", matchs: []});
        const database: Database = await Database.getInstance();
        const now = new Date();
        const [rows] = await database.db!.execute(`SELECT start, current_round
                                                   FROM tournament
                                                   WHERE id_tournament = ?`, [this.id]);
        const info: { start: Date, current_round: number } = (rows as unknown[])[0] as {
            start: Date,
            current_round: number
        };
        if (info.start > now)
            return ({success: false, error: "The tournament has not begun!", matchs: []});
        if (info.current_round != -1)
            return ({success: false, error: "The tournament has already started!", matchs: []});
        const result: getTournamentTeams = await this.getRegisterTeams();
        if (!result.success)
            return ({success: false, error: result.error, matchs: []});
        const teams: (Team & TeamTournament)[] = result.teams;
        const strictStatus: status = await this.setupFirstRound(teams, now);
        if (!strictStatus.success)
            return ({success: false, error: strictStatus.error, matchs: []});
        return (await this.getMatchs());
    }

    public async getMatchs(nbFromLast: number = -1): Promise<getMatchs> {
        if (!this.is_loaded || !this.id)
            return ({success: false, error: "Empty Object!", matchs: []});
        if (!(await TournamentEntity.isExist(this.id)))
            return ({success: false, error: "Tournament does not exist!", matchs: []});
        let addons: string = "";
        if (nbFromLast > 0)
            addons = ` LIMIT ${nbFromLast} `;
        const database: Database = await Database.getInstance();
        const [rows] = await database.db!.execute(`SELECT *
                                                   FROM \`match\`
                                                   WHERE \`match\`.id_tournament = ?
                                                   ORDER BY id_match DESC ${addons}`, [this.id]);
        const matchs = rows as Match[];
        return ({success: true, error: "", matchs: matchs})
    }

    public async isTeamRegister(team: TeamEntity,
                                checkStillRunning: boolean = false): Promise<boolean> {
        if (!this.is_loaded || !this.id)
            return false;
        if (!await TournamentEntity.isExist(this.id))
            return false;
        if (!team.is_loaded || !team.id)
            return false;
        if (await TeamEntity.isExist(team.id) == -1)
            return false;
        let filter: string = "";
        if (checkStillRunning)
            filter = "AND position = -1";
        const database: Database = await Database.getInstance();
        const [rows] = await database.db!.execute(`SELECT 1
                                                   FROM team_tournament
                                                   WHERE id_tournament = ?
                                                     AND id_team = ? ${filter}`, [this.id, team.id]);
        return ((rows as unknown[]).length == 1);
    }

    // Math.ceil: arrondit à l'entier supérieur
    public async isAllMatchEnded(): Promise<boolean> {
        if (!this.is_loaded || !this.id)
            return false;
        if (!(await TournamentEntity.isExist(this.id)))
            return false;
        const database: Database = await Database.getInstance();
        const [rows] = await database.db!.execute(`SELECT id_match
                                                   FROM \`match\`
                                                   WHERE id_tournament = ? && \`match\`.id_victory_team IS NULL`, [this.id]);
        return (!(rows as unknown[]).length);
    }

    public async setupNextRound(): Promise<getMatchs> {
        if (!this.is_loaded || !this.id)
            return ({success: false, error: "Empty Object!", matchs: []});
        const status: status & { result: boolean } = await this.isEnded();
        if (!status.success)
            return ({success: false, error: status.error, matchs: []});
        else if (status.result) // Success True, car ce n'est pas une erreur et ça permet de boucler sur matchs.lengths pour faire fonctionner le tournois
            return ({success: true, error: "Tournament has ended!", matchs: []});
        if (!(await this.isAllMatchEnded()))
            return ({success: false, error: "All match has not ended!", matchs: []});
        const database: Database = await Database.getInstance();
        const [rows_size] = await database.db!.execute(`SELECT tournament.size, tournament.current_round
                                                        FROM tournament
                                                        WHERE id_tournament = ?`, [this.id]);
        const tournament_info: { size: number, current_round: number } = (rows_size as unknown[])[0] as {
            size: number,
            current_round: number
        };
        if (tournament_info.current_round == -1)
            return ({success: false, error: "This tournament have not start yet !", matchs: []});
        // On incrémente de un car on est un round mais on ne met pas à jour la BDD pour pas être bloquant en cas d'échec
        tournament_info.current_round++;

        // On calcule le nombre de matchs à préparer
        const match_to_setup: number = (tournament_info.size / 2 ** tournament_info.current_round) / 2;
        const match_to_fetch: number = match_to_setup * 2;
        const [rows] = await database.db!.execute(`SELECT m.id_match, m.id_victory_team, team_match.id_team,
                                                   FROM (SELECT *
                                                         FROM \`match\`
                                                         WHERE id_tournament = ?
                                                         ORDER BY \`match\`.id_match DESC
                                                         LIMIT ${match_to_fetch}) as m
                                                            INNER JOIN team_match ON m.id_match = team_match.id_match
                                                   ORDER BY m.id_match`, [this.id]);
        const previous_round: MatchTeams[] = await MatchEntity.groupByMatchID(rows as TeamAndMatch[]);
        let nmatch: number = 0;
        let errors: string = "";
        const match: MatchEntity = new MatchEntity();
        const team_host: TeamEntity = new TeamEntity();
        const team_guest: TeamEntity = new TeamEntity();
        let strictStatus: status;
        for (let i = 0; i < match_to_setup; i++) {
            const id_host: number = previous_round[nmatch].id_victory_team;
            strictStatus = await team_host.fetch(id_host);
            if (!strictStatus.success)
                errors += "\n" + strictStatus.error;
            nmatch++;
            strictStatus = await team_guest.fetch(previous_round[nmatch].id_victory_team);
            if (!strictStatus.success)
                errors += "\n" + strictStatus.error;
            nmatch++;
            const status = await match.create(this, team_host, team_guest, new Date);
            if (!status.success)
                errors += "\n" + status.error;
        }
        if (errors.length)
            return ({success: false, error: "All matchs setup with errors : " + errors, matchs: []});
        await database.db!.execute(`UPDATE tournament
                                    SET current_round = ?
                                    WHERE id_tournament = ?`, [tournament_info.current_round, this.id]);
        return (await this.getMatchs(match_to_setup));
    }

    // Static
    public static async isExist(id: number,
                                checkFreeSlots: boolean = false): Promise<boolean> {
        let size: string = "";
        if (checkFreeSlots)
            size = `, size`;
        const database: Database = await Database.getInstance();
        const [rows] = await database.db!.execute(`SELECT id_tournament ${size}
                                                   FROM tournament
                                                   WHERE id_tournament = ?`, [id]);
        if (!checkFreeSlots) {
            const tournaments = rows as { tournament_id: number }[];
            return (!!tournaments.length);
        }
        const tournaments = rows as ({ tournament_id: number } & { size: number })[];
        if (tournaments.length == 0)
            return false;
        const [count] = await database.db!.execute(`SELECT COUNT(*) as nb_teams
                                                    FROM team_tournament
                                                    WHERE id_tournament = ?`, [id]);
        const result = count as ({ nb_teams: number })[];
        const nbTeams: number = result[0].nb_teams;
        return tournaments[0].size != nbTeams;
    }

    // Private
    private async isRegistrationPeriod(): Promise<status & { result: boolean }> {
        if (!this.is_loaded || !this.id)
            return ({success: false, error: "Empty Object!", result: false});
        if (!await TournamentEntity.isExist(this.id))
            return ({success: false, error: "This tournament does not exist !", result: false});
        const database: Database = await Database.getInstance();
        const [rows] = await database.db!.execute(`SELECT open_registration, close_registration
                                                   FROM tournament
                                                   WHERE id_tournament = ?`, [this.id]);
        const tournament_info = (rows as unknown[])[0] as { open_registration: Date, close_registration: Date };
        const now = new Date();
        // Précision d'une seconde car la base de donnée arrondi
        if ((now.getTime() - tournament_info.open_registration.getTime()) >= -1000 && (now.getTime() - tournament_info.close_registration.getTime()) < 1000)
            return ({success: true, error: "", result: true});
        return ({success: true, error: "", result: false});
    }

    private findSize(nb_teams: number): number {
        return nb_teams <= 1 ? nb_teams : 2 ** Math.ceil(Math.log2(nb_teams));
    }

    private async setupFirstRound(teams: (Team & TeamTournament)[],
                                  start: Date): Promise<status> {
        const tournament_size = this.findSize(teams.length);
        const Match: MatchEntity = new MatchEntity();
        if (tournament_size == 1) {
            const winner: TeamEntity = new TeamEntity();
            const strictStatus: status = await winner.fetch(teams[0].id_team);
            if (!strictStatus.error)
                return ({success: false, error: strictStatus.error});
            const status: status & id = await Match.create(this, winner, null, new Date());
            if (!status.success)
                return ({success: false, error: status.error});
        } else {
            const byes: number = tournament_size - teams.length;
            const byesInterval: number = byes ? (Math.floor(tournament_size / byes)) - 1 : 0;
            let nteam: number = 0;
            let nbyes: number = 0;
            const nb_matchs: number = tournament_size / 2;
            for (let nmatch: number = 0; nmatch < nb_matchs; nmatch++) {
                let match: { team_host: TeamEntity | null, team_guest: TeamEntity | null } = {
                    team_host: null,
                    team_guest: null
                };
                for (let n_slot = 0; n_slot < 2; n_slot++) {
                    let team_id: number;
                    if (byesInterval && nbyes < byes && nteam % byesInterval === 0) {
                        team_id = -1;
                        nbyes++;
                    } else {
                        team_id = teams[nteam].id_team;
                        nteam += 1;
                    }
                    if (!n_slot) {
                        match.team_host = new TeamEntity();
                        const status: status = await match.team_host.fetch(team_id);
                        if (!status.success)
                            return ({success: false, error: status.error});
                    } else {
                        match.team_guest = new TeamEntity();
                        const status: status = await match.team_guest.fetch(team_id);
                        if (!status.success)
                            return ({success: false, error: status.error});
                    }
                }
                const status: status & id = await Match.create(this, match.team_host, match.team_guest, start);
                if (!status.success) {
                    return ({success: false, error: status.error});
                }
            }
        }
        // En dernier car s'il y a un problème avec ScheduleMatch, c'est pas bloquant pour retry
        const database: Database = await Database.getInstance();
        await database.db!.execute(`UPDATE tournament
                                    SET size = ?,
                                        current_round = 0
                                    WHERE tournament.id_tournament = ?`, [tournament_size, teams[0].id_tournament]);
        return ({success: true, error: ""});
    }

    private async checkEvent(): Promise<void> {
        const database: Database = await Database.getInstance();
        let [rows] = await database.db!.execute(`SELECT tournament.id_tournament, tournament.current_round
                                                 FROM tournament
                                                          LEFT JOIN \`match\`
                                                                    ON \`match\`.id_tournament = tournament.id_tournament
                                                 WHERE tournament.start < NOW()
                                                 GROUP BY tournament.id_tournament, tournament.current_round
                                                 HAVING COUNT(\`match\`.id_match) = 0
                                                     OR COUNT(CASE WHEN \`match\`.id_victory_team IS NOT NULL THEN 1 END) = 0;
        `);
        const tournaments: { tournament_id: number, current_round: number }[] = rows as {
            tournament_id: number,
            current_round: number
        }[];
        if (tournaments.length == 0)
            return;
        for (const tournament of tournaments) {
            if (tournament.current_round == -1)
                await this.setup();
            else {
                await this.setupNextRound();
            }
        }
    }
}