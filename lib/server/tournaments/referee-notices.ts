/**
 * Ce que le site dit quand l'arbitre désigné ou l'organisation d'un match
 * change (`docs/features/MATCH_REFEREE.md`) — sur le modèle des avis de cast
 * (`./cast-notices`) :
 *
 * - une ligne au journal du staff sur Discord, sans personne nommée
 *   (« un arbitre », « le staff ») et sans ligne nominative dans pm2 — sauf un
 *   retrait sur opposition retenue, qui n'en a **aucune** (la route de
 *   l'opposition écrit seule une ligne anonyme : nommer les matchs
 *   désignerait leur arbitre) ;
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
import type { BotLogCategory } from "@/lib/shared/bot-log-category";
import { formatRefereeChangeLog, type RefereeLogChange } from "@/lib/shared/bot-logs";
import { refereeObjectionReleasedPush, refereeReleasedPush, type RefereeReleaseReason } from "@/lib/shared/push-messages";
import { loadMatchLogRow, matchLogSubject } from "./match-log-subject";

/** Un changement d'arbitrage ou d'organisation, constaté sous verrou. */
export type RefereeChange =
  /**
   * Un arbitre prend le match lui-même. `afterRemoval` : il le reprend à un
   * arbitre devenu inéligible, retiré dans le même geste — la ligne suit
   * celle du retrait, dans la même catégorie (même lot, même minuteur).
   */
  | { kind: "TAKEN"; matchId: number; afterRemoval?: true }
  /**
   * Le staff désigne un arbitre ; `replacedRefereeId` : celui qu'il remplace ;
   * `actorId` : l'auteur du geste (l'arbitre qui se remplace n'est pas prévenu).
   */
  | { kind: "ASSIGNED"; matchId: number; replacedRefereeId: number | null; actorId?: number }
  /** Arbitrage retiré par son arbitre (`byStaff: false`) ou par le staff. */
  | { kind: "RELEASED"; matchId: number; refereeId: number; byStaff: boolean }
  /**
   * Arbitrage retiré parce que l'opposition de l'arbitre est retenue par le
   * staff : aucune ligne de journal par match (la route en écrit une seule,
   * anonyme et sans nombre), l'avis à l'arbitre en donne le motif.
   * `takenOver` : retiré hors de ce retrait en série (reprise du match par un
   * autre arbitre, lecture des contacts) — la ligne du match part alors, sous
   * le motif générique « condition d'arbitrage » (`INELIGIBLE`), qui ne dit
   * pas l'opposition.
   */
  | { kind: "OBJECTION_RELEASED"; matchId: number; refereeId: number; takenOver?: boolean }
  /** Arbitrage retiré d'office. */
  | { kind: "AUTO_RELEASED"; matchId: number; refereeId: number; reason: "INELIGIBLE" | "JOINED_TEAM" }
  /**
   * Arbitrage retiré parce que l'arbitre a demandé la suppression de son
   * compte : ligne anonyme pour le staff, aucun avis (le compte n'est plus).
   */
  | { kind: "ACCOUNT_WITHDRAWN"; matchId: number }
  /** Autogestion allumée ou éteinte ; allumée, elle retire l'arbitre (`replacedRefereeId`), l'auteur `actorId`. */
  | { kind: "SELF_MANAGED"; matchId: number; enabled: boolean; replacedRefereeId: number | null; actorId?: number }
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
      return change.takenOver ? "INELIGIBLE" : "RELEASED_BY_STAFF";
    case "AUTO_RELEASED":
      return change.reason;
    case "ACCOUNT_WITHDRAWN":
      return "ACCOUNT_WITHDRAWN";
    case "SELF_MANAGED":
      return change.enabled ? "SELF_MANAGED_ON" : "SELF_MANAGED_OFF";
    case "FIRST_MAP":
      return change.set ? "FIRST_MAP_SET" : "FIRST_MAP_CLEARED";
    case "MAP_PICK":
      if (!change.set) return "MAP_PICK_CLEARED";
      return change.byTeam ? "MAP_PICKED_BY_TEAM" : "MAP_PICKED";
  }
}

/**
 * Catégorie de la ligne de journal : `staff-removal` (alerte) quand un arbitre
 * est retiré et que le match reste sans arbitre — retrait, retrait d'office,
 * autogestion qui l'écarte —, `referees` (trace) sinon : une désignation qui
 * remplace le titulaire repourvoit le créneau dans la même transaction, il n'y
 * a rien à repourvoir.
 */
export function refereeLogCategory(change: RefereeChange): BotLogCategory {
  switch (change.kind) {
    case "RELEASED":
    case "OBJECTION_RELEASED":
    case "AUTO_RELEASED":
    case "ACCOUNT_WITHDRAWN":
      return "staff-removal";
    case "ASSIGNED":
      return "referees";
    case "SELF_MANAGED":
      return change.replacedRefereeId === null ? "referees" : "staff-removal";
    case "TAKEN":
      return change.afterRemoval ? "staff-removal" : "referees";
    case "FIRST_MAP":
    case "MAP_PICK":
      return "referees";
    default:
      return assertNever(change);
  }
}

