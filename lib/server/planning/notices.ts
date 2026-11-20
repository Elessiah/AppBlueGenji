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
import { sendBotLog } from "@/lib/server/bot-integration";
import { createKeyedChain } from "@/lib/server/coalescer";
import { failureReason } from "@/lib/server/failure-reason";
import { loadNotificationRecipients, loadStaffIds, notifyUsers } from "@/lib/server/notify";
import { siteCanonicalBase } from "@/lib/server/site-url";
import { publishStaffAction } from "@/lib/server/staff-audit";
import { formatSoloCasterChangeLog } from "@/lib/shared/bot-logs";
import type { StaffActor } from "@/lib/shared/log-privacy";
import type { PlanningRole } from "@/lib/shared/planning";
import {
  formatPlanningAssignedDm,
  formatPlanningSoloCasterDm,
  formatPlanningUnfilledDm,
  formatPlanningUnfilledLine,
  formatPlanningWithdrawalDm,
  type PlanningNoticeAssignment,
  type PlanningNoticeEntry,
  type PlanningWithdrawalNotice,
} from "@/lib/shared/planning-notices";
import {
  planningAssignedPush,
  planningSoloCasterPush,
  planningUnfilledPush,
  planningWithdrawalPush,
} from "@/lib/shared/push-messages";
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

/** Envois d'affectations lancés en même temps. */
const ASSIGNMENT_SEND_CONCURRENCY = 4;

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
    const recipients = await loadNotificationRecipients([...byUser.keys()], "proven", { excludeSuspended: true, planningMembersOnly: true });
    const base = siteCanonicalBase();
    const replacement = options.replacement === true;
    // Les personnes qui reçoivent la même liste partent en un envoi (une
    // confirmation de semaine en groupe : quelques envois, non un par membre).
    const groups = new Map<string, { list: PlanningNoticeAssignment[]; recipients: typeof recipients }>();
    for (const recipient of recipients) {
      const list = (byUser.get(recipient.userId) ?? []).sort((a, b) => a.startAt.localeCompare(b.startAt));
      if (list.length === 0) continue;
      const signature = list.map((item) => `${item.key}:${item.role}`).join("|");
      const group = groups.get(signature) ?? { list, recipients: [] };
      group.recipients.push(recipient);
      groups.set(signature, group);
    }
    const batches = [...groups.values()];
    // Par paquets : les envois partent ensemble, sans inonder le bot ni la base.
    for (let index = 0; index < batches.length; index += ASSIGNMENT_SEND_CONCURRENCY) {
      await Promise.all(
        batches.slice(index, index + ASSIGNMENT_SEND_CONCURRENCY).map(({ list, recipients: group }) =>
          notifyUsers(group, {
            topic: "PLANNING_ASSIGNED",
            push: (locale) => planningAssignedPush(list, locale, replacement),
            discord: {
              message: (locale) => formatPlanningAssignedDm(list, base, locale, replacement),
              context: replacement ? "planning-replacement" : "planning-assigned",
            },
            dmFollowsTopic: true,
          }),
        ),
      );
    }
  } catch (error) {
    console.error("[planning] annonce des affectations impossible.", failureReason(error));
  }
}

const soloCasterNotices = createKeyedChain<number>();

/**
 * Statut de caster autonome d'un autre membre réglé par le staff : une ligne au
 * journal (anonyme sur Discord, l'auteur nommé dans pm2 — `publishStaffAction`),
 * puis l'avis au caster (`PLANNING_SOLO_CASTER`, push et message privé coupés
 * avec le sujet). La route n'appelle ceci que pour un réglage **changé** sur le
 * compte d'un autre : ni le sien, ni une valeur reposée. Ne lève jamais.
 */
