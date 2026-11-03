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
import { createCoalescer } from "@/lib/server/coalescer";
import { failureReason } from "@/lib/server/failure-reason";
import { loadNotificationRecipients, notifyUsers } from "@/lib/server/notify";
import { siteCanonicalBase } from "@/lib/server/site-url";
import type { BotLogCategory } from "@/lib/shared/bot-log-category";
import { formatCastChangeLog, type CastLogChange } from "@/lib/shared/bot-logs";
import type { CastReleaseReason, CastReleasedMatch } from "@/lib/shared/cast-notices";
import type { CastBlock } from "@/lib/shared/match-launch";
import { tournamentMatchHref } from "@/lib/shared/match-anchor";
import { castReleasedPush } from "@/lib/shared/push-messages";
import { formatCastReleasedNotice } from "./cast-release-message";
import { loadMatchLogRow, matchLogSubject } from "./match-log-subject";

/** Un changement d'inscription de caster, tel que `match-launch.ts` le constate sous verrou. */
export type CastChange =
  /** Inscription posée par `casterId` ; `replacedCasterId` : le titulaire inéligible dont la place est reprise. */
  | { kind: "CLAIMED"; matchId: number; casterId: number; replacedCasterId: number | null }
  /** Inscription retirée par son caster (`byStaff: false`) ou par le staff. */
  | { kind: "RELEASED"; matchId: number; casterId: number; byStaff: boolean }
  /**
   * Inscription retirée d'office (`releaseIneligibleCast`) ; `block`
   * (`INELIGIBLE`) : la condition qui manque, que le motif nomme au caster.
   */
  | {
      kind: "AUTO_RELEASED";
      matchId: number;
      casterId: number;
      reason: "INELIGIBLE" | "JOINED_TEAM";
      block?: CastBlock | null;
    };

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

/**
 * Catégorie de la ligne de journal : `staff-removal` (alerte) quand un caster
 * est retiré du match — retrait, remplacement, retrait d'office —, `casts`
 * (trace) pour une simple inscription.
 */
export function castLogCategory(change: CastChange): BotLogCategory {
  if (change.kind === "CLAIMED") return change.replacedCasterId === null ? "casts" : "staff-removal";
  return "staff-removal";
}

/** Le caster à prévenir et son motif ; `null` quand personne n'a à l'être (il s'est retiré lui-même, ou rien n'est retiré). */
export function castReleaseNotice(
  change: CastChange,
): { casterId: number; reason: CastReleaseReason; block?: CastBlock | null } | null {
  switch (change.kind) {
    case "CLAIMED":
      return change.replacedCasterId === null ? null : { casterId: change.replacedCasterId, reason: "REPLACED" };
    case "RELEASED":
      return change.byStaff ? { casterId: change.casterId, reason: "STAFF" } : null;
    case "AUTO_RELEASED":
      return change.block === undefined
        ? { casterId: change.casterId, reason: change.reason }
        : { casterId: change.casterId, reason: change.reason, block: change.block };
  }
}

/** Le journal, puis l'avis au caster s'il en faut un. Peut lever (base indisponible) : {@link announceCastChange} l'enveloppe. */
export async function deliverCastChange(change: CastChange): Promise<void> {
  const notice = castReleaseNotice(change);
  // Le destinataire ne dépend que du caster : sa lecture part avec celle du match.
  // Message de match : l'interrupteur « messages privés de mes matchs » de
  // « Mon profil » le coupe (droit d'opposition), le push garde son sujet.
  // Comme tout message de match, seul un tag Discord certifié le reçoit.
  const [row, recipients] = await Promise.all([
    loadMatchLogRow(change.matchId),
    // Une lecture qui échoue ne coûte que l'avis au caster : la ligne du journal part quand même.
    notice
      ? loadNotificationRecipients([notice.casterId], "certified", { matchDm: true }).catch((error) => {
          console.error(
            `[cast] destinataire de l'avis non lu : ${failureReason(error)}`,
          );
          return null;
        })
      : null,
  ]);
  if (!row) return;
  const match = matchLogSubject(row);
  const log = sendBotLog(formatCastChangeLog({ ...match, change: castLogChange(change) }), {
    tournamentId: match.tournament.id,
    category: castLogCategory(change),
  });

  if (!notice || !recipients) {
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
    block: notice.block,
  };
  const url = `${siteCanonicalBase()}${tournamentMatchHref(subject.tournamentId, subject.matchId)}`;
  await Promise.all([
    log,
    notifyUsers(recipients, {
      topic: "CAST_RELEASED",
      discord: { message: (locale) => formatCastReleasedNotice(subject, url, locale), context: "cast-released" },
      push: (locale) => castReleasedPush(subject, locale),
    }),
  ]);
}

