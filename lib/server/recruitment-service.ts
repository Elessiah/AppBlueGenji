import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { getDatabase } from "./database";
import { applyDisplayOrder } from "./reorder";
import {
  type RecruiterContactDefaults,
  type RecruitmentAd,
  type RecruitmentAdInput,
  selectHighlightedAd,
  validateRecruitmentAdInput,
} from "@/lib/shared/recruitment";

export type {
  RecruiterContactDefaults,
  RecruitmentAd,
  RecruitmentAdInput,
} from "@/lib/shared/recruitment";

interface RecruitmentRow extends RowDataPacket {
  id: number;
  title: string;
  team_name: string | null;
  domain: RecruitmentAd["domain"];
  roles: string | null;
  body: string | null;
  contact_url: string | null;
  contact_discord: string | null;
  contact_discord_id: string | null;
  contact_preferred: RecruitmentAd["contactPreferred"];
  highlight: RecruitmentAd["highlight"];
  active: number;
}

function fromRow(row: RecruitmentRow): RecruitmentAd {
  return {
    id: Number(row.id),
    title: row.title,
    teamName: row.team_name,
    domain: row.domain,
    roles: row.roles,
    body: row.body,
    contactUrl: row.contact_url,
    contactDiscord: row.contact_discord,
    contactDiscordId: row.contact_discord_id,
    contactPreferred: row.contact_preferred ?? "AUTO",
    highlight: row.highlight,
    active: Boolean(row.active),
  };
}

const SELECT_COLUMNS = `id, title, team_name, domain, roles, body, contact_url, contact_discord, contact_discord_id, contact_preferred, highlight, active`;

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
 *
 * Le choix lui-même n'est pas refait ici : la requête ne fait que remonter les
 * candidates dans l'ordre d'affichage, et c'est `selectHighlightedAd` — la même
 * fonction pure que l'interface de gestion utilise pour ses badges — qui désigne
 * la gagnante. Sans ça, un jour où l'un des deux tris change, les badges
 * annonceraient « en ligne » une autre annonce que celle réellement servie.
 */
export async function getHighlightedAd(): Promise<RecruitmentAd | null> {
  try {
    const db = await getDatabase();
    const [rows] = await db.execute<RecruitmentRow[]>(
      `SELECT ${SELECT_COLUMNS}
       FROM bg_recruitment_ads
       WHERE active = 1 AND highlight <> 'NONE'
       ORDER BY display_order ASC, id ASC`,
    );
    return selectHighlightedAd((rows ?? []).map(fromRow));
  } catch {
    return null;
  }
}

/**
 * Récupère les coordonnées Discord du recruteur (pseudo + id snowflake) pour
 * pré-remplir le formulaire de création d'annonce. Retourne des valeurs `null`
 * si l'utilisateur est introuvable ou la base injoignable — l'auto-complétion
 * est un confort, jamais un point de blocage.
 */
export async function getRecruiterContactDefaults(userId: number): Promise<RecruiterContactDefaults> {
  try {
    const db = await getDatabase();
    const [rows] = await db.execute<
      (RowDataPacket & { discord_pseudo: string | null; discord_id: string | null })[]
    >(
      `SELECT discord_pseudo, discord_id FROM bg_users WHERE id = ? LIMIT 1`,
      [userId],
    );
    if (rows.length === 0) return { discord: null, discordId: null };
    return { discord: rows[0].discord_pseudo, discordId: rows[0].discord_id };
  } catch {
    return { discord: null, discordId: null };
  }
}

/** Crée une annonce et la renvoie. Placée en fin de liste. */
export async function createRecruitmentAd(input: RecruitmentAdInput): Promise<RecruitmentAd> {
  const validation = validateRecruitmentAdInput(input);
  if (!validation.ok) throw new Error(validation.error);
  const {
    title,
    teamName,
    domain,
    roles,
    body,
    contactUrl,
    contactDiscord,
    contactDiscordId,
    contactPreferred,
    highlight,
    active,
  } = validation.value;

  const db = await getDatabase();
  const [res] = await db.execute<ResultSetHeader>(
    `INSERT INTO bg_recruitment_ads
       (title, team_name, domain, roles, body, contact_url, contact_discord,
        contact_discord_id, contact_preferred, highlight, active, display_order)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
       (SELECT COALESCE(MAX(display_order), 0) + 10 FROM bg_recruitment_ads AS r))`,
    [
      title,
      teamName,
      domain,
      roles,
      body,
      contactUrl,
      contactDiscord,
      contactDiscordId,
      contactPreferred,
      highlight,
      active ? 1 : 0,
    ],
  );

  return {
    id: Number(res.insertId),
    title,
    teamName,
    domain,
    roles,
    body,
    contactUrl,
    contactDiscord,
    contactDiscordId,
    contactPreferred,
    highlight,
    active,
  };
}

/** Met à jour une annonce existante. Lève `RECRUITMENT_NOT_FOUND` si absente. */
export async function updateRecruitmentAd(id: number, input: RecruitmentAdInput): Promise<RecruitmentAd> {
  const validation = validateRecruitmentAdInput(input);
  if (!validation.ok) throw new Error(validation.error);
  const {
    title,
    teamName,
    domain,
    roles,
    body,
    contactUrl,
    contactDiscord,
    contactDiscordId,
    contactPreferred,
    highlight,
    active,
  } = validation.value;

  const db = await getDatabase();
  // On vérifie l'existence par un SELECT plutôt que via `affectedRows` : sans
  // `CLIENT_FOUND_ROWS`, mysql2 compte les lignes *modifiées*, donc un
  // enregistrement sans changement renverrait 0 et masquerait une annonce
  // pourtant présente derrière un faux `RECRUITMENT_NOT_FOUND`.
  const [existing] = await db.execute<(RowDataPacket & { id: number })[]>(
    `SELECT id FROM bg_recruitment_ads WHERE id = ? LIMIT 1`,
    [id],
  );
  if (existing.length === 0) throw new Error("RECRUITMENT_NOT_FOUND");

  await db.execute<ResultSetHeader>(
    `UPDATE bg_recruitment_ads
     SET title = ?, team_name = ?, domain = ?, roles = ?, body = ?, contact_url = ?,
         contact_discord = ?, contact_discord_id = ?, contact_preferred = ?,
         highlight = ?, active = ?
     WHERE id = ?`,
    [
      title,
      teamName,
      domain,
      roles,
      body,
      contactUrl,
      contactDiscord,
      contactDiscordId,
      contactPreferred,
      highlight,
      active ? 1 : 0,
      id,
    ],
  );

  return {
    id,
    title,
    teamName,
    domain,
    roles,
    body,
    contactUrl,
    contactDiscord,
    contactDiscordId,
    contactPreferred,
    highlight,
    active,
  };
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
