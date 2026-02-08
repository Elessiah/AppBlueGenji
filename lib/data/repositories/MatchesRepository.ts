// match.service.ts
import type {Connection, ResultSetHeader, RowDataPacket} from "mysql2/promise";
import {Match, MatchBracket, MatchParticipation, MatchRow, ParticipationRow} from "../../types";

/**
 * Objet service pour la table Matches
 */
export class MatchRepository {
    /**
     * Constructeur pour récupérer la connexion à la base de données
     * @param db Connection de la base de données à récupérer
     */
    constructor(private readonly db: Connection) {}

    /**
     * Renvoi l'objet courant d'un match
     * @param row Prend l'objet SQL retourné par execute
     * @private
     */
    private static normalizeMatch(row: MatchRow): Match {
        return {
            id_match: row.id_match,
            id_tournament: row.id_tournament,
            start_at: row.start_at ? new Date(row.start_at) : null,
            round: Number(row.round),
            bracket: row.bracket ?? null,
            match_index: row.match_index === null ? null : Number(row.match_index),
        };
    }

    /**
     * Renvoi l'objet courant d'une participation
     * @param row Prend l'objet SQL retourné par execute
     * @private
     */
    private static normalizeParticipation(row: ParticipationRow): MatchParticipation {
        return {
            id_participation: row.id_participation,
            id_match: row.id_match,
            id_team: row.id_team,
            score: Number(row.score),
            is_winner: Boolean(row.is_winner),
        };
    }

    // -------------------
    // Match CRUD
    // -------------------
    /**
     * Créer un match
     * @param input Information nécessaire à la création d'un match
     */
    async createMatch(input: {
        id_tournament: number;
        round: number;
        bracket?: MatchBracket | null;
        match_index?: number;
        start_at?: Date | null;
    }): Promise<Match> {
        const [res] = await this.db.execute<ResultSetHeader>(
            `INSERT INTO matches (id_tournament, start_at, round, bracket, match_index)
       VALUES (?, ?, ?, ?, ?)`,
            [
                input.id_tournament,
                input.start_at ?? null,
                input.round,
                input.bracket ?? null,
                input.match_index ?? 0,
            ]
        );

        const m: Match | null = await this.getById(res.insertId);
        if (!m) throw new Error("MATCH_CREATE_FAILED");
        return m;
    }

    /**
     * Récupère un match avec son ID
     * @param id_match ID du match
     */
    async getById(id_match: number): Promise<Match | null> {
        const [rows] = await this.db.execute<MatchRow[]>(
            `SELECT id_match, id_tournament, start_at, round, bracket, match_index
       FROM matches
       WHERE id_match = ?
       LIMIT 1`,
            [id_match]
        );
        if (rows.length === 0) return null;
        return MatchRepository.normalizeMatch(rows[0]);
    }

    /**
     * Retourne la liste de match existant pour le tournoi
     * @param id_tournament ID du tournoi
     */
    async listByTournament(id_tournament: number): Promise<Match[]> {
        const [rows] = await this.db.execute<MatchRow[]>(
            `SELECT id_match, id_tournament, start_at, round, bracket, match_index
       FROM matches
       WHERE id_tournament = ?
       ORDER BY round ASC, COALESCE(bracket, 'UPPER') ASC, COALESCE(match_index, 2147483647) ASC, id_match ASC`,
            [id_tournament]
        );
        return rows.map(MatchRepository.normalizeMatch);
    }

    /**
     * Retourne la liste de match existant pour le round
     * @param id_tournament ID du tournoi
     * @param round Index du round
     * @param bracket Bracket du round
     */
    async listByRound(id_tournament: number, round: number, bracket: MatchBracket | null = null): Promise<Match[]> {
        const [rows] = await this.db.execute<MatchRow[]>(
            `SELECT id_match, id_tournament, start_at, round, bracket, match_index
       FROM matches
       WHERE id_tournament = ? AND round = ? AND (? IS NULL OR bracket = ?)
       ORDER BY COALESCE(match_index, 2147483647) ASC, id_match ASC`,
            [id_tournament, round, bracket, bracket]
        );
        return rows.map(MatchRepository.normalizeMatch);
    }

    /**
     * Met à jour le match
     * @param id_match ID du match
     * @param patch Données à mettre à jour
     */
    async updateMatch(id_match: number, patch: Partial<{
        start_at: Date | null;
        round: number;
        bracket: MatchBracket | null;
        match_index: number | null;
    }>): Promise<void> {
        const fields: string[] = [];
        const values: unknown[] = [];

        if (patch.start_at !== undefined) { fields.push("start_at = ?"); values.push(patch.start_at); }
        if (patch.round !== undefined) { fields.push("round = ?"); values.push(patch.round); }
        if (patch.bracket !== undefined) { fields.push("bracket = ?"); values.push(patch.bracket); }
        if (patch.match_index !== undefined) { fields.push("match_index = ?"); values.push(patch.match_index); }

        if (fields.length === 0) return;

        values.push(id_match);

        const [res] = await this.db.execute<ResultSetHeader>(
            `UPDATE matches SET ${fields.join(", ")} WHERE id_match = ?`,
            values
        );

        if (res.affectedRows !== 1) throw new Error("MATCH_NOT_FOUND");
    }

