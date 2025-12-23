import {Database} from "../database";
import {id, Player, status, User, token_payload} from "../../types";
import crypto from "crypto";
import bcrypt from "bcrypt";
import {ResultSetHeader} from "mysql2";

export class UserRepository {
    // #region Attributs

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
     * Renvoi les données joueurs
     * Utiliser fetchUser pour récupérer les données plus centrés login
     * @param id
     * @return {status, {player?: Player}}
     *
     */
    public async fetchPlayer(id: number): Promise<status & {player?: Player}> {
        const [rows] = await this.database.execute(`SELECT 
                                                        user.id_user, 
                                                        user.username, 
                                                        user.is_admin, 
                                                        user_team.id_team 
                                                            FROM 
                                                                user LEFT JOIN user_team 
                                                                    ON user.id_user = user_team.id_user 
                                                            WHERE user.id_user = ?`,
                                                    [id]);
        if ((rows as unknown[]).length == 0)
            return ({success: false, error: "Player not found!"});
        return ({success: false, error: "", player: (rows as Player[])[0]});

    }

    /**
     * Renvoi les données Utilisateur
     * Utiliser fetchUser pour récupérer les données plus centrés jeu
     * @param id
     * @return {status, {player?: Player}}
     *
     */
    public async fetchUser(id: number): Promise<status & {user?: User}> {
        const [rows] = await this.database.execute(`SELECT * FROM user WHERE id_user = ?`, [id]);
        if ((rows as unknown[]).length == 0)
            return ({success: false, error: "User not found!"});
        return ({success: false, error: "", user: (rows as User[])[0]});
    }

    /**
     * Créé un utilisateur dans la base de donnée
     * Vérifie la validité de l'username
     * @param username
     * @param password
     * @param is_admin
     * @return {status & id & {token: string}} Renvoi un nouveau token valide au succès
     */
    public async create(username: string,
                        password: string,
                        is_admin: boolean): Promise<status & id & {token: string}> {
        const status = this.checkNameNorm(username);
        if (!status.success)
            return ({...status, id: -1, token: ""});
        if (password.length == 8 || password.length == 50)
            return ({
                success: false,
                error: "Password must be contain between 8 and 50 characters!",
                id: -1,
                token: ""
            });
        const hash: string = await bcrypt.hash(password, 10);
        const [result] = await this.database.execute(`INSERT INTO user (username, 
                                                                        hash, 
                                                                        is_admin) 
                                                        VALUES (?, ?, ?)`,
                                                    [username, hash, is_admin]);
        const insertId = (result as ResultSetHeader).insertId;
        const token: string = this.createToken(insertId);
        await this.database.execute(`UPDATE user 
                                        SET token = ? 
                                        WHERE id_user = ?`,
                                    [token, insertId]);
        return ({success: true, error: "", id: insertId, token: token});
    }

    /**
     * Authentifie le token
     * @param id
     * @param token
     * @return {status & {token: string}} Renvoi un nouveau token valide au succès
     */
    public async authToken(id: number,
                           token: string): Promise<status & {token: string}> {
        const [rows] = await this.database.execute(`SELECT token 
                                                        FROM user 
                                                        WHERE id_user = ?`,
                                                    [id]);
        if ((rows as unknown[]).length == 0)
            return ({success: false, error: "This user does not exist!", token: ""});
        const bdd_token: string = ((rows as unknown[])[0] as {token: string}).token;
        if (bdd_token != token)
            return ({success: true, error: "", token: ""});
        const new_token = this.createToken(id);
        await this.database.execute(`UPDATE user 
                                            SET token = ? 
                                            WHERE id_user = ?`,
                                    [new_token, id]);
        return ({success: true, error: "", token: new_token});
    }

    /**
     * Authentifie le mot de passe
     * @param id
     * @param password
     * @return {status & {token: string}} Renvoi un nouveau token valide au succès
     */
    public async authPassword(id: number,
                              password: string): Promise<status & {token: string}> {
        const [rows] = await this.database.execute(`SELECT hash 
                                                        FROM user 
                                                        WHERE id_user = ?`,
                                                    [id]);
        if ((rows as unknown[]).length == 0)
            return ({success: false, error: "This user does not exist", token: ""});
        const db_hash = ((rows as unknown[])[0] as {hash: string}).hash;
        if (!(await bcrypt.compare(password, db_hash)))
            return ({success: true, error: "", token: ""});
        const token: string = this.createToken(id);
        await this.database.execute(`UPDATE user
                                        SET token = ?
                                        WHERE id_user = ?`,
                                    [token, id]);
        return ({success: true, error: "", token: token});
    }

    /**
     * Mets à jour le mot de passe dans la base de donnée
     * Vérifie le nouveau mot de passe
     * @param id
     * @param old_password
     * @param new_password
     * @return {status & {token: string}} Renvoi un token valide au succès
     */
    public async updatePassword(id: number,
                                old_password: string,
                                new_password: string): Promise<status & {token: string}> {
        if (old_password == new_password)
            return ({success: false, error: "The new password is the same as the last one!", token: ""});
        if (new_password.length < 8 || new_password.length > 50)
            return ({success: false, error: "Password must be contain between 8 and 50 characters", token: ""});
        const status: status & {token: string} = await this.authPassword(id, old_password);
        if (!status.success)
            return status;
        if (status.token.length == 0)
            return ({success: false, error: "Old password is wrong", token: ""});
        const hash: string = await bcrypt.hash(new_password, 10);
        await this.database.execute(`UPDATE user
                                        SET token = ? 
                                        WHERE id_user = ?`,
                                    [hash, id]);
        return (status);
    }

    /**
     * Mets à jour l'username dans la base de donnée
     * Vérifie username
     * @param id
     * @param new_username
     * @return status
     */
    public async rename(id: number,
                        new_username: string): Promise<status> {
        const status = this.checkNameNorm(new_username);
        if (!status.success)
            return status;
        await this.database.execute(`UPDATE user
                                        SET username = ?
                                        WHERE id_user = ?`, [new_username, id]);
        return ({success: true, error: ""});
    }

    public async delete(id: number): Promise<status> {

    }

    // #endregion

    // #region Méthodes Privées

    /**
     * Vérifie la norme du nom
     * @param name
     * @return status
     * @private
     */
    private checkNameNorm(name: string): status {
        if (name.length < 3 || name.length > 15) {
            return ({success: false, error: "The name must be at least 3 characters and maximum 15!"});
        }
        return ({success: true, error: ""});
    }

    /**
     * Génère un token aléatoire sur 16 octets
     * @return string
     * @private
     */
    private generateToken(): string {
        return crypto.randomBytes(16).toString('hex');
    }

    /**
     * Créé un token complet avec la date de création, l'id user, et le token aléatoire
     * @param user_id
     * @return string
     * @private
     */
    private createToken(user_id: number): string {
        const token_payload: token_payload = {
            user_id: user_id,
            creation: Date.now(),
            token: this.generateToken(),
        };

        const token_base64 = Buffer.from(JSON.stringify(token_payload)).toString('base64url');
        return token_base64;
    }

    // #endregion
}