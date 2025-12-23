import {Database} from "../database";
import {id, status, Team, TeamInfo} from "../../types";
import {UserEntity} from "../../database/UserEntity";
import {ResultSetHeader} from "mysql2";

export class TeamRepository {
    // #region Attributs Privés

    /**
     * Contient la classe Database
     * @private
     */
    private database: Database;

    // #endregion

    // #region Constructeur
    /**
     * Construit l'objet par rapport à une instance de base de donnée
     * @param database Doit être une instance de Database
     */
    constructor(database: Database) {
        this.database = database;
    }
    // #endregion

    // #region Méthodes Publiques
    /**
     * Récupère un match à partir d'un ID.
     * @param id id de l'équipe
     * @return status
     * @return TeamInfo Valide en cas de status.success
     */
    public async fetch(id: number): Promise<status & {team?: TeamInfo}> {
        let [rows] = await this.database.execute(`SELECT team.id_team,
                                                         team.name, 
                                                         team.creation_date, 
                                                         team.id_user, 
                                                         owner.username, 
                                                         COUNT(IF(members.date_leave IS NULL, 
                                                                  1, 
                                                                  NULL)) as members_count
                                                    FROM team 
                                                        LEFT JOIN user_team members 
                                                            ON members.id_team = team.id_team
                                                        LEFT JOIN user owner ON owner.id_user = team.id_user
                                                    WHERE team.id_team=?
                                                    GROUP BY team.id_team, 
                                                             team.name, 
                                                             team.creation_date, 
                                                             team.id_user, 
                                                             owner.username`,
                                                [id]);
        if ((rows as unknown[]).length == 0)
            return ({success: false, error: "Team not found!"});
        return {success: true, error: "", team:((rows as TeamInfo[])[0])};
    }

    /**
     * Créé une nouvelle équipe
     * @param name Nom de l'équipe
     * @param id_owner ID du propriétaire de l'équipe
     * @return status
     * @return id Valide en cas de status.success
     */
    public async new(name: string,
                     id_owner: number): Promise<status & id> {
        let status: status = await this.checkNameNorm(name);
        if (!status.success)
            return {...status, id: -1};
        let [rows] = await this.database.execute(`SELECT 1 
                                                    FROM team_owner 
                                                    WHERE id_user = ? 
                                                    LIMIT 1`,
                                            [id_owner]);
        if ((rows as unknown[]).length > 0)
            return ({success: false, error: "The user is already an owner !", id: -1});
        if ((rows as unknown[]).length > 0)
            return ({success: false, error: "The name is already taken !", id: -1});
        await this.database.beginTransaction();
        const [result] = await this.database.execute(`INSERT INTO team 
                                                        (name) 
                                                        VALUES (?)`,
                                                    [name]);
        const insertId: number = (result as ResultSetHeader).insertId;
        await this.database.execute(`INSERT INTO user_team 
                                        (id_user, id_team) 
                                        VALUES (?, ?)`,
                                    [id_owner, insertId]);
        await this.database.execute(`INSERT INTO team_owner 
                                        (id_user, id_team) 
                                        VALUES (?, ?)`,
                                    [id_owner, insertId]);
        await this.database.commit();
        return {...status, id: insertId};
    }

    /**
     * Change le nom d'une équipe
     * @param id de l'équipe
     * @param new_name nouveau nom
     */
    public async rename(id: number,
                        new_name: string): Promise<status> {
        const status: status = await this.checkNameNorm(new_name);
        if (!status.success)
            return status;
        const [result] = await this.database.execute(`UPDATE team 
                                        SET name = ? 
                                        WHERE id_team = ?`,
                                    [new_name, id]);
        return this.verifySQLInput(result as ResultSetHeader);
    }

    public async getIdOwner(id: number): Promise<status & id> {
        const [rows] = await this.database.execute(`SELECT id_user 
                                                        FROM team_owner 
                                                        WHERE id_team = ?`,
                                                    [id]);
        if ((rows as unknown[]).length > 0)
            return {success: false, error: "Team not found !", id: -1}
        return {success: true, error: "", id: ((rows as {id_user: number}[])[0].id_user)};
    }

    /**
     * Réattribue la propriété d'une équipe
     * @param id_team team visé
     * @param id_new_owner nouveau propriétaire
     */
    public async giveOwnership(id_team: number,
                               id_new_owner: number): Promise<status> {
        const [result] = await this.database.execute(`UPDATE team_owner
                                                        SET id_user = ?
                                                        WHERE id_team = ?`,
            [id_new_owner, id_team]);
        return this.verifySQLInput(result as ResultSetHeader);
    }

    public async hardDelete(id_team: number): Promise<status> {
        const [result] = await this.database.execute(`DELETE FROM team`)
    }

    // #endregion

    // #region Méthodes Privées
    /**
     * Vérifie la norme du nom
     * @param name
     * @return status
     * @private
     */
    private async checkNameNorm(name: string): Promise<status> {
        if (name.length < 3 || name.length > 15) {
            return ({success: false, error: "The name must be at least 3 characters and maximum 15!"});
        }
        const [rows] = await this.database.execute(`SELECT 1
                                                    FROM team
                                                    WHERE name = ?
                                                    LIMIT 1`,
                                                    [name]);
        if ((rows as unknown[]).length > 0)
            return ({success: false, error: "The name is already taken !"});
        return ({success: true, error: ""});
    }

    /**
     * Vérifie que l'input (UPDATE ou SET) s'est bien passé
     * @param result
     * @return status
     * @private
     */
    private verifySQLInput(result: ResultSetHeader): status {
        if (result.affectedRows > 0)
            return {success: true, error: ""};
        else if (result.warningStatus > 0)
            return ({success: false, error: result.info});
        return ({success: false, error: "Team not found!"});
    }
    // #endregion
}