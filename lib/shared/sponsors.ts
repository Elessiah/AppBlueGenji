import { isStoredUploadIn, toDiskUploadPath } from "./uploads";
import type { Locale } from "./locales";
import { checkEnglish, englishCodes, hasEnglish, optionalStaffText } from "./staff-translation";

export const SPONSOR_TIERS = ["GOLD", "SILVER", "BRONZE", "PARTNER"] as const;
export type SponsorTier = (typeof SPONSOR_TIERS)[number];

export type Sponsor = {
  id: number;
  name: string;
  slug: string;
  tier: SponsorTier;
  logoUrl: string | null;
  /**
   * Bandeau de la carte (image large, recadrée au format 3:1 à l'import).
   * Toujours un fichier téléversé chez nous — jamais une URL collée, contrairement
   * au logo : la carte n'a pas de relais pour lui (voir `sponsor-card.ts`).
   */
  bannerUrl: string | null;
  websiteUrl: string | null;
  description: string | null;
  /**
   * Description en anglais (lot 5b) ; `null` sans description ou tant qu'elle
   * n'est pas traduite — sous `/en`, le partenaire reste affiché, **sans** sa
   * description.
   */
  descriptionEn: string | null;
};

export type SponsorInput = {
  name: string;
  tier?: SponsorTier | string; // NOSONAR typescript:S6571 — l'union documente les valeurs attendues ; `string` admet une saisie brute, validée ensuite
  logoUrl?: string | null;
  bannerUrl?: string | null;
  websiteUrl?: string | null;
  description?: string | null;
  descriptionEn?: string | null;
  active?: boolean;
};

export const SPONSOR_TIER_LABELS: Record<SponsorTier, string> = {
  GOLD: "Or",
  SILVER: "Argent",
  BRONZE: "Bronze",
  PARTNER: "Soutien",
};

/**
 * Sponsors affichés tant qu'aucune ligne n'existe en base (ou si la base est
 * injoignable). Les `id` négatifs marquent ces sponsors « de secours » comme
 * non modifiables côté interface. Partagé client/serveur.
 */
export const FALLBACK_SPONSORS: Sponsor[] = [
  { id: -1, name: "LOGITECH G", slug: "logitech-g", tier: "PARTNER", logoUrl: null, bannerUrl: null, websiteUrl: "https://www.logitechg.com", description: null, descriptionEn: null },
  { id: -2, name: "CORSAIR", slug: "corsair", tier: "PARTNER", logoUrl: null, bannerUrl: null, websiteUrl: "https://www.corsair.com", description: null, descriptionEn: null },
  { id: -3, name: "HYPERX", slug: "hyperx", tier: "PARTNER", logoUrl: null, bannerUrl: null, websiteUrl: "https://www.hyperxgaming.com", description: null, descriptionEn: null },
  { id: -4, name: "STEELSERIES", slug: "steelseries", tier: "PARTNER", logoUrl: null, bannerUrl: null, websiteUrl: "https://www.steelseries.com", description: null, descriptionEn: null },
  { id: -5, name: "RAZER", slug: "razer", tier: "PARTNER", logoUrl: null, bannerUrl: null, websiteUrl: "https://www.razer.com", description: null, descriptionEn: null },
  { id: -6, name: "ASUS ROG", slug: "asus-rog", tier: "PARTNER", logoUrl: null, bannerUrl: null, websiteUrl: "https://rog.asus.com", description: null, descriptionEn: null },
];

export const SPONSOR_NAME_MAX = 120;
export const SPONSOR_SLUG_MAX = 140;
export const SPONSOR_URL_MAX = 2048;
/** Colonne `bg_sponsors.banner_url` : un chemin d'upload, jamais une URL longue. */
export const SPONSOR_BANNER_URL_MAX = 255;
/**
 * Une **brève** description : elle s'affiche en entier sous le nom, sur une
 * carte d'un tiers de largeur. Au-delà, elle serait coupée à l'écran — le champ
 * refuse donc de la saisir plutôt que de la tronquer à l'affichage.
 */
export const SPONSOR_DESCRIPTION_MAX = 200;

/** Génère un slug URL-safe à partir d'un nom (accents retirés, minuscules). */
export function slugifySponsor(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") // NOSONAR typescript:S8786 — nom saisi par le staff, borné par SPONSOR_NAME_MAX
    .slice(0, SPONSOR_SLUG_MAX);
}

/**
 * Vrai si l'adresse désigne un fichier du dossier des partenaires — le seul où
 * la route de téléversement du bandeau écrit. Un autre dossier d'upload
 * (avatar d'un joueur, logo d'une équipe) serait bien « à nous », mais le
 * nettoyage d'un bandeau remplacé l'effacerait alors du disque.
 */
export function isStoredSponsorBanner(url: string): boolean {
  return isStoredUploadIn(url, "sponsors");
}

function isTier(value: unknown): value is SponsorTier {
  return typeof value === "string" && (SPONSOR_TIERS as readonly string[]).includes(value);
}

