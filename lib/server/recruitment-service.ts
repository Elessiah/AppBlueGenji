import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { getDatabase } from "./database";
import { cachedShowcase, invalidateShowcase } from "./showcase-cache";
import { applyDisplayOrder } from "./reorder";
import {
  type RecruiterContactDefaults,
  type RecruitmentAd,
  type RecruitmentAdInput,
  type RecruitmentPriority,
  type RecruitmentSpotlight,
  recruitmentOrderMixesPriorities,
  selectRecruitmentSpotlight,
  sortRecruitmentAds,
  validateRecruitmentAdInput,
} from "@/lib/shared/recruitment";

export type {
  RecruiterContactDefaults,
  RecruitmentAd,
  RecruitmentAdInput,
  RecruitmentSpotlight,
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
  priority: RecruitmentAd["priority"];
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
    priority: row.priority,
    active: Boolean(row.active),
  };
}

const SELECT_COLUMNS = `id, title, team_name, domain, roles, body, contact_url, contact_discord, contact_discord_id, contact_preferred, priority, active`;

/** Lecture nue, sans cache : l'assiette dépend de `includeInactive`. */
async function loadRecruitmentAds(includeInactive: boolean): Promise<RecruitmentAd[]> {
  const db = await getDatabase();
  const [rows] = await db.execute<RecruitmentRow[]>(
    `SELECT ${SELECT_COLUMNS}
     FROM bg_recruitment_ads
     ${includeInactive ? "" : "WHERE active = 1"}
     ORDER BY display_order ASC, id ASC`,
  );
  // L'ordre d'affichage ne vaut qu'**à l'intérieur** d'un statut : le tri par
  // statut vit dans le module pur, que la mise en avant et la page partagent.
  return sortRecruitmentAds((rows ?? []).map(fromRow));
}

/**
 * Liste les annonces de recrutement, triées par ordre d'affichage. Par défaut
 * seules les annonces actives sont renvoyées (vue publique) ; passer
 * `includeInactive` permet à un administrateur de gérer aussi les brouillons.
 * Retourne `[]` si la base est injoignable.
 */
export async function listRecruitmentAds(includeInactive = false): Promise<RecruitmentAd[]> {
  try {
    // Seule la **vue publique** est mutualisée : `/recrutement` est rendue à
    // chaque visite (elle lit la session) et n'est pas une route API, donc
    // aucun plafond de débit ne peut la protéger. La vue du staff, brouillons
    // compris, passe droit en base — elle est rare, et la mettre en cache sous
    // la même clé servirait des brouillons au public (même règle que la portée
    // `hiddenOnly` de la liste des tournois).
    if (includeInactive) return await loadRecruitmentAds(true);
    return await cachedShowcase("recruitment-ads", () => loadRecruitmentAds(false));
  } catch {
    return [];
  }
}

/** Aucune mise en avant : ce que rend la vitrine quand la base ne répond pas. */
const EMPTY_SPOTLIGHT: RecruitmentSpotlight<RecruitmentAd> = { modal: [], banner: [] };

/**
 * Renvoie les annonces mises en avant sur le site : les **prioritaires** pour
 * la modale d'arrivée, prioritaires **et** importantes pour la banderole.
 * Listes vides si aucune ou si la base est injoignable.
 *
 * Le choix n'est pas refait ici : la requête ne remonte que les candidates
 * publiées dans l'ordre d'affichage, et c'est `selectRecruitmentSpotlight` — la
 * même règle pure que la page et la gestion — qui les répartit. Sans ça, un
 * jour où l'un des deux tris change, la gestion annoncerait « dans la modale »
 * une annonce que le site ne montre pas.
 */
