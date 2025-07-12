import {UserEntity} from "./UserEntity";
import {getHistories, getTeamMembers, History, id, status, TeamInfo, UserInfo} from "../types";
import {Database} from "./database";
import mysql from "mysql2/promise";

export class TeamEntity {
    public id: number | undefined;
    public name: string | undefined;
    public creation_date: Date | undefined;
    public id_user: number | null | undefined;
    public members_count: number | undefined;
    public is_loaded: boolean = false;

    constructor(team : TeamEntity | null = null) {
        if (team === null) {
            this.is_loaded = false;
        } else {
            if (!team.is_loaded) {
                this.is_loaded = false;
                return;
            }
            this.id = team.id;
            this.name = team.name;
            this.creation_date = team.creation_date;
            this.id_user = team.id_user;
            this.is_loaded = true;
        }
    }

    public async fetch(team: number | string): Promise<status> {
        team = await TeamEntity.isExist(team);
        if (team == -1)
            return ({success: false, error: "This team does not exist!"})
        const database: Database = await Database.getInstance();
        const [rows] = await database.db!.execute(`SELECT team.id_team,
                                                      team.name,
                                                      team.creation_date,
                                                      team.id_user,
                                                      COUNT(members.date_join) as members_count
                                               FROM team
                                                        LEFT JOIN user_team members ON members.id_team = team.id_team
                                               WHERE team.id_team = ?
                                               GROUP BY team.id_team, team.id_user, team.name, team.creation_date`, [team]);
        const team_data: TeamInfo = (rows as TeamInfo[])[0];
        this.id = team_data.id_team;
        this.name = team_data.name;
        this.creation_date = team_data.creation_date;
        this.members_count = team_data.members_count;
        this.id_user = team_data.id_user;
        return ({success: true, error: ""});
    }

    public async create(name: string,
                        owner: UserEntity): Promise<status & id> {
        let status: status = this.checkNameNorm(name);
        if (!status.success)
            return ({...status, id: -1});
        if (!owner.id || await UserEntity.isExist(owner.id) == -1) {
            return ({success: false, error: "Parameter owner does not exist or badly construct", id: -1});
        }
        this.id_user = owner.id;
        if (await TeamEntity.isExist(name) != -1)
            return ({success: false, error: "Team name already exist !", id: -1});
        const database: Database = await Database.getInstance();
        const [result] = await database.db!.execute<mysql.ResultSetHeader>(`INSERT INTO team (name, id_user)
                                                                            VALUES (?, ?)`, [name, owner.id]);
        this.id = result.insertId;
        this.name = name;
        this.creation_date = new Date();
        this.is_loaded = true;
        status = await this.addMember(owner);
        if (!status.success) {
            await this.hardDelete();
            return ({success: status.success, error: status.error, id: -1});
        }
        return ({success: true, error: "", id: result.insertId});
    }

    public async rename(new_name: string): Promise<status> {
        if (!this.is_loaded || !this.id)
            return ({success: false, error: "Empty Object!"});
        const status: status = this.checkNameNorm(new_name);
        if (!status.success)
            return status;
        const team = await TeamEntity.isExist(this.id, true);
        if (team == -1)
            return ({ success: false, error: "This team does not exist!"});
        if (await TeamEntity.isExist(new_name) != -1)
            return ({success: false, error: "The new name is already used!"});
        const database: Database = await Database.getInstance();
        await database.db!.execute(`UPDATE team SET name = ? WHERE id_team = ?`, [new_name, team]);
        this.name = new_name;
        return ({success: true, error: ""});
    }

    public async giveOwnership(owner: UserEntity,
                               new_owner: UserEntity):  Promise<status> {
        if (!this.is_loaded || !this.id)
            return ({success: false, error: "Empty Object!"});
        if (!owner.is_loaded || !new_owner.is_loaded || !new_owner.id || !owner.id)
            return ({success: false, error: "Object passed in parameter are broken or empty!"})
        let status: status = await this.fetch(this.id); // Making sure the team is up to date
        if (!this.id_user)
            return ({success: false, error: "Team deleted ! Cannot edit owner!"});
        if (this.id_user !== owner.id)
            return ({success: false, error: "The owner in parameter is not the owner of the team!"});
        status = await new_owner.fetch(new_owner.id); // Making sure the user is up to date
        if (!status.success)
            return ({success: false, error: status.error});
        if (new_owner.team == null || !new_owner.team.id || new_owner.team.id != this.id)
            return ({success: false,  error: "This user is not in the previous owner's team!"});
        const database: Database = await Database.getInstance();
        await database.db!.execute(`UPDATE team SET id_user = ? WHERE id_team = ?`, [new_owner.id, new_owner.team.id]);
        this.id_user = new_owner.id;
        return ({success: true, error: ""});
    }

    public async hardDelete(): Promise<status> {
        if (!this.is_loaded || !this.id)
            return ({success: false, error: "Empty Object!"});
        if (await TeamEntity.isExist(this.id))
            return ({success: false, error: "This team does not exist!"});
        const database: Database = await Database.getInstance();
        await database.db!.execute(`DELETE
                               FROM team
                               WHERE id_team = ?`, [this.id]);
        this.is_loaded = false;
        return ({success: true, error: ""});
    }

