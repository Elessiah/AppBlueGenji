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
import { notifyUsers, type NotificationReport } from "@/lib/server/notify";
import { siteCanonicalBase } from "@/lib/server/site-url";
import { activeSuspensionSql } from "@/lib/server/suspension-sql";
import { teamInvitationPush } from "@/lib/shared/push-messages";
import {
  TEAM_INVITE_NOTICE_COOLDOWN_HOURS,
  TEAM_NOTICE_DMS_HOURLY_CAP,
  withinGhostClaimNoticeBudget,
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
  const windowSql = `created_at > NOW() - INTERVAL ${Number(TEAM_INVITE_NOTICE_COOLDOWN_HOURS)} HOUR`;
  // Le joueur a-t-il déjà été membre de l'équipe ? Son ancienne équipe qui le
  // rappelle échappe au plafond par joueur (trois équipes d'un tiers ne la
  // taisent pas).
  const formerMemberSql = `EXISTS (SELECT 1 FROM bg_team_members WHERE team_id = ? AND user_id = ?)`;
  if (kind === "INVITE") {
    // Invitations ordinaires dans la fenêtre, celle-ci comprise : une équipe
    // recréée ne repart pas de zéro (compte par auteur), et un joueur n'est
    // pas relancé par équipe après équipe (compte par destinataire). Les
    // reprises proposées par le staff (invitation portant `OWNER`) ne comptent pas.
    const [counts] = await db.execute<(RowDataPacket & {
      any_player: number | string;
      by_actor: number | string;
      teams_to_player: number | string;
      former_member: number | string;
    })[]>(
      `SELECT COUNT(DISTINCT CASE WHEN team_id = ? THEN user_id END) AS any_player,
              COUNT(DISTINCT CASE WHEN created_by = ? THEN user_id END) AS by_actor,
              COUNT(DISTINCT CASE WHEN user_id = ? THEN team_id END) AS teams_to_player,
              ${formerMemberSql} AS former_member
       FROM bg_team_invitations
       WHERE (team_id = ? OR created_by = ? OR user_id = ?)
         AND kind = 'INVITE' AND COALESCE(JSON_CONTAINS(roles_json, '"OWNER"'), 0) = 0 AND ${windowSql}`,
      [teamId, actorId, userId, teamId, userId, teamId, actorId, userId],
    );
    const budget = {
      toAnyPlayer: Number(counts[0]?.any_player ?? 0),
      byActor: Number(counts[0]?.by_actor ?? 0),
      teamsToThisPlayer: Number(counts[0]?.teams_to_player ?? 0),
      formerMember: Number(counts[0]?.former_member ?? 0) === 1,
    };
    if (!withinTeamInviteNoticeBudget(budget)) return;
  } else if (kind === "GHOST_CLAIM") {
    // Un compte staff ne fait pas écrire à tout le site, un joueur ne reçoit
    // pas fantôme après fantôme (mêmes plafonds qu'une invitation).
    const [offers] = await db.execute<(RowDataPacket & {
      by_actor: number | string;
      teams_to_player: number | string;
      former_member: number | string;
    })[]>(
      `SELECT COUNT(DISTINCT CASE WHEN created_by = ? THEN user_id END) AS by_actor,
              COUNT(DISTINCT CASE WHEN user_id = ? THEN team_id END) AS teams_to_player,
              ${formerMemberSql} AS former_member
       FROM bg_team_invitations
       WHERE (user_id = ? OR created_by = ?)
         AND kind = 'INVITE' AND COALESCE(JSON_CONTAINS(roles_json, '"OWNER"'), 0) = 1 AND ${windowSql}`,
      [actorId, userId, teamId, userId, userId, actorId],
    );
    const budget = {
      byActor: Number(offers[0]?.by_actor ?? 0),
      teamsToThisPlayer: Number(offers[0]?.teams_to_player ?? 0),
      formerMember: Number(offers[0]?.former_member ?? 0) === 1,
    };
    if (!withinGhostClaimNoticeBudget(budget)) return;
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
  // Une fois par équipe, par joueur et par sorte d'avis dans la fenêtre :
  // invitation retirée puis renvoyée, reprise refaite, propriété que deux
  // membres se renvoient n'écrivent qu'une fois. Compté sur les avis
  // **partis** (en mémoire), pas sur les lignes écrites : une invitation
  // restée muette (compte suspendu, plafond) ne retient plus l'avis suivant.
  // Réservé une fois l'avis décidé : un compte suspendu ne consomme rien.
  const claimedAt = Date.now();
  if (!claimTeamNoticeSlot(kind, teamId, userId, claimedAt)) return;
  const report = await sendTeamInviteNotice(kind, teamId, account, team.name, claimedAt);
  if (report.discord === null && report.discordUnreachedUserIds.length > 0) {
    console.warn(`[teams] bot injoignable : message privé d'équipe non remis (${kind})`);
  }
}

/**
 * Envoie l'avis (push et message privé). Propriété : rien de remis (bot tombé,
 * aucun appareil) ou erreur, la place réservée est rendue — le prochain
 * transfert dans la fenêtre pourra prévenir.
 */
async function sendTeamInviteNotice(
  kind: TeamInviteNoticeKind,
  teamId: number,
  account: Parameters<typeof teamInviteNoticeRecipient>[0],
  teamName: string,
  claimedAt: number,
): Promise<NotificationReport> {
  const url = `${siteCanonicalBase()}${teamInviteNoticePath(kind, teamId)}`;
  const proven = teamInviteNoticeRecipient(account);
  // Au-delà du plafond horaire du site, le push seul : rien ne part sur Discord.
  const recipient = proven.discord && !claimTeamNoticeDmSlot(claimedAt) ? { ...proven, discord: null } : proven;
  const release = () => releaseTeamNoticeSlot(kind, teamId, recipient.userId, claimedAt);
  let report: NotificationReport;
  try {
    report = await notifyUsers([recipient], {
      topic: "TEAM_INVITATION",
      discord: {
        message: (locale) => formatTeamInviteNotice({ kind, teamName, url }, locale),
        context: "team-invitation",
      },
      push: (locale) => teamInvitationPush({ kind, teamId, teamName }, locale),
    });
  } catch (error) {
    release();
    throw error;
  }
  if ((report.discord?.sent ?? 0) === 0 && report.pushed === 0) release();
  return report;
}

/**
 * Dernier avis par sorte, équipe et destinataire (`kind:teamId:userId` → ms),
 * en mémoire : une invitation retirée puis renvoyée, une reprise refaite, une
 * équipe renvoyée de main en main n'écrivent qu'une fois par
 * `TEAM_INVITE_NOTICE_COOLDOWN_HOURS` au même joueur (revue sécurité #544). Un
 * redémarrage l'oublie — au pire un avis de plus, à un joueur que l'équipe
 * sollicite déjà.
 */
const teamNotices = new Map<string, number>();
/** Au-delà, les avis les plus anciens sont oubliés : la mémoire reste bornée. */
const TEAM_NOTICE_MEMORY = 1000;

/**
 * Réserve l'avis `kind` de `userId` pour `teamId` : `false` si un avis est déjà
 * parti dans la fenêtre. Réservé avant l'envoi : deux gestes simultanés
 * n'écrivent qu'une fois.
 */
export function claimTeamNoticeSlot(
  kind: TeamInviteNoticeKind,
  teamId: number,
  userId: number,
  now: number = Date.now(),
): boolean {
  const key = `${kind}:${teamId}:${userId}`;
  const windowMs = TEAM_INVITE_NOTICE_COOLDOWN_HOURS * 3_600_000;
  const last = teamNotices.get(key);
  if (last !== undefined && now - last < windowMs) return false;
  teamNotices.delete(key);
  teamNotices.set(key, now);
  for (const [oldKey, at] of teamNotices) {
    if (teamNotices.size <= TEAM_NOTICE_MEMORY && now - at < windowMs) break;
    teamNotices.delete(oldKey);
  }
  return true;
}

/** {@link claimTeamNoticeSlot} pour un avis de propriété. */
export function claimOwnershipNoticeSlot(teamId: number, userId: number, now: number = Date.now()): boolean {
  return claimTeamNoticeSlot("OWNERSHIP", teamId, userId, now);
}

/**
 * Rend la place réservée par {@link claimTeamNoticeSlot} quand rien n'a été
 * remis — seulement si elle porte encore cette réservation (un avis plus récent
 * garde la sienne).
 */
export function releaseTeamNoticeSlot(
  kind: TeamInviteNoticeKind,
  teamId: number,
  userId: number,
  claimedAt: number,
): void {
  const key = `${kind}:${teamId}:${userId}`;
  if (teamNotices.get(key) === claimedAt) teamNotices.delete(key);
}

/** {@link releaseTeamNoticeSlot} pour un avis de propriété. */
export function releaseOwnershipNoticeSlot(teamId: number, userId: number, claimedAt: number): void {
  releaseTeamNoticeSlot("OWNERSHIP", teamId, userId, claimedAt);
}

/** Fenêtre horaire des messages privés d'équipe du site entier (début en ms, nombre partis). */
const dmWindow = { startedAt: 0, count: 0 };

/**
 * Réserve un message privé d'équipe sur le plafond horaire du site
 * ({@link TEAM_NOTICE_DMS_HOURLY_CAP}) : `false` au-delà, jusqu'à la fenêtre
 * suivante. En mémoire, comme les avis : un redémarrage la rouvre.
 */
export function claimTeamNoticeDmSlot(now: number = Date.now()): boolean {
  if (now - dmWindow.startedAt >= 3_600_000 || now < dmWindow.startedAt) {
    dmWindow.startedAt = now;
    dmWindow.count = 0;
  }
  if (dmWindow.count >= TEAM_NOTICE_DMS_HOURLY_CAP) return false;
  dmWindow.count += 1;
  return true;
}

/** Tests : oublie les avis réservés et la fenêtre horaire des messages privés. */
export function resetOwnershipNoticeSlots(): void {
  teamNotices.clear();
  dmWindow.startedAt = 0;
  dmWindow.count = 0;
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
