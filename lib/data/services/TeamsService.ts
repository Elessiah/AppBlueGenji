// team.service.ts
import type {Connection, ResultSetHeader, RowDataPacket} from "mysql2/promise";
import {Membership, MembershipRow, Team, TeamMemberRole, TeamRow} from "../../types";

/**
 * Objet service de la table Teams
 */
export class TeamService {
    /**
     * Constructeur permettant de récupérer la connection à la base de données
     * @param db
     */
    constructor(private readonly db: Connection) {}

    /**
     * Transforme l'objet brut retourné par SQL en objet métier
     * @param row Objet brut retourné par SQL
     * @private
     */
    private static normalizeTeam(row: TeamRow): Team {
        return {
            id_team: row.id_team,
            name: row.name,
            created_at: new Date(row.created_at),
        };
    }

    /**
     * Transforme l'objet brut retourné par SQL en objet métier
     * @param row Objet brut retourné par SQL
     * @private
     */
    private static normalizeMembership(row: MembershipRow): Membership {
        return {
            id_membership: row.id_membership,
            id_user: row.id_user,
            id_team: row.id_team,
            joined_at: new Date(row.joined_at),
            left_at: row.left_at ? new Date(row.left_at) : null,
            role: row.role,
        };
    }

    /**
     * Créer une nouvelle équipe
     * @param name Nouveau nom
     * @param ownerUserId ID de l'utilisateur propriétaire
     */
    async createTeam(name: string, ownerUserId: number): Promise<Team> {
        try {
            await this.db.beginTransaction();

            const [resTeam] = await this.db.execute<ResultSetHeader>(
                `INSERT INTO teams (name) VALUES (?)`,
                [name]
            );

            const id_team: number = resTeam.insertId;

            await this.db.execute<ResultSetHeader>(`INSERT INTO memberships (id_user, id_team, role)
                                                            VALUES (?, ?, 'OWNER')`,
                                                                [ownerUserId, id_team]
            );

            await this.db.commit();

            const team: Team | null = await this.getById(id_team);
            if (!team) throw new Error("TEAM_CREATE_FAILED");
            return team;
        } catch (e) {
            await this.db.rollback();
            throw e;
        } finally {
            await this.db.end();
        }
    }

    /**
     * Récupère une équipe
     * @param id_team ID de l'équipe à récupérer
     */
    async getById(id_team: number): Promise<Team | null> {
        const [rows] = await this.db.execute<TeamRow[]>(
            `SELECT id_team, name, created_at
       FROM teams
       WHERE id_team = ?
       LIMIT 1`,
            [id_team]
        );

        if (rows.length === 0) return null;
        return TeamService.normalizeTeam(rows[0]);
    }

    /**
     * Récupère une équipe
     * @param name Nom de l'équipe à récupérer
     */
    async getByName(name: string): Promise<Team | null> {
        const [rows] = await this.db.execute<TeamRow[]>(
            `SELECT id_team, name, created_at
       FROM teams
       WHERE name = ?
       LIMIT 1`,
            [name]
        );

        if (rows.length === 0) return null;
        return TeamService.normalizeTeam(rows[0]);
    }

    async listTeams(): Promise<Team[]> {
        const [rows] = await this.db.execute<TeamRow[]>(
            `SELECT id_team, name, created_at
       FROM teams
       ORDER BY created_at DESC`
        );

        return rows.map(TeamService.normalizeTeam);
    }

    async addMember(id_team: number, id_user: number, role: TeamMemberRole = "MEMBER"): Promise<void> {
        // Empêche 2 memberships actifs en parallèle pour le même user/team
        const [active] = await this.db.execute<RowDataPacket[]>(
            `SELECT 1
       FROM memberships
       WHERE id_team = ? AND id_user = ? AND left_at IS NULL
       LIMIT 1`,
            [id_team, id_user]
        );
        if (active.length > 0) throw new Error("MEMBERSHIP_ALREADY_ACTIVE");

        await this.db.execute<ResultSetHeader>(
            `INSERT INTO memberships (id_user, id_team, role)
       VALUES (?, ?, ?)`,
            [id_user, id_team, role]
        );
    }

    async leaveTeam(id_team: number, id_user: number): Promise<void> {
        const [res] = await this.db.execute<ResultSetHeader>(`
                UPDATE memberships
                   SET left_at = CURRENT_TIMESTAMP
                   WHERE id_team = ? AND id_user = ? AND left_at IS NULL`,
                        [id_team, id_user]
        );

        if (res.affectedRows === 0) throw new Error("NO_ACTIVE_MEMBERSHIP");
    }

    async setMemberRole(id_team: number, id_user: number, role: TeamMemberRole): Promise<void> {
        const [res] = await this.db.execute<ResultSetHeader>(
            `UPDATE memberships
       SET role = ?
       WHERE id_team = ? AND id_user = ? AND left_at IS NULL`,
            [role, id_team, id_user]
        );

        if (res.affectedRows === 0) throw new Error("NO_ACTIVE_MEMBERSHIP");
    }

    async listMembers(id_team: number): Promise<Array<ReturnType<typeof TeamService.normalizeMembership>>> {
        const [rows] = await this.db.execute<MembershipRow[]>(
            `SELECT id_membership, id_user, id_team, joined_at, left_at, role
                   FROM memberships
                   WHERE id_team = ?
                   ORDER BY joined_at ASC`,
                        [id_team]
        );

        return rows.map(TeamService.normalizeMembership);
    }

    async getActiveMembers(id_team: number): Promise<Array<ReturnType<typeof TeamService.normalizeMembership>>> {
        const [rows] = await this.db.execute<MembershipRow[]>(
            `SELECT id_membership, id_user, id_team, joined_at, left_at, role
                   FROM memberships
                   WHERE id_team = ? AND left_at IS NULL
                   ORDER BY joined_at ASC`,
                        [id_team]
        );

        return rows.map(TeamService.normalizeMembership);
    }

    async isMemberActive(id_team: number, id_user: number): Promise<boolean> {
        const [rows] = await this.db.execute<RowDataPacket[]>(
            `SELECT 1
                   FROM memberships
                   WHERE id_team = ? AND id_user = ? AND left_at IS NULL
                   LIMIT 1`,
                        [id_team, id_user]
        );
        return rows.length > 0;
    }

    async deleteTeam(id_team: number): Promise<void> {
        const [res] = await this.db.execute<ResultSetHeader>(
            `DELETE FROM teams WHERE id_team = ?`,
            [id_team]
        );

        if (res.affectedRows !== 1) throw new Error("TEAM_NOT_FOUND");
    }
}
