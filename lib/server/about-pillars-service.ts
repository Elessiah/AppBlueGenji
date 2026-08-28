import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { getDatabase } from "./database";
import { applyDisplayOrder } from "./reorder";
import {
  type AboutPillar,
  type AboutPillarInput,
  FALLBACK_ABOUT_PILLARS,
  validateAboutPillarInput,
} from "@/lib/shared/about-pillars";
import { cachedShowcase, invalidateShowcase } from "./showcase-cache";

export type { AboutPillar, AboutPillarInput } from "@/lib/shared/about-pillars";
export { FALLBACK_ABOUT_PILLARS } from "@/lib/shared/about-pillars";

interface AboutPillarRow extends RowDataPacket {
  id: number;
  title: string;
  text: string;
}

function fromRow(row: AboutPillarRow): AboutPillar {
  return { id: Number(row.id), title: row.title, text: row.text };
}

/**
 * Liste les piliers « L'association » triés par ordre d'affichage. Renvoie les
 * piliers de secours si la base ne contient aucune ligne ou est injoignable,
 * afin que la section reste toujours peuplée.
 */
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
export async function listAboutPillars(): Promise<AboutPillar[]> {
  try {
    return await cachedShowcase("about-pillars", loadListAboutPillars);
  } catch {
    return FALLBACK_ABOUT_PILLARS;
  }
}

async function loadListAboutPillars(): Promise<AboutPillar[]> {
  const db = await getDatabase();
  const [rows] = await db.execute<AboutPillarRow[]>(
    `SELECT id, title, text
     FROM bg_about_pillars
     ORDER BY display_order ASC, id ASC`,
  );
  if (!rows || rows.length === 0) return FALLBACK_ABOUT_PILLARS;
  return rows.map(fromRow);
}

/** Crée un pilier et le renvoie. Place le nouveau pilier en fin de liste. */
export async function createAboutPillar(input: AboutPillarInput): Promise<AboutPillar> {
  const validation = validateAboutPillarInput(input);
  if (!validation.ok) throw new Error(validation.error);
  const { title, text } = validation.value;

  const db = await getDatabase();
  const [res] = await db.execute<ResultSetHeader>(
    `INSERT INTO bg_about_pillars (title, text, display_order)
     VALUES (?, ?, (SELECT COALESCE(MAX(display_order), 0) + 10 FROM bg_about_pillars AS p))`,
    [title, text],
  );

  // Le staff vient d'écrire : la vitrine doit le montrer sans attendre.
  invalidateShowcase();
  return { id: Number(res.insertId), title, text };
}

/** Met à jour un pilier existant et renvoie sa version mise à jour. */
export async function updateAboutPillar(id: number, input: AboutPillarInput): Promise<AboutPillar> {
  const validation = validateAboutPillarInput(input);
  if (!validation.ok) throw new Error(validation.error);
  const { title, text } = validation.value;

  const db = await getDatabase();
  const [res] = await db.execute<ResultSetHeader>(
    `UPDATE bg_about_pillars SET title = ?, text = ? WHERE id = ?`,
    [title, text, id],
  );
  if (res.affectedRows === 0) throw new Error("ABOUT_PILLAR_NOT_FOUND");

  // Le staff vient d'écrire : la vitrine doit le montrer sans attendre.
  invalidateShowcase();
  return { id, title, text };
}

/**
 * Réordonne les piliers « L'association » selon la liste d'ids fournie
 * (premier = affiché en tête). Réécrit `display_order` de façon atomique.
 */
export async function reorderAboutPillars(ids: number[]): Promise<void> {
  await applyDisplayOrder("bg_about_pillars", ids);
  // Le staff vient d'écrire : la vitrine doit le montrer sans attendre.
  invalidateShowcase();
}

/** Supprime un pilier. Lève `ABOUT_PILLAR_NOT_FOUND` si l'id n'existe pas. */
export async function deleteAboutPillar(id: number): Promise<void> {
  const db = await getDatabase();
  const [res] = await db.execute<ResultSetHeader>(
    `DELETE FROM bg_about_pillars WHERE id = ?`,
    [id],
  );
  if (res.affectedRows === 0) throw new Error("ABOUT_PILLAR_NOT_FOUND");
  // Le staff vient d'écrire : la vitrine doit le montrer sans attendre.
  invalidateShowcase();
}
