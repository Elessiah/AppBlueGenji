import {Database} from "../database";
import {getMatchsServer, id, Match, MatchTeams, status, TeamAndMatch, TeamMatch, Tournament} from "../../types";
import {ResultSetHeader} from "mysql2";

export class MatchRepository {
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
     * @param id id du match
     */
    public async fetch(id: number): Promise<status & {match?: Match}> {
        let [rows] = await this.database.execute(`SELECT 
                                                        m.id_match, 
                                                        m.id_victory_team, 
                                                        m.id_tournament, 
                                                        m.start_date, 
                                                        team_match.id_team, 
                                                        team_match.score
                                                    FROM (SELECT *
                                                          FROM \`match\`
                                                          WHERE id_match = ?) as m
                                                             LEFT JOIN team_match 
                                                                 ON m.id_match = team_match.id_match`,
                                                    [id]);
        if ((rows as unknown[]).length == 0)
            return ({success: false, error: "This match does not exist!"});
        const matchAndTeams: MatchTeams = (await MatchRepository.groupByMatchID((rows as TeamAndMatch[])))[0];
        [rows] = await this.database.execute(`SELECT * FROM tournament WHERE id_tournament = ?`, [matchAndTeams.id_tournament]);
        const tournament : Tournament = (rows as Tournament[])[0];
        const match: Match = {
            id_match: matchAndTeams.id_match,
            tournament: tournament,
            teams: matchAndTeams.teams,
            id_victory_team: matchAndTeams.id_victory_team,
            start_date: matchAndTeams.start_date
        }
        return ({success: true, error: "", match: match});
    }

    public async create(id_tournament: number,
                        date: Date,
                        id_host?: number,
                        id_guest?: number): Promise<status & id> {
        let id_victory_team: number = -1;
        if (!id_host) {
            if (id_guest)
                id_victory_team = id_guest;
        } else if (!id_guest) {
            id_victory_team = id_host;
        }
        const now = new Date();
        now.setMinutes(now.getMinutes() - 1);
        if (now > date)
            return ({success: false, error: "The date must not be in the past !", id: -1});
        const [result] = await this.database.execute(`INSERT INTO \`match\` 
                                                        (id_tournament, id_victory_team, start_date) 
                                                        VALUES (?, ?, ?)`,
                                                    [id_tournament, id_victory_team, date]);
        const insertId: number = (result as ResultSetHeader).insertId;
        if (id_host)
            await this.database.execute(`INSERT INTO team_match (id_match, id_team) VALUES (?, ?)`, [insertId, id_host]);
        if (id_guest)
            await this.database.execute(`INSERT INTO team_match (id_match, id_team) VALUES (?, ?)`, [insertId, id_guest]);
        if (id_victory_team)
            await this.manageTournamentWinner(id_tournament);
        return ({success: true, error: "", id: insertId});
    }

    public async update(id_match: number,
                        scores: number[],
                        id_victory_team: number = -1): Promise<status> {
        if (scores.length != this.teams.length)
            return ({success: false, error: "The number of scores does not match the teams number"});
        const database: Database = await Database.getInstance();
        for (let i = 0; i < this.teams.length; i++) {
            await database.sql!.execute(`UPDATE team_match
                                         SET score = ?
                                         WHERE id_team = ?`, [scores[i], this.teams[i].id_team]);
            this.teams[i].score = scores[i];
        }
        if (id_victory_team) {
            await database.sql!.execute(`UPDATE \`match\` SET id_victory_team = ?WHERE id_match = ?`, [id_victory_team, this.id]);
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

    // #endregion

    // #region Méthodes Publiques

    private async manageTournamentWinner(id_tournament: number): Promise<status> {
        const [rows] = await this.database.execute(`SELECT COUNT(*) as nbTeams FROM team_tournament WHERE id_tournament = ? && position = -1`, [id_tournament]);
        // Pas d'équipes inscrites ou tournoi terminé. Bizarre voire impossible ici, mais au cas où
        if ((rows as unknown[]).length == 0)
            return ({success: true, error: ""});
        const nbTeams: number = ((rows as unknown[])[0] as {nbTeams: number}).nbTeams;
        if (nbTeams > 1)
            return ({success: true, error: ""});
        await this.database.execute(`UPDATE team_tournament SET position=1 WHERE id_tournament=?AND position=-1`, [id_tournament]);
        return ({success: true, error: ""});
    }

    // #endregion

    // #region Static Publiques
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
    // #endregion

    // #region Méthodes Privées
    // #endregion

}