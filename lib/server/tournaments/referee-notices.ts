/**
 * Ce que le site dit quand l'arbitre désigné ou l'organisation d'un match
 * change (`docs/features/MATCH_REFEREE.md`) — sur le modèle des avis de cast
 * (`./cast-notices`) :
 *
 * - **toujours** une ligne au journal du staff sur Discord, sans personne
 *   nommée (« un arbitre », « le staff ») et sans ligne nominative dans pm2 ;
 * - **à l'arbitre**, quand un autre que lui retire son arbitrage (staff,
 *   remplacement, autogestion, opposition retenue, retrait d'office) : une notification push
 *   `REFEREE_RELEASED`, avec le motif, dans la langue de son compte. Pas de
 *   message privé Discord.
 *
 * Appelé **après le commit**, sans attendre. Ne lève jamais.
 */
import type { PoolConnection } from "mysql2/promise";
import { sendBotLog } from "@/lib/server/bot-integration";
import { loadNotificationRecipients, notifyUsers } from "@/lib/server/notify";
import { formatRefereeChangeLog, type RefereeLogChange } from "@/lib/shared/bot-logs";
import { refereeReleasedPush, type RefereeReleaseReason } from "@/lib/shared/push-messages";
import { loadMatchLogRow, matchLogSubject } from "./match-log-subject";

/** Un changement d'arbitrage ou d'organisation, constaté sous verrou. */
export type RefereeChange =
  /** Un arbitre prend le match lui-même. */
  | { kind: "TAKEN"; matchId: number }
  /** Le staff désigne un arbitre ; `replacedRefereeId` : celui qu'il remplace. */
  | { kind: "ASSIGNED"; matchId: number; replacedRefereeId: number | null }
  /** Arbitrage retiré par son arbitre (`byStaff: false`) ou par le staff. */
  | { kind: "RELEASED"; matchId: number; refereeId: number; byStaff: boolean }
  /**
   * Arbitrage retiré parce que l'opposition de l'arbitre est retenue par le
   * staff : le journal dit « retiré par le staff » (rien sur l'opposition),
   * l'avis à l'arbitre en donne le motif.
   */
  | { kind: "OBJECTION_RELEASED"; matchId: number; refereeId: number }
  /** Arbitrage retiré d'office. */
  | { kind: "AUTO_RELEASED"; matchId: number; refereeId: number; reason: "INELIGIBLE" | "JOINED_TEAM" }
  /** Autogestion allumée ou éteinte ; allumée, elle retire l'arbitre (`replacedRefereeId`). */
  | { kind: "SELF_MANAGED"; matchId: number; enabled: boolean; replacedRefereeId: number | null }
  /** Première carte posée ou retirée. */
  | { kind: "FIRST_MAP"; matchId: number; set: boolean }
  /** Carte choisie (ou retirée) dans le pool de la manche, par l'arbitrage ou une équipe (`byTeam`). */
  | { kind: "MAP_PICK"; matchId: number; set: boolean; byTeam: boolean };

/** Ligne du journal de ce changement. */
export function refereeLogChange(change: RefereeChange): RefereeLogChange {
  switch (change.kind) {
    case "TAKEN":
      return "TAKEN";
    case "ASSIGNED":
      return change.replacedRefereeId === null ? "ASSIGNED" : "SWAPPED";
    case "RELEASED":
      return change.byStaff ? "RELEASED_BY_STAFF" : "RELEASED";
    case "OBJECTION_RELEASED":
      return "RELEASED_BY_STAFF";
    case "AUTO_RELEASED":
      return change.reason;
    case "SELF_MANAGED":
      return change.enabled ? "SELF_MANAGED_ON" : "SELF_MANAGED_OFF";
    case "FIRST_MAP":
      return change.set ? "FIRST_MAP_SET" : "FIRST_MAP_CLEARED";
    case "MAP_PICK":
      if (!change.set) return "MAP_PICK_CLEARED";
      return change.byTeam ? "MAP_PICKED_BY_TEAM" : "MAP_PICKED";
  }
}

