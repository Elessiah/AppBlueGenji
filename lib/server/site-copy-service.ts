/**
 * Persistance des textes éditables du site vitrine.
 *
 * Stockage dans la table clé/valeur `bg_settings`, comme les coordonnées de
 * contact : une ligne par texte modifié **et par langue** — `copy_<clé>` pour le
 * français (inchangée depuis l'origine, aucune migration), `copy_<clé>__en` pour
 * l'anglais (lot 2 de la traduction). Une clé absente signifie « jamais
 * édité » et retombe sur la valeur par défaut du registre
 * (`lib/shared/site-copy.ts`), de sorte que la page reste toujours peuplée —
 * même base injoignable. La règle de rattrapage (français édité sans anglais)
 * est dans `resolveSiteCopy`.
 */
import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { getDatabase } from "./database";
import {
  resolveSiteCopy,
  SITE_COPY_FIELDS,
  siteCopySettingKey,
  siteCopySettingKeys,
  validateBilingualSiteCopy,
  type SiteCopy,
  type SiteCopyBundle,
  type SiteCopyKey,
} from "@/lib/shared/site-copy";
import { DEFAULT_LOCALE, type Locale } from "@/lib/shared/locales";
import { cachedShowcase, invalidateShowcase } from "./showcase-cache";

interface SettingRow extends RowDataPacket {
  setting_key: string;
  setting_value: string;
}

export type { SiteCopy } from "@/lib/shared/site-copy";

/**
 * Les textes des deux langues, défauts compris, et ce qu'en reprend l'éditeur.
 *
 * Lecture mutualisée : l'accueil est rendu à chaque visite et cette requête y
 * revient à chaque fois, pour un contenu que le staff modifie quelques fois par
 * mois. Toute écriture invalide (voir `./showcase-cache`).
 *
 * Le repli de base injoignable est renvoyé **hors** du chargeur mis en cache, à
 * dessein : `cached` ne mémorise jamais un rejet, si bien qu'une coupure d'une
 * seconde ne fige pas du contenu de substitution sur l'accueil pendant toute une
 * minute — la visite suivante retente. Le repli d'une table vide, lui, est un
 * résultat légitime : il passe par le chargeur et se met en cache normalement.
 */
export async function getSiteCopyBundle(): Promise<SiteCopyBundle> {
  try {
    return await cachedShowcase("site-copy", loadSiteCopyBundle);
  } catch {
    return resolveSiteCopy(new Map());
  }
}

/** Tous les textes du site vitrine dans une langue (français par défaut). */
export async function getSiteCopy(locale: Locale = DEFAULT_LOCALE): Promise<SiteCopy> {
  const bundle = await getSiteCopyBundle();
  return locale === "en" ? bundle.en : bundle.fr;
}

/**
 * Ce que l'éditeur bilingue reprend, texte par texte (`SiteCopyEditorProvider`) —
 * à ne demander que pour un porteur de `showcase`.
 */
export async function getSiteCopyEditor(): Promise<SiteCopyBundle["editor"]> {
  return (await getSiteCopyBundle()).editor;
}

async function loadSiteCopyBundle(): Promise<SiteCopyBundle> {
  try {
    const db = await getDatabase();
    const keys = siteCopySettingKeys();
    const [rows] = await db.execute<SettingRow[]>(
      `SELECT setting_key, setting_value
       FROM bg_settings
       WHERE setting_key IN (${keys.map(() => "?").join(",")})`,
      keys,
    );
    return resolveSiteCopy(new Map(rows.map((row) => [row.setting_key, row.setting_value])));
  } catch {
    // Base injoignable : les défauts font le travail.
    return resolveSiteCopy(new Map());
  }
}

/**
 * Enregistre un texte dans les deux langues et renvoie le français à jour.
 *
 * L'anglais est **obligatoire** (D9) : sans lui, rien n'est écrit. Les deux
 * lignes partent dans **une** instruction — jamais un français enregistré dont
 * l'anglais aurait échoué.
 *
 * @throws UNKNOWN_COPY_KEY | COPY_EMPTY | COPY_TOO_LONG | COPY_EN_EMPTY | COPY_EN_TOO_LONG
 */
export async function setSiteCopy(key: string, value: unknown, valueEn: unknown): Promise<SiteCopy> {
  const validation = validateBilingualSiteCopy(key, value, valueEn);
  if (!validation.ok) throw new Error(validation.error);

  const copyKey = key as SiteCopyKey;
  const db = await getDatabase();
  await db.execute<ResultSetHeader>(
    `INSERT INTO bg_settings (setting_key, setting_value)
     VALUES (?, ?), (?, ?)
     ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)`,
    [siteCopySettingKey(copyKey, "fr"), validation.fr, siteCopySettingKey(copyKey, "en"), validation.en],
  );

  // Le staff vient d'écrire : la vitrine doit le montrer sans attendre.
  invalidateShowcase();
  return getSiteCopy();
}

/**
 * Réinitialise un texte à sa valeur par défaut, dans les deux langues
 * (suppression des deux lignes).
 *
 * @throws UNKNOWN_COPY_KEY
 */
export async function resetSiteCopy(key: string): Promise<SiteCopy> {
  const field = SITE_COPY_FIELDS.find((candidate) => candidate.key === key);
  if (!field) throw new Error("UNKNOWN_COPY_KEY");

  const db = await getDatabase();
  await db.execute(`DELETE FROM bg_settings WHERE setting_key IN (?, ?)`, [
    siteCopySettingKey(field.key, "fr"),
    siteCopySettingKey(field.key, "en"),
  ]);

  // Le staff vient d'écrire : la vitrine doit le montrer sans attendre.
  invalidateShowcase();
  return getSiteCopy();
}
