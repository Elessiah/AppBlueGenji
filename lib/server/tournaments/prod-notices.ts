/**
 * Ce que le site dit quand la prod d'un match change (`docs/features/MATCH_PROD.md`) :
 * une ligne au journal du staff (salon des casts, ou alerte quand le match perd
 * sa prod), sans personne nommée, et un avis (message privé, push `MATCH_PROD`)
 * au compte que le staff place ou retire, ou dont la place est rendue d'office
 * — jamais à qui agit sur sa propre place.
 *
 * Module sans dépendance au moteur de lancement : `match-launch.ts` y note la
 * prod retirée d'office au fond d'une transaction ({@link queueProdChange}),
 * annoncée après le commit (`flushBotLogs`) ou jetée sur annulation.
 */
import type { PoolConnection } from "mysql2/promise";
import { sendBotLog } from "@/lib/server/bot-integration";
import { trackAnnouncement } from "@/lib/server/coalescer";
import { failureDiagnostic } from "@/lib/server/failure-reason";
import { loadNotificationRecipients, notifyUsers } from "@/lib/server/notify";
import { siteCanonicalBase } from "@/lib/server/site-url";
import { formatProdChangeLog, type ProdLogChange } from "@/lib/shared/bot-logs";
import type { BotLogCategory } from "@/lib/shared/bot-log-category";
import { discordQuoted } from "@/lib/shared/discord-text";
import { localizedSiteUrl } from "@/lib/shared/dm-language";
import type { Locale } from "@/lib/shared/locales";
import { prodNoticeHref, type ProdNoticeKind, type ProdNoticeMatch } from "@/lib/shared/match-prod";
import { nullableId } from "@/lib/shared/nullable-id";
import { matchProdPush, pushRoundLabel } from "@/lib/shared/push-messages";
import type { CastPairing } from "./cast-notices";
import { loadMatchLogRow, matchLogSubject } from "./match-log-subject";
import { createTransactionState } from "./transaction-state";

/** Un changement de prod constaté sous verrou, annoncé après le commit. */
export type ProdChange = {
  matchId: number;
  log: ProdLogChange;
  /** Comptes à prévenir (placés ou retirés par un autre qu'eux). */
  notices: { userId: number; kind: ProdNoticeKind }[];
  /** Appariement lu sous verrou : un match réapparié depuis n'est pas nommé par ses nouveaux engagés. */
  pairing: CastPairing;
};

/** Catégorie de la ligne : `casts` quand le match gagne ou change de prod, `staff-removal` (alerte) quand il la perd. */
export function prodLogCategory(change: ProdLogChange): BotLogCategory {
  return change === "CLAIMED" || change === "ASSIGNED" || change === "REPLACED" ? "casts" : "staff-removal";
}

const DM_TEXT: Readonly<Record<Locale, Readonly<Record<ProdNoticeKind, string>>>> = {
  fr: {
    ASSIGNED: "Le staff te place comme prod",
    RELEASED: "Le staff te retire la prod",
    INELIGIBLE: "Tu n'as plus le rôle prod : tu ne fais plus la prod",
    UNAVAILABLE: "Ton compte ne peut plus faire la prod pour le moment : tu ne fais plus la prod",
    JOINED_TEAM: "Tu fais désormais partie des joueurs : tu ne fais plus la prod",
  },
  en: {
    ASSIGNED: "The staff made you the prod",
    RELEASED: "The staff removed you as the prod",
    INELIGIBLE: "You no longer hold the prod role: you are no longer the prod",
    UNAVAILABLE: "Your account cannot be a prod for now: you are no longer the prod",
    JOINED_TEAM: "You are now one of the players: you are no longer the prod",
  },
};

function quotedName(value: string | null, locale: Locale): string {
  return value === null ? "TBD" : discordQuoted(value, locale);
}

/**
 * Le message privé Discord d'un avis de prod, dans la langue du compte. Aucun
 * pseudo de joueur : en tournoi individuel, « un match ».
 */
