// tournament.service.ts
import type { Pool, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import {RegistrationRow, Tournament, TournamentFormat, TournamentRow, TournamentStatus} from "../../types";

/**
 * Objet service pour la table SQL Tournaments
 */
export class TournamentsRepository {
    /**
     * Constructeur permettant de récupérer la connexion
     * @param db
     */
    constructor(private readonly db: Pool) {}

    /**
     * Transforme l'objet brut retourné par SQL en objet métier
     * @param row Objet brut retourné par SQL
     * @private
     */
    private static normalizeTournament(row: TournamentRow): Tournament {
        return {
            id_tournament: row.id_tournament,
            organizer_user_id: row.organizer_user_id,
            name: row.name,
            description: row.description,
            format: row.format,
            max_teams: row.max_teams,
            created_at: new Date(row.created_at),
            start_visibility_at: row.start_visibility_at ? new Date(row.start_visibility_at) : null,
            open_registration_at: row.open_registration_at ? new Date(row.open_registration_at) : null,
            close_registration_at: row.close_registration_at ? new Date(row.close_registration_at) : null,
            start_at: row.start_at ? new Date(row.start_at) : null,
            status: row.status,
            current_round: row.current_round === null ? null : Number(row.current_round),
        };
    }

    /**
     * Transforme l'objet brut retourné par SQL en objet métier
     * @param row Objet brut retourné par SQL
     * @private
     */
    private static normalizeRegistration(row: RegistrationRow) {
        return {
            id_registration: row.id_registration,
            id_tournament: row.id_tournament,
            id_team: row.id_team,
            registered_at: new Date(row.registered_at),
            final_position: row.final_position === null ? null : Number(row.final_position),
            seed: row.seed === null ? null : Number(row.seed),
        };
    }

    // -------------------
    // CRUD Tournament
    // -------------------
    /**
     * Créer un tournoi
     * @param input Données pour créer le tournoi
     */
    async createTournament(input: {
        organizer_user_id: number;
        name: string;
        description?: string | null;
        format: TournamentFormat;
        max_teams: number;
        start_visibility_at?: Date | null;
        open_registration_at?: Date | null;
        close_registration_at?: Date | null;
        start_at?: Date | null;
    }): Promise<Tournament> {
        const [res] = await this.db.execute<ResultSetHeader>(
            `INSERT INTO tournaments
       (organizer_user_id, name, description, format, max_teams,
        start_visibility_at, open_registration_at, close_registration_at, start_at, status, current_round)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'DRAFT', NULL)`,
            [
                input.organizer_user_id,
                input.name,
                input.description ?? null,
                input.format,
                input.max_teams,
                input.start_visibility_at ?? null,
                input.open_registration_at ?? null,
                input.close_registration_at ?? null,
                input.start_at ?? null,
            ]
        );

        const t: Tournament | null = await this.getById(res.insertId);
        if (!t) throw new Error("TOURNAMENT_CREATE_FAILED");
        return t;
    }

    /**
     * Récupère un tournoi
     * @param id_tournament ID du tournois à récupérer
     */
    async getById(id_tournament: number): Promise<Tournament | null> {
        const [rows] = await this.db.execute<TournamentRow[]>(
            `SELECT id_tournament, organizer_user_id, name, description, format, max_teams,
              created_at, start_visibility_at, open_registration_at, close_registration_at,
              start_at, status, current_round
       FROM tournaments
       WHERE id_tournament = ?
       LIMIT 1`,
            [id_tournament]
        );

        if (rows.length === 0) return null;
        return TournamentsRepository.normalizeTournament(rows[0]);
    }

    /**
     * Récupère une liste de tournois
     * @param status Status des tournois à récupérer
     */
    async listByStatus(status: TournamentStatus): Promise<Tournament[]> {
        const [rows] = await this.db.execute<TournamentRow[]>(
            `SELECT id_tournament, organizer_user_id, name, description, format, max_teams,
              created_at, start_visibility_at, open_registration_at, close_registration_at,
              start_at, status, current_round
       FROM tournaments
       WHERE status = ?
       ORDER BY created_at DESC`,
            [status]
        );
        return rows.map(TournamentsRepository.normalizeTournament);
    }

    /**
     * Récupère tous les tournois visible
     * @param now Date à partir de laquelle il doivent être visible, défaut = now
     */
    async listVisible(now = new Date()): Promise<Tournament[]> {
        const [rows] = await this.db.execute<TournamentRow[]>(
            `SELECT id_tournament, organizer_user_id, name, description, format, max_teams,
              created_at, start_visibility_at, open_registration_at, close_registration_at,
              start_at, status, current_round
       FROM tournaments
       WHERE start_visibility_at IS NULL OR start_visibility_at <= ?
       ORDER BY COALESCE(start_visibility_at, created_at) DESC`,
            [now]
        );
        return rows.map(TournamentsRepository.normalizeTournament);
    }

    /**
     * Mets à jour les données d'un tournoi
     * @param id_tournament ID du tournoi à mettre à jour
     * @param patch Données à mettre à jour
     */
    async updateTournament(id_tournament: number, patch: Partial<{
        name: string;
        description: string | null;
        format: TournamentFormat;
        max_teams: number;
        start_visibility_at: Date | null;
        open_registration_at: Date | null;
        close_registration_at: Date | null;
        start_at: Date | null;
    }>): Promise<void> {
        const fields: string[] = [];
        const values: unknown[] = [];

        if (patch.name !== undefined) { fields.push("name = ?"); values.push(patch.name); }
        if (patch.description !== undefined) { fields.push("description = ?"); values.push(patch.description); }
        if (patch.format !== undefined) { fields.push("format = ?"); values.push(patch.format); }
        if (patch.max_teams !== undefined) { fields.push("max_teams = ?"); values.push(patch.max_teams); }
        if (patch.start_visibility_at !== undefined) { fields.push("start_visibility_at = ?"); values.push(patch.start_visibility_at); }
        if (patch.open_registration_at !== undefined) { fields.push("open_registration_at = ?"); values.push(patch.open_registration_at); }
        if (patch.close_registration_at !== undefined) { fields.push("close_registration_at = ?"); values.push(patch.close_registration_at); }
        if (patch.start_at !== undefined) { fields.push("start_at = ?"); values.push(patch.start_at); }

        if (fields.length === 0) return;

        values.push(id_tournament);

        const [res] = await this.db.execute<ResultSetHeader>(
            `UPDATE tournaments SET ${fields.join(", ")} WHERE id_tournament = ?`,
            values
        );

        if (res.affectedRows !== 1) throw new Error("TOURNAMENT_NOT_FOUND");
    }

    /**
     * Défini le status du tournoi
     * @param id_tournament ID du tournoi à mettre à jour
     * @param status Status du tournoi à appliquer
     */
    async setStatus(id_tournament: number, status: TournamentStatus): Promise<void> {
        const [res] = await this.db.execute<ResultSetHeader>(
            `UPDATE tournaments SET status = ? WHERE id_tournament = ?`,
            [status, id_tournament]
        );
        if (res.affectedRows !== 1) throw new Error("TOURNAMENT_NOT_FOUND");
    }

    /**
     * Défini le round actuel du tournoi
     * @param id_tournament ID du tournoi à mettre à jour
     * @param current_round Index du round à activer
     */
    async setCurrentRound(id_tournament: number, current_round: number | null): Promise<void> {
        const [res] = await this.db.execute<ResultSetHeader>(
            `UPDATE tournaments SET current_round = ? WHERE id_tournament = ?`,
            [current_round, id_tournament]
        );
        if (res.affectedRows !== 1) throw new Error("TOURNAMENT_NOT_FOUND");
    }

    /**
     * Supprime un tournoi
     * @param id_tournament ID du tournoi à mettre à jour
     */
    async deleteTournament(id_tournament: number): Promise<void> {
        const [res] = await this.db.execute<ResultSetHeader>(
            `DELETE FROM tournaments WHERE id_tournament = ?`,
            [id_tournament]
        );
        if (res.affectedRows !== 1) throw new Error("TOURNAMENT_NOT_FOUND");
    }

    // -------------------
    // Registration (teams <-> tournaments)
    // -------------------
    /**
     * Inscrit une équipe à un tournoi
     * @param id_tournament ID du tournoi où inscrire l'équipe
     * @param id_team ID de l'équipe à inscrire
     * @param seed Seed de l'équipe pour le tournoi
     */
    async registerTeam(id_tournament: number, id_team: number, seed: number | null = null): Promise<void> {
        const [res] = await this.db.execute<ResultSetHeader>(
            `INSERT INTO registrations (id_tournament, id_team, seed)
       VALUES (?, ?, ?)`,
            [id_tournament, id_team, seed]
        );
        if (res.affectedRows !== 1) throw new Error("REGISTRATION_FAILED");
    }

    /**
     * Désinscrit une équipe à un tournoi
     * @param id_tournament ID du tournoi où désinscrire l'équipe
     * @param id_team ID de l'équipe à désinscrire
     */
    async unregisterTeam(id_tournament: number, id_team: number): Promise<void> {
        const [res] = await this.db.execute<ResultSetHeader>(
            `DELETE FROM registrations
       WHERE id_tournament = ? AND id_team = ?`,
            [id_tournament, id_team]
        );
        if (res.affectedRows !== 1) throw new Error("REGISTRATION_NOT_FOUND");
    }

    /**
     * Récupère toutes les équipes inscrites à un tournoi
     * @param id_tournament ID du tournoi où récupérer les équipes
     */
    async listRegisteredTeams(id_tournament: number): Promise<Array<ReturnType<typeof TournamentsRepository.normalizeRegistration>>> {
        const [rows] = await this.db.execute<RegistrationRow[]>(
            `SELECT id_registration, id_tournament, id_team, registered_at, final_position, seed
       FROM registrations
       WHERE id_tournament = ?
       ORDER BY COALESCE(seed, 2147483647) ASC, registered_at ASC`,
            [id_tournament]
        );
        return rows.map(TournamentsRepository.normalizeRegistration);
    }

    /**
     * Défini le seed d'une équipe dans un tournoi
     * @param id_tournament ID du tournoi à mettre à jour
     * @param id_team ID de l'équipe où mettre à jour le seeed
     * @param seed Nouveau seed de l'équipe
     */
    async setTeamSeed(id_tournament: number, id_team: number, seed: number | null): Promise<void> {
        const [res] = await this.db.execute<ResultSetHeader>(
            `UPDATE registrations
       SET seed = ?
       WHERE id_tournament = ? AND id_team = ?`,
            [seed, id_tournament, id_team]
        );
        if (res.affectedRows !== 1) throw new Error("REGISTRATION_NOT_FOUND");
    }

    /**
     * Défini la position de l'équipe au tournoi.
     * Position final, donc lors de son élimination ou de sa victoire
     * @param id_tournament ID du tournoi à mettre à jour
     * @param id_team ID de l'équipe à mettre à jour
     * @param final_position Position finale à appliquer
     */
    async setFinalPosition(id_tournament: number, id_team: number, final_position: number | null): Promise<void> {
        const [res] = await this.db.execute<ResultSetHeader>(
            `UPDATE registrations
       SET final_position = ?
       WHERE id_tournament = ? AND id_team = ?`,
            [final_position, id_tournament, id_team]
        );
        if (res.affectedRows !== 1) throw new Error("REGISTRATION_NOT_FOUND");
    }

    // -------------------
    // Helpers
    // -------------------
    /**
     * Renvoi le nombre d'inscription au tournoi
     * @param id_tournament ID du tournoi cible
     */
    async countRegistrations(id_tournament: number): Promise<number> {
        const [rows] = await this.db.execute<(RowDataPacket & { c: number })[]>(
            `SELECT COUNT(*) AS c FROM registrations WHERE id_tournament = ?`,
            [id_tournament]
        );
        return Number(rows[0]?.c ?? 0);
    }

    /**
     * Test si une équipe est inscrite à un tournoi
     * @param id_tournament ID du tournoi à tester
     * @param id_team ID de l'équipe à tester
     */
    async isTeamRegistered(id_tournament: number, id_team: number): Promise<boolean> {
        const [rows] = await this.db.execute<RowDataPacket[]>(
            `SELECT 1
       FROM registrations
       WHERE id_tournament = ? AND id_team = ?
       LIMIT 1`,
            [id_tournament, id_team]
        );
        return rows.length > 0;
    }
}