/** L'arbitre à prévenir et son motif ; `null` quand personne n'a à l'être. */
export function refereeReleaseNotice(
  change: RefereeChange,
): { refereeId: number; reason: RefereeReleaseReason } | null {
  switch (change.kind) {
    case "ASSIGNED":
      return change.replacedRefereeId === null ? null : { refereeId: change.replacedRefereeId, reason: "REPLACED" };
    case "RELEASED":
      return change.byStaff ? { refereeId: change.refereeId, reason: "STAFF" } : null;
    case "OBJECTION_RELEASED":
      return { refereeId: change.refereeId, reason: "OBJECTION" };
    case "AUTO_RELEASED":
      return { refereeId: change.refereeId, reason: change.reason };
    case "SELF_MANAGED":
      return change.replacedRefereeId === null ? null : { refereeId: change.replacedRefereeId, reason: "SELF_MANAGED" };
    default:
      return null;
  }
}

/** Le journal, puis l'avis à l'arbitre s'il en faut un. Peut lever : {@link announceRefereeChange} l'enveloppe. */
export async function deliverRefereeChange(change: RefereeChange, options: RefereeAnnounceOptions = {}): Promise<void> {
  const row = await loadMatchLogRow(change.matchId);
  if (!row) return;
  const match = matchLogSubject(row);
  // Geste groupé (autogestion d'une manche) : une seule ligne de journal pour
  // toute la manche, écrite par l'appelant ; l'avis à chaque arbitre reste.
  const log = options.log === false ? Promise.resolve() : sendBotLog(
    formatRefereeChangeLog({
      tournament: match.tournament,
      matchId: match.matchId,
      bracket: match.bracket,
      roundNumber: match.roundNumber,
      swiss: match.swiss,
      team1: match.team1,
      team2: match.team2,
      change: refereeLogChange(change),
    }),
  );
  const notice = refereeReleaseNotice(change);
  if (!notice) {
    await log;
    return;
  }
  const recipients = await loadNotificationRecipients([notice.refereeId], "certified");
  await Promise.all([
    log,
    notifyUsers(recipients, {
      topic: "REFEREE_RELEASED",
      push: (locale) =>
        refereeReleasedPush(
          {
            tournamentId: match.tournament.id,
            tournamentName: match.tournament.name,
            matchId: match.matchId,
            bracket: match.bracket,
            roundNumber: match.roundNumber,
            swiss: match.swiss,
            team1Name: row.team1_name,
            team2Name: row.team2_name,
            solo: match.participantType === "SOLO",
            reason: notice.reason,
          },
          locale,
        ),
    }),
  ]);
}

/** Options d'une annonce : `log: false` tait la ligne du journal (geste groupé). */
export type RefereeAnnounceOptions = { log?: boolean };

/** Annonce un changement d'arbitrage, sans attendre ; ne lève jamais. */
export function announceRefereeChange(change: RefereeChange, options: RefereeAnnounceOptions = {}): void {
  void deliverRefereeChange(change, options).catch((error) => console.error("[referee] changement d'arbitrage non annoncé", error));
}

/** Changements constatés au fond d'une transaction, annoncés après son commit (`./cast-notices`, même cycle). */
const pendingChanges = new WeakMap<PoolConnection, RefereeChange[]>();

export function queueRefereeChange(connection: PoolConnection, change: RefereeChange): void {
  const queued = pendingChanges.get(connection);
  if (queued) queued.push(change);
  else pendingChanges.set(connection, [change]);
}

export function discardRefereeChanges(connection: PoolConnection): void {
  pendingChanges.delete(connection);
}

export function flushRefereeChanges(connection: PoolConnection): void {
  const queued = pendingChanges.get(connection);
  pendingChanges.delete(connection);
  for (const change of queued ?? []) announceRefereeChange(change);
}