export function formatProdNotice(match: ProdNoticeMatch, url: string, locale: Locale = "fr"): string {
  const round = pushRoundLabel(match.bracket, match.roundNumber, locale, match.swiss);
  const tournament = quotedName(match.tournamentName, locale);
  const lead = DM_TEXT[locale][match.kind];
  if (locale === "en") {
    const subject = match.solo
      ? "of a match"
      : `of the match ${quotedName(match.team1Name, locale)} vs ${quotedName(match.team2Name, locale)}`;
    return `🎛️ BlueGenji — ${lead} ${subject} (${round}, ${tournament}). Match page: ${localizedSiteUrl(url, locale)}`;
  }
  const subject = match.solo
    ? "d'un match"
    : `du match ${quotedName(match.team1Name, locale)} contre ${quotedName(match.team2Name, locale)}`;
  return `🎛️ BlueGenji — ${lead} ${subject} (${round}, ${tournament}). Fiche du match : ${url}`;
}

/** Le journal, puis les avis. Peut lever : {@link announceProdChange} l'enveloppe. */
export async function deliverProdChange(change: ProdChange): Promise<void> {
  const row = await loadMatchLogRow(change.matchId);
  if (!row) return;
  const current =
    change.pairing.team1Id === nullableId(row.team1_id ?? null) &&
    change.pairing.team2Id === nullableId(row.team2_id ?? null);
  // Appariement changé depuis le geste : le match est désigné sans ses engagés.
  const named = current ? row : { ...row, team1_name: null, team2_name: null };
  const match = matchLogSubject(named);
  sendBotLog(formatProdChangeLog({ ...match, change: change.log }), {
    tournamentId: match.tournament.id,
    category: prodLogCategory(change.log),
  });
  for (const notice of change.notices) {
    // Message de match : l'interrupteur « messages privés de mes matchs » le
    // coupe, le push garde son sujet ; seul un tag Discord certifié le reçoit.
    // Un compte qui vient de perdre `prod` sort de l'audience du sujet : il n'a
    // que le message privé (comme un caster qui perd `live`).
    const recipients = await loadNotificationRecipients([notice.userId], "certified", { matchDm: true });
    const subject: ProdNoticeMatch = {
      tournamentId: match.tournament.id,
      tournamentName: match.tournament.name,
      matchId: match.matchId,
      bracket: match.bracket,
      roundNumber: match.roundNumber,
      swiss: match.swiss,
      team1Name: named.team1_name,
      team2Name: named.team2_name,
      solo: match.participantType === "SOLO",
      kind: notice.kind,
    };
    const url = `${siteCanonicalBase()}${prodNoticeHref(subject)}`;
    await notifyUsers(recipients, {
      topic: "MATCH_PROD",
      discord: { message: (locale) => formatProdNotice(subject, url, locale), context: "match-prod" },
      push: (locale) => matchProdPush(subject, locale),
    });
  }
}

/** Annonce sans attendre ; attendue à l'arrêt du serveur. Ne lève jamais. */
export function announceProdChange(change: ProdChange): void {
  void trackAnnouncement(
    deliverProdChange(change).catch((error: unknown) =>
      console.error(`[prod] changement de prod non annoncé : ${failureDiagnostic(error)}`),
    ),
  );
}

/**
 * Changements de prod constatés au fond d'une transaction qui ne les annonce
 * pas elle-même (la prod devenue joueuse du match, `adoptCurrentPairing`) :
 * partis après le commit ({@link flushProdChanges}), jetés sur annulation
 * ({@link discardProdChanges}) — même cycle que `./cast-notices`.
 */
const pendingChanges = createTransactionState<ProdChange[]>(() => []);

/** Note un changement à annoncer si — et seulement si — la transaction en cours aboutit. */
export function queueProdChange(connection: PoolConnection, change: ProdChange): void {
  pendingChanges.ensure(connection).push(change);
}

/** La transaction n'a pas abouti : rien ne part. */
export function discardProdChanges(connection: PoolConnection): void {
  pendingChanges.discard(connection);
}

/** Annonce, sans attendre, les changements de la transaction qui vient d'aboutir. Ne lève jamais. */
export function flushProdChanges(connection: PoolConnection): void {
  for (const change of pendingChanges.take(connection) ?? []) announceProdChange(change);
}
