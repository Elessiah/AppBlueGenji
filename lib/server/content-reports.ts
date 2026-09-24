/**
 * Signalements adressés à l'association — service.
 *
 * Les règles (catégories, validation, cycle de vie, conservation, ligne
 * Discord) vivent dans le module pur `lib/shared/content-reports.ts` ; ici, la
 * base et l'envoi.
 *
 * **Conservation.** Un signalement ouvert est gardé le temps de son
 * traitement ; résolu, il est effacé `REPORT_RETENTION_DAYS_AFTER_RESOLUTION`
 * jours plus tard, cibles comprises (cascade). La purge est **datée**, pas
 * programmée : elle efface tout ce dont la date est passée, si bien qu'une base
 * restaurée depuis une sauvegarde plus ancienne se purge d'elle-même au passage
 * suivant — aucun signalement effacé ne « revient » durablement.
 */
import type { PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { getDatabase } from "@/lib/server/database";
import {
  pushDiscordDirectMessages,
  pushLeadershipAlert,
  type DiscordRecipient,
} from "@/lib/server/bot-integration";
import { siteCanonicalBase } from "@/lib/server/site-url";
import { publishStaffAction } from "@/lib/server/staff-audit";
import { listQuarantinesForReports, purgeDueQuarantines } from "@/lib/server/logo-quarantine";
import { toIso } from "@/lib/server/serialization";
import { localUploadUrl } from "@/lib/shared/uploads";
import { visibleAvatarUrl } from "@/lib/shared/avatar";
import { canViewTournament, isTournamentPublished } from "@/lib/shared/tournament-visibility";
import { displayTeamTag } from "@/lib/shared/team-tag";
import type { PersonalDataExport } from "@/lib/shared/types";
import {
  REPORTS_HOURLY_CAP,
  REPORT_RESOLUTION_NOTE_MAX_LENGTH,
  REPORT_RETENTION_DAYS_AFTER_RESOLUTION,
  REPORT_TARGET_NOTICE_COOLDOWN_HOURS,
  REPORT_TARGET_SEARCH_LIMIT,
  REPORT_TARGET_SEARCH_MIN_LENGTH,
  formatContestAlert,
  formatReportAlert,
  formatTargetNotice,
  isConcernedByReport,
  nextReportStatus,
  reportAdminHref,
  reportConcernedHref,
  reportPurgeDate,
  type ConcernedReportView,
  type ContestableReportOption,
  type ReportAction,
  type ReportCategory,
  type ReportContestView,
  type ReportPerson,
  type ReportStatus,
  type ReportSubmission,
  type ReportTargetOption,
  type ReportTargetRef,
  type ReportTargetType,
  type ReportTargetView,
  type ReportView,
  type RightsRelation,
} from "@/lib/shared/content-reports";

/** Ce que le service sait de celui qui lit ou écrit. */
export interface ReportViewer {
  userId: number | null;
  /** Permission `tournaments` : un tournoi non publié lui est désignable. */
  managesTournaments: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Cibles
// ─────────────────────────────────────────────────────────────────────────────

type UserTargetRow = RowDataPacket & {
  id: number;
  pseudo: string;
  avatar_url: string | null;
  visible_avatar: 0 | 1;
};

type TeamTargetRow = RowDataPacket & {
  id: number;
  name: string;
  tag: string | null;
  logo_url: string | null;
  is_ghost: 0 | 1;
};

type TournamentTargetRow = RowDataPacket & {
  id: number;
  name: string;
  image_url: string | null;
  start_visibility_at: Date | string;
};

function userOption(row: UserTargetRow): ReportTargetOption {
  return {
    type: "USER",
    id: Number(row.id),
    label: row.pseudo,
    detail: null,
    imageUrl: visibleAvatarUrl(row.avatar_url, row.visible_avatar === 1),
  };
}

function teamOption(row: TeamTargetRow): ReportTargetOption {
  return {
    type: "TEAM",
    id: Number(row.id),
    label: row.name,
    detail: row.is_ghost === 1 ? "Équipe fantôme" : displayTeamTag(row.tag, row.name),
    imageUrl: localUploadUrl(row.logo_url),
  };
}

function tournamentOption(row: TournamentTargetRow): ReportTargetOption {
  return {
    type: "TOURNAMENT",
    id: Number(row.id),
    label: row.name,
    detail: isTournamentPublished({ startVisibilityAt: row.start_visibility_at }) ? null : "Non publié",
    imageUrl: localUploadUrl(row.image_url),
  };
}

/**
 * Échappe les jokers d'un motif `LIKE` : un « % » tapé dans la recherche est un
 * caractère, pas « n'importe quoi ».
 */
export function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

const USER_TARGET_COLUMNS = `id, pseudo, avatar_url, visible_avatar`;
const TEAM_TARGET_COLUMNS = `id, name, tag, logo_url, is_ghost`;
const TOURNAMENT_TARGET_COLUMNS = `id, name, image_url, start_visibility_at`;

/**
 * Ce qu'un signalement peut désigner : un compte **non supprimé**, une équipe
 * **vivante et réelle ou fantôme** (jamais une entrée solo — c'est le joueur
 * qu'on désigne), un tournoi **que le lecteur peut ouvrir**.
 */
const TARGET_FILTERS: Record<ReportTargetType, string> = {
  USER: `is_deleted = 0`,
  TEAM: `deleted_at IS NULL AND solo_user_id IS NULL`,
  TOURNAMENT: `1 = 1`,
};

function keepVisibleTournaments(rows: TournamentTargetRow[], viewer: ReportViewer): TournamentTargetRow[] {
  return rows.filter((row) =>
    canViewTournament({ startVisibilityAt: row.start_visibility_at }, { canManage: viewer.managesTournaments }),
  );
}

/**
 * Propositions du sélecteur, par nom (pseudo, nom ou sigle d'équipe, nom de
 * tournoi).
 */
export async function searchReportTargets(
  type: ReportTargetType,
  rawQuery: string,
  viewer: ReportViewer,
): Promise<ReportTargetOption[]> {
  const query = rawQuery.trim();
  if (query.length < REPORT_TARGET_SEARCH_MIN_LENGTH) return [];
  const db = await getDatabase();
  const pattern = `%${escapeLikePattern(query)}%`;
  // Le `LIMIT` ne se lie pas en paramètre avec `execute` : une constante du
  // module, entière par construction.
  const limit = Number(REPORT_TARGET_SEARCH_LIMIT);

  switch (type) {
    case "USER": {
      const [rows] = await db.execute<UserTargetRow[]>(
        `SELECT ${USER_TARGET_COLUMNS} FROM bg_users
         WHERE ${TARGET_FILTERS.USER} AND pseudo LIKE ?
         ORDER BY pseudo LIMIT ${limit}`,
        [pattern],
      );
      return rows.map(userOption);
    }
    case "TEAM": {
      const [rows] = await db.execute<TeamTargetRow[]>(
        `SELECT ${TEAM_TARGET_COLUMNS} FROM bg_teams
         WHERE ${TARGET_FILTERS.TEAM} AND (name LIKE ? OR tag LIKE ?)
         ORDER BY name LIMIT ${limit}`,
        [pattern, pattern],
      );
      return rows.map(teamOption);
    }
    case "TOURNAMENT": {
      // Filtrés en mémoire par la règle partagée de visibilité : le SQL en
      // serait une seconde écriture. D'où une marge sur le `LIMIT`.
      const [rows] = await db.execute<TournamentTargetRow[]>(
        `SELECT ${TOURNAMENT_TARGET_COLUMNS} FROM bg_tournaments
         WHERE name LIKE ?
         ORDER BY start_at DESC LIMIT ${limit * 4}`,
        [pattern],
      );
      return keepVisibleTournaments(rows, viewer).slice(0, limit).map(tournamentOption);
    }
  }
}

/**
 * Résout des cibles désignées par leur identifiant (proposition d'une fiche,
 * relecture à l'envoi). Ce qui n'existe pas — ou que le lecteur ne peut pas
 * voir — est simplement absent du résultat.
 */
export async function resolveReportTargets(
  refs: readonly ReportTargetRef[],
  viewer: ReportViewer,
  executor?: Pick<PoolConnection, "execute">,
): Promise<ReportTargetOption[]> {
  if (refs.length === 0) return [];
  const db = executor ?? (await getDatabase());
  const idsOf = (type: ReportTargetType) => refs.filter((ref) => ref.type === type).map((ref) => ref.id);
  const placeholders = (ids: number[]) => ids.map(() => "?").join(", ");
  const found: ReportTargetOption[] = [];

  const userIds = idsOf("USER");
  if (userIds.length > 0) {
    const [rows] = await db.execute<UserTargetRow[]>(
      `SELECT ${USER_TARGET_COLUMNS} FROM bg_users
       WHERE ${TARGET_FILTERS.USER} AND id IN (${placeholders(userIds)})`,
      userIds,
    );
    found.push(...rows.map(userOption));
  }
  const teamIds = idsOf("TEAM");
  if (teamIds.length > 0) {
    const [rows] = await db.execute<TeamTargetRow[]>(
      `SELECT ${TEAM_TARGET_COLUMNS} FROM bg_teams
       WHERE ${TARGET_FILTERS.TEAM} AND id IN (${placeholders(teamIds)})`,
      teamIds,
    );
    found.push(...rows.map(teamOption));
  }
  const tournamentIds = idsOf("TOURNAMENT");
  if (tournamentIds.length > 0) {
    const [rows] = await db.execute<TournamentTargetRow[]>(
      `SELECT ${TOURNAMENT_TARGET_COLUMNS} FROM bg_tournaments
       WHERE id IN (${placeholders(tournamentIds)})`,
      tournamentIds,
    );
    found.push(...keepVisibleTournaments(rows, viewer).map(tournamentOption));
  }

  // Dans l'ordre de la demande, pas dans celui des trois requêtes.
  const byKey = new Map(found.map((option) => [`${option.type}:${option.id}`, option]));
  return refs
    .map((ref) => byKey.get(`${ref.type}:${ref.id}`))
    .filter((option): option is ReportTargetOption => option !== undefined);
}

// ─────────────────────────────────────────────────────────────────────────────
// Envoi
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Enregistre un signalement, puis prévient le propriétaire et le président de
 * l'association sur Discord.
 *
 * L'alerte n'est **pas attendue** : le signalement est enregistré, c'est ce
 * que le signalant doit savoir, et le panneau le montre qu'elle soit partie ou
 * non. Un bot injoignable ne doit ni ralentir ni faire échouer l'envoi.
 *
 * **Désigner des cibles exige un compte.** Chaque cible désignée reçoit un
 * message privé : ouvert aux visiteurs anonymes, le formulaire ferait écrire le
 * bot à n'importe quel joueur dont on devine l'identifiant, sans autre borne
 * qu'un plafond par IP. Un visiteur sans compte décrit ce qu'il signale — le
 * formulaire ne lui propose d'ailleurs aucun sélecteur.
 *
 * @throws REPORT_TARGETS_REQUIRE_LOGIN Des cibles désignées sans compte.
 * @throws REPORTS_SATURATED Trop de signalements reçus dans l'heure.
 * @throws REPORT_TARGET_NOT_FOUND Une cible n'existe pas ou n'est pas visible.
 */
export async function createReport(submission: ReportSubmission, viewer: ReportViewer): Promise<number> {
  if (submission.category === "CONTEST") return createContest(submission, viewer);
  if (viewer.userId === null && submission.targets.length > 0) throw new Error("REPORT_TARGETS_REQUIRE_LOGIN");
  const db = await getDatabase();
  const connection = await db.getConnection();
  let reportId: number;
  let targets: ReportTargetOption[];
  try {
    await connection.beginTransaction();

    await assertReportsNotSaturated(connection);

    targets = await resolveReportTargets(submission.targets, viewer, connection);
    if (targets.length !== submission.targets.length) throw new Error("REPORT_TARGET_NOT_FOUND");

    const [inserted] = await connection.execute<ResultSetHeader>(
      `INSERT INTO bg_reports
         (category, description, page_path, reporter_user_id, contact_name, contact_email,
          rights_relation, consent_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, NOW())`,
      [
        submission.category,
        submission.description,
        submission.pagePath,
        viewer.userId,
        submission.contactName,
        submission.contactEmail,
        submission.rightsRelation,
      ],
    );
    reportId = Number(inserted.insertId);

    for (const target of targets) {
      await connection.execute(
        `INSERT INTO bg_report_targets (report_id, target_type, target_id, label_snapshot)
         VALUES (?, ?, ?, ?)`,
        [reportId, target.type, target.id, target.label.slice(0, 191)],
      );
    }

    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }

  const message = formatReportAlert({
    id: reportId,
    category: submission.category,
    // Le libellé d'un joueur n'est même pas transmis au formateur : ce qui ne
    // lui parvient pas ne peut pas partir sur Discord.
    targets: targets.map((target) => ({ type: target.type, label: target.type === "USER" ? null : target.label })),
    fromMember: viewer.userId !== null,
    adminUrl: `${siteCanonicalBase()}${reportAdminHref(reportId)}`,
  });
  void pushLeadershipAlert(message, "content-report").catch(() => undefined);
  void notifyReportTargets(reportId, submission.category, targets, viewer.userId).catch((error) => {
    console.error("[reports] personnes visées non prévenues", error);
  });
  void purgeExpiredReports().catch(() => undefined);

  return reportId;
}

/** @throws REPORTS_SATURATED */
async function assertReportsNotSaturated(connection: Pick<PoolConnection, "execute">): Promise<void> {
  const [recent] = await connection.execute<(RowDataPacket & { total: number })[]>(
    `SELECT COUNT(*) AS total FROM bg_reports WHERE created_at > NOW() - INTERVAL 1 HOUR`,
  );
  if (Number(recent[0]?.total ?? 0) >= REPORTS_HOURLY_CAP) throw new Error("REPORTS_SATURATED");
}

/**
 * Équipes dont ce compte est membre **aujourd'hui** (appartenance en cours,
 * équipe vivante, entrée solo exclue — elle n'a pas de membre).
 */
export async function loadViewerTeamIds(
  userId: number,
  executor?: Pick<PoolConnection, "execute">,
): Promise<number[]> {
  const db = executor ?? (await getDatabase());
  const [rows] = await db.execute<(RowDataPacket & { team_id: number })[]>(
    `SELECT tm.team_id
     FROM bg_team_members tm
     JOIN bg_teams t ON t.id = tm.team_id
     WHERE tm.user_id = ? AND tm.left_at IS NULL AND t.deleted_at IS NULL AND t.solo_user_id IS NULL`,
    [userId],
  );
  return rows.map((row) => Number(row.team_id));
}

type RecipientRow = RowDataPacket & {
  id: number;
  pseudo: string;
  discord_id: string | null;
  discord_pseudo: string | null;
  discord_verified_at: Date | string | null;
};

/**
 * Prévient en message privé les personnes qu'un signalement vise : les joueurs
 * désignés et les membres **actuels** des équipes désignées, pour qu'elles
 * puissent le contester.
 *
 * Ne sont joints que les comptes dont le site connaît un moyen **prouvé** de les
 * joindre (identifiant Discord, ou tag certifié) — un tag saisi à la main peut
 * désigner n'importe qui. L'auteur du signalement n'est pas prévenu de son
 * propre signalement. Un tournoi désigné ne prévient personne : il n'a pas de
 * membres, il est organisé par l'association. Une cible déjà visée dans les
 * `REPORT_TARGET_NOTICE_COOLDOWN_HOURS` dernières heures n'est pas reprévenue :
 * le message part avant toute lecture par l'association, et sans cette borne
 * le formulaire servirait à faire écrire le bot en boucle à une équipe.
 *
 * Meilleur effort : un bot injoignable laisse le signalement intact, les
 * personnes visées le découvriront quand l'association les contactera.
 */
export async function notifyReportTargets(
  reportId: number,
  category: ReportCategory,
  targets: readonly ReportTargetRef[],
  reporterUserId: number | null,
): Promise<void> {
  const cooled = await recentlyNotifiedTargets(reportId, targets);
  const notYetWarned = (target: ReportTargetRef) => !cooled.has(`${target.type}:${target.id}`);
  const userIds = targets.filter((target) => target.type === "USER" && notYetWarned(target)).map((target) => target.id);
  const teamIds = targets.filter((target) => target.type === "TEAM" && notYetWarned(target)).map((target) => target.id);
  if (userIds.length === 0 && teamIds.length === 0) return;

  const clauses: string[] = [];
  const params: number[] = [];
  if (userIds.length > 0) {
    clauses.push(`u.id IN (${userIds.map(() => "?").join(", ")})`);
    params.push(...userIds);
  }
  if (teamIds.length > 0) {
    clauses.push(
      `u.id IN (SELECT tm.user_id FROM bg_team_members tm
                WHERE tm.left_at IS NULL AND tm.team_id IN (${teamIds.map(() => "?").join(", ")}))`,
    );
    params.push(...teamIds);
  }

  const db = await getDatabase();
  const [rows] = await db.execute<RecipientRow[]>(
    `SELECT u.id, u.pseudo, u.discord_id, u.discord_pseudo, u.discord_verified_at
     FROM bg_users u
     WHERE u.is_deleted = 0 AND (${clauses.join(" OR ")})`,
    params,
  );

  const recipients: DiscordRecipient[] = [];
  for (const row of rows) {
    if (reporterUserId !== null && Number(row.id) === reporterUserId) continue;
    const handle = row.discord_verified_at ? row.discord_pseudo : null;
    if (!row.discord_id && !handle) continue;
    recipients.push({ discordId: row.discord_id, handle, label: row.pseudo });
  }
  if (recipients.length === 0) return;

  const url = `${siteCanonicalBase()}${reportConcernedHref(reportId)}`;
  await pushDiscordDirectMessages(formatTargetNotice({ category, url }), recipients, "content-report-target");
}

/**
 * Cibles de ce signalement déjà visées par un **autre** signalement depuis
 * moins de `REPORT_TARGET_NOTICE_COOLDOWN_HOURS` : elles ont été prévenues, le
 * message de plus est retenu (clés `TYPE:id`).
 */
async function recentlyNotifiedTargets(
  reportId: number,
  targets: readonly ReportTargetRef[],
): Promise<Set<string>> {
  const refs = targets.filter((target) => target.type === "USER" || target.type === "TEAM");
  if (refs.length === 0) return new Set();
  const db = await getDatabase();
  const [rows] = await db.execute<(RowDataPacket & { target_type: ReportTargetType; target_id: number })[]>(
    `SELECT DISTINCT t.target_type, t.target_id
     FROM bg_report_targets t
     JOIN bg_reports r ON r.id = t.report_id
     WHERE r.id <> ?
       AND r.created_at > NOW() - INTERVAL ${Number(REPORT_TARGET_NOTICE_COOLDOWN_HOURS)} HOUR
       AND (${refs.map(() => "(t.target_type = ? AND t.target_id = ?)").join(" OR ")})`,
    [reportId, ...refs.flatMap((target) => [target.type, target.id])],
  );
  return new Set(rows.map((row) => `${row.target_type}:${Number(row.target_id)}`));
}

/**
 * Enregistre la contestation d'un signalement par une personne qu'il vise.
 *
 * Le signalement d'origine est relu **sous verrou**, avec ses cibles et les
 * équipes du lecteur : le droit de contester se juge à l'instant de l'écriture.
 * Un signalement archivé est **réactivé** (il redevient « à traiter ») — une
 * contestation posée sur un dossier clos resterait sinon lettre morte. Dans les
 * deux cas, la direction de l'association est prévenue.
 *
 * Un signalement inexistant et un signalement qui ne vise pas le lecteur
 * donnent le **même** refus : le premier ne doit pas se distinguer du second,
 * les identifiants étant consécutifs.
 *
 * @throws REPORT_CONTEST_LOGIN_REQUIRED
 * @throws REPORT_NOT_CONCERNED
 * @throws REPORTS_SATURATED
 */
async function createContest(submission: ReportSubmission, viewer: ReportViewer): Promise<number> {
  if (viewer.userId === null) throw new Error("REPORT_CONTEST_LOGIN_REQUIRED");
  const parentId = submission.parentReportId;
  if (parentId === null) throw new Error("REPORT_NOT_CONCERNED");
  const userId = viewer.userId;

  const db = await getDatabase();
  const connection = await db.getConnection();
  let contestId: number;
  let parentCategory: ReportCategory;
  let reopened = false;
  try {
    await connection.beginTransaction();
    const [parents] = await connection.execute<
      (RowDataPacket & { category: ReportCategory; status: ReportStatus })[]
    >(`SELECT category, status FROM bg_reports WHERE id = ? FOR UPDATE`, [parentId]);
    if (parents.length === 0) throw new Error("REPORT_NOT_CONCERNED");
    parentCategory = parents[0].category;

    const [targetRows] = await connection.execute<TargetRow[]>(
      `SELECT report_id, target_type, target_id, label_snapshot FROM bg_report_targets WHERE report_id = ?`,
      [parentId],
    );
    const teamIds = await loadViewerTeamIds(userId, connection);
    const concerned = isConcernedByReport(
      { userId, teamIds },
      {
        category: parentCategory,
        targets: targetRows.map((row) => ({ type: row.target_type, id: Number(row.target_id) })),
      },
    );
    if (!concerned) throw new Error("REPORT_NOT_CONCERNED");

    await assertReportsNotSaturated(connection);

    const [inserted] = await connection.execute<ResultSetHeader>(
      `INSERT INTO bg_reports
         (category, parent_report_id, description, page_path, reporter_user_id, contact_email, consent_at)
       VALUES ('CONTEST', ?, ?, ?, ?, ?, NOW())`,
      [parentId, submission.description, submission.pagePath, userId, submission.contactEmail],
    );
    contestId = Number(inserted.insertId);

    if (parents[0].status === "RESOLVED") {
      await connection.execute(
        `UPDATE bg_reports SET status = 'OPEN', resolved_at = NULL WHERE id = ?`,
        [parentId],
      );
      reopened = true;
    }
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }

  const message = formatContestAlert({
    contestId,
    parentId,
    parentCategory,
    reopened,
    adminUrl: `${siteCanonicalBase()}${reportAdminHref(parentId)}`,
  });
  void pushLeadershipAlert(message, "content-report-contest").catch(() => undefined);
  return contestId;
}

/**
 * Signalements et contestations envoyés depuis ce compte, pour l'export de ses
 * données — **tout** ce que la ligne garde de lui, coordonnées saisies
 * comprises : un export qui les tairait ne répondrait pas au droit d'accès.
 */
export async function listReportsByAuthor(userId: number): Promise<PersonalDataExport["reports"]> {
  const db = await getDatabase();
  const [rows] = await db.execute<
    (RowDataPacket & {
      id: number;
      category: string;
      status: string;
      description: string;
      page_path: string | null;
      contact_name: string | null;
      contact_email: string | null;
      rights_relation: string | null;
      parent_report_id: number | null;
      created_at: Date | string;
    })[]
  >(
    `SELECT id, category, status, description, page_path, contact_name, contact_email,
            rights_relation, parent_report_id, created_at
     FROM bg_reports
     WHERE reporter_user_id = ? ORDER BY created_at, id`,
    [userId],
  );
  return rows.map((row) => ({
    id: Number(row.id),
    category: row.category,
    status: row.status,
    description: row.description,
    pagePath: row.page_path,
    contactName: row.contact_name,
    contactEmail: row.contact_email,
    rightsRelation: row.rights_relation,
    parentReportId: row.parent_report_id === null ? null : Number(row.parent_report_id),
    createdAt: toIso(row.created_at) ?? new Date().toISOString(),
  }));
}

// ─────────────────────────────────────────────────────────────────────────────
// Lecture par une personne visée
// ─────────────────────────────────────────────────────────────────────────────

function isOwnTarget(row: TargetRow, userId: number, teamIds: readonly number[]): boolean {
  return (
    (row.target_type === "USER" && Number(row.target_id) === userId) ||
    (row.target_type === "TEAM" && teamIds.includes(Number(row.target_id)))
  );
}

/**
 * Un signalement, pour une personne qu'il vise — `null` s'il n'existe pas, s'il
 * ne la vise pas, ou si c'est une contestation (le lecteur ne distingue pas ces
 * trois cas, et c'est voulu).
 *
 * Ne sort **rien** du signalant : ni compte, ni nom, ni adresse. Les cibles
 * sont réduites à celles qui concernent le lecteur.
 */
export async function getConcernedReport(reportId: number, viewerUserId: number): Promise<ConcernedReportView | null> {
  const db = await getDatabase();
  const [rows] = await db.execute<
    (RowDataPacket & {
      id: number;
      category: ReportCategory;
      status: ReportStatus;
      description: string;
      created_at: Date | string;
    })[]
  >(`SELECT id, category, status, description, created_at FROM bg_reports WHERE id = ? LIMIT 1`, [reportId]);
  if (rows.length === 0) return null;
  const row = rows[0];

  const [targetRows] = await db.execute<TargetRow[]>(
    `SELECT report_id, target_type, target_id, label_snapshot FROM bg_report_targets WHERE report_id = ?`,
    [reportId],
  );
  const teamIds = await loadViewerTeamIds(viewerUserId);
  const refs = targetRows.map((target) => ({ type: target.target_type, id: Number(target.target_id) }));
  if (!isConcernedByReport({ userId: viewerUserId, teamIds }, { category: row.category, targets: refs })) {
    return null;
  }

  const mine = targetRows.filter((target) => isOwnTarget(target, viewerUserId, teamIds));
  const live = await resolveReportTargets(
    mine.map((target) => ({ type: target.target_type, id: Number(target.target_id) })),
    { userId: viewerUserId, managesTournaments: false },
  );

  const [contests] = await db.execute<
    (RowDataPacket & { id: number; description: string; created_at: Date | string })[]
  >(
    `SELECT id, description, created_at FROM bg_reports
     WHERE parent_report_id = ? AND reporter_user_id = ?
     ORDER BY created_at, id`,
    [reportId, viewerUserId],
  );

  return {
    id: Number(row.id),
    category: row.category,
    status: row.status,
    description: row.description,
    createdAt: toIso(row.created_at) ?? new Date().toISOString(),
    targets: mine.map((target) => toTargetView(target, live)),
    // Seulement les logos de **ses** équipes : ceux des autres équipes visées
    // ne le regardent pas.
    quarantines: (await listQuarantinesForReports([reportId])).filter((quarantine) =>
      teamIds.includes(quarantine.teamId),
    ),
    myContests: contests.map((contest) => ({
      id: Number(contest.id),
      description: contest.description,
      createdAt: toIso(contest.created_at) ?? new Date().toISOString(),
    })),
  };
}

/**
 * Les signalements qui visent ce lecteur (choix du formulaire de
 * contestation), du plus récent au plus ancien.
 */
export async function listContestableReports(viewerUserId: number): Promise<ContestableReportOption[]> {
  const teamIds = await loadViewerTeamIds(viewerUserId);
  const clauses = [`(t.target_type = 'USER' AND t.target_id = ?)`];
  const params: number[] = [viewerUserId];
  if (teamIds.length > 0) {
    clauses.push(`(t.target_type = 'TEAM' AND t.target_id IN (${teamIds.map(() => "?").join(", ")}))`);
    params.push(...teamIds);
  }
  const db = await getDatabase();
  const [rows] = await db.execute<
    (RowDataPacket & { id: number; category: ReportCategory; status: ReportStatus; created_at: Date | string })[]
  >(
    `SELECT DISTINCT r.id, r.category, r.status, r.created_at
     FROM bg_reports r
     JOIN bg_report_targets t ON t.report_id = r.id
     WHERE r.category <> 'CONTEST' AND (${clauses.join(" OR ")})
     ORDER BY r.created_at DESC, r.id DESC`,
    params,
  );
  return rows.map((row) => ({
    id: Number(row.id),
    category: row.category,
    status: row.status,
    createdAt: toIso(row.created_at) ?? new Date().toISOString(),
  }));
}

function toTargetView(row: TargetRow, live: readonly ReportTargetOption[]): ReportTargetView {
  const current = live.find((option) => option.type === row.target_type && option.id === Number(row.target_id));
  return {
    type: row.target_type,
    id: Number(row.target_id),
    label: current?.label ?? row.label_snapshot ?? `#${row.target_id}`,
    exists: current !== undefined,
    imageUrl: current?.imageUrl ?? null,
    detail: current?.detail ?? null,
  };
}


// ─────────────────────────────────────────────────────────────────────────────
// Panneau d'administration
// ─────────────────────────────────────────────────────────────────────────────

type ReportRow = RowDataPacket & {
  id: number;
  category: ReportCategory;
  status: ReportStatus;
  description: string;
  page_path: string | null;
  reporter_user_id: number | null;
  reporter_pseudo: string | null;
  contact_name: string | null;
  contact_email: string | null;
  rights_relation: RightsRelation | null;
  assignee_user_id: number | null;
  assignee_pseudo: string | null;
  resolution_note: string | null;
  created_at: Date | string;
  updated_at: Date | string;
  resolved_at: Date | string | null;
};

type TargetRow = RowDataPacket & {
  report_id: number;
  target_type: ReportTargetType;
  target_id: number;
  label_snapshot: string | null;
};

function person(userId: number | null, pseudo: string | null): ReportPerson | null {
  if (userId === null || pseudo === null) return null;
  return { userId: Number(userId), pseudo };
}

/**
 * Tous les signalements encore conservés, du plus récent au plus ancien, avec
 * leurs cibles **relues** : un logo déjà retiré ne doit plus s'afficher comme
 * s'il était en ligne, et une équipe renommée se lit sous son nom du jour.
 *
 * Tout d'un coup plutôt que par page : la purge borne le volume à ce qui est
 * ouvert, plus trente jours d'archives — quelques dizaines de lignes pour une
 * communauté de cette taille.
 */
export async function listReports(): Promise<ReportView[]> {
  await purgeExpiredReports();
  const db = await getDatabase();
  const [rows] = await db.execute<ReportRow[]>(
    `SELECT r.id, r.category, r.status, r.description, r.page_path,
            r.reporter_user_id, reporter.pseudo AS reporter_pseudo,
            r.contact_name, r.contact_email, r.rights_relation,
            r.assignee_user_id, assignee.pseudo AS assignee_pseudo,
            r.resolution_note, r.created_at, r.updated_at, r.resolved_at
     FROM bg_reports r
     LEFT JOIN bg_users reporter ON reporter.id = r.reporter_user_id
     LEFT JOIN bg_users assignee ON assignee.id = r.assignee_user_id
     WHERE r.parent_report_id IS NULL
     ORDER BY r.created_at DESC, r.id DESC`,
  );
  if (rows.length === 0) return [];

  const ids = rows.map((row) => Number(row.id));
  const contestsByReport = await loadContests(ids);
  const quarantines = await listQuarantinesForReports(ids);
  const [targetRows] = await db.execute<TargetRow[]>(
    `SELECT report_id, target_type, target_id, label_snapshot
     FROM bg_report_targets
     WHERE report_id IN (${ids.map(() => "?").join(", ")})
     ORDER BY FIELD(target_type, 'TEAM', 'USER', 'TOURNAMENT'), target_id`,
    ids,
  );

  // Le panneau voit tout ce qui existe encore : un tournoi non publié compris.
  const live = await resolveReportTargets(
    targetRows.map((row) => ({ type: row.target_type, id: Number(row.target_id) })),
    { userId: null, managesTournaments: true },
  );
  const liveByKey = new Map(live.map((option) => [`${option.type}:${option.id}`, option]));

  const targetsByReport = new Map<number, ReportTargetView[]>();
  for (const row of targetRows) {
    const current = liveByKey.get(`${row.target_type}:${Number(row.target_id)}`);
    const view: ReportTargetView = {
      type: row.target_type,
      id: Number(row.target_id),
      label: current?.label ?? row.label_snapshot ?? `#${row.target_id}`,
      exists: current !== undefined,
      imageUrl: current?.imageUrl ?? null,
      detail: current?.detail ?? null,
    };
    const list = targetsByReport.get(Number(row.report_id)) ?? [];
    list.push(view);
    targetsByReport.set(Number(row.report_id), list);
  }

  return rows.map((row) => {
    const resolvedAt = row.resolved_at ? new Date(row.resolved_at) : null;
    return {
      id: Number(row.id),
      category: row.category,
      status: row.status,
      description: row.description,
      pagePath: row.page_path,
      createdAt: toIso(row.created_at) ?? new Date().toISOString(),
      updatedAt: toIso(row.updated_at) ?? new Date().toISOString(),
      resolvedAt: resolvedAt ? resolvedAt.toISOString() : null,
      purgeAt: row.status === "RESOLVED" && resolvedAt ? reportPurgeDate(resolvedAt).toISOString() : null,
      reporter: person(row.reporter_user_id, row.reporter_pseudo),
      contactName: row.contact_name,
      contactEmail: row.contact_email,
      rightsRelation: row.rights_relation,
      assignee: person(row.assignee_user_id, row.assignee_pseudo),
      resolutionNote: row.resolution_note,
      targets: targetsByReport.get(Number(row.id)) ?? [],
      contests: contestsByReport.get(Number(row.id)) ?? [],
      quarantines: quarantines.filter((quarantine) => quarantine.reportId === Number(row.id)),
    };
  });
}

/**
 * Les contestations des signalements donnés, rangées sous leur signalement
 * d'origine — le panneau ne les liste jamais à part.
 */
async function loadContests(reportIds: readonly number[]): Promise<Map<number, ReportContestView[]>> {
  const byReport = new Map<number, ReportContestView[]>();
  if (reportIds.length === 0) return byReport;
  const db = await getDatabase();
  const [rows] = await db.execute<
    (RowDataPacket & {
      id: number;
      parent_report_id: number;
      description: string;
      created_at: Date | string;
      reporter_user_id: number | null;
      reporter_pseudo: string | null;
      contact_email: string | null;
    })[]
  >(
    `SELECT c.id, c.parent_report_id, c.description, c.created_at, c.reporter_user_id,
            u.pseudo AS reporter_pseudo, c.contact_email
     FROM bg_reports c
     LEFT JOIN bg_users u ON u.id = c.reporter_user_id
     WHERE c.parent_report_id IN (${reportIds.map(() => "?").join(", ")})
     ORDER BY c.created_at, c.id`,
    [...reportIds],
  );
  for (const row of rows) {
    const parentId = Number(row.parent_report_id);
    const list = byReport.get(parentId) ?? [];
    list.push({
      id: Number(row.id),
      description: row.description,
      createdAt: toIso(row.created_at) ?? new Date().toISOString(),
      author: person(row.reporter_user_id, row.reporter_pseudo),
      contactEmail: row.contact_email,
    });
    byReport.set(parentId, list);
  }
  return byReport;
}

/** Signalements qui attendent quelqu'un (pastille de la navigation). */
export async function countOpenReports(): Promise<number> {
  const db = await getDatabase();
  const [rows] = await db.execute<(RowDataPacket & { total: number })[]>(
    `SELECT COUNT(*) AS total FROM bg_reports WHERE status = 'OPEN' AND parent_report_id IS NULL`,
  );
  return Number(rows[0]?.total ?? 0);
}

/**
 * Applique un geste du panneau.
 *
 * Le statut est relu **sous verrou** : deux administrateurs qui prennent en
 * charge le même signalement au même instant ne se l'attribuent pas tous les
 * deux — le second lit « en cours » et reçoit un refus.
 *
 * @throws REPORT_NOT_FOUND
 * @throws REPORT_ACTION_NOT_ALLOWED Le geste n'a pas de sens depuis l'état courant.
 */
export async function applyReportAction(
  reportId: number,
  action: ReportAction,
  actor: ReportPerson,
  rawNote?: string | null,
): Promise<void> {
  const note = typeof rawNote === "string" ? rawNote.trim().slice(0, REPORT_RESOLUTION_NOTE_MAX_LENGTH) : "";
  const db = await getDatabase();
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    // Une contestation n'a pas de cycle de vie propre : elle suit son
    // signalement d'origine, sur lequel se font tous les gestes.
    const [rows] = await connection.execute<(RowDataPacket & { status: ReportStatus })[]>(
      `SELECT status FROM bg_reports WHERE id = ? AND parent_report_id IS NULL FOR UPDATE`,
      [reportId],
    );
    if (rows.length === 0) throw new Error("REPORT_NOT_FOUND");
    const next = nextReportStatus(rows[0].status, action);
    if (next === null) throw new Error("REPORT_ACTION_NOT_ALLOWED");

    switch (action) {
      case "TAKE":
        await connection.execute(
          `UPDATE bg_reports SET status = 'IN_PROGRESS', assignee_user_id = ? WHERE id = ?`,
          [actor.userId, reportId],
        );
        break;
      case "RELEASE":
        await connection.execute(
          `UPDATE bg_reports SET status = 'OPEN', assignee_user_id = NULL WHERE id = ?`,
          [reportId],
        );
        break;
      case "RESOLVE":
        await connection.execute(
          `UPDATE bg_reports
           SET status = 'RESOLVED', resolved_at = NOW(), resolution_note = ?,
               assignee_user_id = COALESCE(assignee_user_id, ?)
           WHERE id = ?`,
          [note || null, actor.userId, reportId],
        );
        break;
      case "REOPEN":
        await connection.execute(
          `UPDATE bg_reports SET status = 'OPEN', resolved_at = NULL WHERE id = ?`,
          [reportId],
        );
        break;
    }
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }

  // L'archivage est la seule étape que le propriétaire et le président ont
  // besoin d'apprendre : l'alerte qu'ils ont reçue est close. Les autres gestes
  // restent dans les journaux du serveur.
  const line = `Signalement #${reportId} ${ACTION_AUDIT_LABELS[action]} par le staff.`;
  if (action === "RESOLVE") publishStaffAction(`✅ ${line}`, { id: actor.userId, pseudo: actor.pseudo });
  else console.info(`[staff-audit] ${line} — auteur : ${actor.pseudo} (#${actor.userId})`);
}

const ACTION_AUDIT_LABELS: Record<ReportAction, string> = {
  TAKE: "pris en charge",
  RELEASE: "remis en attente",
  RESOLVE: "résolu et archivé",
  REOPEN: "rouvert",
};

// ─────────────────────────────────────────────────────────────────────────────
// Conservation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Efface les signalements résolus depuis plus que la durée de conservation —
 * leurs cibles et leurs contestations partent avec eux (cascade). Une
 * contestation n'est jamais purgée seule : son statut ne dit rien, c'est celui
 * de son signalement d'origine qui compte.
 */
export async function purgeExpiredReports(): Promise<number> {
  const db = await getDatabase();
  const [result] = await db.execute<ResultSetHeader>(
    `DELETE FROM bg_reports
     WHERE status = 'RESOLVED'
       AND parent_report_id IS NULL
       AND resolved_at < NOW() - INTERVAL ${Number(REPORT_RETENTION_DAYS_AFTER_RESOLUTION)} DAY
       -- Un logo encore masqué au titre de ce signalement le garde : c'est sur
       -- lui que l'équipe conteste, jusqu'à l'échéance de la quarantaine.
       AND NOT EXISTS (
         SELECT 1 FROM bg_logo_quarantines q WHERE q.report_id = bg_reports.id AND q.status = 'HIDDEN'
       )`,
  );
  return Number(result.affectedRows);
}

const PURGE_INTERVAL_MS = 60 * 60 * 1000;
const purgeState = globalThis as typeof globalThis & { __bgReportsPurgedAt?: number };

/**
 * Purge entraînée par le trafic, au plus une fois par heure et par processus.
 *
 * La purge est déjà faite à chaque envoi et à chaque ouverture du panneau ; ce
 * passage couvre la période où personne ne fait ni l'un ni l'autre, pour que la
 * durée annoncée tienne même sans visite du staff. Jamais attendue, jamais
 * levée.
 */
export function schedulePurgeExpiredReports(now: number = Date.now()): void {
  if (purgeState.__bgReportsPurgedAt !== undefined && now - purgeState.__bgReportsPurgedAt < PURGE_INTERVAL_MS) {
    return;
  }
  purgeState.__bgReportsPurgedAt = now;
  // Les logos d'abord : un logo supprimé à l'échéance libère son signalement,
  // que la purge suivante peut alors effacer.
  void purgeDueQuarantines()
    .catch((error) => console.error("[moderation] purge des logos en quarantaine impossible", error))
    .then(() => purgeExpiredReports())
    .catch((error) => console.error("[reports] purge impossible", error));
}
