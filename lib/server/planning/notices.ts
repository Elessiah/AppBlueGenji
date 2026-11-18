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
import { pushRefereeAlert } from "@/lib/server/bot-integration";
import { failureReason } from "@/lib/server/failure-reason";
import { loadNotificationRecipients, notifyStaff, notifyUsers } from "@/lib/server/notify";
import { siteCanonicalBase } from "@/lib/server/site-url";
import { staffAlertDm } from "@/lib/server/staff-alert-dm";
import { discordInline } from "@/lib/shared/discord-text";
import type { PlanningRole } from "@/lib/shared/planning";
import {
  formatPlanningAssignedDm,
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
  /** Remplaçant affecté (prévenu à part, `PLANNING_ASSIGNED`), ou `null` : place à pourvoir. */
  replacementId: number | null;
  /** Les autres affectés de l'entrée (tenus, ni le désisté ni le remplaçant). */
  coAssignedIds: readonly number[];
};

/**
 * Désistement d'une attribution **confirmée** : les autres affectés de
 * l'entrée (`PLANNING_WITHDRAWAL`), le remplaçant (`PLANNING_ASSIGNED`), ou
 * le staff des tournois quand la place reste à pourvoir (`PLANNING_UNFILLED`,
 * canal de logs et messages privés aux arbitres, comme une alerte d'arbitrage).
 */
export async function announceWithdrawal(input: WithdrawalAnnouncement): Promise<void> {
  const notice: PlanningWithdrawalNotice = {
    ...noticeEntry(input.entry),
    role: input.role,
    replaced: input.replacementId !== null,
    late: input.late,
  };
  try {
    const others = [...new Set(input.coAssignedIds)].filter((id) => id !== input.replacementId);
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
  await announceUnfilled(notice);
}

/** Place à pourvoir : le staff des tournois (push) et le rôle arbitre sur Discord (canal de logs, messages privés). */
async function announceUnfilled(notice: PlanningWithdrawalNotice): Promise<void> {
  try {
    const line = formatPlanningUnfilledLine(notice, siteCanonicalBase());
    // Noms passés par `discordInline` pour l'anglais du message privé (`staffAlertDm`).
    const english = planningUnfilledPush(
      {
        ...notice,
        tournamentName: discordInline(notice.tournamentName),
        team1Name: notice.team1Name === null ? null : discordInline(notice.team1Name),
        team2Name: notice.team2Name === null ? null : discordInline(notice.team2Name),
      },
      "en",
    );
    await notifyStaff({
      topic: "PLANNING_UNFILLED",
      push: (locale) => planningUnfilledPush(notice, locale),
      discord: () => pushRefereeAlert(line, "planning-unfilled", { honourCircuit: true, dmMessage: staffAlertDm(line, english) }),
    });
  } catch (error) {
    console.error("[planning] annonce d'une place à pourvoir impossible.", failureReason(error));
  }
}
