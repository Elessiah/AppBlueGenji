import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { getDatabase } from "./database";
import {
  type Sponsor,
  type SponsorInput,
  FALLBACK_SPONSORS,
  slugifySponsor,
  validateSponsorInput,
} from "@/lib/shared/sponsors";

export type { Sponsor, SponsorInput, SponsorTier } from "@/lib/shared/sponsors";
export { FALLBACK_SPONSORS } from "@/lib/shared/sponsors";

interface SponsorRow extends RowDataPacket {
  id: number;
  name: string;
  slug: string;
  tier: Sponsor["tier"];
  logoUrl: string | null;
  websiteUrl: string | null;
  description: string | null;
}

function fromRow(row: SponsorRow): Sponsor {
  return {
    id: Number(row.id),
    name: row.name,
    slug: row.slug,
    tier: row.tier,
    logoUrl: row.logoUrl,
    websiteUrl: row.websiteUrl,
    description: row.description,
  };
}

export async function listSponsors(): Promise<Sponsor[]> {
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  try {
    const dbPromise = getDatabase();
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutHandle = setTimeout(() => reject(new Error("Database query timeout")), 5000);
    });

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

    return rows.map(fromRow);
  } catch {
    return FALLBACK_SPONSORS;
  } finally {
    clearTimeout(timeoutHandle);
  }
}

/** Garantit un slug unique en suffixant `-2`, `-3`… si nécessaire. */
async function ensureUniqueSlug(base: string, excludeId?: number): Promise<string> {
  const db = await getDatabase();
  const safe = base || `sponsor-${Date.now().toString().slice(-5)}`;
  let candidate = safe;
  let suffix = 1;
  // Boucle bornée : on n'essaie pas indéfiniment.
  while (suffix < 1000) {
    const [rows] = await db.execute<(RowDataPacket & { id: number })[]>(
      `SELECT id FROM bg_sponsors WHERE slug = ? LIMIT 1`,
      [candidate]
    );
    if (rows.length === 0 || (excludeId !== undefined && Number(rows[0].id) === excludeId)) {
      return candidate;
    }
    suffix += 1;
    candidate = `${safe.slice(0, 136)}-${suffix}`;
  }
  return `${safe.slice(0, 130)}-${Date.now().toString().slice(-5)}`;
}

/** Crée un sponsor et le renvoie. Placé en fin de liste, slug dérivé du nom. */
export async function createSponsor(input: SponsorInput): Promise<Sponsor> {
  const validation = validateSponsorInput(input);
  if (!validation.ok) throw new Error(validation.error);
  const { name, tier, logoUrl, websiteUrl, description, active } = validation.value;

  const slug = await ensureUniqueSlug(slugifySponsor(name));
  const db = await getDatabase();
  const [res] = await db.execute<ResultSetHeader>(
    `INSERT INTO bg_sponsors (name, slug, tier, logo_url, website_url, description, display_order, active)
     VALUES (?, ?, ?, ?, ?, ?, (SELECT COALESCE(MAX(display_order), 0) + 10 FROM bg_sponsors AS s), ?)`,
    [name, slug, tier, logoUrl, websiteUrl, description, active ? 1 : 0]
  );

  return { id: Number(res.insertId), name, slug, tier, logoUrl, websiteUrl, description };
}

/** Met à jour un sponsor existant et renvoie sa version mise à jour. */
export async function updateSponsor(id: number, input: SponsorInput): Promise<Sponsor> {
  const validation = validateSponsorInput(input);
  if (!validation.ok) throw new Error(validation.error);
  const { name, tier, logoUrl, websiteUrl, description, active } = validation.value;

  const db = await getDatabase();
  const [existing] = await db.execute<SponsorRow[]>(
    `SELECT slug FROM bg_sponsors WHERE id = ? LIMIT 1`,
    [id]
  );
  if (existing.length === 0) throw new Error("SPONSOR_NOT_FOUND");
  const slug = existing[0].slug;

  await db.execute<ResultSetHeader>(
    `UPDATE bg_sponsors
     SET name = ?, tier = ?, logo_url = ?, website_url = ?, description = ?, active = ?
     WHERE id = ?`,
    [name, tier, logoUrl, websiteUrl, description, active ? 1 : 0, id]
  );

  return { id, name, slug, tier, logoUrl, websiteUrl, description };
}

/** Supprime un sponsor. Lève `SPONSOR_NOT_FOUND` si l'id n'existe pas. */
export async function deleteSponsor(id: number): Promise<void> {
  const db = await getDatabase();
  const [res] = await db.execute<ResultSetHeader>(
    `DELETE FROM bg_sponsors WHERE id = ?`,
    [id]
  );
  if (res.affectedRows === 0) throw new Error("SPONSOR_NOT_FOUND");
}
