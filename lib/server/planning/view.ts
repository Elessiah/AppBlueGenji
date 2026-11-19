/**
 * La page « Planning » (`GET /api/planning`) : entrées, attributions,
 * couverture, disponibilités du lecteur — et, pour le staff des tournois,
 * celles de tous.
 */
import type { RowDataPacket } from "mysql2/promise";
import type { AuthUser } from "@/lib/server/auth";
import { withConnection } from "@/lib/server/database";
import { can, canComputePlanning } from "@/lib/shared/permissions";
import { PLANNING_ROLES, planningRolesOf, withdrawableRoles, type PlanningRole } from "@/lib/shared/planning";
import { planningConfirmAt } from "@/lib/shared/schedule-deadline";
import type { PlanningAssignmentShown, PlanningAssignmentView, PlanningEntryView, PlanningName, PlanningView } from "@/lib/shared/planning-view";
import { visibleText } from "@/lib/shared/visible-text";
import {
  loadPlanningData,
  loadPlanningMembers,
  coveringSoloCasterIds,
  loadPlanningMembersByIds,
  type Executor,
  type LoadedEntry,
  type LoadedMember,
  type LoadedWithdrawal,
  type PlanningData,
} from "./load";
import { autoConfirmAwaiting, loadedPendingRoles, readStoredAutoConfirms, type PendingRoles } from "./auto-confirm";
import { entryAssignments, entryCoverage } from "./model";
import { loadEntryRounds, type RoundRequest } from "./round-names";

/**
 * Durée de la copie de la **liste** des comptes qui tiennent un rôle du
 * planning : elle évite de repasser, à chaque chargement de page, sur toute la
 * table des comptes (les rôles se cherchent dans du JSON). Seuls les
 * identifiants en sont gardés : à chaque page, ces comptes se relisent par
 * leur clé (pseudo, rôles, réglage « caster autonome »), et un compte supprimé
 * ou qui a perdu son rôle n'est plus rendu, dès le chargement suivant. Un
 * rôle **accordé** apparaît, lui, au plus tard au bout de ce délai.
 */
export const PLANNING_MEMBERS_TTL_MS = 30 * 1000;

let membersCache: { at: number; ids: number[] } | null = null;

/** Oublie la copie de la liste des comptes (tests). */
export function resetPlanningMembersCache(): void {
  membersCache = null;
}

async function pageMembers(connection: Executor, now: number): Promise<LoadedMember[]> {
  if (membersCache && now >= membersCache.at && now - membersCache.at < PLANNING_MEMBERS_TTL_MS) {
    return loadPlanningMembersByIds(connection, membersCache.ids);
  }
  const members = await loadPlanningMembers(connection);
  membersCache = { at: now, ids: members.map((member) => member.userId) };
  return members;
}

/**
 * Ce qu'une attribution dit de sa raison. « Préférence » et « Charge » disent
 * ce que la personne a demandé (ou non) : seuls le staff des tournois et la
 * personne elle-même le lisent ; pour les autres, une proposition du calcul
 * est « Calcul », sans plus.
 */
export function visibleAssignment(row: PlanningAssignmentView, readerId: number, canManage: boolean): PlanningAssignmentShown {
  if (canManage || row.userId === readerId) return row;
  // Liste blanche : un motif ajouté plus tard reste masqué tant qu'il n'y est pas.
  return SHARED_REASONS.has(row.reason) ? row : { ...row, reason: "AUTO" };
}

/** Motifs qui ne disent rien de ce que la personne a déclaré : lisibles de tous. */
const SHARED_REASONS: ReadonlySet<PlanningAssignmentView["reason"]> = new Set<PlanningAssignmentView["reason"]>(["MANUAL", "CAST", "MATCH"]);

/**
 * Rôles « à pourvoir » d'une entrée encore modifiable : un désistement d'une
 * attribution **confirmée** sur ce rôle, et plus personne qui le tienne
 * (proposition provisoire non comprise).
 */
export function unfilledRoles(
  entry: Pick<LoadedEntry, "editable">,
  assignments: readonly PlanningAssignmentView[],
  withdrawals: readonly LoadedWithdrawal[],
): PlanningRole[] {
  if (!entry.editable) return [];
  const roles = new Set(withdrawals.filter((row) => row.confirmed).map((row) => row.role));
  return PLANNING_ROLES.filter((role) => roles.has(role) && !assignments.some((row) => row.role === role && !row.provisional));
}

/** Les lignes regroupées par entrée, en un seul passage. */
function groupByEntry<T extends { entryKey: string }>(rows: readonly T[]): Map<string, T[]> {
  const byEntry = new Map<string, T[]>();
  for (const row of rows) {
    const list = byEntry.get(row.entryKey);
    if (list) list.push(row);
    else byEntry.set(row.entryKey, [row]);
  }
  return byEntry;
}

