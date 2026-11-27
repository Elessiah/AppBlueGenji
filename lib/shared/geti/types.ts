/**
 * Types des annonces GETI (recrutement Overwatch relayé dans nos salons
 * Discord) — `docs/features/GETI_INFO.md`.
 *
 * Module pur : importable côté serveur comme côté client.
 */

/** Catégories d'annonces, une par salon source. */
export const GETI_CATEGORIES = ["lfp", "lft", "lfsub", "lfstaff", "lfs", "lfcast"] as const;
export type GetiCategory = (typeof GETI_CATEGORIES)[number];

/** Serveur Discord qui héberge les salons sources. */
export const GETI_GUILD_ID = "676570513023172637";

/** Salon source de chaque catégorie. */
export const GETI_CHANNEL_IDS: Readonly<Record<GetiCategory, string>> = Object.freeze({
  lfp: "679323677874978826",
  lft: "679323773559635999",
  lfsub: "679323726717911090",
  lfstaff: "679323814106103819",
  lfs: "930074663340605451",
  lfcast: "1085116755925536828",
});

/** Paliers Overwatch, du plus bas au plus haut (Émeraude se place entre Platine et Diamant). */
export const GETI_TIERS = [
  "BRONZE",
  "SILVER",
  "GOLD",
  "PLATINUM",
  "EMERALD",
  "DIAMOND",
  "MASTER",
  "GRANDMASTER",
  "CHAMPION",
] as const;
export type GetiTier = (typeof GETI_TIERS)[number];

/** Division d'un palier : 5 (la plus basse) à 1 (la plus haute). */
export type GetiDivision = 1 | 2 | 3 | 4 | 5;

/** Un rang précis : palier et division. */
export type GetiRank = { tier: GetiTier; division: GetiDivision };

/** Fourchette de rangs, bornes comprises. */
export type GetiRankRange = { min: GetiRank; max: GetiRank };

export const GETI_ROLES = ["TANK", "DPS", "SUPPORT", "FLEX"] as const;
export type GetiRole = (typeof GETI_ROLES)[number];

/** Rôles qui portent un rang propre (« Flex » n'en a pas). */
export type GetiRankedRole = Exclude<GetiRole, "FLEX">;

export const GETI_SUB_ROLES = [
  "MAIN_TANK",
  "OFF_TANK",
  "HITSCAN",
  "FLEX_DPS",
  "MAIN_SUPPORT",
  "FLEX_SUPPORT",
] as const;
export type GetiSubRole = (typeof GETI_SUB_ROLES)[number];

export const GETI_REGIONS = ["EU", "NA", "LATAM", "ASIA", "OCE"] as const;
export type GetiRegion = (typeof GETI_REGIONS)[number];

export const GETI_PLATFORMS = ["PC", "CONSOLE"] as const;
export type GetiPlatform = (typeof GETI_PLATFORMS)[number];

export const GETI_LANGUAGES = ["FR", "EN", "ES", "DE", "IT", "PT", "NL", "PL", "AR"] as const;
export type GetiLanguage = (typeof GETI_LANGUAGES)[number];

/** Jours de la semaine, lundi en tête. */
export const GETI_DAYS = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"] as const;
export type GetiDay = (typeof GETI_DAYS)[number];

/**
 * Niveaux de division (ligue FACEIT), du plus bas au plus haut : le niveau
 * d'une équipe (« LFS EU PC adv »), ou celui qu'un joueur vise.
 */
export const GETI_LEVELS = ["OPEN", "INTERMEDIATE", "ADVANCED", "EXPERT"] as const;
export type GetiLevel = (typeof GETI_LEVELS)[number];

export const GETI_STAFF_ROLES = [
  "COACH",
  "MANAGER",
  "ANALYST",
  "CASTER",
  "OBSERVER",
  "GRAPHIC",
  "COMMUNITY",
] as const;
export type GetiStaffRole = (typeof GETI_STAFF_ROLES)[number];

/**
 * Horaire lu dans l'annonce, en minutes depuis minuit (0–1440) dans le fuseau
 * de l'annonce ; `to` vaut `null` pour une heure seule (« à partir de 21h »).
 */
export type GetiTimeRange = { from: number; to: number | null };

