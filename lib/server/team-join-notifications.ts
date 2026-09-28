/**
 * Prévenir la gestion d'une équipe d'une demande d'adhésion — envoi.
 *
 * Les règles (destinataires, borne anti-répétition, message) vivent dans le
 * module pur `lib/shared/team-join-request-notice.ts` ; ici, la base et le bot.
 */
import type { RowDataPacket } from "mysql2/promise";
import { getDatabase } from "@/lib/server/database";
import { pushDiscordDirectMessages } from "@/lib/server/bot-integration";
import { parseRoles } from "@/lib/server/serialization";
import { siteCanonicalBase } from "@/lib/server/site-url";
import {
  TEAM_JOIN_REQUEST_NOTICE_COOLDOWN_HOURS,
  formatTeamJoinRequestNotice,
  shouldNotifyTeamJoinRequest,
  teamJoinNoticeRecipients,
} from "@/lib/shared/team-join-request-notice";

type ManagerRow = RowDataPacket & {
  pseudo: string;
  roles_json: unknown;
  discord_id: string | null;
  discord_pseudo: string | null;
  discord_verified_at: Date | string | null;
};

/**
 * Écrit en message privé au propriétaire et aux managers de l'équipe qu'un
 * joueur vient de demander à la rejoindre.
 *
 * Meilleur effort, comme tout message du bot : la demande est déjà enregistrée,
 * un bot injoignable la laisse intacte — la gestion la verra sur la fiche.
 * Rien n'est levé : l'appelant ne l'attend pas.
 */
export async function notifyTeamJoinRequest(teamId: number, requesterId: number): Promise<void> {
  const db = await getDatabase();

  const [counts] = await db.execute<(RowDataPacket & { n: number })[]>(
    `SELECT COUNT(*) AS n FROM bg_team_invitations
     WHERE team_id = ? AND user_id = ? AND kind = 'REQUEST'
       AND created_at > NOW() - INTERVAL ${Number(TEAM_JOIN_REQUEST_NOTICE_COOLDOWN_HOURS)} HOUR`,
    [teamId, requesterId],
  );
  if (!shouldNotifyTeamJoinRequest(Number(counts[0]?.n ?? 0))) return;

  const [teams] = await db.execute<(RowDataPacket & { name: string })[]>(
    `SELECT name FROM bg_teams WHERE id = ? AND deleted_at IS NULL LIMIT 1`,
    [teamId],
  );
  if (teams.length === 0) return;

  const [rows] = await db.execute<ManagerRow[]>(
    `SELECT u.pseudo, tm.roles_json, u.discord_id, u.discord_pseudo, u.discord_verified_at
     FROM bg_team_members tm
     JOIN bg_users u ON u.id = tm.user_id
     WHERE tm.team_id = ? AND tm.left_at IS NULL AND u.is_deleted = 0 AND u.id <> ?`,
    [teamId, requesterId],
  );
  const recipients = teamJoinNoticeRecipients(
    rows.map((row) => ({
      pseudo: row.pseudo,
      roles: parseRoles(row.roles_json),
      discordId: row.discord_id,
      discordPseudo: row.discord_pseudo,
      discordVerified: Boolean(row.discord_verified_at),
    })),
  );
  if (recipients.length === 0) return;

  const url = `${siteCanonicalBase()}/equipes/${teamId}`;
  await pushDiscordDirectMessages(
    formatTeamJoinRequestNotice({ teamName: teams[0].name, url }),
    recipients,
    "team-join-request",
  );
}
