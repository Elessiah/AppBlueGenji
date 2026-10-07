/**
 * Textes de la fiche d'un tournoi (`/tournois/[id]`, lot 8a-2) — espace
 * `tournament`, formatés **sans** `next-intl` (`lib/shared/scoped-text.ts`),
 * comme la liste (`tournaments-text.ts`).
 *
 * Le français est inclus dans le paquet de la fiche (il remplace les chaînes
 * écrites en dur) ; l'anglais n'arrive que sous `/en`, sérialisé par la mise en
 * page du segment (`TournamentPageTextProvider`). Les espaces lus côté serveur
 * seulement (`meta`, `settings`, `share`) ne voyagent pas.
 *
 * Les textes portés par le flux temps réel (libellés d'attente d'un créneau,
 * libellés de manche) restent des **données** françaises dans l'instantané,
 * commun à tous les lecteurs : ils sont traduits ici, au rendu
 * (`localizedPlaceholder`).
 */
import frTournament from "@/messages/fr/tournament.json";
import { DEFAULT_LOCALE, INTL_LOCALE, type Locale } from "@/lib/shared/locales";
import { scopedText, type Leaves, type ScopedText } from "@/lib/shared/scoped-text";
import { matchAllowsDraw, matchFormatNotation, matchMaxMaps, matchWinsRequired, naturalMaxMaps, type MatchFormat } from "@/lib/shared/match-format";
import { toParticipantType, type ParticipantType } from "@/lib/shared/participants";
import type { Messages } from "@/lib/shared/i18n-messages";
import { parseBracketPlaceholder } from "@/lib/shared/bracket-placeholders";

type FrTournament = typeof frTournament;

/** Espaces lus côté serveur seulement : jamais sérialisés vers le navigateur. */
export const TOURNAMENT_SERVER_PARTS = ["meta", "settings", "share"] as const;
type ServerPart = (typeof TOURNAMENT_SERVER_PARTS)[number];

export type TournamentPageMessages = Omit<FrTournament, ServerPart>;
export type TournamentPageKey = Leaves<TournamentPageMessages>;
export type TournamentPageText = ScopedText<TournamentPageKey>;

/**
 * Les espaces client, lus **un à un** : c'est ce qui laisse le bundler écarter
 * du paquet les espaces serveur (`meta`, `settings`, `share`) — une
 * déstructuration `...reste` garderait le JSON entier.
 */
function clientPart(messages: Messages["tournament"]): TournamentPageMessages {
  return {
    participants: messages.participants,
    page: messages.page,
    header: messages.header,
    matchFormat: messages.matchFormat,
    live: messages.live,
    loading: messages.loading,
    progress: messages.progress,
    phases: messages.phases,
    bracket: messages.bracket,
    sections: messages.sections,
    placeholders: messages.placeholders,
    match: messages.match,
    launch: messages.launch,
    ranking: messages.ranking,
    swiss: messages.swiss,
    survival: messages.survival,
    endurance: messages.endurance,
    registrations: messages.registrations,
    planning: messages.planning,
  };
}

/**
 * Le français du paquet, propriété par propriété **sur l'import lui-même** :
 * passé entier à une fonction, le JSON ne se laisserait plus élaguer et les
 * espaces serveur entreraient dans le paquet de la fiche.
 */
export const FR_TOURNAMENT_PAGE_MESSAGES: TournamentPageMessages = {
  participants: frTournament.participants,
  page: frTournament.page,
  header: frTournament.header,
  matchFormat: frTournament.matchFormat,
  live: frTournament.live,
  loading: frTournament.loading,
  progress: frTournament.progress,
  phases: frTournament.phases,
  bracket: frTournament.bracket,
  sections: frTournament.sections,
  placeholders: frTournament.placeholders,
  match: frTournament.match,
  launch: frTournament.launch,
  ranking: frTournament.ranking,
  swiss: frTournament.swiss,
  survival: frTournament.survival,
  endurance: frTournament.endurance,
  registrations: frTournament.registrations,
  planning: frTournament.planning,
};

