import mysql from 'mysql2/promise';
import dotenv from "dotenv";

dotenv.config();

import {
    getTeamMembers,
    History,
    getHistories,
    status,
    Team,
    User,
    SQLGetParams,
    SQLEditParams,
    SQLQuery,
    SQLGetResult,
    SQLWhere,
    TournamentMatch,
    getMatchs,
    getTournamentTeams,
    TeamTournament, id, Tournament,
} from './types';

export class Database {
    // public
    public static getInstance(): Database {
        if (!Database.instance) {
            Database.instance = new Database();
        }
        return Database.instance;
    }

    // Primary function
    public async insert(params: SQLEditParams): Promise<status & id> {
        await this.ready;
        if (!this.db)
            return ({success: false, error: "Database not connected!", id: -1});
        try {
            const placeholders = params.values.map(() => "?").join(", ");

            const [result] = await this.db.execute<mysql.ResultSetHeader>(
                `INSERT INTO ${params.table} (${params.columns.join(", ")})
                 VALUES (${placeholders})`,
                params.values,
            );

            return {success: true, error: "", id: result.insertId};
        } catch (error: any) {
            return {success: false, error: error.message, id: -1};
        }
    }

    public async update(params: SQLEditParams, where: SQLWhere[]): Promise<status> {
        await this.ready;
        if (!this.db)
            return ({success: false, error: "Database not connected!"});
        if (where.length === 0)
            return ({success: false, error: "Impossible car trop dangereux"});
        try {
            const placeholders = params.columns.map((column) => `${column} = ?`).join(", ");
            let filter: string = ' WHERE ';
            where.forEach((elem) => {
                filter += ` ${elem.column} ${elem.condition} ?`;
                params.values.push(elem.value);
            })
            await this.db.execute(
                `UPDATE ${params.table}
                 SET ${placeholders} ${filter}`,
                params.values,
            );

            return {success: true, error: ""};
        } catch (error: any) {
            return {success: false, error: error.message};
        }
    }

    public async get(
        rawParams: Partial<SQLGetParams>,
    ): Promise<SQLGetResult> {
        await this.ready;
        if (!this.db)
            return ({success: false, error: "Database not connected!", result: []})
        const query = await this.buildSelectQuery(rawParams, true);

        try {
            const [rows] = await this.db!.execute(query.query, query.values);

            return ({success: true, error: "", result: rows as unknown[]});
        } catch (error: any) {
            return ({success: false, error: error.message, result: []});
        }
    }

    public async remove(rawParams: Partial<SQLGetParams>): Promise<status> {
        await this.ready;
        if (!this.db)
            return ({success: false, error: "Database not connected !"});
        const query = await this.buildSelectQuery(rawParams, false);

        await this.db!.execute(query.query, query.values);

        return {success: true, error: ""};
    }

    // App function
    public async newUser(username: string,
                         is_admin: boolean = false): Promise<status & id> {
        await this.ready;
        if (!this.db)
            return ({success: false, error: "Database not connected !", id: -1});
        const status = this.checkNameNorm(username);
        if (!status.success)
            return ({...status, id: -1});
        if (await this.isUserExist(username) != -1) {
            return ({success: false, error: "Username already exist !", id: -1});
        }
        const [result] = await this.db.execute<mysql.ResultSetHeader>(`INSERT INTO user (username, is_admin)
                                                                       VALUES (?, ?)`, [username, is_admin]);
        return ({success: true, error: "", id: result.insertId});
    }

    public async getUser(user: number | string): Promise<status & Partial<User>> {
        await this.ready;
        if (!this.db)
            return ({success: false, error: "Database not connected !"});
        user = await this.isUserExist(user);
        if (user == -1)
            return ({success: false, error: "This user does not exist!"});
        const [rows] = await this.db.execute(`SELECT *
                                              FROM user
                                              WHERE user_id = ?`, [user]);
        const users = rows as User[];
        if (users.length)
            return ({success: true, error: "", ...users[0], is_admin: Boolean(users[0].is_admin)});
        return ({success: true, error: ""});
    }

    public async editUsername(user: number | string,
                              new_username: string): Promise<status> {
        await this.ready;
        if (!this.db)
            return ({success: false, error: "Database not connected !"});
        user = await this.isUserExist(user);
        if (user == -1)
            return ({success: false, error: "User does not exist!"});
        const status = this.checkNameNorm(new_username);
        if (!status.success)
            return status;
        if (await this.isUserExist(new_username) != -1)
            return ({success: false, error: "Username already exist or it's already your username!"});
        await this.db.execute(`UPDATE user
                               SET username = ?
                               WHERE user_id = ?`, [new_username, user]);
        return ({success: true, error: ""});
    }

    public async deleteUser(user: number | string): Promise<status> {
        await this.ready;
        if (!this.db)
            return ({success: false, error: "Database not connected !"});
        user = await this.isUserExist(user);
        if (user == -1) {
            return ({success: false, error: "This user does not exist!"});
        }
        await this.db.execute(`DELETE
                               FROM user_history
                               WHERE id_user = ?`, [user]);
        await this.db.execute(`DELETE
                               FROM user
                               WHERE user_id = ?`, [user]);
        return ({success: true, error: ""});
    }