/** Palier saisi : « PARTNER » par défaut, `null` pour une valeur inconnue. */
function parseSponsorTier(raw: unknown): SponsorTier | null {
  if (raw === undefined || raw === null || raw === "") return "PARTNER";
  return isTier(raw) ? raw : null;
}

/**
 * Bandeau saisi : `null` s'il est vide, `false` s'il est refusé. Le bandeau ne
 * se pose que par téléversement : une autre adresse est un refus, pas un repli
 * silencieux sur « aucun bandeau ».
 */
function parseSponsorBanner(raw: unknown): string | null | false {
  const banner = typeof raw === "string" ? raw.trim() : "";
  if (!banner) return null;
  if (banner.length > SPONSOR_BANNER_URL_MAX || !isStoredSponsorBanner(banner)) return false;
  return banner;
}

function normalizeOptional(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, max);
}

export type SponsorValidationResult =
  | {
      ok: true;
      value: {
        name: string;
        tier: SponsorTier;
        logoUrl: string | null;
        bannerUrl: string | null;
        websiteUrl: string | null;
        description: string | null;
        descriptionEn: string | null;
        active: boolean;
      };
    }
  | { ok: false; error: string };

/**
 * Valide et normalise une entrée de sponsor. Le nom est requis ; le palier
 * (tier) défaut « PARTNER » ; logo/bandeau/site/description sont optionnels et
 * ramenés à `null` si vides. Le bandeau doit être un fichier téléversé
 * (`INVALID_BANNER_URL`), un logo désignant un upload l'être du dossier des
 * partenaires (`INVALID_LOGO_URL`), la description tenir en `SPONSOR_DESCRIPTION_MAX`
 * caractères (`DESCRIPTION_TOO_LONG`). `active` défaut `true`.
 */
export function validateSponsorInput(input: SponsorInput): SponsorValidationResult {
  const name = typeof input.name === "string" ? input.name.trim() : "";
  if (!name) return { ok: false, error: "NAME_REQUIRED" };
  if (name.length > SPONSOR_NAME_MAX) return { ok: false, error: "NAME_TOO_LONG" };

  const tier = parseSponsorTier(input.tier);
  if (tier === null) return { ok: false, error: "INVALID_TIER" };

  const logoUrl = normalizeOptional(input.logoUrl, SPONSOR_URL_MAX);
  // Un logo collé peut être une adresse étrangère (servie par le relais) ; mais
  // une adresse d'upload doit être celle d'un logo de partenaire. Un avatar ou
  // le logo d'une équipe collé ici serait effacé au remplacement du logo.
  if (logoUrl && toDiskUploadPath(logoUrl) !== null && !isStoredUploadIn(logoUrl, "sponsors")) {
    return { ok: false, error: "INVALID_LOGO_URL" };
  }
  const websiteUrl = normalizeOptional(input.websiteUrl, SPONSOR_URL_MAX);

  const bannerUrl = parseSponsorBanner(input.bannerUrl);
  if (bannerUrl === false) return { ok: false, error: "INVALID_BANNER_URL" };

  const rawDescription = typeof input.description === "string" ? input.description.trim() : "";
  if (rawDescription.length > SPONSOR_DESCRIPTION_MAX) return { ok: false, error: "DESCRIPTION_TOO_LONG" };
  const description = rawDescription || null;
  // Anglais obligatoire dès qu'une description est saisie (D9).
  const descriptionEn = checkEnglish(input.descriptionEn, description !== null, SPONSOR_DESCRIPTION_MAX, englishCodes("DESCRIPTION"));
  if (!descriptionEn.ok) return descriptionEn;
  const active = input.active === undefined ? true : Boolean(input.active);

  return {
    ok: true,
    value: { name, tier, logoUrl, bannerUrl, websiteUrl, description, descriptionEn: descriptionEn.value, active },
  };
}

/**
 * La description d'un partenaire dans la langue de la page, ou `null` : sans
 * description, ou sous `/en` sans anglais — le partenaire reste affiché, sans
 * elle (`staff-translation.ts`).
 */
export function sponsorDescription(sponsor: Pick<Sponsor, "description" | "descriptionEn">, locale: Locale): string | null {
  return optionalStaffText(sponsor.description, sponsor.descriptionEn, locale) || null;
}

/** Une description saisie attend-elle son anglais (rattrapage du lot 5b) ? */
export function sponsorEnglishMissing(sponsor: Pick<Sponsor, "description" | "descriptionEn">): boolean {
  return Boolean(sponsor.description?.trim()) && !hasEnglish(sponsor.descriptionEn);
}

/** Champ du formulaire que chaque refus désigne (`useFieldErrors`). */
export const SPONSOR_FIELD_ERRORS = {
  DESCRIPTION_TOO_LONG: "description",
  DESCRIPTION_EN_REQUIRED: "descriptionEn",
  DESCRIPTION_EN_TOO_LONG: "descriptionEn",
} as const;
