/**
 * Les cartes d'aperçu de chaque page (`docs/features/SHARE_METADATA.md` §
 * « Une carte par page »).
 *
 * Module **pur** : il nomme les cartes, dit où leur image est servie et en
 * rédige le texte depuis l'espace de messages `share` de la langue demandée.
 * Le rendu (`components/og/`) et la route qui le sert (`app/og/…`) sont
 * ailleurs.
 *
 * Une carte se désigne par une **clé** stable, qui est aussi le nom du fichier
 * servi : `/og/<langue>/<clé>.png`. La langue est dans le chemin, pas déduite
 * de la requête : la convention `opengraph-image` de Next résout son URL sur
 * le segment de la route, qui est le même sous `/regles` et `/en/regles`
 * (réécriture) — elle servirait la carte française à la page anglaise.
 */
import type frShare from "@/messages/fr/share.json";
import { RULE_MODE_DEFINITIONS } from "./rule-mode-definitions";
import { DEFAULT_LOCALE, isLocale, type Locale } from "./locales";
import { PODIUM_TIER_COUNT, type PodiumTier } from "./podium-tiers";
import { truncateForShare } from "./share-metadata";
import { visibleText } from "./visible-text";

export type ShareMessages = typeof frShare;

/** Cartes à texte fixe, une par page (ou famille de pages). */
export const PAGE_SHARE_CARD_KEYS = [
  "home",
  "association",
  "ranking",
  "rules",
  "recruitment",
  "volunteers",
  "login",
  "bot",
  "botDocs",
  "legalNotice",
  "privacy",
  "processingRegister",
  "terms",
  "accessibility",
  "botPrivacy",
  "botTerms",
  "tournaments",
  "teams",
  "team",
  "players",
  "player",
] as const;

export type PageShareCardKey = (typeof PAGE_SHARE_CARD_KEYS)[number];

/** Préfixe de la carte d'un mode de règles : `rules-<slug>`. */
const RULE_MODE_PREFIX = "rules-";

/** Clé de la carte d'un mode de règles (`/regles/[slug]`). */
export function ruleModeShareCardKey(slug: string): string {
  return `${RULE_MODE_PREFIX}${slug}`;
}

/**
 * Motif dessiné à droite de la carte : une icône du jeu de l'interface
 * (Lucide), choisie pour ce que la page **est**. Le nom est résolu en icône
 * par `components/og/share-motifs.tsx`.
 */
export type ShareMotif =
  | "handshake"
  | "trophy"
  | "book"
  | "bracket"
  | "userPlus"
  | "heart"
  | "logIn"
  | "bot"
  | "terminal"
  | "scale"
  | "shield"
  | "clipboard"
  | "fileText"
  | "accessibility"
  | "lock"
  | "scroll"
  | "swords"
  | "users"
  | "teamShield"
  | "gamepad"
  | "user";

/**
 * Teinte d'une carte : la couleur de sa pastille et de son motif. Les tons des
 * variantes `.pill-*` — jamais l'ambre (un avertissement), jamais le rouge (une
 * vraie diffusion).
 */
export type ShareAccent = "cyan" | "blue" | "violet" | "pink" | "teal";

export type ShareCardStyle = { motif: ShareMotif | null; accent: ShareAccent };

export const PAGE_SHARE_CARD_STYLES: Readonly<Record<PageShareCardKey, ShareCardStyle>> = {
  // La carte du site, inchangée : pas de motif, le titre a toute la largeur.
  home: { motif: null, accent: "cyan" },
  association: { motif: "handshake", accent: "pink" },
  ranking: { motif: "trophy", accent: "blue" },
  rules: { motif: "book", accent: "violet" },
  recruitment: { motif: "userPlus", accent: "teal" },
  volunteers: { motif: "heart", accent: "pink" },
  login: { motif: "logIn", accent: "cyan" },
  bot: { motif: "bot", accent: "blue" },
  botDocs: { motif: "terminal", accent: "blue" },
  legalNotice: { motif: "scale", accent: "teal" },
  privacy: { motif: "shield", accent: "teal" },
  processingRegister: { motif: "clipboard", accent: "teal" },
  terms: { motif: "fileText", accent: "teal" },
  accessibility: { motif: "accessibility", accent: "violet" },
  botPrivacy: { motif: "lock", accent: "blue" },
  botTerms: { motif: "scroll", accent: "blue" },
  tournaments: { motif: "swords", accent: "cyan" },
  teams: { motif: "users", accent: "violet" },
  team: { motif: "teamShield", accent: "violet" },
  players: { motif: "gamepad", accent: "pink" },
  player: { motif: "user", accent: "pink" },
};

/** Deux lignes d'accroche à 28 px dans la colonne de 820 px. */
export const RULE_MODE_SUBTITLE_MAX_LENGTH = 100;

/** Style des cartes de mode de règles. */
const RULE_MODE_STYLE: ShareCardStyle = { motif: "bracket", accent: "violet" };