    public async createTeam(name: string,
                            id_owner: number): Promise<status & id> {
        await this.ready;
        if (!this.db)
            return ({success: false, error: "Database not connected !", id: -1});
        let status: status = this.checkNameNorm(name);
        if (!status.success)
            return ({...status, id: -1});
        if (await this.isUserExist(id_owner) == -1) {
            return ({success: false, error: "This user does not exist!", id: -1});
        }
        if (await this.isTeamExist(name) != -1)
            return ({success: false, error: "Team name already exist !", id: -1});
        const [result] = await this.db.execute<mysql.ResultSetHeader>(`INSERT INTO team (name, id_owner)
                                                                       VALUES (?, ?)`, [name, id_owner]);
        status = await this.addTeamMember(id_owner, result.insertId);
        if (!status.success) {
            await this.hardDeleteTeam(result.insertId);
            return ({success: status.success, error: status.error, id: -1});
        }
        return ({success: true, error: "", id: result.insertId});
    }

    public async renameTeam(team: number | string,
                            new_name: string): Promise<status> {
        await this.ready;
        if (!this.db)
            return ({success: false, error: "Database not connected !"});
        const status: status = this.checkNameNorm(new_name);
        if (!status.success)
            return status;
        team = await this.isTeamExist(team, true);
        if (team == -1)
            return ({ success: false, error: "This team does not exist!"});
        if (await this.isTeamExist(new_name) != -1)
            return ({success: false, error: "The new name is already used!"});
        await this.db.execute(`UPDATE team SET name = ? WHERE team_id = ?`, [new_name, team]);
        return ({success: true, error: ""});
    }

    public async giveTeamOwnership(owner: number | string,
                                   new_owner: number | string):  Promise<status> {
        await this.ready;
        if (!this.db)
            return ({success: false, error: "Database not connected !"});
        const status: status & {result: number} = await this.isTeamOwner(owner);
        if (!status.success)
            return ({success: false, error: status.error});
        const team_id = status.result;
        if (team_id == -1)
            return ({success: false, error: "This user is not owner of a team"});
        const user: status & Partial<User> = await this.getUser(new_owner);
        if (!user.success)
            return ({success: false,  error: user.error});
        if (user.id_team == null || user.id_team != status.result)
            return ({success: false,  error: "This user is not in the previous owner's team!"});
        await this.db.execute(`UPDATE team SET id_owner = ? WHERE team_id = ?`, [user.user_id, user.id_team]);
        return ({success: true, error: ""});
    }

    public async hardDeleteTeam(team: number | string): Promise<status> {
        await this.ready;
        if (!this.db)
            return ({success: false, error: "Database not connected !"});
        team = await this.isTeamExist(team);
        if (team == -1)
            return ({success: false, error: "This team does not exist!"});
        await this.db.execute(`UPDATE user
                               SET id_team = null
                               WHERE id_team = ?`, [team]);
        await this.db.execute(`DELETE
                               FROM team
                               WHERE team_id = ?`, [team]);
        await this.db.execute(`DELETE
                               FROM team_tournament
                               WHERE id_team = ?`, [team]);
        return ({success: true, error: ""});
    }

    public async softDeleteTeam(team: number | string): Promise<status> {
        await this.ready;
        if (!this.db)
            return ({success: false, error: "Database not connected !"});
        team = await this.isTeamExist(team);
        if (team == -1)
            return ({success: false, error: "This team does not exist!"});
        await this.db.execute(`UPDATE user
                               SET id_team = null
                               WHERE id_team = ?`, [team]);
        await this.db.execute(`UPDATE team
                               SET id_owner = null
                               WHERE team_id = ?`, [team]);
        return ({success: true, error: ""});
    }

    public async addTeamMember(id_user: number,
                               team: number | string): Promise<status> {
        await this.ready;
        if (!this.db)
            return ({success: false, error: "Database not connected !"});
        team = await this.isTeamExist(team, true);
        if (team == -1)
            return ({success: false, error: "This team does not exist or is inactive!"});
        const user: number = await this.isUserExist(id_user, true);
        if (user == -1) {
            return ({success: false, error: "User do not exist or has already a team!"});
        }
        await this.db.execute(`UPDATE user
                               SET id_team = ?
                               WHERE user_id = ?`, [team, id_user]);
        return ({success: true, error: ""});
    }

    public async rmTeamMember(id_user: number): Promise<status> {
        await this.ready;
        if (!this.db)
            return ({success: false, error: "Database not connected !"});
        const status: status & { result: number } = await this.isTeamOwner(id_user);
        if (!status.success)
            return ({success: false, error: status.error});
        if (status.result != -1)
            return ({success: false, error: "This user is the owner of the team"});
        await this.db.execute(`UPDATE user
                               SET id_team = null
                               WHERE user_id = ?`, [id_user]);
        return ({success: true, error: ""});
    }

