import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { getDatabase } from "./database";
import {
  DEFAULT_PRESS_EMAIL,
  PRESS_EMAIL_KEY,
  validatePressEmail,
} from "@/lib/shared/contact";

export { DEFAULT_PRESS_EMAIL } from "@/lib/shared/contact";

interface SettingRow extends RowDataPacket {
  setting_value: string;
}

/**
 * Renvoie l'email de contact presse stocké en base, ou l'adresse de secours si
 * aucune valeur n'a été enregistrée ou si la base est injoignable — la section
 * contact de la page association reste ainsi toujours fonctionnelle.
 */
export async function getPressEmail(): Promise<string> {
  try {
    const db = await getDatabase();
    const [rows] = await db.execute<SettingRow[]>(
      `SELECT setting_value FROM bg_settings WHERE setting_key = ?`,
      [PRESS_EMAIL_KEY],
    );
    const value = rows?.[0]?.setting_value?.trim();
    return value || DEFAULT_PRESS_EMAIL;
  } catch {
    return DEFAULT_PRESS_EMAIL;
  }
}

/** Valide puis enregistre (upsert) l'email de contact presse et le renvoie normalisé. */
export async function setPressEmail(input: unknown): Promise<string> {
  const validation = validatePressEmail(input);
  if (!validation.ok) throw new Error(validation.error);
  const email = validation.value;

  const db = await getDatabase();
  await db.execute<ResultSetHeader>(
    `INSERT INTO bg_settings (setting_key, setting_value)
     VALUES (?, ?)
     ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)`,
    [PRESS_EMAIL_KEY, email],
  );

  return email;
}
