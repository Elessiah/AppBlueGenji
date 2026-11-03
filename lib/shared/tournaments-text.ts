/**
 * Textes de la liste des tournois et de ses cartes (lot 8a) — formatés **sans**
 * `next-intl` (`lib/shared/scoped-text.ts`) : la page est cliente, et charger le
 * formateur de `next-intl` pour elle coûterait ~12 Ko compressés.
 *
 * Le français est inclus dans le paquet (il remplace les chaînes écrites en
 * dur) ; l'anglais n'arrive que sous `/en` : celui de la liste est sérialisé par
 * sa page, celui que la fiche partage avec elle (`tournamentsShared.json` :
 * effectifs, format de match, aide des règles, plus les libellés) voyage avec
 * l'anglais de la fiche (`TournamentSheetTextGate`). Les propriétés de la liste
 * sont lues une à une, ce qui laisse le bundler écarter `meta`, réservé aux
 * métadonnées serveur.
 */
import frTournaments from "@/messages/fr/tournaments.json";
import frTournamentsShared from "@/messages/fr/tournamentsShared.json";
import frLabels from "@/messages/fr/labels.json";
import { DEFAULT_LOCALE, type Locale } from "@/lib/shared/locales";
import { messageAt, scopedText, type Leaves, type ScopedText } from "@/lib/shared/scoped-text";
import type { Messages } from "@/lib/shared/i18n-messages";
import { matchFormatNotation, matchMaxMaps, naturalMaxMaps, type MatchFormat } from "@/lib/shared/match-format";
import { toParticipantType, type ParticipantType } from "@/lib/shared/participants";
import { tickerControls, type TickerControls } from "@/lib/shared/ticker-labels";

type FrTournaments = typeof frTournaments;

/** Les espaces de `tournaments` que lisent les écrans client de la liste seule. */
export const TOURNAMENTS_LIST_PARTS = ["list", "ticker", "cards"] as const;
type ListPart = (typeof TOURNAMENTS_LIST_PARTS)[number];

/** Libellés du bandeau défilant et de son bouton pause, repris de l'accueil (`landing.ticker`). */
export type { TickerControls } from "@/lib/shared/ticker-labels";

/**
 * Les espaces que lisent **aussi** la fiche, la création et l'édition (libellés,
 * effectifs, format de match, aide des règles) : ce que l'anglais de la fiche
 * porte (`tournamentsSharedMessages`). La liste, ses cartes et le bandeau
 * (`list`, `ticker`, `cards`, `tickerControls`) sont posés par la page de la
 * liste seule.
 */
export type TournamentsSharedMessages = typeof frTournamentsShared & {
  /** Libellés de format, de jeu et d'état (espace `labels`, lot 4). */
  labels: Messages["labels"];
};

export type TournamentsClientMessages = Pick<FrTournaments, ListPart> & TournamentsSharedMessages & {
  /**
   * Contrôles du bandeau, sous `/en` seulement : la liste ne pose pas le
   * fournisseur de l'accueil. En français, le bandeau lit le sien — importer
   * ici `landing.json` l'aurait dupliqué dans le paquet de la liste.
   */
  tickerControls?: TickerControls;
};

type TextKey = Leaves<Omit<TournamentsClientMessages, "tickerControls">>;
export type TournamentsText = ScopedText<TextKey> & {
  /** Libellés du bandeau, absents en français (le bandeau prend alors ceux de l'accueil). */
  readonly tickerLabels?: TickerControls;
};

export const FR_TOURNAMENTS_CLIENT_MESSAGES: TournamentsClientMessages = {
  list: frTournaments.list,
  ticker: frTournaments.ticker,
  cards: frTournaments.cards,
  participants: frTournamentsShared.participants,
  matchFormat: frTournamentsShared.matchFormat,
  rulesHelp: frTournamentsShared.rulesHelp,
  labels: frLabels,
};

/** Ce qui voyage vers le navigateur sous `/en` : les espaces client, pas `meta`. */
export function tournamentsClientMessages(messages: Pick<Messages, "tournaments" | "tournamentsShared" | "labels" | "landing">): TournamentsClientMessages {
  const { tournaments } = messages;
  return {
    list: tournaments.list,
    ticker: tournaments.ticker,
    cards: tournaments.cards,
    ...tournamentsSharedMessages(messages),
    tickerControls: tickerControls(messages.landing.ticker),
  };
}

/** Ce que l'anglais de la fiche porte des textes communs avec la liste. */
export function tournamentsSharedMessages(messages: Pick<Messages, "tournamentsShared" | "labels">): TournamentsSharedMessages {
  const { tournamentsShared } = messages;
  return {
    participants: tournamentsShared.participants,
    matchFormat: tournamentsShared.matchFormat,
    rulesHelp: tournamentsShared.rulesHelp,
    labels: messages.labels,
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
  return maps === naturalMaxMaps(format) ? base : text.t("matchFormat.withMaps", { base, maps });
}