/** Le texte d'une carte, prêt pour `ShareCard`. */
export type PageShareCardText = {
  eyebrow: string;
  title: string;
  subtitle: string;
  /** Mention de pied (« Association loi 1901 »), dans la langue de la carte. */
  footer: string;
};

export type ResolvedPageShareCard = PageShareCardText & ShareCardStyle;

export function isPageShareCardKey(value: string): value is PageShareCardKey {
  return (PAGE_SHARE_CARD_KEYS as readonly string[]).includes(value);
}

/** Toutes les clés servies : les cartes fixes, puis une par mode de règles. */
export function allShareCardKeys(): string[] {
  return [...PAGE_SHARE_CARD_KEYS, ...RULE_MODE_DEFINITIONS.map((mode) => ruleModeShareCardKey(mode.slug))];
}

/** Adresse de l'image d'une carte, relative à `metadataBase`. */
export function pageShareImagePath(key: string, locale: Locale = DEFAULT_LOCALE): string {
  return `/og/${locale}/${key}.png`;
}

/**
 * Lit les segments d'une adresse d'image (`/og/<langue>/<fichier>`) : `null`
 * pour toute langue ou carte inconnue, extension `.png` exigée.
 */
export function parseShareImageSegments(locale: string, file: string): { locale: Locale; key: string } | null {
  if (!isLocale(locale) || !file.endsWith(".png")) return null;
  const key = file.slice(0, -".png".length);
  return allShareCardKeys().includes(key) ? { locale, key } : null;
}

/**
 * Rédige une carte. `modeTexts` porte le nom et l'accroche de chaque mode de
 * règles **dans la langue** (`messages.rules.modes[format]`), lus par slug.
 */
export function resolvePageShareCard(
  key: string,
  messages: ShareMessages,
  modeTexts: ReadonlyMap<string, { label: string; tagline: string }>,
): ResolvedPageShareCard | null {
  if (isPageShareCardKey(key)) {
    return { ...messages.pages[key], footer: messages.footer, ...PAGE_SHARE_CARD_STYLES[key] };
  }
  if (key.startsWith(RULE_MODE_PREFIX)) {
    const mode = modeTexts.get(key.slice(RULE_MODE_PREFIX.length));
    if (!mode) return null;
    return {
      eyebrow: messages.ruleMode.eyebrow,
      title: mode.label,
      // Coupée sur un mot avant les deux lignes de l'accroche, plutôt que
      // tranchée au milieu d'un mot par l'ellipse de Satori.
      subtitle: truncateForShare(mode.tagline, RULE_MODE_SUBTITLE_MAX_LENGTH),
      footer: messages.footer,
      ...RULE_MODE_STYLE,
    };
  }
  return null;
}

/**
 * Longueur maximale d'un nom d'équipe sur le podium : une colonne fait 320 px,
 * deux lignes de 34 px y tiennent environ 30 caractères. Au-delà, coupe sur un
 * mot avec une ellipse (`truncateForShare`).
 */
export const PODIUM_NAME_MAX_LENGTH = 30;

/** Une marche du podium telle que la carte la dessine. */
export type PodiumShareEntry = {
  place: PodiumTier;
  /** Libellé de la marche dans la langue (« 1er », « 2nd »…). */
  placeLabel: string;
  /** Nom d'équipe nettoyé (`visibleText`) et borné. */
  name: string;
  /** Initiale de repli quand l'équipe n'a pas de logo lisible. */
  initial: string;
  /** Cote suivie de l'unité dans la langue (« 1240 pts »). */
  points: string;
  /** Logo en URL `data:` PNG, ou `null` (repli à l'initiale). */
  logoSrc: string | null;
};

export type PodiumShareInput = { teamName: string; points: number; logoSrc: string | null };

/**
 * Les trois marches, dans l'ordre du classement — ou `null` sous trois équipes,
 * comme `/classement`, qui n'affiche alors pas de podium (`splitRankingPodium`) :
 * la carte retombe sur celle de la page.
 */
export function podiumShareEntries(
  rows: readonly PodiumShareInput[],
  messages: ShareMessages,
): PodiumShareEntry[] | null {
  if (rows.length < PODIUM_TIER_COUNT) return null;
  return rows.slice(0, PODIUM_TIER_COUNT).map((row, index) => {
    const place = (index + 1) as PodiumTier;
    const cleaned = visibleText(row.teamName).trim();
    // Un nom sans caractère visible garde une marche lisible plutôt qu'un vide.
    const name = cleaned === "" ? "?" : truncateForShare(cleaned, PODIUM_NAME_MAX_LENGTH);
    return {
      place,
      placeLabel: messages.podium.places[index] ?? String(place),
      name,
      initial: Array.from(name)[0]?.toUpperCase() ?? "?",
      // Sans séparateur de milliers : la page affiche « 1240 », pas « 1 240 ».
      points: `${Math.round(row.points)} ${messages.podium.points}`,
      logoSrc: row.logoSrc,
    };
  });
}
