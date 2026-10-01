import { isStoredUploadIn, toDiskUploadPath } from "./uploads";

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
};

export type SponsorInput = {
  name: string;
  tier?: SponsorTier | string;
  logoUrl?: string | null;
  bannerUrl?: string | null;
  websiteUrl?: string | null;
  description?: string | null;
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
  { id: -1, name: "LOGITECH G", slug: "logitech-g", tier: "PARTNER", logoUrl: null, bannerUrl: null, websiteUrl: "https://www.logitechg.com", description: null },
  { id: -2, name: "CORSAIR", slug: "corsair", tier: "PARTNER", logoUrl: null, bannerUrl: null, websiteUrl: "https://www.corsair.com", description: null },
  { id: -3, name: "HYPERX", slug: "hyperx", tier: "PARTNER", logoUrl: null, bannerUrl: null, websiteUrl: "https://www.hyperxgaming.com", description: null },
  { id: -4, name: "STEELSERIES", slug: "steelseries", tier: "PARTNER", logoUrl: null, bannerUrl: null, websiteUrl: "https://www.steelseries.com", description: null },
  { id: -5, name: "RAZER", slug: "razer", tier: "PARTNER", logoUrl: null, bannerUrl: null, websiteUrl: "https://www.razer.com", description: null },
  { id: -6, name: "ASUS ROG", slug: "asus-rog", tier: "PARTNER", logoUrl: null, bannerUrl: null, websiteUrl: "https://rog.asus.com", description: null },
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

  let tier: SponsorTier = "PARTNER";
  if (input.tier !== undefined && input.tier !== null && input.tier !== "") {
    if (!isTier(input.tier)) return { ok: false, error: "INVALID_TIER" };
    tier = input.tier;
  }

  const logoUrl = normalizeOptional(input.logoUrl, SPONSOR_URL_MAX);
  // Un logo collé peut être une adresse étrangère (servie par le relais) ; mais
  // une adresse d'upload doit être celle d'un logo de partenaire. Un avatar ou
  // le logo d'une équipe collé ici serait effacé au remplacement du logo.
  if (logoUrl && toDiskUploadPath(logoUrl) !== null && !isStoredUploadIn(logoUrl, "sponsors")) {
    return { ok: false, error: "INVALID_LOGO_URL" };
  }
  const websiteUrl = normalizeOptional(input.websiteUrl, SPONSOR_URL_MAX);

  const rawBanner = typeof input.bannerUrl === "string" ? input.bannerUrl.trim() : "";
  let bannerUrl: string | null = null;
  if (rawBanner) {
    // Le bandeau ne se pose que par téléversement : une autre adresse est un
    // refus, pas un repli silencieux sur « aucun bandeau ».
    if (rawBanner.length > SPONSOR_BANNER_URL_MAX || !isStoredSponsorBanner(rawBanner)) {
      return { ok: false, error: "INVALID_BANNER_URL" };
    }
    bannerUrl = rawBanner;
  }

  const rawDescription = typeof input.description === "string" ? input.description.trim() : "";
  if (rawDescription.length > SPONSOR_DESCRIPTION_MAX) return { ok: false, error: "DESCRIPTION_TOO_LONG" };
  const description = rawDescription || null;
  const active = input.active === undefined ? true : Boolean(input.active);

  return { ok: true, value: { name, tier, logoUrl, bannerUrl, websiteUrl, description, active } };
}
