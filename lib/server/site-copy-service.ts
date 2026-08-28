/**
 * Persistance des textes éditables du site vitrine.
 *
 * Stockage dans la table clé/valeur `bg_settings`, comme les coordonnées de
 * contact : une ligne par texte modifié. Une clé absente signifie « jamais
 * édité » et retombe sur la valeur par défaut du registre
 * (`lib/shared/site-copy.ts`), de sorte que la page reste toujours peuplée —
 * même base injoignable.
 */
import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { getDatabase } from "./database";
import {
  defaultSiteCopy,
  SITE_COPY_FIELDS,
  siteCopySettingKey,
  validateSiteCopy,
  type SiteCopy,
  type SiteCopyKey,
} from "@/lib/shared/site-copy";
import { cachedShowcase, invalidateShowcase } from "./showcase-cache";

interface SettingRow extends RowDataPacket {
  setting_key: string;
  setting_value: string;
}

export type { SiteCopy } from "@/lib/shared/site-copy";

/** Tous les textes du site vitrine, défauts compris. */
/**
 * Lecture mutualisée : l'accueil est rendu à chaque visite et cette requête y
 * revient à chaque fois, pour un contenu que le staff modifie quelques fois par
 * mois. Toute écriture invalide (voir `./showcase-cache`).
 */
/**
 * Repli servi quand la base est injoignable.
 *
 * Renvoyé **hors** du chargeur mis en cache, à dessein : `cached` ne mémorise
 * jamais un rejet, si bien qu'une coupure d'une seconde ne fige pas du contenu
 * de substitution sur l'accueil pendant toute une minute — la visite suivante
 * retente. Le repli d'une table vide, lui, est un résultat légitime : il passe
 * par le chargeur et se met en cache normalement.
 */
export async function getSiteCopy(): Promise<SiteCopy> {
  try {
    return await cachedShowcase("site-copy", loadGetSiteCopy);
  } catch {
    return defaultSiteCopy();
  }
}

async function loadGetSiteCopy(): Promise<SiteCopy> {
  const copy = defaultSiteCopy();

  try {
    const db = await getDatabase();
    const keys = SITE_COPY_FIELDS.map((field) => siteCopySettingKey(field.key));
    const [rows] = await db.execute<SettingRow[]>(
      `SELECT setting_key, setting_value
       FROM bg_settings
       WHERE setting_key IN (${keys.map(() => "?").join(",")})`,
      keys,
    );

    const stored = new Map(rows.map((row) => [row.setting_key, row.setting_value]));
    for (const field of SITE_COPY_FIELDS) {
      const value = stored.get(siteCopySettingKey(field.key));
      // Une valeur vide en base ne doit pas effacer la page : on retombe alors
      // sur le défaut, exactement comme si la clé était absente.
      if (typeof value === "string" && value.trim().length > 0) {
        copy[field.key] = value;
      }
    }
  } catch {
    // Base injoignable : les défauts font le travail.
  }

  return copy;
}

/**
 * Enregistre un texte et renvoie l'ensemble à jour.
 *
 * @throws UNKNOWN_COPY_KEY | COPY_EMPTY | COPY_TOO_LONG
 */
export async function setSiteCopy(key: string, value: unknown): Promise<SiteCopy> {
  const validation = validateSiteCopy(key, value);
  if (!validation.ok) throw new Error(validation.error);

  const db = await getDatabase();
  await db.execute<ResultSetHeader>(
    `INSERT INTO bg_settings (setting_key, setting_value)
     VALUES (?, ?)
     ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)`,
    [siteCopySettingKey(key as SiteCopyKey), validation.value],
  );

  // Le staff vient d'écrire : la vitrine doit le montrer sans attendre.
  invalidateShowcase();
  return getSiteCopy();
}

/**
 * Réinitialise un texte à sa valeur par défaut (suppression de la ligne).
 *
 * @throws UNKNOWN_COPY_KEY
 */
export async function resetSiteCopy(key: string): Promise<SiteCopy> {
  const field = SITE_COPY_FIELDS.find((candidate) => candidate.key === key);
  if (!field) throw new Error("UNKNOWN_COPY_KEY");

  const db = await getDatabase();
  await db.execute(`DELETE FROM bg_settings WHERE setting_key = ?`, [siteCopySettingKey(field.key)]);

  // Le staff vient d'écrire : la vitrine doit le montrer sans attendre.
  invalidateShowcase();
  return getSiteCopy();
}
