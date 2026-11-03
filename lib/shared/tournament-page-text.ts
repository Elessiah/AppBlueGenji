/**
 * Textes de la fiche d'un tournoi (`/tournois/[id]`, lot 8a-2) — espace
 * `tournament`, formatés **sans** `next-intl` (`lib/shared/scoped-text.ts`),
 * comme la liste (`tournaments-text.ts`).
 *
 * Le français est inclus dans le paquet de la fiche (il remplace les chaînes
 * écrites en dur) — sauf celui des vues chargées à la demande (suisse, survie,
 * endurance, graphique), qui voyage avec la vue (`frTournamentViewText`,
 * `_lib/views-text.ts`, `_lib/endurance-text.ts`). L'anglais n'arrive que sous
 * `/en` : celui de la fiche sérialisé par la mise en page au seul chargement
 * complet d'une page, sinon chargé par son morceau (`TournamentSheetTextGate`) ;
 * celui d'une vue avec la vue (`useTournamentViewText`). Les espaces lus côté
 * serveur seulement (`meta`, `settings`, `share`) vivent dans leur propre
 * fichier (`messages/<langue>/tournamentServer.json`) : ils n'entrent jamais
 * dans un paquet client.
 *
 * Les textes portés par le flux temps réel (libellés d'attente d'un créneau,
 * libellés de manche) restent des **données** françaises dans l'instantané,
 * commun à tous les lecteurs : ils sont traduits ici, au rendu
 * (`localizedPlaceholder`).
 */
import frTournament from "@/messages/fr/tournament.json";
import type frTournamentViews from "@/messages/fr/tournamentViews.json";
import type frTournamentEndurance from "@/messages/fr/tournamentEndurance.json";
import type frTournamentEnduranceChart from "@/messages/fr/tournamentEnduranceChart.json";
import { DEFAULT_LOCALE, INTL_LOCALE, type Locale } from "@/lib/shared/locales";
import { scopedText, type Leaves, type ScopedText } from "@/lib/shared/scoped-text";
import { matchAllowsDraw, matchFormatNotation, matchMaxMaps, matchWinsRequired, naturalMaxMaps, type MatchFormat } from "@/lib/shared/match-format";
import { toParticipantType, type ParticipantType } from "@/lib/shared/participants";
import type { Messages } from "@/lib/shared/i18n-messages";
import { parseBracketPlaceholder } from "@/lib/shared/bracket-placeholders";
import type { BracketType } from "@/lib/shared/types";

type FrTournament = typeof frTournament;

/** L'espace `endurance` entier : la vue (`tournamentEndurance`) et son graphique (`tournamentEnduranceChart`). */
type EnduranceMessages = {
  endurance: (typeof frTournamentEndurance)["endurance"] & (typeof frTournamentEnduranceChart)["endurance"];
};

/** Espaces client de `tournament`, plus ceux des vues (`tournamentViews`, `tournamentEndurance*`). */
export type TournamentPageMessages = FrTournament & typeof frTournamentViews & EnduranceMessages;
export type TournamentPageKey = Leaves<TournamentPageMessages>;
export type TournamentPageText = ScopedText<TournamentPageKey>;

/**
 * Espaces des vues chargées à la demande (`dynamic()` dans `page.tsx`), rangés
 * dans leur propre fichier (`messages/<langue>/tournamentViews.json`) : un JSON
 * est un seul module pour le bundler, si bien qu'un espace lu à part dans le
 * même fichier restait dans le premier chargement. Leurs deux langues voyagent
 * avec la vue (`useTournamentViewText`) : ni la mise en page ni le morceau de la
 * fiche ne les portent.
 */
export const TOURNAMENT_VIEW_PARTS = ["swiss", "survival", "endurance"] as const;
export type TournamentViewPart = (typeof TOURNAMENT_VIEW_PARTS)[number];
export type TournamentViewMessages = Partial<Pick<TournamentPageMessages, TournamentViewPart>>;
/** Les espaces de la fiche, sans ceux des vues : ce que sérialise la mise en page. */
export type TournamentSheetMessages = Omit<TournamentPageMessages, TournamentViewPart>;

/**
 * Le français du paquet, sans les espaces des vues (`TOURNAMENT_VIEW_PARTS`,
 * dans leurs propres fichiers). `tournament.json` ne porte que du texte client :
 * les parties serveur sont à part (`tournamentServer.json`).
 */
export const FR_TOURNAMENT_PAGE_MESSAGES: TournamentSheetMessages = frTournament;

/** Ce qui voyage vers le navigateur sous `/en` : la fiche, sans les vues. */
export function tournamentPageMessages(messages: Pick<Messages, "tournament">): TournamentSheetMessages {
  return messages.tournament;
}

/**
 * Le texte de la fiche, typé sur **toutes** les clés : celles des vues
 * (`view`, absentes par défaut) se rendent telles quelles — une vue lit le sien
 * par `useTournamentViewText`.
 */
export function tournamentPageText(locale: Locale, messages: TournamentSheetMessages, view: TournamentViewMessages = {}): TournamentPageText {
  return scopedText(locale, { ...messages, ...view } as TournamentPageMessages);
}

/**
 * Le français du paquet, typé sur **toutes** les clés : une clé d'une vue
 * (`swiss.*`, `survival.*`, `endurance.*`) n'y est pas et se rend telle quelle —
 * une vue lit son texte par `useTournamentViewText(FR_VIEWS_TEXT)`.
 */
function frPageText(view: TournamentViewMessages): TournamentPageText {
  return scopedText(DEFAULT_LOCALE, { ...FR_TOURNAMENT_PAGE_MESSAGES, ...view } as TournamentPageMessages);
}

/** Le français, hors de tout fournisseur (tests, composant rendu ailleurs). */
export const FR_TOURNAMENT_PAGE_TEXT: TournamentPageText = frPageText({});

/** Le français complété de l'espace d'une vue — à construire dans `_lib/views-text.ts`. */
export function frTournamentViewText(view: TournamentViewMessages): TournamentPageText {
  return frPageText(view);
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

/**
 * Place d'un match (« Tableau perdants · Manche 2 · Match 1 ») : le tableau
 * n'est nommé que hors du tableau principal — sans lui, en double
 * élimination, deux matchs de même manche et de même numéro se confondaient.
 */
export function matchPositionText(
  text: TournamentPageText,
  position: Readonly<{ bracket: BracketType; roundNumber: number; matchNumber: number }>,
): string {
  return [
    position.bracket === "UPPER" ? null : text.t(`page.bracketLabels.${position.bracket}`),
    text.t("bracket.roundN", { number: position.roundNumber }),
    text.t("bracket.matchN", { number: position.matchNumber }),
  ]
    .filter(Boolean)
    .join(" · ");
}

/** Notation d'un format de match (« BO5 », « FT3 · 4 maps », « Score libre »). */
export function matchFormatText(text: TournamentPageText, format: MatchFormat | null): string {
  if (!format) return text.t("matchFormat.free");
  const base = matchFormatNotation(format);
  const maps = matchMaxMaps(format);
  return maps === naturalMaxMaps(format) ? base : text.t("matchFormat.withMaps", { base, maps });
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
  // Mois en toutes lettres seulement : « 03/05 » garde ses deux chiffres.
  const wordMonth = options.month === "short" || options.month === "long";
  const day = locale === "en" && options.day === "2-digit" && wordMonth ? { day: "numeric" as const } : {};
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
