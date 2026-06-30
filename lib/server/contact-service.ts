import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { getDatabase } from "./database";
import {
  CONTACT_DISCORD_TAG_KEY,
  CONTACT_DISCORD_URL_KEY,
  CONTACT_EMAIL_KEY,
  type ContactInfo,
  DEFAULT_CONTACT,
  validateContactInfo,
} from "@/lib/shared/contact";

export type { ContactInfo } from "@/lib/shared/contact";
export { DEFAULT_CONTACT } from "@/lib/shared/contact";

interface SettingRow extends RowDataPacket {
  setting_key: string;
  setting_value: string;
}

const KEY_BY_FIELD: Record<keyof ContactInfo, string> = {
  email: CONTACT_EMAIL_KEY,
  discordTag: CONTACT_DISCORD_TAG_KEY,
  discordUrl: CONTACT_DISCORD_URL_KEY,
};

/**
 * Renvoie les coordonnées de contact stockées en base. Chaque canal absent
 * retombe sur sa valeur par défaut ; si la base est injoignable on renvoie
 * l'ensemble par défaut — la section contact reste ainsi toujours peuplée.
 */
export async function getContactInfo(): Promise<ContactInfo> {
  try {
    const db = await getDatabase();
    const [rows] = await db.execute<SettingRow[]>(
      `SELECT setting_key, setting_value FROM bg_settings WHERE setting_key IN (?, ?, ?)`,
      [CONTACT_EMAIL_KEY, CONTACT_DISCORD_TAG_KEY, CONTACT_DISCORD_URL_KEY],
    );
    const stored = new Map(rows.map((r) => [r.setting_key, r.setting_value?.trim() ?? ""]));
    // On distingue « jamais configuré » (clé absente → valeur par défaut) de
    // « explicitement vidé » (clé présente à `""` → canal retiré). Sinon un admin
    // ne pourrait jamais supprimer un canal : il réapparaîtrait au défaut.
    const pick = (key: string, fallback: string) => (stored.has(key) ? stored.get(key)! : fallback);
    return {
      email: pick(CONTACT_EMAIL_KEY, DEFAULT_CONTACT.email),
      discordTag: pick(CONTACT_DISCORD_TAG_KEY, DEFAULT_CONTACT.discordTag),
      discordUrl: pick(CONTACT_DISCORD_URL_KEY, DEFAULT_CONTACT.discordUrl),
    };
  } catch {
    return { ...DEFAULT_CONTACT };
  }
}

/** Valide puis enregistre (upsert) les trois canaux de contact, et renvoie la version normalisée. */
export async function setContactInfo(input: Partial<ContactInfo>): Promise<ContactInfo> {
  const validation = validateContactInfo(input);
  if (!validation.ok) throw new Error(validation.error);
  const value = validation.value;

  const db = await getDatabase();
  await db.execute<ResultSetHeader>(
    `INSERT INTO bg_settings (setting_key, setting_value)
     VALUES (?, ?), (?, ?), (?, ?)
     ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)`,
    [
      KEY_BY_FIELD.email, value.email,
      KEY_BY_FIELD.discordTag, value.discordTag,
      KEY_BY_FIELD.discordUrl, value.discordUrl,
    ],
  );

  return value;
}