/** Contrôle d'exhaustivité : un nouveau cas de `RefereeChange` ne compile pas sans sa catégorie. */
function assertNever(change: never): never {
  throw new Error(`changement d'arbitrage inconnu : ${JSON.stringify(change)}`);
}

/**
 * L'arbitre à prévenir et son motif ; `null` quand personne n'a à l'être —
 * notamment quand il est lui-même l'auteur du geste (il se remplace, ou passe
 * son match en autogestion) : seul un retrait par un autre que lui est annoncé.
 */
export function refereeReleaseNotice(
  change: RefereeChange,
): { refereeId: number; reason: RefereeReleaseReason } | null {
  switch (change.kind) {
    case "ASSIGNED":
      if (change.replacedRefereeId === null || change.replacedRefereeId === change.actorId) return null;
      return { refereeId: change.replacedRefereeId, reason: "REPLACED" };
    case "RELEASED":
      return change.byStaff ? { refereeId: change.refereeId, reason: "STAFF" } : null;
    case "OBJECTION_RELEASED":
      return { refereeId: change.refereeId, reason: "OBJECTION" };
    case "AUTO_RELEASED":
      return { refereeId: change.refereeId, reason: change.reason };
    case "SELF_MANAGED":
      if (change.replacedRefereeId === null || change.replacedRefereeId === change.actorId) return null;
      return { refereeId: change.replacedRefereeId, reason: "SELF_MANAGED" };
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
  // Opposition retenue : aucune ligne par match — N matchs nommés juste avant
  // la ligne anonyme de la route désigneraient leur arbitre comme celui qui
  // s'oppose ; seule cette ligne, sans nombre, part sur Discord.
  // Hors de ce retrait en série (`takenOver`), la ligne du match part, motif générique.
  const silent = options.log === false || (change.kind === "OBJECTION_RELEASED" && !change.takenOver);
  if (!silent) sendBotLog(
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
    { tournamentId: match.tournament.id, category: refereeLogCategory(change) },
  );
  const notice = refereeReleaseNotice(change);
  if (!notice) return;
  const recipients = await loadNotificationRecipients([notice.refereeId], "certified");
  await notifyUsers(recipients, {
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
  });
}

/**
 * Avis **récapitulatif** du balayage d'une opposition retenue
 * (`referee-objection.ts`) : un seul push pour les `count` matchs retirés, au
 * lieu d'un par match. Aucune ligne de journal (comme un `OBJECTION_RELEASED`
 * de ce balayage, la ligne anonyme de la route suffit). Ne lève jamais.
 */
export async function announceObjectionReleases(
  refereeId: number,
  count: number,
  tournamentIds: readonly number[],
): Promise<void> {
  if (count === 0) return;
  try {
    const recipients = await loadNotificationRecipients([refereeId], "certified");
    await notifyUsers(recipients, {
      topic: "REFEREE_RELEASED",
      push: (locale) => refereeObjectionReleasedPush({ count, tournamentIds }, locale),
    });
  } catch (error) {
    console.error("[referee] retraits sur opposition non annoncés", error);
  }
}

/** Options d'une annonce : `log: false` tait la ligne du journal (geste groupé). */
export type RefereeAnnounceOptions = { log?: boolean };

/** Annonce un changement d'arbitrage, sans attendre ; ne lève jamais. */
export function announceRefereeChange(change: RefereeChange, options: RefereeAnnounceOptions = {}): void {
  void deliverRefereeChange(change, options).catch((error) => console.error("[referee] changement d'arbitrage non annoncé", error));
}

/**
 * Annonce plusieurs changements **l'un après l'autre**, sans attendre l'appelant
 * (autogestion d'une manche) : chaque avis relit son match et son destinataire,
 * et seize avis lancés ensemble occupaient le pool d'une trentaine de requêtes
 * simultanées. Ne lève jamais.
 */
export function announceRefereeChanges(changes: readonly RefereeChange[], options: RefereeAnnounceOptions = {}): void {
  if (changes.length === 0) return;
  void (async () => {
    for (const change of changes) {
      await deliverRefereeChange(change, options).catch((error) =>
        console.error("[referee] changement d'arbitrage non annoncé", error),
      );
    }
  })();
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

/**
 * Annonce les changements de la transaction **dans leur ordre** : le retrait
 * d'un arbitre inéligible part avant la reprise du match (revue sécurité #536).
 */
export function flushRefereeChanges(connection: PoolConnection): void {
  const queued = pendingChanges.get(connection);
  pendingChanges.delete(connection);
  announceRefereeChanges(queued ?? []);
}
