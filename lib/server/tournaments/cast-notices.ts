/**
 * Ce que le site dit quand l'inscription d'un caster sur un match change
 * (`docs/features/CAST_NOTICES.md`) :
 *
 * - **toujours** une ligne au journal du staff sur Discord (`/internal/log`),
 *   sans personne nommée — ni le caster, ni le staff, ni un joueur en tournoi
 *   individuel — et sans ligne nominative dans pm2 (décision du 27 octobre 2026) ;
 * - **au caster**, quand un autre que lui retire son inscription (staff, retrait
 *   d'office, place reprise par un autre caster) : un message privé Discord et
 *   une notification push `CAST_RELEASED`, avec le motif, dans la langue de son
 *   compte.
 *
 * Les joueurs du match ne sont pas prévenus (décision du 27 octobre 2026).
 *
 * Appelé **après le commit**, sans attendre : le bot est optionnel, et un envoi
 * lent n'a pas à retarder le geste. Ne lève jamais.
 */
import type { PoolConnection } from "mysql2/promise";
import { sendBotLog } from "@/lib/server/bot-integration";
import { loadNotificationRecipients, notifyUsers } from "@/lib/server/notify";
import { siteCanonicalBase } from "@/lib/server/site-url";
import { formatCastChangeLog, type CastLogChange } from "@/lib/shared/bot-logs";
import { formatCastReleasedNotice, type CastReleaseReason, type CastReleasedMatch } from "@/lib/shared/cast-notices";
import { tournamentMatchHref } from "@/lib/shared/match-anchor";
import { castReleasedPush } from "@/lib/shared/push-messages";
import { loadMatchLogRow, matchLogSubject } from "./match-log-subject";

/** Un changement d'inscription de caster, tel que `match-launch.ts` le constate sous verrou. */
export type CastChange =
  /** Inscription posée ; `replacedCasterId` : le titulaire inéligible dont la place est reprise. */
  | { kind: "CLAIMED"; matchId: number; replacedCasterId: number | null }
  /** Inscription retirée par son caster (`byStaff: false`) ou par le staff. */
  | { kind: "RELEASED"; matchId: number; casterId: number; byStaff: boolean }
  /** Inscription retirée d'office (`releaseIneligibleCast`). */
  | { kind: "AUTO_RELEASED"; matchId: number; casterId: number; reason: "INELIGIBLE" | "JOINED_TEAM" };

/** Ligne du journal de ce changement. */
export function castLogChange(change: CastChange): CastLogChange {
  switch (change.kind) {
    case "CLAIMED":
      return change.replacedCasterId === null ? "CLAIMED" : "REPLACED";
    case "RELEASED":
      return change.byStaff ? "RELEASED_BY_STAFF" : "RELEASED";
    case "AUTO_RELEASED":
      return change.reason;
  }
}

/** Le caster à prévenir et son motif ; `null` quand personne n'a à l'être (il s'est retiré lui-même, ou rien n'est retiré). */
export function castReleaseNotice(change: CastChange): { casterId: number; reason: CastReleaseReason } | null {
  switch (change.kind) {
    case "CLAIMED":
      return change.replacedCasterId === null ? null : { casterId: change.replacedCasterId, reason: "REPLACED" };
    case "RELEASED":
      return change.byStaff ? { casterId: change.casterId, reason: "STAFF" } : null;
    case "AUTO_RELEASED":
      return { casterId: change.casterId, reason: change.reason };
  }
}

/** Le journal, puis l'avis au caster s'il en faut un. Peut lever (base indisponible) : {@link announceCastChange} l'enveloppe. */
export async function deliverCastChange(change: CastChange): Promise<void> {
  const row = await loadMatchLogRow(change.matchId);
  if (!row) return;
  const match = matchLogSubject(row);
  const log = sendBotLog(
    formatCastChangeLog({
      tournament: match.tournament,
      matchId: match.matchId,
      bracket: match.bracket,
      roundNumber: match.roundNumber,
      swiss: match.swiss,
      team1: match.team1,
      team2: match.team2,
      change: castLogChange(change),
    }),
  );

  const notice = castReleaseNotice(change);
  if (!notice) {
    await log;
    return;
  }
  const subject: CastReleasedMatch = {
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
  };
  const url = `${siteCanonicalBase()}${tournamentMatchHref(subject.tournamentId, subject.matchId)}`;
  // Message de match : l'interrupteur « messages privés de mes matchs » de
  // « Mon profil » le coupe (droit d'opposition), le push garde son sujet.
  // Comme tout message de match, seul un tag Discord certifié le reçoit.
  const recipients = await loadNotificationRecipients([notice.casterId], "certified", { matchDm: true });
  await Promise.all([
    log,
    notifyUsers(recipients, {
      topic: "CAST_RELEASED",
      discord: { message: (locale) => formatCastReleasedNotice(subject, url, locale), context: "cast-released" },
      push: (locale) => castReleasedPush(subject, locale),
    }),
  ]);
}

/** Annonce un changement d'inscription de caster, sans attendre ; ne lève jamais. */
export function announceCastChange(change: CastChange): void {
  void deliverCastChange(change).catch((error) => console.error("[cast] changement d'inscription non annoncé", error));
}

/**
 * Changements constatés **au fond d'une transaction** qui ne les annonce pas
 * elle-même — le caster désinscrit d'office quand l'appariement qui arrive
 * compte son équipe (`adoptCurrentPairing`, appelé par l'entretien comme par
 * les gestes de lancement). Même cycle de vie que la file du journal
 * (`./bot-logs`) : partis après le commit (`flushCastChanges`), jetés si la
 * transaction échoue (`discardCastChanges`). Rien n'est annoncé qui ne soit écrit.
 */
const pendingChanges = new WeakMap<PoolConnection, CastChange[]>();

/** Note un changement à annoncer si — et seulement si — la transaction en cours aboutit. */
export function queueCastChange(connection: PoolConnection, change: CastChange): void {
  const queued = pendingChanges.get(connection);
  if (queued) queued.push(change);
  else pendingChanges.set(connection, [change]);
}

/** La transaction n'a pas abouti : rien ne part. */
export function discardCastChanges(connection: PoolConnection): void {
  pendingChanges.delete(connection);
}

/** Annonce, sans attendre, les changements de la transaction qui vient d'aboutir. Ne lève jamais. */
export function flushCastChanges(connection: PoolConnection): void {
  const queued = pendingChanges.get(connection);
  pendingChanges.delete(connection);
  for (const change of queued ?? []) announceCastChange(change);
}