/** Ce qui voyage vers le navigateur sous `/en`. */
export function tournamentPageMessages(messages: Pick<Messages, "tournament">): TournamentPageMessages {
  return clientPart(messages.tournament);
}

export function tournamentPageText(
  locale: Locale = DEFAULT_LOCALE,
  messages: TournamentPageMessages = FR_TOURNAMENT_PAGE_MESSAGES,
): TournamentPageText {
  return scopedText(locale, messages);
}

/** Le français, hors de tout fournisseur (tests, composant rendu ailleurs). */
export const FR_TOURNAMENT_PAGE_TEXT: TournamentPageText = tournamentPageText();

/** `lang` à poser sur un bloc resté français (staff, actions du lot 8b) : seulement sous une page anglaise. */
export function frenchBlockLang(text: Pick<TournamentPageText, "locale">): "fr" | undefined {
  return text.locale === "fr" ? undefined : "fr";
}

type ParticipantKey = keyof FrTournament["participants"]["TEAM"];

/** Mot d'effectif selon le type d'engagés (« Équipe », « Joueurs participants »…). */
export function participantText(
  text: TournamentPageText,
  participantType: ParticipantType | null | undefined,
  key: ParticipantKey,
): string {
  return text.t(`participants.${toParticipantType(participantType)}.${key}`);
}

/** Notation d'un format de match (« BO5 », « FT3 · 4 maps », « Score libre »). */
export function matchFormatText(text: TournamentPageText, format: MatchFormat | null): string {
  if (!format) return text.t("matchFormat.free");
  const base = matchFormatNotation(format);
  const maps = matchMaxMaps(format);
  return maps === naturalMaxMaps(format) ? base : text.t("matchFormat.withMaps", { base, maps: String(maps) });
}

/** Phrase d'aide d'un format de match (`matchFormatDescription`), dans la langue du texte. */
export function matchFormatDescriptionText(text: TournamentPageText, format: MatchFormat | null): string {
  if (!format) return text.t("matchFormat.noLimit");
  const values = { wins: matchWinsRequired(format), maps: String(matchMaxMaps(format)) };
  return text.t(matchAllowsDraw(format) ? "matchFormat.raceWithDraw" : "matchFormat.race", values);
}

/**
 * Date et heure d'un écran de la fiche : « 07 oct. 2026, 20:00 » / « Oct 7,
 * 2026, 20:00 », sur 24 h — l'anglais sans zéro initial au jour, comme les
 * cartes de la liste (`formatCardDate`). Fuseau du lecteur, comme avant (le
 * français reste celui de `toLocaleString("fr-FR", …)`).
 */
export function pageDateTime(iso: string, locale: Locale, options: Intl.DateTimeFormatOptions): string {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return "—";
  const hour = options.hour === undefined ? {} : { hourCycle: "h23" as const };
  const day = locale === "en" && options.day === "2-digit" ? { day: "numeric" as const } : {};
  return date.toLocaleString(INTL_LOCALE[locale], { ...options, ...hour, ...day });
}

/**
 * Libellé d'attente d'un créneau (« Perdant match 2 du tableau principal,
 * manche 1 ») dans la langue de la page. Le flux le porte en français ; un
 * libellé inconnu est rendu tel quel.
 */
export function localizedPlaceholder(text: TournamentPageText, placeholder: string | null): string | null {
  if (placeholder === null || text.locale === "fr") return placeholder;
  const parts = parseBracketPlaceholder(placeholder);
  if (parts === null) return placeholder;
  switch (parts.kind) {
    case "upperFinalWinner":
    case "lowerFinalWinner":
      return text.t(`placeholders.${parts.kind}`);
    case "upperLoser":
    case "lowerWinner":
      return text.t(`placeholders.${parts.kind}`, { match: String(parts.match), round: String(parts.round) });
    case "semiLoser":
      return text.t("placeholders.semiLoser", { slot: String(parts.slot) });
  }
}

/** « A contre B » d'une carte de match, noms ou libellés d'attente compris. */
export function versusText(text: TournamentPageText, team1: string, team2: string): string {
  return text.t("match.versus", { team1, team2 });
}