    public async getTeamMembers(team: number | string): Promise<getTeamMembers> {
        await this.ready;
        if (!this.db)
            return ({success: false, error: "Database not connected !", members: []});
        team = await this.isTeamExist(team, true);
        if (team == -1)
            return ({success: false, error: "This team does not exist or is deleted!", members: []});
        const [rows] = await this.db.execute(`SELECT *
                                              FROM user
                                              WHERE id_team = ?`, [team]);
        return ({success: true, error: "", members: rows as User[]});
    }

    public async createTournament(name: string,
                                  description: string,
                                  format: 'SIMPLE' | 'DOUBLE',
                                  size: number,
                                  owner_id: number,
                                  start_visibility: Date,
                                  open_registration: Date,
                                  close_registration: Date,
                                  start: Date): Promise<status & id> {
        await this.ready;
        if (!this.db)
            return ({success: false, error: "Database not connected !", id: -1});
        if (name.length < 5)
            return ({success: false, error: "Tournament name must be at least 5 characters!", id: -1});
        if (await this.isUserExist(owner_id) == -1)
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
        const [result] = await this.db.execute<mysql.ResultSetHeader>(`INSERT INTO tournament
                                                                       (name,
                                                                        description,
                                                                        format,
                                                                        size,
                                                                        id_owner,
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
                owner_id,
                start_visibility,
                open_registration,
                close_registration,
                start
            ]);
        return ({success: true, error: "", id: result.insertId});
    }

    public async editTournament(id_tournament: number,
                                name: string | null = null,
                                description: string | null = null,
                                format: 'SIMPLE' | 'DOUBLE' | null = null,
                                size: number | null = null,
                                start_visibility: Date | null = null,
                                open_registration: Date | null = null,
                                close_registration: Date | null = null,
                                start: Date | null = null) : Promise<status> {
        await this.ready;
        if (!this.db)
            return ({success: false, error: "Database not connected!"});
        if (!(await this.isTournamentExist(id_tournament)))
            return ({success: false, error: "This tournament does not exist!"});
        const [open_rows] = await this.db.execute(`SELECT tournament.start_visibility,
                                                          tournament.open_registration,
                                                          tournament.close_registration,
                                                          tournament.start
                                                   FROM tournament
                                                   WHERE tournament_id = ?`, [id_tournament]);
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
            updates = "name = ?";
            values.push(name);
        }
        if (description) {
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
        values.push(id_tournament);
        await this.db.execute(`UPDATE tournament
                               SET ${updates}
                               WHERE tournament_id = ?`, values);
        return ({success: true, error: ""});
    }

    public async getTournament(id: number): Promise<status & Partial<Tournament>> {
        await this.ready;
        if (!this.db)
            return ({success: false, error: "Database not connected!"});
        if (!(await this.isTournamentExist(id)))
            return ({success: false, error: "Tournament does not exist!"});
        const [rows] = await this.db.execute(`SELECT * FROM tournament WHERE tournament.tournament_id = ?`, [id]);
        const tournament = (rows as Tournament[])[0] as Tournament;
        return ({success: true, error: "", ...tournament});
    }

    public async deleteTournament(id: number): Promise<status> {
        await this.ready;
        if (!this.db)
            return ({success: false, error: "Database not connected !"});
        if (!(await this.isTournamentExist(id)))
            return ({success: false, error: "Tournament does not exist!"});
        await this.db.execute(`DELETE
                               FROM tournament
                               WHERE tournament_id = ?`, [id]);
        await this.db.execute(`DELETE user_history
                               FROM user_history
                                        JOIN team_tournament ON user_history.id_team_tournament = team_tournament.team_tournament_id
                               WHERE team_tournament.id_tournament = ?`, [id])
        await this.db.execute(`DELETE
                               FROM team_tournament
                               WHERE id_tournament = ?`, [id]);
        return ({success: true, error: ""});
    }

    public async tournamentRegistration(id_tournament: number,
                                        id_team: number): Promise<status> {
        await this.ready;
        if (!this.db)
            return ({success: false, error: "Database not connected !"});
        // Vérifie que le tournois existe et qu'il n'est pas complet
        if (!(await this.isTournamentExist(id_tournament, true)))
            return ({success: false, error: "Tournament does not exist or is full!"});
        // Vérifie si le tournois existe aussi mais pas s'il est complet
        const status: status & {result: boolean} = await this.isRegistrationPeriod(id_tournament);
        if (!status.success)
            return ({success: false, error: status.error});
        if (!status.result)
            return ({success: false, error: "We are out of the registration period !"});
        if (await this.isTeamExist(id_team) == -1)
            return ({success: false, error: "Team does not exist!"});
        if (await this.isTeamRegister(id_tournament, id_team) != -1)
            return ({success: false, error: "Team already registered!"});
        const [result] = await this.db.execute<mysql.ResultSetHeader>(`INSERT INTO team_tournament (id_tournament, id_team)
                                                                       VALUES (?, ?)`, [id_tournament, id_team]);
        const team_tournament_id = result.insertId;
        const [rows] = await this.db.execute(`SELECT user_id
                                              FROM user
                                              WHERE id_team = ?`, [id_team]);
        const members_id: {user_id: number}[] = rows as { user_id: number }[];
        if (members_id.length > 0) {
            const values = members_id.map(() => '(?, ?)').join(', ');
            const params = members_id.flatMap((member: {user_id: number}) => ([member.user_id, team_tournament_id]));
            await this.db.execute(`INSERT INTO user_history (id_user, id_team_tournament)
                                   VALUES ${values}`, params);
        }
        return ({success: true, error: ""});
    }

    public async tournamentUnregistration(id_tournament: number,
                                          id_team: number) : Promise<status> {
        await this.ready;
        if (!this.db)
            return ({success: false, error: "Database not connected !"});
        const result: status & {result: boolean} = await this.isRegistrationPeriod(id_tournament);
        if (!result.success)
            return ({success: false, error: result.error});
        if (!result.result)
            return ({success: false, error: "We are out of the registration period !"});
        if (!(await this.isTeamExist(id_team) == -1))
            return ({success: false, error: "This team does not exist!"});
        const id_team_tournament: number = await this.isTeamRegister(id_tournament, id_team);
        if (id_team_tournament == -1)
            return ({success: false, error: "This team is not register to this tournament!"});
        await this.db.execute(`DELETE FROM user_history WHERE id_team_tournament = ?`, [id_team_tournament]);
        await this.db.execute(`DELETE FROM team_tournament WHERE team_tournament_id = ?`, [id_team_tournament]);
        return ({success: true, error: ""});
    }

    public async getRegisterTeams(id_tournament: number): Promise<getTournamentTeams> {
        await this.ready;
        if (!this.db)
            return ({success: false, error: "Database not connected!", teams: []});
        if (!(await this.isTournamentExist(id_tournament)))
            return ({success: false, error: "Tournament does not exist!", teams: []});
        const [rows] = await this.db.execute(`SELECT *
                                              FROM team
                                                       INNER JOIN team_tournament ON team_tournament.id_team = team.team_id
                                              WHERE team_tournament.id_tournament = ?`, [id_tournament]);
        const teams = rows as (Team & TeamTournament)[];
        return ({success: true, error: "", teams: teams});
    }

    public async getTeamHistory(id_team: number): Promise<getHistories> {
        await this.ready;
        if (!this.db)
            return ({success: false, error: "Database not connected !", histories: []});
        if (await this.isTeamExist(id_team) == -1)
            return ({success: false, error: "Team does not exist!", histories: []});
        const [rows] = await this.db.execute(`SELECT tournament.*, team_tournament.*, team.name as team_name
                                              FROM team_tournament
                                                       INNER JOIN tournament ON id_tournament = tournament.tournament_id
                                                       INNER JOIN team ON team_tournament.id_team = team.team_id
                                              WHERE id_team = ?
                                              ORDER BY start DESC`, [id_team]);
        return ({success: true, error: "", histories: rows as History[]});
    }

    public async getUserHistory(id_user: number): Promise<getHistories> {
        await this.ready;
        if (!this.db)
            return ({success: false, error: "Database not connected!", histories: []});
        if (await this.isUserExist(id_user) == -1)
            return ({success: false, error: "User not found!", histories: []});
        const [rows] = await this.db.execute(`SELECT tournament.*, team_tournament.*, team.name as team_name
                                              FROM tournament
                                                       INNER JOIN team_tournament ON tournament.tournament_id = team_tournament.id_tournament
                                                       INNER JOIN team ON team_tournament.id_team = team.team_id
                                                       INNER JOIN user_history ON team_tournament.team_tournament_id = user_history.id_team_tournament
                                              WHERE user_history.id_user = ?
                                              ORDER BY tournament.start DESC`, [id_user]);
        return ({success: true, error: "", histories: rows as History[]});
    }

    // Tester un tournoi qui a déjà terminé
    public async setupTournament(id_tournament: number): Promise<getMatchs> {
        await this.ready;
        if (!this.db)
            return ({success: false, error: "Database not connected!", matchs: []});
        if (!(await this.isTournamentExist(id_tournament, false, true))) // Doit empêcher, le cas 0 team
            return ({success: false, error: "Tournament does not exist!", matchs: []});
        const [rows] = await this.db.execute(`SELECT start FROM tournament WHERE tournament_id = ?` [id_tournament]);
        const start: Date = (rows as {start: Date}[])[0].start;
        const result: getTournamentTeams = await this.getRegisterTeams(id_tournament);
        if (!result.success)
            return ({ success: false, error: result.error, matchs: []});
        const teams: (Team & TeamTournament)[] = result.teams;
        await this.setupFirstRound(teams, start);
        return (await this.getMatchs(id_tournament));
    }

    public async setupNextRound(id_tournament: number): Promise<getMatchs> {
        await this.ready;
        if (!this.db)
            return ({success: false, error: "Database not connected!", matchs: []});
        if (!(await this.isTournamentExist(id_tournament, false, true)))
            return ({success: false, error: "Tournament does not exist!", matchs: []});
        if (!(await this.isAllMatchEnded(id_tournament)))
            return ({success: false, error: "All match has not ended!", matchs: []});
        const [rows_size] = await this.db.execute(`SELECT tournament.size, tournament.current_round FROM tournament WHERE tournament_id = ?`, [id_tournament]);
        const tournament_info: {size: number, current_round: number} = (rows_size as unknown[])[0] as {size: number, current_round: number};
        // On calcule le nombre de matchs à préparer
        const match_to_setup: number = (tournament_info.size / 2 ** tournament_info.current_round) / 2;
        const [rows] = await this.db.execute(`SELECT tournament_match.*
                                              FROM tournament_match
                                              WHERE id_tournament = ?
                                              ORDER BY tournament_match_id
                                              LIMIT ?`, [id_tournament, (match_to_setup * 2)]);
        const previous_round: TournamentMatch[] = rows as TournamentMatch[];
        let nmatch: number = 0;
        let errors: string = "";
        for (let i = 0; i < match_to_setup; i++) {
            const id_host: number = previous_round[nmatch].victory == "host" ? previous_round[nmatch].id_team_tournament_host : previous_round[nmatch].id_team_tournament_guest;
            nmatch++;
            const id_guest: number = previous_round[nmatch].victory == "host" ? previous_round[nmatch].id_team_tournament_host : previous_round[nmatch].id_team_tournament_guest;
            nmatch++;
            const status = await this.scheduleMatch(id_tournament, id_host, id_guest, new Date);
            if (!status.success)
                errors += "\n" + status.error;
        }
        if (errors.length)
            return ({success: false, error: "All matchs setup with errors : " + errors, matchs: []});
        await this.db.execute(`UPDATE tournament SET current_round = ? WHERE tournament_id = ?`, [tournament_info.current_round + 1, id_tournament]);
        return (await this.getMatchs(id_tournament, match_to_setup));
    }

    public async scheduleMatch(id_tournament: number,
                               host: string | number,
                               guest: string | number,
                               date: Date): Promise<status & id> {
        await this.ready;
        if (!this.db)
            return ({success: false, error: "Database not connected!", id: -1});
        if (!(await this.isTournamentExist(id_tournament)))
            return ({success: false, error: "The tournament does not exist!", id: -1});
        let victory: 'host' | 'guest' | null = null;
        let id_host_register: number = -1;
        host = await this.isTeamExist(host, true);
        if (host == -1)
            victory = 'guest';
        else {
            id_host_register = await this.isTeamRegister(id_tournament, host, true);
            if (id_host_register == -1)
                return ({success: false, error: "The host team is not register or has been eliminated!", id: -1});
        }
        let id_guest_register;
        guest = await this.isTeamExist(guest, true);
        if (guest == -1) {
            victory = 'host';
        } else {
            id_guest_register = await this.isTeamRegister(id_tournament, guest, true);
            if (id_guest_register == -1)
                return ({success: false, error: "The guest team is not register or has been eliminated!", id: -1});
        }
        const now = new Date();
        now.setMinutes(now.getMinutes() - 1);
        if (now > date)
            return ({success: false, error: "The date must not be in the past!", id: -1});
        const [result] = await this.db.execute<mysql.ResultSetHeader>(`INSERT INTO tournament_match (id_tournament, id_team_tournament_host, id_team_tournament_guest, victory, start_date)
                                                                       VALUES (?, ?, ?, ?, ?)`,
            [
                id_tournament, id_host_register, id_guest_register, victory, date
            ]);
        return ({success: true, error: "", id: result.insertId});
    }

    public async updateScore(id_match: number,
                             host_score: number,
                             guest_score: number,
                             victory: 'host' | 'guest' | null = null): Promise<status> {
        await this.ready;
        if (!this.db)
            return ({success: false, error: "Database not connected!"});
        if (!(await this.isMatchExist(id_match, true)))
            return ({success: false, error: "Match does not exist or is ended!"});
        await this.db.execute(`UPDATE tournament_match
                               SET score_host  = ?,
                                   score_guest = ?,
                                   victory     = ?
                               WHERE tournament_match_id = ?`, [host_score, guest_score, victory, id_match]);
        if (victory) {
            const status = await this.setLoserPosition(id_match);
            if (!status.success)
                return ({ success: false, error: status.error });
        }
        return ({success: true, error: ""});
    }

    public async getMatchs(id_tournament: number,
                           nbFromLast: number = -1): Promise<getMatchs> {
        await this.ready;
        if (!this.db)
            return ({success: false, error: "Database not connected!", matchs: []});
        if (!(await this.isTournamentExist(id_tournament)))
            return ({success: false, error: "Tournament does not exist!", matchs: []});
        let addons: string = "";
        if (nbFromLast < 0)
            addons = ` LIMIT ${nbFromLast} `;
        const [rows] = await this.db.execute(`SELECT tournament_match.*
                                              FROM tournament_match
                                              WHERE tournament_match.id_tournament = ?
                                              ORDER BY tournament_match_id DESC ${addons}`, [id_tournament]);
        const matchs = rows as TournamentMatch[];
        return ({success: true, error: "", matchs: matchs})
    }

    // private
    private static instance: Database;
    private db: mysql.Connection | null = null;
    public readonly ready: Promise<void>;

    private constructor() {
        this.ready = this.connect();
    }

    private async connect() {
        this.db = await mysql.createConnection({
            host: process.env.DB_HOST,
            user: process.env.DB_USER,
            password: process.env.DB_PASSWORD,
            database: process.env.DB_DATABASE,
        });
        if (!this.db)
            throw ("Database connection error");
        await this.initialize();
    }

    private async initialize() {
        await this.db!.execute(`CREATE TABLE IF NOT EXISTS user
                                (
                                    user_id  INTEGER PRIMARY KEY AUTO_INCREMENT,
                                    username VARCHAR(255) COLLATE utf8mb4_bin NOT NULL,
                                    id_team  INTEGER DEFAULT NULL,
                                    is_admin BOOLEAN DEFAULT false
                                );`);
        await this.db!.execute(`CREATE TABLE IF NOT EXISTS team
                                (
                                    team_id       INTEGER PRIMARY KEY AUTO_INCREMENT,
                                    name          VARCHAR(255) COLLATE utf8mb4_bin NOT NULL,
                                    creation_date DATETIME DEFAULT CURRENT_TIMESTAMP,
                                    id_owner      INTEGER                          NOT NULL
                                );`);
        await this.db!.execute(`CREATE TABLE IF NOT EXISTS tournament
                                (
                                    tournament_id      INTEGER PRIMARY KEY AUTO_INCREMENT,
                                    name               VARCHAR(255) NOT NULL,
                                    description        TEXT         NOT NULL,
                                    format             ENUM ('SIMPLE', 'DOUBLE') NOT NULL,
                                    size               INTEGER      NOT NULL,
                                    id_owner           INTEGER      NOT NULL,
                                    creation_date      DATETIME DEFAULT CURRENT_TIMESTAMP,
                                    start_visibility   DATETIME     NOT NULL,
                                    open_registration  DATETIME     NOT NULL,
                                    close_registration DATETIME     NOT NULL,
                                    start              DATETIME     NOT NULL,
                                    current_round      INTEGER DEFAULT -1 NOT NULL
                                );`);
        await this.db!.execute(`CREATE TABLE IF NOT EXISTS team_tournament
                                (
                                    team_tournament_id       INTEGER PRIMARY KEY AUTO_INCREMENT,
                                    id_tournament            INTEGER NOT NULL,
                                    id_team                  INTEGER NOT NULL,
                                    position                 INTEGER DEFAULT -1
                                );`);
        await this.db!.execute(`CREATE TABLE IF NOT EXISTS tournament_match
                                (
                                    tournament_match_id      INTEGER PRIMARY KEY AUTO_INCREMENT,
                                    id_tournament            INTEGER  NOT NULL,
                                    id_team_tournament_host  INTEGER  NOT NULL,
                                    id_team_tournament_guest INTEGER  NOT NULL,
                                    score_host               INTEGER                                             DEFAULT 0,
                                    score_guest              INTEGER                                             DEFAULT 0,
                                    victory                  ENUM ('host', 'guest') DEFAULT NULL,
                                    start_date               DATETIME NOT NULL
                                );`);
        await this.db!.execute(`CREATE TABLE IF NOT EXISTS user_history
                                (
                                    user_history_id    INTEGER PRIMARY KEY AUTO_INCREMENT,
                                    id_user            INTEGER NOT NULL,
                                    id_team_tournament INTEGER NOT NULL
                                );`);
    }

    private async buildSelectQuery(
        rawParams: Partial<SQLGetParams>,
        isSelect: boolean,
    ): Promise<SQLQuery> {
        if (rawParams.table == undefined) {
            return {success: false, error: "Table must be define to get something!", query: "", values: []};
        }

        const params: SQLGetParams = {
            table: "",
            values: ["*"],
            joinOption: [],
            whereOption: [],
            order: [],
            all: true,
            ...rawParams,
        };
        let query: string;

        if (isSelect) {
            query = `SELECT ${params.values?.join(", ")} `;
        } else {
            query = `DELETE `;
        }
        query += ` FROM ${params.table} ${params.joinOption?.join(" ")} `;

        let values: (string | number | bigint)[] = [];

        if (params.whereOption.length > 0) {
            query += ` WHERE `;
            params.whereOption.forEach((elem) => {
                query += ` ${elem.column} ${elem.condition} ?`;
                values.push(elem.value);
            });
        }
        if (isSelect && params.order && params.order.length > 0) {
            query += ` ORDER BY `;
            params.order?.forEach((elem) => {
                query += ` ${elem.orderBy} [${elem.isAscending ? "ASC" : "DESC"}] `;
            });
        }

        return {success: true, error: "", query: query, values: values};
    }

    private async isTeamExist(team: string | number,
                              checkWithoutDel: boolean = false): Promise<number> {
        await this.ready;
        if (!this.db)
            return -1;
        let teams: {team_id: number}[];
        let delFilter: string = "";
        if (checkWithoutDel)
            delFilter = " AND id_owner IS NOT NULL";
        if (typeof team == typeof "string") {
            const [rows] = await this.db.execute(`SELECT team_id
                                                  FROM team
                                                  WHERE name LIKE ? ${delFilter}`, [team]);
            teams = rows as {team_id: number}[];
        } else {
            const [rows] = await this.db.execute(`SELECT team_id
                                                  FROM team
                                                  WHERE team_id = ? ${delFilter}`, [team]);
            teams = rows as {team_id: number}[];
        }
        if (!!teams.length)
            return (teams[0].team_id);
        return (-1)
    }

    private async isUserExist(user: string | number,
                              checkWithoutTeam: boolean = false): Promise<number> {
        await this.ready;
        if (!this.db)
            return -1;
        let users: {user_id: number}[];
        let teamFilter: string = "";
        if (checkWithoutTeam)
            teamFilter = " AND id_team IS NULL";
        if (typeof user == typeof "string") {
            const [rows] = await this.db.execute(`SELECT user_id
                                                  FROM user
                                                  WHERE username LIKE ? ${teamFilter}`, [user]);
            users = rows as {user_id: number}[];
        } else {
            const [rows] = await this.db.execute(`SELECT user_id
                                                  FROM user
                                                  WHERE user_id = ? ${teamFilter}`, [user]);
            users = rows as {user_id: number}[];
        }
        if (!!users.length)
            return (users[0].user_id);
        return (-1);
    }

    private async isTournamentExist(id: number,
                                    checkFreeSlots: boolean = false,
                                    notEnded: boolean = false): Promise<boolean> {
        await this.ready;
        if (!this.db)
            return false;
        let size: string = "";
        if (checkFreeSlots)
            size = `, size`
        const [rows] = await this.db.execute(`SELECT tournament_id ${size}
                                              FROM tournament
                                              WHERE tournament_id = ?`, [id]);
        if (!checkFreeSlots && !notEnded) {
            const tournaments = rows as { tournament_id: number }[];
            return (!!tournaments.length);
        } else if (checkFreeSlots) {
            const tournaments = rows as ({ tournament_id: number } & { size: number })[];
            if (tournaments.length == 0)
                return false;
            const [count] = await this.db.execute(`SELECT COUNT(*) as nb_teams
                                                   FROM team_tournament
                                                   WHERE id_tournament = ?`, [id]);
            const result = count as ({ nb_teams: number })[];
            const nbTeams: number = result[0].nb_teams;
            return tournaments[0].size != nbTeams;

        } else {
            const tournaments = rows as ({ tournament_id: number } & { size: number })[];
            if (tournaments.length == 0)
                return false;
            const [count] = await this.db.execute(`SELECT COUNT(*) as nb_teams
                                                   FROM team_tournament
                                                   WHERE id_tournament = ? AND position = -1`, [id]);
            const result  = count as ({ nb_teams: number })[];
            const nbTeams: number = result[0].nb_teams;
            return (!!nbTeams);
        }
    }

    private async isRegistrationPeriod(tournament_id: number): Promise<status & {result: boolean}> {
        await this.ready;
        if (!this.db)
            return ({success: false, error: "Database not connected!", result: false});
        if (!await this.isTournamentExist(tournament_id))
            return ({success: false, error: "This tournament does not exist !", result: false});
        const [rows] = await this.db.execute(`SELECT open_registration, close_registration FROM tournament WHERE tournament_id = ?`, [tournament_id]);
        const tournament_info = (rows as unknown[])[0] as {open_registration: Date, close_registration: Date};
        const now = new Date();
        if (now > tournament_info.open_registration && now < tournament_info.close_registration)
            return ({success: true, error: "", result: true});
        return ({success: true, error: "", result: false});
    }

    private async isTeamRegister(tournament_id: number,
                                 team_id: number,
                                 checkStillRunning: boolean = false): Promise<number> {
        await this.ready;
        if (!this.db)
            return -1;
        let filter: string = "";
        if (checkStillRunning)
            filter = "AND position != -1";
        const [rows] = await this.db.execute(`SELECT team_tournament_id
                                              FROM team_tournament
                                              WHERE id_tournament = ?
                                                AND id_team = ? ${filter}`, [tournament_id, team_id]);
        const ids = rows as {team_tournament_id: number}[];
        if (ids.length == 0)
            return (-1);
        return (ids[0].team_tournament_id);
    }

    private async isTeamOwner(target_user: number | string): Promise<status & { result: number }> {
        await this.ready;
        if (!this.db)
            return ({success: false, error: "Database not connected!", result: -1});
        const tmp: status & Partial<User> = await this.getUser(target_user);
        if (!tmp.success)
            return ({success: tmp.success, error: tmp.error, result: -1});
        const user: status & Partial<User> = tmp as status & Partial<User>;
        if (!user.id_team)
            return ({success: true, error: "", result: -1});
        const [rows] = await this.db.execute(`SELECT team_id
                                              FROM team
                                              WHERE id_owner = ?`, [user.user_id]);
        const ids = (rows as ({team_id: number})[]);
        if (ids.length == 0)
            return ({success: true, error: "", result: -1})
        return ({success: true, error: "", result: ids[0].team_id});
    }

    private async isMatchExist(id_match: number,
                               checkStillRunning: boolean = false): Promise<boolean> {
        await this.ready;
        if (!this.db)
            return false;
        let filter: string = "";
        if (checkStillRunning)
            filter = ' AND victory IS NULL ';
        const [rows] = await this.db.execute(`SELECT tournament_match_id
                                              FROM tournament_match
                                              WHERE tournament_match_id = ? ${filter}`, [id_match])
        const ids = rows as {tournament_match_id: number}[];
        return (!!ids.length);
    }

    // Math.ceil: arrondit à l'entier supérieur
    private findSizeTournament(nb_teams: number): number {
        return nb_teams <= 1 ? nb_teams : 2 ** Math.ceil(Math.log2(nb_teams));
    }

    private async setupFirstRound(teams: (Team & TeamTournament)[],
                                  start: Date): Promise<status> {
        await this.ready;
        if (!this.db)
            return ({success: false, error: "Database not connected!"});
        const tournament_size = this.findSizeTournament(teams.length);
        await this.db.execute(`UPDATE tournament SET size = ?, current_round = 0 WHERE tournament.tournament_id = ?`, [tournament_size, teams[0].id_tournament])
        const byes: number = tournament_size - teams.length;
        const byesInterval: number = byes ? (Math.floor(tournament_size / byes)) - 1 : 0;
        let nteam: number = 0;
        let nbyes: number = 0;
        const nb_matchs: number = tournament_size / 2;
        for (let nmatch: number = 0; nmatch < nb_matchs; nmatch++) {
            let match: {id_host: number, id_guest: number} = {id_host: -1,  id_guest: -1};
            for (let n_slot = 0; n_slot < 2; n_slot++) {
                let team_id: number;
                if (byesInterval && nbyes < byes && nteam % byesInterval === 0) {
                    team_id = -1;
                    nbyes++;
                } else
                    team_id = teams[nteam].team_id;
                nteam += 1;
                if (!n_slot)
                    match.id_host = team_id;
                else
                    match.id_guest = team_id;
            }
            const status : status & id = await this.scheduleMatch(teams[0].id_tournament, match.id_host, match.id_guest, start);
            if (!status.success)
                return ({ success: false, error: status.error });
        }
        return ({ success: true, error: "" });
    }

    private async isAllMatchEnded(tournament_id: number): Promise<boolean> {
        await this.ready;
        if (!this.db)
            return false;
        if (!(await this.isTournamentExist(tournament_id)))
            return false;
        const [rows] = await this.db.execute(`SELECT tournament_match_id
                                              FROM tournament_match
                                                       LEFT JOIN team_tournament
                                                                 ON id_team_tournament_guest = team_tournament.team_tournament_id
                                              WHERE team_tournament.id_tournament && tournament_match.victory IS NULL`);
        return (!!(rows as unknown[]).length);
    }

    private async setLoserPosition(id_match: number): Promise<status> {
        await this.ready;
        if (!this.db)
            return ({success: false, error: "Database not connected!"});
        const [rows_match] = await this.db.execute(`SELECT * FROM tournament_match WHERE tournament_match_id = ?`, [id_match]);
        if ((rows_match as TournamentMatch[]).length == 0)
            return ({success: false, error: "No match found!"});
        const match: TournamentMatch = (rows_match as TournamentMatch[])[0];
        if (!match.victory)
            return ({success: false, error: "No loser found for this match"});
        const [info_rows] = await this.db.execute(`SELECT size, current_round FROM tournament WHERE tournament_id = ?`, [match.id_tournament])
        if ((info_rows as unknown[]).length == 0)
            return ({success: false, error: "No tournament found!"});
        const tournament_info: {size: number, current_round: number} = (info_rows as unknown[])[0] as {size: number, current_round: number};
        const position: number = (tournament_info.size / 2 ** tournament_info.current_round);
        const id_loser: number = match.victory == 'host' ? match.id_team_tournament_guest : match.id_team_tournament_host;
        await this.db.execute(`UPDATE team_tournament SET position = ? WHERE team_tournament_id = ?`, [position, id_loser]);
        return ({success: true, error: ""});
    }

    private checkNameNorm(name: string): status {
        if (name.length < 3 || name.length > 15) {
            return ({success: false, error: "The name must be at least 3 characters and maximum 15!"});
        }
        return ({success: true, error: ""});
    }
}