export type GetiAvailability = {
  days: GetiDay[];
  times: GetiTimeRange[];
  /** « Europe/Paris », ou le sigle écrit (« CET », « UTC+1 ») ; `null` si absent. */
  timezone: string | null;
};

/** Rangs lus dans l'annonce : fourchette globale, puis par rôle quand il est donné. */
export type GetiRanks = {
  min: GetiRank | null;
  max: GetiRank | null;
  byRole: Partial<Record<GetiRankedRole, GetiRankRange>>;
};

/** Auteur d'un message Discord, tel que le bot le transmet. */
export type GetiRawAuthor = {
  id?: string | null;
  username?: string | null;
  /** Ancien suffixe « #1234 » ; « 0 » pour un compte au nouveau format. */
  discriminator?: string | null;
  bot?: boolean | null;
};

export type GetiRawEmbedField = { name?: string | null; value?: string | null };

export type GetiRawEmbed = {
  authorName?: string | null;
  title?: string | null;
  description?: string | null;
  fields?: GetiRawEmbedField[] | null;
  footerText?: string | null;
};

/**
 * Message Discord brut d'un salon source. Tout y est facultatif et **non
 * fiable** : texte libre d'un inconnu, ou relais d'un bot tiers.
 */
export type GetiRawPost = {
  /** Catégorie connue de l'appelant ; sinon déduite du salon, puis du mot-clé. */
  category?: GetiCategory | null;
  channelId?: string | null;
  content?: string | null;
  author?: GetiRawAuthor | null;
  embeds?: GetiRawEmbed[] | null;
  /** Dates ISO 8601 de publication et de dernière modification. */
  postedAt?: string | null;
  editedAt?: string | null;
};

/** Annonce analysée : données simples, jamais de balisage. */
export type GetiParsedPost = {
  category: GetiCategory | null;
  /** Pseudo Discord de l'auteur (à copier), `null` s'il est illisible. */
  authorTag: string | null;
  authorId: string | null;
  /** `true` quand le message est le relais d'un bot (auteur lu dans l'encart). */
  relayed: boolean;
  /** Serveur d'origine d'un relais (« Sent from »), s'il est nommé. */
  originServer: string | null;
  /** Texte de l'annonce, nettoyé de ses invisibles, sans la ligne de relais. */
  text: string;
  ranks: GetiRanks;
  roles: GetiRole[];
  subRoles: GetiSubRole[];
  regions: GetiRegion[];
  platforms: GetiPlatform[];
  languages: GetiLanguage[];
  availability: GetiAvailability;
  /**
   * Dates visées (« 26/11 », « Thursday 26 », « ce soir »), « AAAA-MM-JJ » à
   * l'heure de Paris, triées ; vide sans date de publication.
   */
  dates: string[];
  /** Niveaux de division cités (« adv », « high open »). */
  levels: GetiLevel[];
  /** `true` quand tout le texte est barré (`~~…~~`) : l'annonce est close. */
  closed: boolean;
  teamName: string | null;
  staffRoles: GetiStaffRole[];
  /** Âge minimal demandé ou annoncé (« 18+ », « majeur »). */
  minAge: number | null;
  /** Date ISO de publication, `null` si absente ou invalide. */
  postedAt: string | null;
  edited: boolean;
};

/** Filtre de recherche : chaque critère absent ou vide ne filtre rien. */
export type GetiFilter = {
  category?: GetiCategory | null;
  /** Fourchette de rangs voulue ; une borne absente est ouverte. */
  ranks?: { min?: GetiRank | null; max?: GetiRank | null } | null;
  roles?: readonly GetiRole[] | null;
  regions?: readonly GetiRegion[] | null;
  platforms?: readonly GetiPlatform[] | null;
  languages?: readonly GetiLanguage[] | null;
  levels?: readonly GetiLevel[] | null;
  /** `true` : une annonce close (texte entièrement barré) est écartée. */
  hideClosed?: boolean;
  /** Âge maximal de l'annonce, en heures. */
  maxAgeHours?: number | null;
  /**
   * `true` : une annonce où le critère n'a pas été lu (rang, rôle, région,
   * plateforme, langue, niveau) passe quand même. Par défaut elle est écartée.
   */
  includeUnknown?: boolean;
};
