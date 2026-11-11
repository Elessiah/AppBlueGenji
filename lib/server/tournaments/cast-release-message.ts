/**
 * Le message privé Discord d'un retrait de cast (`docs/features/CAST_NOTICES.md`),
 * dans la langue du compte. Serveur seulement : il tire `push-messages.ts` (le
 * libellé de la manche), qui embarque les deux langues.
 */
import { castReleaseReasonKey, type CastReleaseReasonKey, type CastReleasedMatch } from "@/lib/shared/cast-notices";
import { discordQuoted } from "@/lib/shared/discord-text";
import { localizedSiteUrl } from "@/lib/shared/dm-language";
import type { Locale } from "@/lib/shared/locales";
import { pushRoundLabel } from "@/lib/shared/push-messages";

const DM_REASONS: Readonly<Record<Locale, Readonly<Record<CastReleaseReasonKey, string>>>> = {
  fr: {
    STAFF: "décision du staff",
    REPLACED:
      "tu ne remplissais plus les conditions du cast (permission de diffusion, tag Discord certifié, compte Battle.net rattaché en Overwatch), et un autre caster a pris le match",
    INELIGIBLE:
      "tu ne remplis plus les conditions du cast (permission de diffusion, tag Discord certifié, compte Battle.net rattaché en Overwatch)",
    INELIGIBLE_PERMISSION: "tu n'as plus la permission de diffusion",
    INELIGIBLE_IDENTITY:
      "ton identité de caster est incomplète (tag Discord certifié et compte Battle.net rattaché, à vérifier dans « Mon profil »)",
    INELIGIBLE_DISCORD: "ton tag Discord n'est plus certifié (à vérifier dans « Mon profil »)",
    JOINED_TEAM: "tu joues désormais ce match",
    MATCH_DELETED: "le match a été supprimé (retour arrière ou manche refaite par le staff)",
  },
  en: {
    STAFF: "staff decision",
    REPLACED:
      "you no longer met the casting requirements (streaming permission, certified Discord tag, linked Battle.net account in Overwatch), and another caster took the match",
    INELIGIBLE:
      "you no longer meet the casting requirements (streaming permission, certified Discord tag, linked Battle.net account in Overwatch)",
    INELIGIBLE_PERMISSION: "you no longer have the streaming permission",
    INELIGIBLE_IDENTITY:
      "your caster identity is incomplete (certified Discord tag and linked Battle.net account, check “My profile”)",
    INELIGIBLE_DISCORD: "your Discord tag is no longer certified (check “My profile”)",
    JOINED_TEAM: "you now play in this match",
    MATCH_DELETED: "the match was deleted (rolled back or round redone by the staff)",
  },
};

function quotedName(value: string | null, locale: Locale): string {
  return value === null ? "TBD" : discordQuoted(value, locale);
}

/** « « A » contre « B » » ; `null` en tournoi individuel, où ce seraient des pseudos. */
function dmPairing(match: CastReleasedMatch, locale: Locale): string | null {
  if (match.solo) return null;
  const separator = locale === "en" ? "vs" : "contre";
  return `${quotedName(match.team1Name, locale)} ${separator} ${quotedName(match.team2Name, locale)}`;
}

/**
 * Le message privé Discord. `url` : la fiche du match, adresse absolue en
 * français (`localizedSiteUrl` la passe sous `/en` pour un compte anglais).
 */
export function formatCastReleasedNotice(match: CastReleasedMatch, url: string, locale: Locale = "fr"): string {
  const round = pushRoundLabel(match.bracket, match.roundNumber, locale, match.swiss);
  const pairing = dmPairing(match, locale);
  const reason = DM_REASONS[locale][castReleaseReasonKey(match)];
  const tournament = quotedName(match.tournamentName, locale);
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
