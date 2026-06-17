export const SPONSOR_TIERS = ["GOLD", "SILVER", "BRONZE", "PARTNER"] as const;
export type SponsorTier = (typeof SPONSOR_TIERS)[number];

export type Sponsor = {
  id: number;
  name: string;
  slug: string;
  tier: SponsorTier;
  logoUrl: string | null;
  websiteUrl: string | null;
  description: string | null;
};

export type SponsorInput = {
  name: string;
  tier?: SponsorTier | string;
  logoUrl?: string | null;
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
  { id: -1, name: "LOGITECH G", slug: "logitech-g", tier: "PARTNER", logoUrl: null, websiteUrl: "https://www.logitechg.com", description: null },
  { id: -2, name: "CORSAIR", slug: "corsair", tier: "PARTNER", logoUrl: null, websiteUrl: "https://www.corsair.com", description: null },
  { id: -3, name: "HYPERX", slug: "hyperx", tier: "PARTNER", logoUrl: null, websiteUrl: "https://www.hyperxgaming.com", description: null },
  { id: -4, name: "STEELSERIES", slug: "steelseries", tier: "PARTNER", logoUrl: null, websiteUrl: "https://www.steelseries.com", description: null },
  { id: -5, name: "RAZER", slug: "razer", tier: "PARTNER", logoUrl: null, websiteUrl: "https://www.razer.com", description: null },
  { id: -6, name: "ASUS ROG", slug: "asus-rog", tier: "PARTNER", logoUrl: null, websiteUrl: "https://rog.asus.com", description: null },
];

export const SPONSOR_NAME_MAX = 120;
export const SPONSOR_SLUG_MAX = 140;
export const SPONSOR_URL_MAX = 2048;

/** Génère un slug URL-safe à partir d'un nom (accents retirés, minuscules). */
export function slugifySponsor(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, SPONSOR_SLUG_MAX);
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
      value: { name: string; tier: SponsorTier; logoUrl: string | null; websiteUrl: string | null; description: string | null; active: boolean };
    }
  | { ok: false; error: string };

/**
 * Valide et normalise une entrée de sponsor. Le nom est requis ; le palier
 * (tier) défaut « PARTNER » ; logo/site/description sont optionnels et
 * ramenés à `null` si vides. `active` défaut `true`.
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
  const websiteUrl = normalizeOptional(input.websiteUrl, SPONSOR_URL_MAX);
  const description = normalizeOptional(input.description, 1000);
  const active = input.active === undefined ? true : Boolean(input.active);

  return { ok: true, value: { name, tier, logoUrl, websiteUrl, description, active } };
}