    public async softDelete(): Promise<status> {
        if (!this.is_loaded || !this.id)
            return ({success: false, error: "Empty Object!"});
        if (await TeamEntity.isExist(this.id))
            return ({success: false, error: "This team does not exist!"});
        const database: Database = await Database.getInstance();
        await database.db!.execute(`UPDATE user_team
                               SET date_leave = CURRENT_TIMESTAMP
                               WHERE id_team = ?`, [this.id]);
        await database.db!.execute(`UPDATE team
                               SET id_user = null
                               WHERE id_team = ?`, [this.id]);
        return ({success: true, error: ""});
    }

    public async addMember(user: UserEntity): Promise<status> {
        if (!this.is_loaded || !this.id)
            return ({success: false, error: "Empty Object!"});
        if (!user.is_loaded || !user.id)
            return ({success: false, error: "Broken user!"});
        if (await TeamEntity.isExist(this.id, true))
            return ({success: false, error: "This team does not exist or is inactive!"});
        const status: status = await user.fetch(user.id); // Making sure user up to date
        if (!status.success) {
            return ({success: false, error: status.error });
        }
        const database: Database = await Database.getInstance();
        await database.db!.execute(`INSERT INTO user_team (id_user, id_team)
                               VALUES (?, ?)`, [this.id, user.id]);
        return ({success: true, error: ""});
    }

    public async rmMember(user: UserEntity): Promise<status> {
        if (!this.is_loaded || !this.id)
            return ({success: false, error: "Empty Object!"});
        if (!user.is_loaded || !user.id)
            return ({success: false, error: "Broken user!"});
        if (await TeamEntity.isExist(this.id, true))
            return ({success: false, error: "This team does not exist or is inactive!"});
        const status: status = await user.fetch(user.id); // Making sure user up to date
        if (!status.success)
            return ({success: false, error: status.error});
        if (this.id_user == user.id)
            return ({success: false, error: "This user is the owner of the team"});
        const database: Database = await Database.getInstance();
        await database.db!.execute(`UPDATE user_team
                               SET date_leave = CURRENT_TIMESTAMP
                               WHERE id_user = ?`, [user.id]);
        return ({success: true, error: ""});
    }

    public async isTeamOwner(target_user: UserEntity): Promise<status & { result: number }> {
        if (!target_user.is_loaded || !target_user.id || target_user.team === undefined || (target_user.team && !target_user.team.id))
            return ({success: false, error: "Broken user!", result: -1});
        if (target_user.team === null)
            return ({success: true, error: "", result: -1});
        const database: Database = await Database.getInstance();
        const [rows] = await database.db!.execute(`SELECT id_team
                                              FROM team
                                              WHERE id_user = ?`, [target_user.id]);
        const ids = (rows as ({team_id: number})[]);
        if (ids.length == 0)
            return ({success: true, error: "", result: -1})
        return ({success: true, error: "", result: ids[0].team_id});
    }

    public async getMembers(): Promise<getTeamMembers> {
        if (!this.is_loaded || !this.id)
            return ({success: false, error: "Empty Object!", members: []});
        if (await TeamEntity.isExist(this.id, true) == -1)
            return ({success: false, error: "This team does not exist or is deleted!", members: []});
        const database: Database = await Database.getInstance();
        const [rows] = await database.db!.execute(`SELECT user.id_user, user.username, user.is_admin
                                                   FROM user
                                                            INNER JOIN user_team ON user_team.id_user = user.id_user
                                                   WHERE user_team.id_team = ?
                                                     AND user_team.date_leave IS NULL`, [this.id]);
        return ({success: true, error: "", members: rows as UserInfo[]});
    }

    public async getHistory(): Promise<getHistories> {
        if (!this.is_loaded || !this.id)
            return ({success: false, error: "Empty object!", histories: []});
        if (await TeamEntity.isExist(this.id) == -1)
            return ({success: false, error: "Team does not exist!", histories: []});
        const database: Database = await Database.getInstance();
        const [rows] = await database.db!.execute(`SELECT tournament.*, team_tournament.*, team.name as team_name
                                              FROM team_tournament
                                                       INNER JOIN tournament ON tournament.id_tournament = team_tournament.id_tournament
                                                       INNER JOIN team ON team_tournament.id_team = team.id_team
                                              WHERE team_tournament.id_team = ?
                                              ORDER BY start DESC`, [this.id]);
        return ({success: true, error: "", histories: rows as History[]});
    }

    // Static
    public static async isExist(team: string | number,
                                checkWithoutDel: boolean = false): Promise<number> {
        let teams: {team_id: number}[];
        let delFilter: string = "";
        if (checkWithoutDel)
            delFilter = " AND id_owner IS NOT NULL";
        const database: Database = await Database.getInstance();
        if (typeof team == typeof "string") {
            const [rows] = await database.db!.execute(`SELECT id_team
                                                  FROM team
                                                  WHERE name LIKE ? ${delFilter}`, [team]);
            teams = rows as {team_id: number}[];
        } else {
            const [rows] = await database.db!.execute(`SELECT id_team
                                                  FROM team
                                                  WHERE id_team = ? ${delFilter}`, [team]);
            teams = rows as {team_id: number}[];
        }
        if (!!teams.length)
            return (teams[0].team_id);
        return (-1)
    }

    // Private
    private checkNameNorm(name: string): status {
        if (name.length < 3 || name.length > 15) {
            return ({success: false, error: "The name must be at least 3 characters and maximum 15!"});
        }
        return ({success: true, error: ""});
    }
}