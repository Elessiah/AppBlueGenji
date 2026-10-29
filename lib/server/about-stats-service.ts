import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { getDatabase } from "./database";
import { applyDisplayOrder } from "./reorder";
import {
  type AboutStat,
  type AboutStatInput,
  FALLBACK_ABOUT_STATS,
  validateAboutStatInput,
} from "@/lib/shared/about-stats";
import { cachedShowcase, invalidateShowcase } from "./showcase-cache";

export type { AboutStat, AboutStatInput } from "@/lib/shared/about-stats";
export { FALLBACK_ABOUT_STATS } from "@/lib/shared/about-stats";

interface AboutStatRow extends RowDataPacket {
  id: number;
  value: string;
  value_en: string | null;
  label: string;
  label_en: string | null;
}

function fromRow(row: AboutStatRow): AboutStat {
  return {
    id: Number(row.id),
    value: row.value,
    valueEn: row.value_en ?? null,
    label: row.label,
    labelEn: row.label_en,
  };
}

/**
 * Liste les cartes « L'association » triées par ordre d'affichage. Renvoie les
 * cartes de secours si la base ne contient aucune ligne ou est injoignable, afin
 * que la section reste toujours peuplée.
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
export async function listAboutStats(): Promise<AboutStat[]> {
  try {
    return await cachedShowcase("about-stats", loadListAboutStats);
  } catch {
    return FALLBACK_ABOUT_STATS;
  }
}

async function loadListAboutStats(): Promise<AboutStat[]> {
  const db = await getDatabase();
  const [rows] = await db.execute<AboutStatRow[]>(
    `SELECT id, value, value_en, label, label_en
     FROM bg_about_stats
     ORDER BY display_order ASC, id ASC`,
  );
  if (!rows || rows.length === 0) return FALLBACK_ABOUT_STATS;
  return rows.map(fromRow);
}

/** Crée une carte et la renvoie. Place la nouvelle carte en fin de liste. */
export async function createAboutStat(input: AboutStatInput): Promise<AboutStat> {
  const validation = validateAboutStatInput(input);
  if (!validation.ok) throw new Error(validation.error);
  const { value, valueEn, label, labelEn } = validation.value;

  const db = await getDatabase();
  const [res] = await db.execute<ResultSetHeader>(
    `INSERT INTO bg_about_stats (value, value_en, label, label_en, display_order)
     VALUES (?, ?, ?, ?, (SELECT COALESCE(MAX(display_order), 0) + 10 FROM bg_about_stats AS s))`,
    [value, valueEn, label, labelEn],
  );

  // Le staff vient d'écrire : la vitrine doit le montrer sans attendre.
  invalidateShowcase();
  return { id: Number(res.insertId), value, valueEn, label, labelEn };
}

/**
 * Met à jour une carte existante et renvoie sa version mise à jour. `valueEn`
 * absent (`undefined`) conserve la valeur anglaise enregistrée ; `null` ou vide l'efface.
 */
export async function updateAboutStat(id: number, input: AboutStatInput): Promise<AboutStat> {
  const validation = validateAboutStatInput(input);
  if (!validation.ok) throw new Error(validation.error);
  const { value, valueEn, label, labelEn } = validation.value;

  // Clé `valueEn` absente (onglet resté sur un ancien bundle) : l'anglais
  // enregistré n'est pas touché, plutôt qu'effacé sans avertissement.
  const keepValueEn = input.valueEn === undefined;
  const db = await getDatabase();
  const [res] = keepValueEn
    ? await db.execute<ResultSetHeader>(`UPDATE bg_about_stats SET value = ?, label = ?, label_en = ? WHERE id = ?`, [
        value,
        label,
        labelEn,
        id,
      ])
    : await db.execute<ResultSetHeader>(
        `UPDATE bg_about_stats SET value = ?, value_en = ?, label = ?, label_en = ? WHERE id = ?`,
        [value, valueEn, label, labelEn, id],
      );
  if (res.affectedRows === 0) throw new Error("ABOUT_STAT_NOT_FOUND");

  let keptValueEn = valueEn;
  if (keepValueEn) {
    const [rows] = await db.execute<AboutStatRow[]>(`SELECT value_en FROM bg_about_stats WHERE id = ?`, [id]);
    keptValueEn = rows?.[0]?.value_en ?? null;
  }

  // Le staff vient d'écrire : la vitrine doit le montrer sans attendre.
  invalidateShowcase();
  return { id, value, valueEn: keptValueEn, label, labelEn };
}

/**
 * Réordonne les cartes « L'association » selon la liste d'ids fournie (premier =
 * affiché en tête). Réécrit `display_order` de façon atomique.
 */
export async function reorderAboutStats(ids: number[]): Promise<void> {
  await applyDisplayOrder("bg_about_stats", ids);
  // Le staff vient d'écrire : la vitrine doit le montrer sans attendre.
  invalidateShowcase();
}

/** Supprime une carte. Lève `ABOUT_STAT_NOT_FOUND` si l'id n'existe pas. */
export async function deleteAboutStat(id: number): Promise<void> {
  const db = await getDatabase();
  const [res] = await db.execute<ResultSetHeader>(
    `DELETE FROM bg_about_stats WHERE id = ?`,
    [id],
  );
  if (res.affectedRows === 0) throw new Error("ABOUT_STAT_NOT_FOUND");
  // Le staff vient d'écrire : la vitrine doit le montrer sans attendre.
  invalidateShowcase();
}