async function deliverSoloCasterChange(targetUserId: number, solo: boolean, actor: StaffActor): Promise<void> {
  // Le journal et l'avis échouent chacun de leur côté : une ligne Discord non
  // écrite ne prive pas le caster de son avis (l'auteur, écrit dans pm2 avant
  // l'envoi, y reste nommé).
  const line = formatSoloCasterChangeLog(solo);
  try {
    publishStaffAction(line, actor, { category: "casts", auditLine: `${line} (compte #${targetUserId})` });
  } catch (error) {
    console.error("[planning] journal du caster autonome impossible.", failureReason(error));
  }
  try {
    // Un compte suspendu n'est prévenu de rien du planning (T20), comme les autres avis.
    const recipients = await loadNotificationRecipients([targetUserId], "proven", { excludeSuspended: true, planningMembersOnly: true });
    if (recipients.length === 0) return;
    const base = siteCanonicalBase();
    await notifyUsers(recipients, {
      topic: "PLANNING_SOLO_CASTER",
      push: (locale) => planningSoloCasterPush(solo, locale),
      discord: {
        message: (locale) => formatPlanningSoloCasterDm(solo, base, locale),
        context: "planning-solo-caster",
      },
      dmFollowsTopic: true,
    });
  } catch (error) {
    console.error("[planning] avis du caster autonome impossible.", failureReason(error));
  }
}

/**
 * Annonce un réglage changé, **dans l'ordre des gestes** pour un même caster
 * (`createKeyedChain`) : activer, désactiver, activer ne laisse pas arriver un
 * « désactivé » en dernier. Ne lève jamais.
 */
export function announceSoloCasterChange(targetUserId: number, solo: boolean, actor: StaffActor): Promise<void> {
  return soloCasterNotices.chain(targetUserId, () => deliverSoloCasterChange(targetUserId, solo, actor));
}

/** Un désistement à annoncer : l'entrée, le rôle quitté, et son issue. */
export type WithdrawalAnnouncement = {
  entry: LoadedEntry;
  role: PlanningRole;
  late: boolean;
  /** Qui s'est désisté : jamais prévenu de son propre geste. */
  withdrawnUserId: number;
  /**
   * Sortie d'un invité par le staff (`releaseGuestPlanning`) : les avis disent « retiré du planning », pas
   * « s'est désisté ». Absent : faux.
   */
  released?: boolean;
  /** Le staff auteur de cette sortie : jamais prévenu de son propre geste (désistement ni place à pourvoir). */
  actorId?: number | null;
  /** Remplaçant affecté (prévenu à part, `PLANNING_ASSIGNED`), ou `null`. */
  replacementId: number | null;
  /**
   * La place reste à pourvoir : ni remplaçant, ni arbitre posé entre-temps sur
   * le match par une autre voie. Faux : le rôle est tenu.
   */
  unfilled: boolean;
  /**
   * Pas de remplaçant, mais ces autres casters confirmés tiennent encore
   * l'entrée (second caster) : la place n'est pas à pourvoir. Ils apprennent
   * qu'ils restent affectés ; les autres, qu'un autre caster reste. Absent : vide.
   */
  stillHeldBy?: readonly number[];
  /**
   * Avec `unfilled` : le départ d'un caster autonome a fait perdre la
   * diffusion (le caster restant attend un prod ou un caster autonome). Absent : faux.
   */
  streamLost?: boolean;
  /**
   * La place vue du staff des tournois, qui seule déclenche son alerte : un
   * compte suspendu n'y tient rien, ce que les autres membres n'apprennent
   * pas (`unfilled`, `stillHeldBy` restent leur lecture). `null` : rien à
   * pourvoir. Absent : la lecture des membres (`unfilled`, `streamLost`).
   */
  staffUnfilled?: { streamLost: boolean } | null;
  /** Les autres affectés de l'entrée (tenus, ni le désisté ni le remplaçant). */
  coAssignedIds: readonly number[];
};

/**
 * Désistement d'une attribution **confirmée** : les autres affectés de
 * l'entrée (`PLANNING_WITHDRAWAL`), le remplaçant (`PLANNING_ASSIGNED`), ou
 * le staff des tournois quand la place reste à pourvoir (`PLANNING_UNFILLED`).
 */
