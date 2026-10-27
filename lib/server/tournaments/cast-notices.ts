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
import type { RowDataPacket } from "mysql2/promise";
import { sendBotLog } from "@/lib/server/bot-integration";
import { getDatabase } from "@/lib/server/database";
import { loadNotificationRecipients, notifyUsers } from "@/lib/server/notify";
import { siteCanonicalBase } from "@/lib/server/site-url";
import { formatCastChangeLog, type CastLogChange } from "@/lib/shared/bot-logs";
import { formatCastReleasedNotice, type CastReleaseReason, type CastReleasedMatch } from "@/lib/shared/cast-notices";
import type { LogEntrant } from "@/lib/shared/log-privacy";
import { tournamentMatchHref } from "@/lib/shared/match-anchor";
import { toParticipantType } from "@/lib/shared/participants";
import { castReleasedPush } from "@/lib/shared/push-messages";
import { isSwissRound, swissRoundSql } from "./swiss-round-sql";

/** Un changement d'inscription de caster, tel que `match-launch.ts` le constate sous verrou. */
export type CastChange =
  /** Inscription posée ; `replacedCasterId` : le titulaire inéligible dont la place est reprise. */
  | { kind: "CLAIMED"; matchId: number; replacedCasterId: number | null }
  /** Inscription retirée par son caster (`byStaff: false`) ou par le staff. */
  | { kind: "RELEASED"; matchId: number; casterId: number; byStaff: boolean }
  /** Inscription retirée d'office (`releaseIneligibleCast`). */
  | { kind: "AUTO_RELEASED"; matchId: number; casterId: number; reason: "INELIGIBLE" | "JOINED_TEAM" };

type CastMatchRow = RowDataPacket & {
  id: number;
  bracket: string;
  round_number: number;
  swiss_round: number | null;
  team1_name: string | null;
  team2_name: string | null;
  tournament_id: number;
  tournament_name: string;
  participant_type: string | null;
};

async function loadCastMatch(matchId: number): Promise<CastMatchRow | null> {
  const db = await getDatabase();
  const [rows] = await db.execute<CastMatchRow[]>(
    `SELECT m.id, m.bracket, m.round_number, ${swissRoundSql("m", "tr")},
            t1.name AS team1_name, t2.name AS team2_name,
            tr.id AS tournament_id, tr.name AS tournament_name, tr.participant_type
       FROM bg_matches m
       JOIN bg_tournaments tr ON tr.id = m.tournament_id
       LEFT JOIN bg_teams t1 ON t1.id = m.team1_id
       LEFT JOIN bg_teams t2 ON t2.id = m.team2_id
      WHERE m.id = ?
      LIMIT 1`,
    [matchId],
  );
  return rows[0] ?? null;
}

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
  const match = await loadCastMatch(change.matchId);
  if (!match) return;
  const participantType = toParticipantType(match.participant_type);
  const entrant = (name: string | null): LogEntrant | null => (name === null ? null : { name, participantType });
  const log = sendBotLog(
    formatCastChangeLog({
      tournament: { id: Number(match.tournament_id), name: match.tournament_name },
      matchId: Number(match.id),
      bracket: String(match.bracket),
      roundNumber: Number(match.round_number),
      swiss: isSwissRound(match),
      team1: entrant(match.team1_name),
      team2: entrant(match.team2_name),
      change: castLogChange(change),
    }),
  );

  const notice = castReleaseNotice(change);
  if (!notice) {
    await log;
    return;
  }
  const subject: CastReleasedMatch = {
    tournamentId: Number(match.tournament_id),
    tournamentName: match.tournament_name,
    matchId: Number(match.id),
    bracket: String(match.bracket),
    roundNumber: Number(match.round_number),
    swiss: isSwissRound(match),
    team1Name: match.team1_name,
    team2Name: match.team2_name,
    solo: participantType === "SOLO",
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
