/**
 * Textes de la fiche d'un tournoi (`/tournois/[id]`, lot 8a-2) — espace
 * `tournament`, formatés **sans** `next-intl` (`lib/shared/scoped-text.ts`),
 * comme la liste (`tournaments-text.ts`).
 *
 * Le français est inclus dans le paquet de la fiche (il remplace les chaînes
 * écrites en dur) — sauf celui des vues chargées à la demande (suisse, survie,
 * endurance), qui voyage avec la vue (`frTournamentViewText`, `_lib/views-text.ts`) ; l'anglais n'arrive que sous `/en`, sérialisé par la mise en
 * page du segment (`TournamentPageTextProvider`). Les espaces lus côté serveur
 * seulement (`meta`, `settings`, `share`) ne voyagent pas.
 *
 * Les textes portés par le flux temps réel (libellés d'attente d'un créneau,
 * libellés de manche) restent des **données** françaises dans l'instantané,
 * commun à tous les lecteurs : ils sont traduits ici, au rendu
 * (`localizedPlaceholder`).
 */
import frTournament from "@/messages/fr/tournament.json";
import type frTournamentViews from "@/messages/fr/tournamentViews.json";
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

/** Espaces client de `tournament`, plus ceux des vues (`tournamentViews`). */
export type TournamentPageMessages = Omit<FrTournament, ServerPart> & typeof frTournamentViews;
export type TournamentPageKey = Leaves<TournamentPageMessages>;
export type TournamentPageText = ScopedText<TournamentPageKey>;

/**
 * Les espaces client, lus **un à un** : c'est ce qui laisse le bundler écarter
 * du paquet les espaces serveur (`meta`, `settings`, `share`) — une
 * déstructuration `...reste` garderait le JSON entier.
 */
function clientPart(messages: Messages["tournament"], views: Messages["tournamentViews"]): TournamentPageMessages {
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
    swiss: views.swiss,
    survival: views.survival,
    endurance: views.endurance,
    registrations: messages.registrations,
    planning: messages.planning,
  };
}

/**
 * Espaces des vues chargées à la demande (`dynamic()` dans `page.tsx`), rangés
 * dans leur propre fichier (`messages/<langue>/tournamentViews.json`) : un JSON
 * est un seul module pour le bundler, si bien qu'un espace lu à part dans le
 * même fichier restait dans le premier chargement. Leur français est importé
 * par la vue elle-même (`useTournamentViewText`) ; l'anglais, sérialisé par la
 * mise en page, les porte tous.
 */
export const TOURNAMENT_VIEW_PARTS = ["swiss", "survival", "endurance"] as const;
export type TournamentViewPart = (typeof TOURNAMENT_VIEW_PARTS)[number];
export type TournamentViewMessages = Partial<Pick<TournamentPageMessages, TournamentViewPart>>;

/**
 * Le français du paquet, propriété par propriété **sur l'import lui-même** :
 * passé entier à une fonction, le JSON ne se laisserait plus élaguer et les
 * espaces serveur entreraient dans le paquet de la fiche. Sans les espaces des
 * vues (`TOURNAMENT_VIEW_PARTS`).
 */
export const FR_TOURNAMENT_PAGE_MESSAGES: Omit<TournamentPageMessages, TournamentViewPart> = {
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
  registrations: frTournament.registrations,
  planning: frTournament.planning,
};

/** Ce qui voyage vers le navigateur sous `/en`. */
export function tournamentPageMessages(messages: Pick<Messages, "tournament" | "tournamentViews">): TournamentPageMessages {
  return clientPart(messages.tournament, messages.tournamentViews);
}

export function tournamentPageText(locale: Locale, messages: TournamentPageMessages): TournamentPageText {
  return scopedText(locale, messages);
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
