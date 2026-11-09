/**
 * Message privé Discord d'un **nouveau match** (`NEW_MATCH`,
 * `docs/features/NEW_MATCH_NOTICE.md`) : vu de l'engagée du destinataire, qui
 * elle affronte, dans quel tournoi et quelle manche, l'horaire s'il est posé,
 * et le lien de la page du match.
 *
 * Noms d'équipe seulement, passés par `discordInline` ; en tournoi individuel
 * le nom d'un engagé est un pseudo : le message dit « ton adversaire ». Jamais
 * de pseudo, de BattleTag ni de tag Discord. FR/EN en dur comme les autres
 * messages privés (`docs/features/BOT_DM_LANGUAGE.md`).
 */
import { formatMatchStartIn, matchDmOptOutLine } from "@/lib/shared/discord-notifications";
import { discordInline } from "@/lib/shared/discord-text";
import { localizedSiteUrl } from "@/lib/shared/dm-language";
import { neutralizeQuotes } from "@/lib/shared/lobby-brief";
import type { Locale } from "@/lib/shared/locales";
import { pushRoundLabel, type NewMatchSide } from "@/lib/shared/push-messages";

function quoted(value: string, locale: Locale): string {
  // Guillemets neutralisés d'abord, `discordInline` en dernier : rien n'est écrit après son nettoyage.
  const name = discordInline(neutralizeQuotes(value));
  return locale === "en" ? `“${name}”` : `« ${name} »`;
}

const DM_TEXT = {
  fr: {
    title: "# Nouveau match",
    versus: (team: string, opponent: string) => `Ton équipe ${team} affronte ${opponent}.`,
    versusSolo: "L'adversaire de ton prochain match est connu.",
    start: (start: string) => `**Coup d'envoi : ${start}** (heure de Paris).`,
    noStart: "Pas encore d'horaire : il sera annoncé dès qu'il est posé.",
    link: (url: string) => `Page du match : ${url}`,
    organise: "Organise-toi avec ton équipe pour être prêt à l'heure.",
    organiseSolo: "Prépare-toi pour être prêt à l'heure.",
  },
  en: {
    title: "# New match",
    versus: (team: string, opponent: string) => `Your team ${team} faces ${opponent}.`,
    versusSolo: "The opponent of your next match is known.",
    start: (start: string) => `**Kickoff: ${start}** (Paris time).`,
    noStart: "No time yet: it will be announced as soon as it is set.",
    link: (url: string) => `Match page: ${url}`,
    organise: "Get organised with your team to be ready on time.",
    organiseSolo: "Get ready to be there on time.",
  },
} as const;

/**
 * @param url Page du match, adresse absolue en français (`localizedSiteUrl` la
 *   passe sous `/en`) ; `null` quand la racine du site est inconnue — la ligne
 *   du lien est alors tue plutôt que de pointer vers une adresse inventée.
 * @param settingsUrl Réglage des messages de match (`MATCH_DM_SETTINGS_PATH`),
 *   rappelé en dernière ligne comme tout message privé de match.
 */
export function formatNewMatchDm(
  side: NewMatchSide,
  url: string | null,
  locale: Locale = "fr",
  settingsUrl: string | null = null,
): string {
  const text = DM_TEXT[locale];
  const round = pushRoundLabel(side.bracket, side.roundNumber, locale, side.swiss);
  return [
    text.title,
    `*${round} · ${quoted(side.tournamentName, locale)}*`,
    "",
    side.solo ? text.versusSolo : text.versus(quoted(side.teamName, locale), quoted(side.opponentName, locale)),
    side.startAt === null ? text.noStart : text.start(formatMatchStartIn(side.startAt, locale)),
    ...(url === null ? [] : [text.link(localizedSiteUrl(url, locale))]),
    "",
    side.solo ? text.organiseSolo : text.organise,
    "",
    matchDmOptOutLine(settingsUrl, locale),
  ].join("\n");
}
