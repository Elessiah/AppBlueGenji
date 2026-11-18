/**
 * Notifications du planning (`docs/features/CAST_PLANNING.md` § Notifications) :
 * affectations confirmées ou manuelles, désistements et places à pourvoir.
 * Tout passe par `lib/server/notify.ts` (push + message privé Discord) ; le
 * sujet coupé coupe aussi le message privé (`dmFollowsTopic`). Ces envois ne
 * lèvent jamais : un bot injoignable ou une panne ne défait aucun geste.
 *
 * Vie privée : aucun pseudo de joueur, et aucun membre du staff nommé —
 * celui qui se désiste, son remplaçant ou l'auteur d'un geste restent
 * anonymes (`lib/shared/planning-notices.ts`).
 */
import type { RowDataPacket } from "mysql2/promise";
import { sendBotLog } from "@/lib/server/bot-integration";
import { getDatabase } from "@/lib/server/database";
import { failureReason } from "@/lib/server/failure-reason";
import { loadNotificationRecipients, notifyUsers } from "@/lib/server/notify";
import { siteCanonicalBase } from "@/lib/server/site-url";
import { activeSuspensionSql } from "@/lib/server/suspension-sql";
import { can, sanitizePlatformRoles } from "@/lib/shared/permissions";
import type { PlanningRole } from "@/lib/shared/planning";
import {
  formatPlanningAssignedDm,
  formatPlanningUnfilledDm,
  formatPlanningUnfilledLine,
  formatPlanningWithdrawalDm,
  type PlanningNoticeAssignment,
  type PlanningNoticeEntry,
  type PlanningWithdrawalNotice,
} from "@/lib/shared/planning-notices";
import { planningAssignedPush, planningUnfilledPush, planningWithdrawalPush } from "@/lib/shared/push-messages";
import type { LoadedEntry } from "./load";

/** Ce qu'une notification dit d'une entrée : ni pseudo, ni membre du staff. */
export function noticeEntry(entry: LoadedEntry): PlanningNoticeEntry {
  return {
    key: entry.key,
    kind: entry.kind,
    tournamentId: entry.tournamentId,
    tournamentName: entry.tournamentName,
    team1Name: entry.team1?.name ?? null,
    team2Name: entry.team2?.name ?? null,
    // Une entrée solo : son nom d'engagé est un pseudo, jamais écrit.
    solo: entry.team1?.soloUserId != null || entry.team2?.soloUserId != null,
    startAt: new Date(entry.startAt).toISOString(),
  };
}

/** Une affectation à annoncer : à qui, sur quelle entrée, dans quel rôle. */
export type AssignmentNotice = { userId: number; entry: LoadedEntry; role: PlanningRole };

/**
 * Annonce des affectations (`PLANNING_ASSIGNED`) : un seul message par
 * personne, qui liste toutes les siennes. L'auteur du geste n'est jamais
 * prévenu de ce qu'il vient de faire lui-même (`actorId`).
 */
export async function announceAssignments(
  items: readonly AssignmentNotice[],
  options: { actorId?: number | null; replacement?: boolean } = {},
): Promise<void> {
  try {
    const byUser = new Map<number, PlanningNoticeAssignment[]>();
    for (const item of items) {
      if (item.userId === options.actorId) continue;
      const list = byUser.get(item.userId) ?? [];
      list.push({ ...noticeEntry(item.entry), role: item.role });
      byUser.set(item.userId, list);
    }
    if (byUser.size === 0) return;
    const recipients = await loadNotificationRecipients([...byUser.keys()], "proven");
    const base = siteCanonicalBase();
    const replacement = options.replacement === true;
    for (const recipient of recipients) {
      const list = (byUser.get(recipient.userId) ?? []).sort((a, b) => a.startAt.localeCompare(b.startAt));
      if (list.length === 0) continue;
      await notifyUsers([recipient], {
        topic: "PLANNING_ASSIGNED",
        push: (locale) => planningAssignedPush(list, locale, replacement),
        discord: {
          message: (locale) => formatPlanningAssignedDm(list, base, locale, replacement),
          context: replacement ? "planning-replacement" : "planning-assigned",
        },
        dmFollowsTopic: true,
      });
    }
  } catch (error) {
    console.error("[planning] annonce des affectations impossible.", failureReason(error));
  }
}