/**
 * Confirmation d'office d'une entrée ouverte : l'instant (ISO) tant qu'il est
 * à venir, ou passé alors qu'une confirmation d'office reste à faire
 * (`awaiting`, `autoConfirmAwaiting` ; `confirmPending` : en attente —
 * semaine en échec, reprise plus tard) ; `null` pour une entrée close, ou
 * passée sans rien que le balayage reprendra (un reste qu'il n'a pas pu
 * confirmer se confirme à la main).
 */
export function entryConfirmState(
  entry: Pick<LoadedEntry, "open" | "startAt" | "deadlineAt">,
  leadHours: number,
  now: number,
  awaiting: boolean,
): { confirmAt: string | null; confirmPending: boolean } {
  if (!entry.open) return { confirmAt: null, confirmPending: false };
  const at = planningConfirmAt(entry.startAt, entry.deadlineAt, leadHours);
  if (at > now) return { confirmAt: new Date(at).toISOString(), confirmPending: false };
  return awaiting ? { confirmAt: new Date(at).toISOString(), confirmPending: true } : { confirmAt: null, confirmPending: false };
}

/**
 * Les entrées dont la carte doit consulter la marque de confirmation
 * d'office : ouvertes, instant de confirmation atteint, et des propositions
 * provisoires en base. Les autres n'en ont pas besoin — la lecture des
 * marques est le plus souvent évitée.
 */
export function entriesNeedingMark(
  entries: readonly Pick<LoadedEntry, "key" | "open" | "startAt" | "deadlineAt">[],
  pending: ReadonlyMap<string, PendingRoles>,
  leadHours: number,
  now: number,
): string[] {
  return entries
    .filter((entry) => entry.open && pending.has(entry.key) && planningConfirmAt(entry.startAt, entry.deadlineAt, leadHours) <= now)
    .map((entry) => entry.key);
}

/**
 * Le pseudo des comptes que la page montre sans qu'ils soient membres du
 * planning : un invité (`CAST_PLANNING.md` § Invités) ou un compte qui a perdu
 * son rôle, encore porté par une attribution (inscription de cast d'un match,
 * historique) ou, pour le staff des tournois, par un désistement. Sans lui, la
 * page les montrait en `#id`. Comptes supprimés exclus.
 */
async function loadOtherNames(
  executor: Executor,
  data: PlanningData,
  assignmentsByEntry: ReadonlyMap<string, readonly { userId: number }[]>,
  canManage: boolean,
): Promise<PlanningName[]> {
  const members = new Set(data.members.map((member) => member.userId));
  const ids = new Set<number>();
  for (const rows of assignmentsByEntry.values()) {
    for (const row of rows) if (!members.has(row.userId)) ids.add(row.userId);
  }
  if (canManage) for (const row of data.withdrawals) if (!members.has(row.userId)) ids.add(row.userId);
  if (ids.size === 0) return [];
  // Borné par les attributions et désistements des entrées déjà lues (la fenêtre du planning), jamais par l'historique.
  const list = [...ids];
  const [rows] = await executor.execute<(RowDataPacket & { id: number; pseudo: string })[]>(
    `SELECT id, pseudo FROM bg_users WHERE is_deleted = 0 AND id IN (${list.map(() => "?").join(", ")})`,
    list,
  );
  return rows.map((row) => ({ userId: Number(row.id), pseudo: visibleText(row.pseudo) }));
}