function deliverInBackground(change: CastChange): Promise<void> {
  return deliverCastChange(change).catch((error) =>
    console.error(
      `[cast] changement d'inscription non annoncé : ${failureReason(error)}`,
    ),
  );
}

/** Silence qui clôt une rafale d'inscriptions et de retraits d'un même caster sur un même match. */
export const CAST_TOGGLE_WINDOW_MS = 60_000;
/** Au plus tard, la rafale s'annonce ce délai après son premier geste. */
export const CAST_TOGGLE_MAX_AGE_MS = 5 * 60_000;

/**
 * Geste volontaire du caster sur sa propre inscription — inscription simple,
 * retrait par lui-même : une ligne de journal, aucun avis. Un caster qui
 * bascule le bouton en boucle ne remplit plus le salon : la rafale ne dit que
 * son **effet net** ({@link deliverToggleBurst}).
 */
function isVoluntaryToggle(change: CastChange): boolean {
  if (change.kind === "CLAIMED") return change.replacedCasterId === null;
  return change.kind === "RELEASED" && !change.byStaff;
}

const voluntaryToggles = createCoalescer<CastChange>({
  windowMs: CAST_TOGGLE_WINDOW_MS,
  maxAgeMs: CAST_TOGGLE_MAX_AGE_MS,
  deliver: deliverToggleBurst,
});

/**
 * Ce qu'une rafale du caster poste : l'état final, et rien quand un retrait
 * suivi d'une réinscription le ramène à son point de départ. Une inscription
 * suivie d'un retrait garde **ses deux lignes**, dans l'ordre : s'inscrire
 * ouvre au caster les contacts du match en cours (`/api/matches/[matchId]/contacts`),
 * et le journal du staff est la trace de qui a tenu la place, même une minute.
 */
async function deliverToggleBurst(first: CastChange, last: CastChange): Promise<void> {
  if (first.kind === last.kind) return deliverInBackground(last);
  if (first.kind !== "CLAIMED") return;
  await deliverInBackground(first);
  await deliverInBackground(last);
}

/** Annonce tout de suite les rafales en attente. Réservé aux tests. */
export function flushCastToggles(): Promise<void> {
  return voluntaryToggles.flushAll();
}

/** Abandonne les rafales en attente. Réservé aux tests. */
export function resetCastToggles(): void {
  voluntaryToggles.reset();
}

/**
 * Annonce un changement d'inscription de caster, sans attendre ; ne lève jamais.
 * Un geste volontaire du caster attend {@link CAST_TOGGLE_WINDOW_MS} de silence.
 */
export function announceCastChange(change: CastChange): void {
  const key = `${change.matchId}:${change.casterId}`;
  if (isVoluntaryToggle(change)) {
    voluntaryToggles.add(key, change);
    return;
  }
  // La rafale en attente du même caster (ou du titulaire remplacé) part d'abord :
  // le journal garde l'ordre des gestes et finit sur l'état réel.
  const keys = [key];
  if (change.kind === "CLAIMED" && change.replacedCasterId !== null) {
    keys.push(`${change.matchId}:${change.replacedCasterId}`);
  }
  // Rien en attente (le cas courant) : l'annonce part sur-le-champ, sans détour
  // par la file des microtâches — un arrêt du serveur juste après ne la rate pas.
  if (!keys.some((pendingKey) => voluntaryToggles.busy(pendingKey))) {
    void deliverInBackground(change);
    return;
  }
  void Promise.all(keys.map((pendingKey) => voluntaryToggles.flush(pendingKey))).then(() =>
    deliverInBackground(change),
  );
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