/** Un désistement à annoncer : l'entrée, le rôle quitté, et son issue. */
export type WithdrawalAnnouncement = {
  entry: LoadedEntry;
  role: PlanningRole;
  late: boolean;
  /** Qui s'est désisté : jamais prévenu de son propre geste. */
  withdrawnUserId: number;
  /** Remplaçant affecté (prévenu à part, `PLANNING_ASSIGNED`), ou `null`. */
  replacementId: number | null;
  /**
   * La place reste à pourvoir : ni remplaçant, ni arbitre posé entre-temps sur
   * le match par une autre voie. Faux : le rôle est tenu.
   */
  unfilled: boolean;
  /** Les autres affectés de l'entrée (tenus, ni le désisté ni le remplaçant). */
  coAssignedIds: readonly number[];
};

/**
 * Désistement d'une attribution **confirmée** : les autres affectés de
 * l'entrée (`PLANNING_WITHDRAWAL`), le remplaçant (`PLANNING_ASSIGNED`), ou
 * le staff des tournois quand la place reste à pourvoir (`PLANNING_UNFILLED`).
 */
export async function announceWithdrawal(input: WithdrawalAnnouncement): Promise<void> {
  const notice: PlanningWithdrawalNotice = {
    ...noticeEntry(input.entry),
    role: input.role,
    replaced: !input.unfilled,
    late: input.late,
  };
  try {
    const others = [...new Set(input.coAssignedIds)].filter((id) => id !== input.replacementId && id !== input.withdrawnUserId);
    if (others.length > 0) {
      const recipients = await loadNotificationRecipients(others, "proven");
      const base = siteCanonicalBase();
      await notifyUsers(recipients, {
        topic: "PLANNING_WITHDRAWAL",
        push: (locale) => planningWithdrawalPush(notice, locale),
        discord: { message: (locale) => formatPlanningWithdrawalDm(notice, base, locale), context: "planning-withdrawal" },
        dmFollowsTopic: true,
      });
    }
  } catch (error) {
    console.error("[planning] annonce d'un désistement impossible.", failureReason(error));
  }
  if (input.replacementId !== null) {
    await announceAssignments([{ userId: input.replacementId, entry: input.entry, role: input.role }], { replacement: true });
    return;
  }
  if (input.unfilled) await announceUnfilled(notice, input.withdrawnUserId);
}

type StaffRow = RowDataPacket & { id: number; is_admin: number; platform_roles_json: unknown };

/**
 * Le staff des tournois (permission `tournaments`, la même qui lit les
 * tournois cachés) : comptes non supprimés, non suspendus, hors `excluded`.
 */
export async function loadTournamentStaffIds(excluded: readonly number[] = []): Promise<number[]> {
  const db = await getDatabase();
  const [rows] = await db.query<StaffRow[]>(
    `SELECT u.id, u.is_admin, u.platform_roles_json FROM bg_users u
      WHERE u.is_deleted = 0
        AND (u.is_admin = 1 OR u.platform_roles_json IS NOT NULL)
        AND NOT EXISTS (SELECT 1 FROM bg_account_suspensions sus
                         WHERE sus.user_id = u.id AND ${activeSuspensionSql("sus")})`,
  );
  const skip = new Set(excluded);
  return rows
    .filter((row) => !skip.has(Number(row.id)))
    .filter((row) => can({ isAdmin: Number(row.is_admin) === 1, roles: sanitizePlatformRoles(row.platform_roles_json) }, "tournaments"))
    .map((row) => Number(row.id));
}

/**
 * Place à pourvoir : une ligne sans nom au journal du staff sur Discord, et
 * le staff des tournois prévenu (push **et** message privé, dans sa langue).
 * Ce staff voit les tournois cachés : rien n'atteint qui ne peut pas voir
 * l'entrée. Couper le sujet coupe aussi le message privé (`dmFollowsTopic`).
 * Celui qui s'est désisté n'est pas prévenu de son propre geste.
 */
async function announceUnfilled(notice: PlanningWithdrawalNotice, withdrawnUserId: number): Promise<void> {
  try {
    const base = siteCanonicalBase();
    sendBotLog(formatPlanningUnfilledLine(notice, base), { tournamentId: notice.tournamentId, category: "referees" });
    const recipients = await loadNotificationRecipients(await loadTournamentStaffIds([withdrawnUserId]), "proven");
    if (recipients.length === 0) return;
    await notifyUsers(recipients, {
      topic: "PLANNING_UNFILLED",
      push: (locale) => planningUnfilledPush(notice, locale),
      discord: { message: (locale) => formatPlanningUnfilledDm(notice, base, locale), context: "planning-unfilled" },
      dmFollowsTopic: true,
    });
  } catch (error) {
    console.error("[planning] annonce d'une place à pourvoir impossible.", failureReason(error));
  }
}
