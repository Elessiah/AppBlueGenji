/**
 * Textes de la liste des tournois et de ses cartes (lot 8a) — formatés **sans**
 * `next-intl` (`lib/shared/scoped-text.ts`) : la page est cliente, et charger le
 * formateur de `next-intl` pour elle coûterait ~12 Ko compressés.
 *
 * Le français est inclus dans le paquet (il remplace les chaînes écrites en
 * dur) ; l'anglais n'arrive que sous `/en`, sérialisé par la mise en page du
 * segment (`TournamentsTextProvider`). Les propriétés du JSON sont lues une à
 * une, ce qui laisse le bundler écarter celles qu'aucun écran client ne lit
 * (`meta`, réservé aux métadonnées serveur).
 */
import frTournaments from "@/messages/fr/tournaments.json";
import frLabels from "@/messages/fr/labels.json";
import { DEFAULT_LOCALE, type Locale } from "@/lib/shared/locales";
import { messageAt, scopedText, type Leaves, type ScopedText } from "@/lib/shared/scoped-text";
import type { Messages } from "@/lib/shared/i18n-messages";
import { matchFormatNotation, matchMaxMaps, naturalMaxMaps, type MatchFormat } from "@/lib/shared/match-format";
import { toParticipantType, type ParticipantType } from "@/lib/shared/participants";

type FrTournaments = typeof frTournaments;

/** Les espaces de `tournaments` que lisent les écrans client de la liste. */
export const TOURNAMENTS_LIST_PARTS = ["list", "ticker", "cards", "participants", "matchFormat", "rulesHelp"] as const;
type ListPart = (typeof TOURNAMENTS_LIST_PARTS)[number];

/** Libellés du bandeau défilant et de son bouton pause, repris de l'accueil (`landing.ticker`). */
export type TickerControls = Pick<Messages["landing"]["ticker"], "label" | "resume" | "pause" | "resumeShort" | "pauseShort">;

export type TournamentsClientMessages = Pick<FrTournaments, ListPart> & {
  /** Libellés de format, de jeu et d'état (espace `labels`, lot 4). */
  labels: Messages["labels"];
  /**
   * Contrôles du bandeau, sous `/en` seulement : la liste ne pose pas le
   * fournisseur de l'accueil. En français, le bandeau lit le sien — importer
   * ici `landing.json` l'aurait dupliqué dans le paquet de la liste.
   */
  tickerControls?: TickerControls;
};

function tickerControls(ticker: Messages["landing"]["ticker"]): TickerControls {
  return { label: ticker.label, resume: ticker.resume, pause: ticker.pause, resumeShort: ticker.resumeShort, pauseShort: ticker.pauseShort };
}

type TextKey = Leaves<Omit<TournamentsClientMessages, "tickerControls">>;
export type TournamentsText = ScopedText<TextKey> & {
  /** Libellés du bandeau, absents en français (le bandeau prend alors ceux de l'accueil). */
  readonly tickerLabels?: TickerControls;
};

export const FR_TOURNAMENTS_CLIENT_MESSAGES: TournamentsClientMessages = {
  list: frTournaments.list,
  ticker: frTournaments.ticker,
  cards: frTournaments.cards,
  participants: frTournaments.participants,
  matchFormat: frTournaments.matchFormat,
  rulesHelp: frTournaments.rulesHelp,
  labels: frLabels,
};

/** Ce qui voyage vers le navigateur sous `/en` : les espaces client, pas `meta`. */
export function tournamentsClientMessages(messages: Pick<Messages, "tournaments" | "labels" | "landing">): TournamentsClientMessages {
  const { tournaments } = messages;
  return {
    list: tournaments.list,
    ticker: tournaments.ticker,
    cards: tournaments.cards,
    participants: tournaments.participants,
    matchFormat: tournaments.matchFormat,
    rulesHelp: tournaments.rulesHelp,
    labels: messages.labels,
    tickerControls: tickerControls(messages.landing.ticker),
  };
}

export function tournamentsText(
  locale: Locale = DEFAULT_LOCALE,
  messages: TournamentsClientMessages = FR_TOURNAMENTS_CLIENT_MESSAGES,
): TournamentsText {
  return { ...scopedText<Omit<TournamentsClientMessages, "tickerControls">>(locale, messages), tickerLabels: messages.tickerControls };
}

/** Le français, hors de tout fournisseur (tests, écrans pas encore traduits). */
export const FR_TOURNAMENTS_TEXT: TournamentsText = tournamentsText();

type LabelTable = keyof TournamentsClientMessages["labels"];

/**
 * Libellé d'un code de domaine (format, jeu, état) dans la langue du texte ; un
 * code inconnu ressort tel quel — une réponse JSON ne garantit pas le typage.
 */
export function tournamentLabel(text: TournamentsText, table: LabelTable, code: string): string {
  // Les deux langues ont les mêmes clés (test de parité) : le français suffit
  // pour savoir si un code est connu.
  if (messageAt(frLabels, `${table}.${code}`) === undefined) return code;
  return text.t(`labels.${table}.${code}` as TextKey);
}

/** Libellé d'effectif d'une carte (« Équipes », « Joueurs participants »…), selon le type d'engagés. */
export function participantLabel(
  text: TournamentsText,
  participantType: ParticipantType | null | undefined,
  key: "manyCapitalized" | "manyParticipating",
): string {
  return text.t(`participants.${toParticipantType(participantType)}.${key}`);
}

/**
 * Notation du format de match (`matchFormatLabel`) dans la langue du texte :
 * « BO5 », « FT3 · 4 maps », ou « Score libre » sans format. La notation
 * elle-même ne se traduit pas (glossaire).
 */
export function localizedMatchFormatLabel(text: TournamentsText, format: MatchFormat | null): string {
  if (!format) return text.t("matchFormat.free");
  const base = matchFormatNotation(format);
  const maps = matchMaxMaps(format);
  return maps === naturalMaxMaps(format) ? base : text.t("matchFormat.withMaps", { base, maps: String(maps) });
}
