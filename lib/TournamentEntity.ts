import {UserEntity} from "./UserEntity";
import {
    getHistories, getMatchs,
    getTournamentTeams, History,
    id,
    status,
    Team,
    TeamTournament,
    Tournament, Match,
    TournamentTeamsCount
} from "./types";
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
                                                   WHERE tournament_id = ?`, [tournament_id]);
        if ((rows as unknown[]).length === 0)
            return ({success: false, error: "This tournament does not exist!"});
        const tournament_data: Tournament = (rows as Tournament[])[0];
        this.id = tournament_data.tournament_id;
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
        const status: status = await this.owner.fetch(tournament_data.id_owner);
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
        if (await owner.isExist(owner.id) == -1)
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
        if (!(await this.isExist(this.id)))
            return ({success: false, error: "This tournament does not exist!"});
        const database: Database = await Database.getInstance();
        const [open_rows] = await database.db!.execute(`SELECT tournament.start_visibility,
                                                           tournament.open_registration,
                                                           tournament.close_registration,
                                                           tournament.start
                                                    FROM tournament
                                                    WHERE tournament_id = ?`, [this.id]);
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
                                WHERE tournament_id = ?`, values);
        return ({success: true, error: ""});
    }

    public async getAll(): Promise<{pending: TournamentTeamsCount[], active: TournamentTeamsCount[], ended: TournamentTeamsCount[]}> {
        this.checkTournamentEvent();
        const database: Database = await Database.getInstance()
        let [rows] = await database.db!.execute(`SELECT tournament.*, COUNT(team_tournament.team_tournament_id) as nb_teams
                                             FROM tournament
                                                      LEFT JOIN team_tournament
                                                           ON team_tournament.id_tournament = tournament.tournament_id
                                             WHERE close_registration > NOW()
                                             GROUP BY tournament_id, close_registration
                                             ORDER BY close_registration DESC`);
        const pending: TournamentTeamsCount[] = rows as TournamentTeamsCount[];
        [rows] = await database.db!.execute(`SELECT DISTINCT tournament.*,
                                                         COUNT(team_tournament.team_tournament_id) as nb_teams
                                         FROM tournament
                                                  JOIN team_tournament
                                                       ON team_tournament.id_tournament = tournament.tournament_id
                                         WHERE start < NOW()
                                           and EXISTS(SELECT 1
                                                      FROM team_tournament
                                                      WHERE team_tournament.id_tournament = tournament.tournament_id
                                                        AND team_tournament.position = -1)
                                         GROUP BY tournament_id, start
                                         ORDER BY start DESC`);
        const active: TournamentTeamsCount[] = rows as TournamentTeamsCount[];
        [rows] = await database.db!.execute(`SELECT DISTINCT tournament.*,
                                                         COUNT(team_tournament.team_tournament_id) as nb_teams
                                         FROM tournament
                                                  JOIN team_tournament
                                                       ON team_tournament.id_tournament = tournament.tournament_id
                                         WHERE start < NOW()
                                           and NOT EXISTS(SELECT 1
                                                          FROM team_tournament
                                                          WHERE team_tournament.id_tournament = tournament.tournament_id
                                                            AND team_tournament.position = -1)
                                         GROUP BY tournament_id, start
                                         ORDER BY start DESC
                                         LIMIT 5`);
        const ended: TournamentTeamsCount[] = rows as TournamentTeamsCount[];
        return ({pending: pending, active: active, ended: ended});
    }

    public async isEnded(): Promise<status & {result: boolean}> {
        if (!this.is_loaded || !this.id)
            return ({success: false, error: "Empty Object!", result: false});
        if (!(await this.isExist(this.id)))
            return ({success: false, error: "This tournament does not exist!", result: false});
        const database: Database = await Database.getInstance()
        const [count] = await database.db!.execute(`SELECT position
                                                   FROM team_tournament
                                                   WHERE id_tournament = ?
                                                   ORDER BY position`, [this.id]);
        const result = count as ({ position: number })[];
        if (result.length == 0) {
            const [rows] = await database.db!.execute(`SELECT close_registration FROM tournament WHERE tournament_id = ?`, [this.id]);
            const close_registration = ((rows as unknown[])[0] as {close_registration: Date}).close_registration;
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
        if (!(await this.isExist(this.id)))
            return ({success: false, error: "Tournament does not exist!"});
        const database: Database = await Database.getInstance();
        await database.db!.execute(`DELETE
                               FROM tournament
                               WHERE tournament_id = ?`, [this.id]);
        await database.db!.execute(`DELETE user_history
                               FROM user_history
                                        JOIN team_tournament ON user_history.id_team_tournament = team_tournament.team_tournament_id
                               WHERE team_tournament.id_tournament = ?`, [this.id])
        await database.db!.execute(`DELETE
                               FROM team_tournament
                               WHERE id_tournament = ?`, [this.id]);
        await database.db!.execute(`DELETE FROM \`match\` WHERE id_tournament = ?`, [this.id]);
        this.is_loaded = false;
        return ({success: true, error: ""});
    }

    public async tournamentRegistration(team: TeamEntity): Promise<status & { id_team_tournament: number, id_user_history: number }> {
        if (!this.is_loaded || !this.id)
            return ({success: false, error: "Empty Object!", id_team_tournament: -1, id_user_history: -1});
        if (!team.is_loaded || !team.id)
            return ({success: false, error: "Broken object team", id_team_tournament: -1, id_user_history: -1});
        if (await team.isExist(team.id) == -1)
            return ({success: false, error: "This team does not exist !", id_team_tournament: -1, id_user_history: -1});
        if (await this.isTeamRegister(team) != -1)
            return ({success: false, error: "Team already registered!", id_team_tournament: -1, id_user_history: -1});
        // Vérifie que le tournois existe et qu'il n'est pas complet
        if (!(await this.isExist(this.id, true)))
            return ({success: false, error: "Tournament does not exist or is full!", id_team_tournament: -1, id_user_history: -1});
        // Vérifie si le tournois existe aussi mais pas s'il est complet
        const checkStatus: status & {result: boolean} = await this.isRegistrationPeriod();
        if (!checkStatus.success)
            return ({success: false, error: checkStatus.error, id_team_tournament: -1, id_user_history: -1});
        if (!checkStatus.result)
            return ({success: false, error: "We are out of the registration period !", id_team_tournament: -1, id_user_history: -1});
        const database: Database = await Database.getInstance();
        let [result] = await database.db!.execute<mysql.ResultSetHeader>(`INSERT INTO team_tournament (id_tournament, id_team)
                                                                       VALUES (?, ?)`, [this.id, team.id]);
        const team_tournament_id: number = result.insertId;
        let user_history_id: number = -1;
        const [rows] = await database.db!.execute(`SELECT user_id
                                              FROM user
                                              WHERE id_team = ?`, [team.id]);
        const members_id: {user_id: number}[] = rows as { user_id: number }[];
        if (members_id.length > 0) {
            const values = members_id.map(() => '(?, ?)').join(', ');
            const params = members_id.flatMap((member: {user_id: number}) => ([member.user_id, team_tournament_id]));
            [result] = await database.db!.execute<mysql.ResultSetHeader>(`INSERT INTO user_history (id_user, id_team_tournament)
                                              VALUES ${values}`, params);
            user_history_id = result.insertId;
        }
        return ({success: true, error: "", id_team_tournament: team_tournament_id, id_user_history: user_history_id});
    }

    public async tournamentUnregistration(team: TeamEntity) : Promise<status> {
        if (!this.is_loaded || !this.id)
            return ({success: false, error: "Empty Object!"});
        if (!team.is_loaded || !team.id)
            return ({success: false, error: "Broken object team"});
        if (await team.isExist(team.id) == -1)
            return ({success: false, error: "This team does not exist !"});
        const result: status & {result: boolean} = await this.isRegistrationPeriod();
        if (!result.success)
            return ({success: false, error: result.error});
        if (!result.result)
            return ({success: false, error: "We are out of the registration period !"});
        const id_team_tournament: number = await this.isTeamRegister(team);
        if (id_team_tournament == -1)
            return ({success: false, error: "This team is not register to this tournament!"});
        const database: Database = await Database.getInstance();
        await database.db!.execute(`DELETE FROM user_history WHERE id_team_tournament = ?`, [id_team_tournament]);
        await database.db!.execute(`DELETE FROM team_tournament WHERE team_tournament_id = ?`, [id_team_tournament]);
        return ({success: true, error: ""});
    }

    public async getRegisterTeams(): Promise<getTournamentTeams> {
        if (!this.is_loaded || !this.id)
            return ({success: false, error: "Empty Object!", teams: []});
        if (!(await this.isExist(this.id)))
            return ({success: false, error: "Tournament does not exist!", teams: []});
        const database: Database = await Database.getInstance();
        const [rows] = await database.db!.execute(`SELECT *
                                              FROM team
                                                       INNER JOIN team_tournament ON team_tournament.id_team = team.team_id
                                              WHERE team_tournament.id_tournament = ?`, [this.id]);
        const teams = rows as (Team & TeamTournament)[];
        return ({success: true, error: "", teams: teams});
    }

    public async setup(): Promise<getMatchs> {
        if (!this.is_loaded || !this.id)
            return ({success: false, error: "Empty Object!", matchs: []});
        const status: status & {result: boolean} = await this.isEnded();
        if (!status.success)
            return ({success: false, error: status.error, matchs: []});
        else if (status.result)
            return ({success: false, error: "Tournament has ended!", matchs: []});
        const database: Database = await Database.getInstance();
        const now = new Date();
        const [rows] = await database.db!.execute(`SELECT start, current_round FROM tournament WHERE tournament_id = ?`, [this.id]);
        const info: {start: Date, current_round: number} = (rows as unknown[])[0] as {start: Date, current_round: number};
        if (info.start > now)
            return ({success: false, error: "The tournament has not begun!", matchs: []});
        if (info.current_round != -1)
            return ({success: false, error: "The tournament has already started!", matchs: []});
        const result: getTournamentTeams = await this.getRegisterTeams();
        if (!result.success)
            return ({ success: false, error: result.error, matchs: []});
        const teams: (Team & TeamTournament)[] = result.teams;
        const strictStatus: status = await this.setupFirstRound(teams, now);
        if (!strictStatus.success)
            return ({success: false, error: strictStatus.error, matchs: []});
        return (await this.getMatchs());
    }

    public async getMatchs(nbFromLast: number = -1): Promise<getMatchs> {
        if (!this.is_loaded || !this.id)
            return ({success: false, error: "Empty Object!", matchs: []});
        if (!(await this.isExist(this.id)))
            return ({success: false, error: "Tournament does not exist!", matchs: []});
        let addons: string = "";
        if (nbFromLast > 0)
            addons = ` LIMIT ${nbFromLast} `;
        const database: Database = await Database.getInstance();
        const [rows] = await database.db!.execute(`SELECT *
                                              FROM \`match\`
                                              WHERE \`match\`.id_tournament = ?
                                              ORDER BY match_id DESC ${addons}`, [this.id]);
        const matchs = rows as Match[];
        return ({success: true, error: "", matchs: matchs})
    }

    public async isExist(id: number,
                         checkFreeSlots: boolean = false): Promise<boolean> {
        let size: string = "";
        if (checkFreeSlots)
            size = `, size`;
        const database: Database = await Database.getInstance();
        const [rows] = await database.db!.execute(`SELECT tournament_id ${size}
                                              FROM tournament
                                              WHERE tournament_id = ?`, [id]);
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

    public async isTeamRegister(team: TeamEntity,
                                checkStillRunning: boolean = false): Promise<number> {
        if (!this.is_loaded || !this.id)
            return (-1);
        if (!await this.isExist(this.id))
            return (-1);
        if (!team.is_loaded || !team.id)
            return (-1);
        if (!await team.isExist(team.id))
            return (-1);
        let filter: string = "";
        if (checkStillRunning)
            filter = "AND position = -1";
        const database: Database = await Database.getInstance();
        const [rows] = await database.db!.execute(`SELECT team_tournament_id
                                              FROM team_tournament
                                              WHERE id_tournament = ?
                                                AND id_team = ? ${filter}`, [this.id, team.id]);
        const ids = rows as {team_tournament_id: number}[];
        if (ids.length == 0)
            return (-1);
        return (ids[0].team_tournament_id);
    }

    // Math.ceil: arrondit à l'entier supérieur
    public async isAllMatchEnded(): Promise<boolean> {
        if (!this.is_loaded || !this.id)
            return false;
        if (!(await this.isExist(this.id)))
            return false;
        const database: Database = await Database.getInstance();
        const [rows] = await database.db!.execute(`SELECT match_id
                                              FROM \`match\`
                                                       LEFT JOIN team_tournament
                                                                 ON id_team_tournament_guest = team_tournament.team_tournament_id
                                              WHERE team_tournament.id_tournament = ? && \`match\`.victory IS NULL`, [this.id]);
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
                                                   WHERE tournament_id = ?`, [this.id]);
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
        const [rows] = await database.db!.execute(`SELECT \`match\`.*,
                                                     th.id_team AS id_team_host,
                                                     tg.id_team AS id_team_guest
                                              FROM \`match\`
                                                LEFT JOIN team_tournament th ON \`match\`.id_team_tournament_host = th.team_tournament_id
                                                LEFT JOIN team_tournament tg ON \`match\`.id_team_tournament_guest = tg.team_tournament_id
                                              WHERE \`match\`.id_tournament = ?
                                              ORDER BY \`match\`.match_id
                                              LIMIT ${match_to_fetch}`, [this.id]);
        const previous_round: (Match & {id_team_host: number, id_team_guest: number})[] = rows as (Match & {id_team_host: number, id_team_guest: number})[];
        let nmatch: number = 0;
        let errors: string = "";
        const match: MatchEntity = new MatchEntity();
        const team_host: TeamEntity = new TeamEntity();
        const team_guest: TeamEntity = new TeamEntity();
        let strictStatus: status;
        for (let i = 0; i < match_to_setup; i++) {
            const id_host: number = previous_round[nmatch].victory == "host" ? previous_round[nmatch].id_team_host : previous_round[nmatch].id_team_guest;
            strictStatus = await team_host.fetch(id_host);
            if (!strictStatus.success)
                errors += "\n" + strictStatus.error;
            nmatch++;
            const id_guest: number = previous_round[nmatch].victory == "host" ? previous_round[nmatch].id_team_host : previous_round[nmatch].id_team_guest;
            strictStatus = await team_guest.fetch(id_guest);
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
                               WHERE tournament_id = ?`, [tournament_info.current_round, this.id]);
        return (await this.getMatchs(match_to_setup));
    }

    // Private
    private async isRegistrationPeriod(): Promise<status & {result: boolean}> {
        if (!this.is_loaded || !this.id)
            return ({success: false, error: "Empty Object!", result: false});
        if (!await this.isExist(this.id))
            return ({success: false, error: "This tournament does not exist !", result: false});
        const database: Database = await Database.getInstance();
        const [rows] = await database.db!.execute(`SELECT open_registration, close_registration FROM tournament WHERE tournament_id = ?`, [this.id]);
        const tournament_info = (rows as unknown[])[0] as {open_registration: Date, close_registration: Date};
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
            const strictStatus: status = await winner.fetch(teams[0].team_id);
            if (!strictStatus.error)
                return ({success: false, error: strictStatus.error});
            const status: status & id = await Match.create(this, winner, null, new Date());
            if (!status.success)
                return({success: false, error: status.error});
        } else {
            const byes: number = tournament_size - teams.length;
            const byesInterval: number = byes ? (Math.floor(tournament_size / byes)) - 1 : 0;
            let nteam: number = 0;
            let nbyes: number = 0;
            const nb_matchs: number = tournament_size / 2;
            for (let nmatch: number = 0; nmatch < nb_matchs; nmatch++) {
                let match: { team_host: TeamEntity | null, team_guest: TeamEntity | null } = {team_host: null, team_guest: null};
                for (let n_slot = 0; n_slot < 2; n_slot++) {
                    let team_id: number;
                    if (byesInterval && nbyes < byes && nteam % byesInterval === 0) {
                        team_id = -1;
                        nbyes++;
                    } else {
                        team_id = teams[nteam].team_id;
                        nteam += 1;
                    }
                    if (!n_slot) {
                        match.team_host = new TeamEntity();
                        const status: status = await match.team_host.fetch(team_id);
                        if (!status.success)
                            return ({success: false, error: status.error});
                    }
                    else {
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
        await database.db!.execute(`UPDATE tournament SET size = ?, current_round = 0 WHERE tournament.tournament_id = ?`, [tournament_size, teams[0].id_tournament]);
        return ({ success: true, error: "" });
    }

    private async checkTournamentEvent(): Promise<void> {
        const database: Database = await Database.getInstance();
        let [rows] = await database.db!.execute(`SELECT tournament.tournament_id, tournament.current_round
                                             FROM tournament
                                                      LEFT JOIN \`match\`
                                                                ON \`match\`.id_tournament = tournament.tournament_id
                                             WHERE tournament.start < NOW()
                                             GROUP BY tournament.tournament_id, tournament.current_round
                                             HAVING COUNT(\`match\`.match_id) = 0
                                                 OR COUNT(CASE WHEN \`match\`.victory IS NOT NULL THEN 1 END) = 0;
        `);
        const tournaments: {tournament_id: number, current_round:number}[] = rows as {tournament_id: number, current_round:number}[];
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