export async function loadPlanningView(user: AuthUser, now: number = Date.now()): Promise<PlanningView> {
  const canManage = can(user, "tournaments");
  const canCompute = canComputePlanning(user);
  const { data, pending, marks, rounds, names, assignmentsByEntry } = await withConnection(async (connection) => {
    const loaded = await loadPlanningData(connection, {
      now,
      includeHidden: canManage,
      members: await pageMembers(connection, now),
      ...(canManage ? {} : { availabilityOf: user.id }),
    });
    // Comptées sur les lignes en base, comme le balayage (`sweepAutoConfirms`) : la carte et la reprise s'accordent.
    const pending = loadedPendingRoles(loaded.assignments);
    const keys = entriesNeedingMark(loaded.entries, pending, loaded.durations.confirmLeadHours, now);
    const requests: RoundRequest[] = [];
    for (const entry of loaded.entries) {
      if (entry.matchId !== null) requests.push({ tournamentId: entry.tournamentId, matchId: entry.matchId, finished: entry.tournamentFinished });
    }
    // Calculées une fois : les noms des non-membres et les cartes les lisent toutes deux.
    const assignmentsByEntry = new Map(loaded.entries.map((entry) => [entry.key, entryAssignments(entry, loaded)]));
    // Une seule connexion : ses requêtes se suivent de toute façon, les lancer « ensemble » n'y gagnerait rien.
    const rounds = await loadEntryRounds(connection, requests, now);
    const names = await loadOtherNames(connection, loaded, assignmentsByEntry, canManage);
    const marks = await readStoredAutoConfirms(connection, keys);
    return { data: loaded, pending, marks, rounds, names, assignmentsByEntry };
  });
  // Un caster autonome suspendu ne couvre plus seul son créneau aux yeux du staff, comme pour le calcul
  // (`preparePlanner`) ; les autres lecteurs gardent la couverture d'avant (rien n'y trahit la suspension).
  const solo = coveringSoloCasterIds(data.members, canManage);
  // Pour le staff seul, un compte suspendu ne tient pas une place quittée : elle se montre « à pourvoir », comme
  // l'alerte qu'il a reçue (`staffUnfilled`) ; les autres lecteurs ne lisent rien de la suspension.
  const suspended = new Set(canManage ? data.members.filter((member) => member.suspended).map((member) => member.userId) : []);
  const availabilityByEntry = groupByEntry(data.availability);
  const withdrawalsByEntry = groupByEntry(data.withdrawals);
  const entries: PlanningEntryView[] = data.entries.map((entry) => {
    const assignments = assignmentsByEntry.get(entry.key) ?? entryAssignments(entry, data);
    const availability = availabilityByEntry.get(entry.key) ?? [];
    return {
      key: entry.key,
      kind: entry.kind,
      tournamentId: entry.tournamentId,
      tournamentName: entry.tournamentName,
      game: entry.game,
      matchId: entry.matchId,
      roundNumber: entry.roundNumber,
      round: entry.matchId === null ? null : (rounds.get(entry.matchId)?.round ?? null),
      matchNumber: entry.matchId === null ? null : (rounds.get(entry.matchId)?.matchNumber ?? null),
      team1: entry.team1,
      team2: entry.team2,
      startAt: new Date(entry.startAt).toISOString(),
      endAt: new Date(entry.endAt).toISOString(),
      open: entry.open,
      editable: entry.editable,
      hidden: entry.hidden,
      channelUrl: entry.channelUrl,
      selfManaged: entry.selfManaged,
      deadlineAt: entry.deadlineAt === null ? null : new Date(entry.deadlineAt).toISOString(),
      ...entryConfirmState(
        entry,
        data.durations.confirmLeadHours,
        now,
        autoConfirmAwaiting(entry.startAt, pending.get(entry.key) ?? {}, marks.get(entry.key)),
      ),
      assignments: assignments.map((row) => visibleAssignment(row, user.id, canManage)),
      // Pour le staff, un compte suspendu ne tient rien (comme pour le calcul, `preparePlanner`, et l'alerte) ;
      // les autres lecteurs gardent la couverture d'avant.
      coverage: entryCoverage(canManage ? assignments.filter((row) => !suspended.has(row.userId)) : assignments, solo),
      mine: availability
        .filter((row) => row.userId === user.id)
        .map(({ userId, role, status, preferred }) => ({ userId, role, status, preferred })),
      // Défense en profondeur : sans `tournaments`, la lecture ne rend déjà que les siennes.
      availability: canManage
        ? availability.map(({ userId, role, status, preferred }) => ({ userId, role, status, preferred }))
        : [],
      unfilled: unfilledRoles(entry, canManage ? assignments.filter((row) => !suspended.has(row.userId)) : assignments, withdrawalsByEntry.get(entry.key) ?? []),
      // Motif et auteur d'un désistement : au staff des tournois seul.
      withdrawals: canManage
        ? (withdrawalsByEntry.get(entry.key) ?? []).map(({ userId, role, late, reason, confirmed, staffRelease, createdAt }) => ({
            userId,
            role,
            late,
            reason,
            confirmed,
            // Sortie d'un invité par le staff : ce n'est pas lui qui s'est désisté.
            ...(staffRelease ? { staffRelease: true as const } : {}),
            createdAt,
          }))
        : [],
    };
  });
  return {
    me: user.id,
    myRoles: planningRolesOf(user),
    withdrawRoles: withdrawableRoles(user),
    canManage,
    canCompute,
    entries,
    // Champs nommés : ce que la page montre, rien de plus (`seesHidden` au staff seul, qui choisit les candidats).
    members: data.members.map(({ userId, pseudo, roles, soloCaster, seesHidden }) =>
      canManage ? { userId, pseudo, roles, soloCaster, seesHidden } : { userId, pseudo, roles, soloCaster },
    ),
    // Les comptes montrés sans être membres (invité, rôle retiré) : leur nom, rien de plus.
    ...(names.length > 0 ? { names } : {}),
    // Réglages du calcul : à l'administrateur seul, les autres n'en reçoivent rien.
    ...(canCompute ? { durations: data.durations } : {}),
  };
}