export async function announceWithdrawal(input: WithdrawalAnnouncement): Promise<void> {
  const stillHeldBy = new Set(input.stillHeldBy ?? []);
  const stillHeld = stillHeldBy.size > 0;
  const notice: PlanningWithdrawalNotice = {
    ...noticeEntry(input.entry),
    role: input.role,
    replaced: !input.unfilled && !stillHeld,
    stillHeld,
    streamLost: input.unfilled && input.streamLost === true,
    late: input.late,
    ...(input.released === true ? { released: true } : {}),
  };
  const actorId = input.actorId ?? null;
  try {
    const others = [...new Set(input.coAssignedIds)].filter(
      (id) => id !== input.replacementId && id !== input.withdrawnUserId && id !== actorId,
    );
    // Le caster qui reste ne lit pas « un autre caster reste affecté » : c'est lui ; il apprend qu'il reste.
    const groups: [number[], PlanningWithdrawalNotice][] = [
      [others.filter((id) => !stillHeldBy.has(id)), notice],
      [others.filter((id) => stillHeldBy.has(id)), { ...notice, selfHeld: true }],
    ];
    const base = siteCanonicalBase();
    // Une seule lecture des destinataires, répartis ensuite entre les deux textes.
    const loaded = others.length === 0 ? [] : await loadNotificationRecipients(others, "proven", { excludeSuspended: true, planningMembersOnly: true });
    for (const [ids, text] of groups) {
      const wanted = new Set(ids);
      const recipients = loaded.filter((recipient) => wanted.has(recipient.userId));
      if (recipients.length === 0) continue;
      await notifyUsers(recipients, {
        topic: "PLANNING_WITHDRAWAL",
        push: (locale) => planningWithdrawalPush(text, locale),
        discord: { message: (locale) => formatPlanningWithdrawalDm(text, base, locale), context: "planning-withdrawal" },
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
  const staff = input.staffUnfilled === undefined ? membersUnfilled(input) : input.staffUnfilled;
  if (staff !== null) {
    const silent = actorId === null ? [input.withdrawnUserId] : [input.withdrawnUserId, actorId];
    await announceUnfilled({ ...notice, replaced: false, stillHeld: false, streamLost: staff.streamLost }, silent);
  }
}

/** La place telle que la lisent les membres, quand aucune lecture du staff n'est donnée. */
function membersUnfilled(input: WithdrawalAnnouncement): { streamLost: boolean } | null {
  return input.unfilled ? { streamLost: input.streamLost === true } : null;
}

/**
 * Place à pourvoir : une ligne sans nom au journal du staff sur Discord (aucune pour la sortie d'un invité), et
 * le staff des tournois prévenu (push **et** message privé, dans sa langue),
 * choisi par la règle de `notifyStaff` (`loadStaffIds`).
 * Ce staff voit les tournois cachés : rien n'atteint qui ne peut pas voir
 * l'entrée. Couper le sujet coupe aussi le message privé (`dmFollowsTopic`).
 * Celui qui s'est désisté — et le staff qui a sorti un invité — n'est pas prévenu de son propre geste (`silent`).
 */
async function announceUnfilled(notice: PlanningWithdrawalNotice, silent: readonly number[]): Promise<void> {
  try {
    const base = siteCanonicalBase();
    // Sortie d'un invité : pas de ligne par place au journal du staff sur Discord — suivant de près la ligne
    // anonyme « Un compte passe invité », leur rafale désignerait le compte (qui tenait ces matchs). Le staff des
    // tournois reste prévenu ci-dessous, et la sortie est nominative dans pm2.
    if (notice.released !== true) {
      sendBotLog(formatPlanningUnfilledLine(notice, base), { tournamentId: notice.tournamentId, category: "staff-removal" });
    }
    const recipients = await loadNotificationRecipients(await loadStaffIds("tournaments", [...silent]), "proven", { excludeSuspended: true, planningMembersOnly: true });
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
