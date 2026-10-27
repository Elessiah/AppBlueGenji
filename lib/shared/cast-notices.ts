/**
 * Avis au caster dont l'inscription sur un match est retirée par un autre que
 * lui — la règle et le texte, sans réseau ni base
 * (`docs/features/CAST_NOTICES.md`).
 *
 * Le caster qui se retire lui-même ne reçoit rien : il sait. Les autres cas
 * reçoivent un message privé Discord et une notification push (`CAST_RELEASED`),
 * **avec le motif** :
 *
 * - `STAFF` — le staff a retiré l'inscription (jamais nommé) ;
 * - `REPLACED` — le caster ne remplissait plus les conditions du cast, et un
 *   autre caster a pris le match ;
 * - `INELIGIBLE` — retirée d'office : les conditions du cast ne sont plus
 *   remplies (permission de diffusion, tag Discord certifié, compte Battle.net) ;
 * - `JOINED_TEAM` — retirée d'office : il joue désormais le match (avec son
 *   équipe, ou seul en tournoi individuel).
 *
 * Aucun pseudo de joueur : en tournoi individuel, les engagés sont des
 * personnes, et le message dit « un match » (`RGPD_LOGS_AND_VISITS.md`).
 *
 * **Serveur seulement** malgré son dossier : il atteint `push-messages.ts`, qui
 * embarque les deux langues.
 */
import { discordInline } from "./discord-text";
import { localizedSiteUrl } from "./dm-language";
import type { Locale } from "./locales";
import { pushRoundLabel } from "./push-messages";

/** Motif donné au caster. L'énumération reste ouverte : l'arbitrage des matchs en ajoutera. */
export type CastReleaseReason = "STAFF" | "REPLACED" | "INELIGIBLE" | "JOINED_TEAM";

/** Le match d'un avis de retrait, tel que la notification et le message le nomment. */
export type CastReleasedMatch = {
  tournamentId: number;
  tournamentName: string;
  matchId: number;
  bracket: string;
  roundNumber: number;
  swiss?: boolean;
  team1Name: string | null;
  team2Name: string | null;
  /** Tournoi individuel : les noms des engagés sont des pseudos, jamais écrits. */
  solo: boolean;
  reason: CastReleaseReason;
};

const DM_REASONS: Readonly<Record<Locale, Readonly<Record<CastReleaseReason, string>>>> = {
  fr: {
    STAFF: "décision du staff",
    REPLACED:
      "tu ne remplissais plus les conditions du cast (permission de diffusion, tag Discord certifié, compte Battle.net rattaché), et un autre caster a pris le match",
    INELIGIBLE:
      "tu ne remplis plus les conditions du cast (permission de diffusion, tag Discord certifié, compte Battle.net rattaché)",
    JOINED_TEAM: "tu joues désormais ce match",
  },
  en: {
    STAFF: "staff decision",
    REPLACED:
      "you no longer met the casting requirements (streaming permission, certified Discord tag, linked Battle.net account), and another caster took the match",
    INELIGIBLE:
      "you no longer meet the casting requirements (streaming permission, certified Discord tag, linked Battle.net account)",
    JOINED_TEAM: "you now play in this match",
  },
};

function quoted(value: string | null, locale: Locale): string {
  if (value === null) return "TBD";
  return locale === "en" ? `“${discordInline(value)}”` : `« ${discordInline(value)} »`;
}

/** « « A » contre « B » » ; `null` en tournoi individuel, où ce seraient des pseudos. */
function dmPairing(match: CastReleasedMatch, locale: Locale): string | null {
  if (match.solo) return null;
  const separator = locale === "en" ? "vs" : "contre";
  return `${quoted(match.team1Name, locale)} ${separator} ${quoted(match.team2Name, locale)}`;
}

/**
 * Le message privé Discord. `url` : la fiche du match, adresse absolue en
 * français (`localizedSiteUrl` la passe sous `/en` pour un compte anglais).
 */
export function formatCastReleasedNotice(match: CastReleasedMatch, url: string, locale: Locale = "fr"): string {
  const round = pushRoundLabel(match.bracket, match.roundNumber, locale, match.swiss);
  const pairing = dmPairing(match, locale);
  const reason = DM_REASONS[locale][match.reason];
  const tournament = quoted(match.tournamentName, locale);
  if (locale === "en") {
    const subject = pairing === null ? "a match" : `the match ${pairing}`;
    return (
      `🎙️ BlueGenji — Your caster registration for ${subject} (${round}, ${tournament}) ` +
      `has been removed: ${reason}. Match page: ${localizedSiteUrl(url, locale)}`
    );
  }
  const subject = pairing === null ? "d'un match" : `du match ${pairing}`;
  return (
    `🎙️ BlueGenji — Ton inscription comme caster ${subject} (${round}, ${tournament}) ` +
    `a été retirée : ${reason}. Fiche du match : ${url}`
  );
}
