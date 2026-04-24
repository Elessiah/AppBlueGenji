import type { RowDataPacket } from "mysql2/promise";
import { getDatabase } from "./database";

export type Sponsor = {
  id: number;
  name: string;
  slug: string;
  tier: "GOLD" | "SILVER" | "BRONZE" | "PARTNER";
  logoUrl: string | null;
  websiteUrl: string | null;
  description: string | null;
};

const FALLBACK_SPONSORS: Sponsor[] = [
  {
    id: 1,
    name: "LOGITECH G",
    slug: "logitech-g",
    tier: "PARTNER",
    logoUrl: null,
    websiteUrl: "https://www.logitechg.com",
    description: null,
  },
  {
    id: 2,
    name: "CORSAIR",
    slug: "corsair",
    tier: "PARTNER",
    logoUrl: null,
    websiteUrl: "https://www.corsair.com",
    description: null,
  },
  {
    id: 3,
    name: "HYPERX",
    slug: "hyperx",
    tier: "PARTNER",
    logoUrl: null,
    websiteUrl: "https://www.hyperxgaming.com",
    description: null,
  },
  {
    id: 4,
    name: "STEELSERIES",
    slug: "steelseries",
    tier: "PARTNER",
    logoUrl: null,
    websiteUrl: "https://www.steelseries.com",
    description: null,
  },
  {
    id: 5,
    name: "RAZER",
    slug: "razer",
    tier: "PARTNER",
    logoUrl: null,
    websiteUrl: "https://www.razer.com",
    description: null,
  },
  {
    id: 6,
    name: "ASUS ROG",
    slug: "asus-rog",
    tier: "PARTNER",
    logoUrl: null,
    websiteUrl: "https://rog.asus.com",
    description: null,
  },
];

interface SponsorRow extends RowDataPacket {
  id: number;
  name: string;
  slug: string;
  tier: "GOLD" | "SILVER" | "BRONZE" | "PARTNER";
  logoUrl: string | null;
  websiteUrl: string | null;
  description: string | null;
}

export async function listSponsors(): Promise<Sponsor[]> {
  try {
    const dbPromise = getDatabase();
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("Database query timeout")), 5000)
    );

    const db = await Promise.race([dbPromise, timeoutPromise]);
    const [rows] = await db.execute<SponsorRow[]>(
      `
        SELECT id, name, slug, tier, logo_url as logoUrl, website_url as websiteUrl, description
        FROM bg_sponsors
        WHERE active = 1
        ORDER BY FIELD(tier, 'GOLD', 'SILVER', 'BRONZE', 'PARTNER'),
                 display_order ASC, name ASC
      `
    );

    if (!rows || rows.length === 0) {
      return FALLBACK_SPONSORS;
    }

    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      slug: row.slug,
      tier: row.tier,
      logoUrl: row.logoUrl,
      websiteUrl: row.websiteUrl,
      description: row.description,
    }));
  } catch {
    return FALLBACK_SPONSORS;
  }
}