export async function getRecruitmentSpotlight(): Promise<RecruitmentSpotlight<RecruitmentAd>> {
  try {
    // La mise en avant est montée dans la **mise en page racine** : elle est
    // donc demandée à chaque arrivée sur le site, par chaque visiteur. Rien ne
    // protégeait d'une arrivée groupée — cent visiteurs, cent requêtes, sur la
    // lecture la plus fréquente du site après la liste des tournois. Le cache à
    // vol unique les ramène à une (60 s).
    return await cachedShowcase("recruitment-spotlight", async () => {
      const db = await getDatabase();
      const [rows] = await db.execute<RecruitmentRow[]>(
        `SELECT ${SELECT_COLUMNS}
         FROM bg_recruitment_ads
         WHERE active = 1 AND priority <> 'OPTIONAL'
         ORDER BY display_order ASC, id ASC`,
      );
      return selectRecruitmentSpotlight((rows ?? []).map(fromRow));
    });
  } catch {
    return EMPTY_SPOTLIGHT;
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
    priority,
    active,
  } = validation.value;

  const db = await getDatabase();
  const [res] = await db.execute<ResultSetHeader>(
    `INSERT INTO bg_recruitment_ads
       (title, team_name, domain, roles, body, contact_url, contact_discord,
        contact_discord_id, contact_preferred, priority, active, display_order)
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
      priority,
      active ? 1 : 0,
    ],
  );

  // Le staff vient d'écrire : la vitrine doit le montrer sans attendre.
  invalidateShowcase();
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
    priority,
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
    priority,
    active,
  } = validation.value;

  const db = await getDatabase();
  // On vérifie l'existence par un SELECT plutôt que via `affectedRows` : sans
  // `CLIENT_FOUND_ROWS`, mysql2 compte les lignes *modifiées*, donc un
  // enregistrement sans changement renverrait 0 et masquerait une annonce
  // pourtant présente derrière un faux `RECRUITMENT_NOT_FOUND`.
  const [existing] = await db.execute<(RowDataPacket & { id: number; priority: RecruitmentPriority })[]>(
    `SELECT id, priority FROM bg_recruitment_ads WHERE id = ? LIMIT 1`,
    [id],
  );
  if (existing.length === 0) throw new Error("RECRUITMENT_NOT_FOUND");

  // Un changement de statut fait **changer de groupe** : l'annonce passe en fin
  // du nouveau, comme une annonce neuve. Garder son rang la ferait atterrir au
  // hasard de son ancienne position. Lu à part plutôt qu'en sous-requête de
  // l'`UPDATE`, que MySQL refuse sur la table même qu'il modifie ; une course
  // entre deux gestionnaires donnerait deux rangs égaux, départagés par l'id.
  let displayOrder: number | null = null;
  if (existing[0].priority !== priority) {
    const [last] = await db.execute<(RowDataPacket & { next_order: number | string })[]>(
      `SELECT COALESCE(MAX(display_order), 0) + 10 AS next_order FROM bg_recruitment_ads`,
    );
    displayOrder = Number(last[0]?.next_order ?? 10);
  }

  await db.execute<ResultSetHeader>(
    `UPDATE bg_recruitment_ads
     SET title = ?, team_name = ?, domain = ?, roles = ?, body = ?, contact_url = ?,
         contact_discord = ?, contact_discord_id = ?, contact_preferred = ?,
         priority = ?, active = ?, display_order = COALESCE(?, display_order)
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
      priority,
      active ? 1 : 0,
      displayOrder,
      id,
    ],
  );

  // Le staff vient d'écrire : la vitrine doit le montrer sans attendre.
  invalidateShowcase();
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
    priority,
    active,
  };
}

/**
 * Réordonne les annonces selon la liste d'ids fournie (premier = affiché en
 * tête). Réécrit `display_order` de façon atomique.
 *
 * Lève `RECRUITMENT_ORDER_MIXES_PRIORITIES` si l'ordre fait passer une annonce
 * devant une autre d'un statut plus important : l'ordre se règle **dans** un
 * statut. Les statuts sont relus en base — ceux du client ont pu vieillir
 * depuis l'ouverture de la page — **sous verrou, dans la transaction de
 * l'écriture** : lus avant, un statut changé entre-temps laisserait passer un
 * ordre mêlé.
 */
export async function reorderRecruitmentAds(ids: number[]): Promise<void> {
  await applyDisplayOrder("bg_recruitment_ads", ids, async (connection) => {
    const [rows] = await connection.execute<
      (RowDataPacket & { id: number; priority: RecruitmentPriority })[]
    >(`SELECT id, priority FROM bg_recruitment_ads FOR UPDATE`);
    const priorityById = new Map((rows ?? []).map((row) => [Number(row.id), row.priority] as const));
    if (recruitmentOrderMixesPriorities(ids, priorityById)) {
      throw new Error("RECRUITMENT_ORDER_MIXES_PRIORITIES");
    }
  });
  // L'ordre décide aussi de celui de la modale et de la banderole : la vitrine doit suivre.
  invalidateShowcase();
}

/** Supprime une annonce. Lève `RECRUITMENT_NOT_FOUND` si l'id n'existe pas. */
export async function deleteRecruitmentAd(id: number): Promise<void> {
  const db = await getDatabase();
  const [res] = await db.execute<ResultSetHeader>(
    `DELETE FROM bg_recruitment_ads WHERE id = ?`,
    [id],
  );
  if (res.affectedRows === 0) throw new Error("RECRUITMENT_NOT_FOUND");
  // Le staff vient d'écrire : la vitrine doit le montrer sans attendre.
  invalidateShowcase();
}