    /**
     * Supprime un match
     * @param id_match ID du match à supprimer
     */
    async deleteMatch(id_match: number): Promise<void> {
        const [res] = await this.db.execute<ResultSetHeader>(
            `DELETE FROM matches WHERE id_match = ?`,
            [id_match]
        );
        if (res.affectedRows !== 1) throw new Error("MATCH_NOT_FOUND");
    }

    // -------------------
    // Participations (match <-> teams)
    // -------------------
    /**
     * Ajoute une équipe à un match
     * @param id_match ID du match où ajouter l'équipe
     * @param id_team ID de l'équipe à ajouter
     */
    async addTeamToMatch(id_match: number, id_team: number): Promise<MatchParticipation> {
        const [res] = await this.db.execute<ResultSetHeader>(
            `INSERT INTO match_participations (id_match, id_team)
       VALUES (?, ?)`,
            [id_match, id_team]
        );

        const p: MatchParticipation | null = await this.getParticipationById(res.insertId);
        if (!p) throw new Error("PARTICIPATION_CREATE_FAILED");
        return p;
    }

    /**
     * Retourne une participation à partir d'un ID
     * @param id_participation ID de la participation
     */
    async getParticipationById(id_participation: number): Promise<MatchParticipation | null> {
        const [rows] = await this.db.execute<ParticipationRow[]>(
            `SELECT id_participation, id_match, id_team, score, is_winner
       FROM match_participations
       WHERE id_participation = ?
       LIMIT 1`,
            [id_participation]
        );
        if (rows.length === 0) return null;
        return MatchRepository.normalizeParticipation(rows[0]);
    }

    /**
     * Retourne toutes les participations d'un match
     * @param id_match ID du match
     */
    async listParticipations(id_match: number): Promise<MatchParticipation[]> {
        const [rows] = await this.db.execute<ParticipationRow[]>(
            `SELECT id_participation, id_match, id_team, score, is_winner
       FROM match_participations
       WHERE id_match = ?
       ORDER BY id_participation ASC`,
            [id_match]
        );
        return rows.map(MatchRepository.normalizeParticipation);
    }

    /**
     * Met à jour les scores d'un match pour une équipe
     * @param id_match ID du match à mettre à jour
     * @param id_team ID de l'équipe à mettre à jour
     * @param score Nouveau score à appliquer
     */
    async setScore(id_match: number, id_team: number, score: number): Promise<void> {
        const [res] = await this.db.execute<ResultSetHeader>(
            `UPDATE match_participations
       SET score = ?
       WHERE id_match = ? AND id_team = ?`,
            [score, id_match, id_team]
        );
        if (res.affectedRows !== 1) throw new Error("PARTICIPATION_NOT_FOUND");
    }

    /**
     * Défini l'équipe vainqueur du match
     * @param id_match ID du match à mettre à jour
     * @param winner_team_id ID de l'équipe vainqueur
     */
    async setWinner(id_match: number, winner_team_id: number): Promise<void> {
        try {
            await this.db.beginTransaction();

            // Met tout le monde à false puis le gagnant à true
            await this.db.execute<ResultSetHeader>(
                `UPDATE match_participations
         SET is_winner = false
         WHERE id_match = ?`,
                [id_match]
            );

            const [res] = await this.db.execute<ResultSetHeader>(
                `UPDATE match_participations
         SET is_winner = true
         WHERE id_match = ? AND id_team = ?`,
                [id_match, winner_team_id]
            );

            if (res.affectedRows !== 1) throw new Error("WINNER_TEAM_NOT_IN_MATCH");

            await this.db.commit();
        } catch (e) {
            await this.db.rollback();
            throw e;
        } finally {
            await this.db.end();
        }
    }

    /**
     * Retire une équipe d'un match
     * @param id_match ID du match à mettre à jour
     * @param id_team ID de l'équipe à retirer
     */
    async removeTeamFromMatch(id_match: number, id_team: number): Promise<void> {
        const [res] = await this.db.execute<ResultSetHeader>(
            `DELETE FROM match_participations
       WHERE id_match = ? AND id_team = ?`,
            [id_match, id_team]
        );
        if (res.affectedRows !== 1) throw new Error("PARTICIPATION_NOT_FOUND");
    }

    // -------------------
    // Helpers
    // -------------------
    /**
     * Récupère l'équipe vainqueur d'un match
     * @param id_match ID du match où récupérer l'équipe
     */
    async getWinnerTeamId(id_match: number): Promise<number | null> {
        const [rows] = await this.db.execute<(RowDataPacket & { id_team: number })[]>(
            `SELECT id_team
       FROM match_participations
       WHERE id_match = ? AND is_winner = true
       LIMIT 1`,
            [id_match]
        );
        if (rows.length === 0) return null;
        return Number(rows[0].id_team);
    }

    /**
     * Défini le départ officiel du match
     * @param id_match ID du match à mettre à jour
     * @param start_at Date du départ
     */
    async setMatchStartAt(id_match: number, start_at: Date | null): Promise<void> {
        const [res] = await this.db.execute<ResultSetHeader>(
            `UPDATE matches SET start_at = ? WHERE id_match = ?`,
            [start_at, id_match]
        );
        if (res.affectedRows !== 1) throw new Error("MATCH_NOT_FOUND");
    }
}
