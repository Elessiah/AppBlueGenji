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

/**
 * Deux lignes d'accroche à 28 px dans la colonne de 820 px : environ 125
 * caractères au rendu ; la limite de deux lignes du rendu coupe le reste.
 */
export const RULE_MODE_SUBTITLE_MAX_LENGTH = 120;

/**
 * L'accroche d'un mode bornée à `maxLength` : entière si elle tient, sinon ses
 * premières phrases entières (fin de phrase au-delà du tiers de la limite),
 * sinon coupée sur un mot avec une ellipse — une explication tronquée au
 * milieu (« Personne n'est coupé… ») dit moins qu'une phrase complète.
 */
export function shareTagline(text: string, maxLength: number): string {
  const flattened = text.replace(/\s+/gu, " ").trim();
  if (Array.from(flattened).length <= maxLength) return flattened;
  const head = Array.from(flattened).slice(0, maxLength + 1).join("");
  let end = -1;
  for (const match of head.matchAll(/[.!?](?= )/gu)) end = match.index;
  if (end + 1 >= maxLength / 3) return flattened.slice(0, end + 1);
  return truncateForShare(flattened, maxLength);
}

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

/** Préfixe de la carte nominative d'une équipe : `team-<id>`. */
const TEAM_PREFIX = "team-";

/**
 * Identifiant entier strictement positif, sans zéro de tête ni signe, borné à
 * dix chiffres : une seule écriture par équipe (pas de `team-007` à côté de
 * `team-7` pour multiplier les rendus), rien qu'un robot puisse étirer.
 */
const TEAM_KEY_PATTERN = /^team-([1-9]\d{0,9})$/u;

/** Clé de la carte nominative de l'équipe `teamId` (`/equipes/[id]`). */
export function teamShareCardKey(teamId: number): string {
  return `${TEAM_PREFIX}${teamId}`;
}

/** L'équipe désignée par une clé `team-<id>`, ou `null`. */
export function parseTeamShareCardKey(key: string): number | null {
  const match = TEAM_KEY_PATTERN.exec(key);
  if (!match) return null;
  const teamId = Number(match[1]);
  return Number.isSafeInteger(teamId) ? teamId : null;
}

/**
 * Lit les segments d'une adresse d'image (`/og/<langue>/<fichier>`) : `null`
 * pour toute langue ou carte inconnue, extension `.png` exigée.
 */
export function parseShareImageSegments(locale: string, file: string): { locale: Locale; key: string } | null {
  if (!isLocale(locale) || !file.endsWith(".png")) return null;
  const key = file.slice(0, -".png".length);
  if (parseTeamShareCardKey(key) !== null) return { locale, key };
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
  // Repli de la carte nominative (équipe inconnue, fantôme, base injoignable) :
  // la carte générique de la fiche, qui ne dit pas si l'équipe existe.
  if (parseTeamShareCardKey(key) !== null) {
    return { ...messages.pages.team, footer: messages.footer, ...PAGE_SHARE_CARD_STYLES.team };
  }
  if (key.startsWith(RULE_MODE_PREFIX)) {
    const mode = modeTexts.get(key.slice(RULE_MODE_PREFIX.length));
    if (!mode) return null;
    return {
      eyebrow: messages.ruleMode.eyebrow,
      title: mode.label,
      // Bornée avant les deux lignes de l'accroche (phrases entières de
      // préférence), plutôt que tranchée au milieu d'un mot par Satori.
      subtitle: shareTagline(mode.tagline, RULE_MODE_SUBTITLE_MAX_LENGTH),
      footer: messages.footer,
      ...RULE_MODE_STYLE,
    };
  }
  return null;
}

/**
 * Longueur maximale d'un nom d'équipe sur le podium : le nom est écrit en
 * 30 px dans une colonne utile de 292 px (336 px moins les marges), soit environ
 * 18 caractères de casse ordinaire par ligne. Au-delà de 32, coupe sur un mot
 * avec une ellipse (`truncateForShare`) ; un nom plus large (capitales) est
 * coupé par la limite de deux lignes du rendu, qui pose sa propre ellipse.
 */
export const PODIUM_NAME_MAX_LENGTH = 32;

/** Une marche du podium telle que la carte la dessine. */
export type PodiumShareEntry = {
  place: PodiumTier;
  /** Libellé de la marche dans la langue (« 1re », « 2nd »…). */
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

/**
 * Longueur maximale du nom sur la carte d'une équipe : coupé sur un mot avec
 * une ellipse (`truncateForShare`) ; le titre rétrécit déjà avec sa longueur
 * (`titleFontSize`).
 */
export const TEAM_SHARE_NAME_MAX_LENGTH = 48;

/** Ce que la carte d'une équipe montre : le sous-ensemble du classement public. */
export type TeamShareInput = {
  teamName: string;
  wins: number;
  losses: number;
  draws: number;
  points: number;
};

/** La carte d'une équipe telle que `ShareCard` la dessine (logo à part). */
export type TeamShareCard = {
  eyebrow: string;
  title: string;
  initial: string;
  subtitle: string;
  facts: { label: string; value: string }[];
  footer: string;
};

function fill(template: string, values: Readonly<Record<string, number>>): string {
  return template.replace(/\{(\w+)\}/gu, (whole, name: string) => (name in values ? String(values[name]) : whole));
}

/**
 * Rédige la carte nominative d'une équipe : nom saisi repassé par
 * `visibleText` puis borné, cote et bilan **tels que `/classement` les
 * affiche** (cote arrondie, sans séparateur de milliers ; nuls seulement s'il
 * y en a). Aucun joueur : ni pseudo ni avatar.
 */
export function teamShareCard(team: TeamShareInput, messages: ShareMessages): TeamShareCard {
  const cleaned = visibleText(team.teamName).trim();
  const title = cleaned === "" ? "?" : truncateForShare(cleaned, TEAM_SHARE_NAME_MAX_LENGTH);
  const texts = messages.teamProfile;
  const counts = { wins: team.wins, losses: team.losses, draws: team.draws };
  return {
    eyebrow: texts.eyebrow,
    title,
    initial: Array.from(title)[0]?.toUpperCase() ?? "?",
    subtitle: texts.subtitle,
    facts: [
      { label: texts.rating, value: `${Math.round(team.points)} ${messages.podium.points}` },
      { label: texts.record, value: fill(team.draws > 0 ? texts.recordWithDraws : texts.recordValue, counts) },
    ],
    footer: messages.footer,
  };
}
