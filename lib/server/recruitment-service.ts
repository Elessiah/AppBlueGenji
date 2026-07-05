import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { getDatabase } from "./database";
import { applyDisplayOrder } from "./reorder";
import {
  type RecruitmentAd,
  type RecruitmentAdInput,
  validateRecruitmentAdInput,
} from "@/lib/shared/recruitment";

export type { RecruitmentAd, RecruitmentAdInput } from "@/lib/shared/recruitment";

interface RecruitmentRow extends RowDataPacket {
  id: number;
  title: string;
  team_name: string | null;
  game: RecruitmentAd["game"];
  roles: string | null;
  body: string | null;
  contact_url: string | null;
  highlight: RecruitmentAd["highlight"];
  active: number;
}

function fromRow(row: RecruitmentRow): RecruitmentAd {
  return {
    id: Number(row.id),
    title: row.title,
    teamName: row.team_name,
    game: row.game,
    roles: row.roles,
    body: row.body,
    contactUrl: row.contact_url,
    highlight: row.highlight,
    active: Boolean(row.active),
  };
}

const SELECT_COLUMNS = `id, title, team_name, game, roles, body, contact_url, highlight, active`;

/**
 * Liste les annonces de recrutement, triées par ordre d'affichage. Par défaut
 * seules les annonces actives sont renvoyées (vue publique) ; passer
 * `includeInactive` permet à un administrateur de gérer aussi les brouillons.
 * Retourne `[]` si la base est injoignable.
 */
export async function listRecruitmentAds(includeInactive = false): Promise<RecruitmentAd[]> {
  try {
    const db = await getDatabase();
    const [rows] = await db.execute<RecruitmentRow[]>(
      `SELECT ${SELECT_COLUMNS}
       FROM bg_recruitment_ads
       ${includeInactive ? "" : "WHERE active = 1"}
       ORDER BY display_order ASC, id ASC`,
    );
    return (rows ?? []).map(fromRow);
  } catch {
    return [];
  }
}

/**
 * Renvoie l'annonce urgente à mettre en avant sur le site (banderole ou modale) :
 * la première annonce active dont le mode de mise en avant n'est pas `NONE`,
 * selon l'ordre d'affichage. Retourne `null` si aucune ou si la base est
 * injoignable.
 */
export async function getHighlightedAd(): Promise<RecruitmentAd | null> {
  try {
    const db = await getDatabase();
    const [rows] = await db.execute<RecruitmentRow[]>(
      `SELECT ${SELECT_COLUMNS}
       FROM bg_recruitment_ads
       WHERE active = 1 AND highlight <> 'NONE'
       ORDER BY display_order ASC, id ASC
       LIMIT 1`,
    );
    return rows.length > 0 ? fromRow(rows[0]) : null;
  } catch {
    return null;
  }
}

/** Crée une annonce et la renvoie. Placée en fin de liste. */
export async function createRecruitmentAd(input: RecruitmentAdInput): Promise<RecruitmentAd> {
  const validation = validateRecruitmentAdInput(input);
  if (!validation.ok) throw new Error(validation.error);
  const { title, teamName, game, roles, body, contactUrl, highlight, active } = validation.value;

  const db = await getDatabase();
  const [res] = await db.execute<ResultSetHeader>(
    `INSERT INTO bg_recruitment_ads
       (title, team_name, game, roles, body, contact_url, highlight, active, display_order)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?,
       (SELECT COALESCE(MAX(display_order), 0) + 10 FROM bg_recruitment_ads AS r))`,
    [title, teamName, game, roles, body, contactUrl, highlight, active ? 1 : 0],
  );

  return { id: Number(res.insertId), title, teamName, game, roles, body, contactUrl, highlight, active };
}

/** Met à jour une annonce existante. Lève `RECRUITMENT_NOT_FOUND` si absente. */
export async function updateRecruitmentAd(id: number, input: RecruitmentAdInput): Promise<RecruitmentAd> {
  const validation = validateRecruitmentAdInput(input);
  if (!validation.ok) throw new Error(validation.error);
  const { title, teamName, game, roles, body, contactUrl, highlight, active } = validation.value;

  const db = await getDatabase();
  const [res] = await db.execute<ResultSetHeader>(
    `UPDATE bg_recruitment_ads
     SET title = ?, team_name = ?, game = ?, roles = ?, body = ?, contact_url = ?, highlight = ?, active = ?
     WHERE id = ?`,
    [title, teamName, game, roles, body, contactUrl, highlight, active ? 1 : 0, id],
  );
  if (res.affectedRows === 0) throw new Error("RECRUITMENT_NOT_FOUND");

  return { id, title, teamName, game, roles, body, contactUrl, highlight, active };
}

/**
 * Réordonne les annonces selon la liste d'ids fournie (premier = affiché en
 * tête). Réécrit `display_order` de façon atomique.
 */
export async function reorderRecruitmentAds(ids: number[]): Promise<void> {
  await applyDisplayOrder("bg_recruitment_ads", ids);
}

/** Supprime une annonce. Lève `RECRUITMENT_NOT_FOUND` si l'id n'existe pas. */
export async function deleteRecruitmentAd(id: number): Promise<void> {
  const db = await getDatabase();
  const [res] = await db.execute<ResultSetHeader>(
    `DELETE FROM bg_recruitment_ads WHERE id = ?`,
    [id],
  );
  if (res.affectedRows === 0) throw new Error("RECRUITMENT_NOT_FOUND");
}
