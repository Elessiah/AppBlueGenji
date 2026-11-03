/**
 * Prévenir un joueur d'une invitation d'équipe, d'une reprise de fantôme
 * proposée ou d'une propriété reçue — envoi.
 *
 * Les règles vivent dans le module pur `lib/shared/team-invite-notice.ts` ;
 * ici, la base et le point d'entrée des notifications (`notifyUsers`).
 * Appelé **après** l'écriture validée (commit, ou instruction seule), jamais
 * attendu par la requête : le geste est fait, le message n'est qu'un
 * avertissement (`docs/features/TEAM_INVITATION_NOTIFICATION.md`).
 */
import type { RowDataPacket } from "mysql2/promise";
import { getDatabase } from "@/lib/server/database";
import { failureReason } from "@/lib/server/failure-reason";
import { notifyUsers } from "@/lib/server/notify";
import { siteCanonicalBase } from "@/lib/server/site-url";
import { activeSuspensionSql } from "@/lib/server/suspension-sql";
import { teamInvitationPush } from "@/lib/shared/push-messages";
import {
  TEAM_INVITE_NOTICE_COOLDOWN_HOURS,
  withinTeamInviteNoticeBudget,
  formatTeamInviteNotice,
  shouldNotifyTeamInvite,
  teamInviteNoticePath,
  teamInviteNoticeRecipient,
  type TeamInviteNoticeKind,
} from "@/lib/shared/team-invite-notice";

type AccountRow = RowDataPacket & {
  id: number;
  pseudo: string;
  is_deleted: number;
  suspended: number | string;
  discord_id: string | null;
  discord_pseudo: string | null;
  discord_verified_at: Date | string | null;
};

type TeamRow = RowDataPacket & {
  name: string;
  is_ghost: number;
  solo_user_id: number | null;
  deleted_at: Date | string | null;
};

/**
 * Prévient `userId` — push et message privé Discord — de ce que l'équipe lui
 * propose. Rien n'est levé par l'envoi ; un bot injoignable laisse une ligne
 * pm2 sans donnée de joueur.
 *
 * @param actorId l'auteur du geste (gestion, staff, ancien propriétaire) : jamais prévenu.
 */
export async function notifyTeamInvite(
  kind: TeamInviteNoticeKind,
  teamId: number,
  userId: number,
  actorId: number,
): Promise<void> {
  const db = await getDatabase();
  if (kind === "INVITE") {
    // Invitations ordinaires de l'équipe dans la fenêtre (celle-ci comprise) :
    // une invitation retirée puis renvoyée n'écrit pas deux fois.
    const [counts] = await db.execute<(RowDataPacket & { this_player: number | string | null; any_player: number | string })[]>(
      `SELECT SUM(user_id = ?) AS this_player, COUNT(DISTINCT user_id) AS any_player FROM bg_team_invitations
       WHERE team_id = ? AND kind = 'INVITE'
         AND created_at > NOW() - INTERVAL ${Number(TEAM_INVITE_NOTICE_COOLDOWN_HOURS)} HOUR`,
      [userId, teamId],
    );
    const budget = { toThisPlayer: Number(counts[0]?.this_player ?? 0), toAnyPlayer: Number(counts[0]?.any_player ?? 0) };
    if (!withinTeamInviteNoticeBudget(budget)) return;
  }
  const [teams] = await db.execute<TeamRow[]>(
    `SELECT name, is_ghost, solo_user_id, deleted_at FROM bg_teams WHERE id = ? LIMIT 1`,
    [teamId],
  );
  if (teams.length === 0) return;
  const [accounts] = await db.execute<AccountRow[]>(
    `SELECT u.id, u.pseudo, u.is_deleted, u.discord_id, u.discord_pseudo, u.discord_verified_at,
            EXISTS (SELECT 1 FROM bg_account_suspensions sus
                    WHERE sus.user_id = u.id AND ${activeSuspensionSql("sus")}) AS suspended
     FROM bg_users u WHERE u.id = ? LIMIT 1`,
    [userId],
  );
  if (accounts.length === 0) return;

  const team = teams[0];
  const row = accounts[0];
  const account = {
    userId: Number(row.id),
    pseudo: row.pseudo,
    discordId: row.discord_id,
    discordPseudo: row.discord_pseudo,
    discordVerified: Boolean(row.discord_verified_at),
    deleted: Number(row.is_deleted) === 1,
    suspended: Number(row.suspended) === 1,
  };
  const teamInfo = {
    name: team.name,
    isGhost: Number(team.is_ghost) === 1,
    soloUserId: team.solo_user_id === null ? null : Number(team.solo_user_id),
    deleted: team.deleted_at !== null,
  };
  if (!shouldNotifyTeamInvite({ kind, actorId, account, team: teamInfo })) return;

  const url = `${siteCanonicalBase()}${teamInviteNoticePath(kind, teamId)}`;
  const report = await notifyUsers([teamInviteNoticeRecipient(account)], {
    topic: "TEAM_INVITATION",
    discord: {
      message: (locale) => formatTeamInviteNotice({ kind, teamName: team.name, url }, locale),
      context: "team-invitation",
    },
    push: (locale) => teamInvitationPush({ kind, teamId, teamName: team.name }, locale),
  });
  if (report.discord === null && report.discordUnreachedUserIds.length > 0) {
    console.warn(`[teams] bot injoignable : message privé d'équipe non remis (${kind})`);
  }
}

/**
 * Lance {@link notifyTeamInvite} sans l'attendre — à appeler **après** le
 * commit. Un échec (base indisponible) est journalisé sans donnée de joueur.
 */
export function notifyTeamInviteInBackground(
  kind: TeamInviteNoticeKind,
  teamId: number,
  userId: number,
  actorId: number,
): void {
  void notifyTeamInvite(kind, teamId, userId, actorId).catch((error: unknown) =>
    console.error(`[teams] joueur non prévenu (${kind})`, failureReason(error)),
  );
}
