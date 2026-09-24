/**
 * Quarantaine des logos d'équipe signalés — service.
 *
 * Les règles (durée, suppression d'office, messages) vivent dans le module pur
 * `lib/shared/logo-quarantine.ts` ; ici, les fichiers, la base et les envois.
 *
 * **Où va le fichier.** Masqué, il quitte `public/uploads/teams` — que la route
 * `/api/uploads/...` sert à quiconque connaît son adresse — pour
 * `data/quarantine/teams`, qu'aucune route ne sert. Retirer la seule colonne
 * `logo_url` ne suffirait pas : l'adresse du fichier a pu être copiée, partagée,
 * mise en cache, et resterait valide. Rétabli, il revient à la même adresse ;
 * supprimé, il est effacé.
 *
 * **Ordre des gestes.** Un déplacement de fichier ne se défait pas avec une
 * transaction : le fichier est déplacé **avant** l'écriture, et remis en place
 * si l'écriture échoue. L'inverse laisserait, sur une panne de disque, une base
 * qui annonce un logo masqué pendant que le site le sert encore.
 */
import { copyFile, mkdir, rename, unlink } from "node:fs/promises";
import path from "node:path";
import type { PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { getDatabase } from "@/lib/server/database";
import { pushDiscordDirectMessages, type DiscordRecipient } from "@/lib/server/bot-integration";
import { publishStaffAction } from "@/lib/server/staff-audit";
import { siteCanonicalBase } from "@/lib/server/site-url";
import { toIso } from "@/lib/server/serialization";
import { toDiskUploadPath } from "@/lib/shared/uploads";
import { reportConcernedHref, type ReportPerson } from "@/lib/shared/content-reports";
import {
  canAutoPurgeLogo,
  formatLogoHiddenLog,
  formatLogoHiddenNotice,
  formatLogoRemovedNotice,
  formatLogoRestoredNotice,
  logoQuarantinePurgeDate,
  type LogoQuarantineStatus,
  type LogoQuarantineView,
} from "@/lib/shared/logo-quarantine";

const TEAM_UPLOAD_PREFIX = "/uploads/teams/";
/** Nom d'un fichier de logo tel que `storeImageBuffer` les écrit. */
const LOGO_FILENAME = /^[A-Za-z0-9_-]+\.webp$/;

/** Dossier de la quarantaine, hors de tout ce que le site sert. */
export function quarantineDirectory(): string {
  return path.join(process.cwd(), "data", "quarantine", "teams");
}

/**
 * Les deux emplacements d'un logo — en ligne et en quarantaine —, ou `null` si
 * l'adresse n'est pas celle d'un logo d'équipe téléversé (une adresse étrangère
 * ne se déplace pas, elle n'est pas à nous).
 *
 * Le nom en quarantaine porte **l'équipe** : un même fichier partagé par deux
 * équipes masquées l'une après l'autre y ferait sinon deux copies au même
 * chemin, et supprimer l'une effacerait celle dont l'autre a encore besoin.
 */
export function logoFileLocations(
  logoUrl: string,
  teamId: number,
): { live: string; quarantined: string } | null {
  const relative = toDiskUploadPath(logoUrl);
  if (!relative || !relative.startsWith(TEAM_UPLOAD_PREFIX)) return null;
  const filename = relative.slice(TEAM_UPLOAD_PREFIX.length);
  if (!LOGO_FILENAME.test(filename) || !Number.isSafeInteger(teamId) || teamId <= 0) return null;
  return {
    live: path.join(process.cwd(), "public", "uploads", "teams", filename),
    quarantined: path.join(quarantineDirectory(), `team-${teamId}-${filename}`),
  };
}

/** Déplace un fichier, y compris d'un disque à l'autre (`EXDEV`). */
async function moveFile(from: string, to: string): Promise<void> {
  await mkdir(path.dirname(to), { recursive: true });
  try {
    await rename(from, to);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EXDEV") throw error;
    await copyFile(from, to);
    await unlink(from);
  }
}

async function unlinkIfPresent(file: string): Promise<void> {
  try {
    await unlink(file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

type MemberRecipientRow = RowDataPacket & {
  pseudo: string;
  discord_id: string | null;
  discord_pseudo: string | null;
  discord_verified_at: Date | string | null;
};

/**
 * Membres actuels d'une équipe joignables sur Discord par un moyen **prouvé**
 * (identifiant, ou tag certifié).
 */
async function teamMemberRecipients(teamId: number): Promise<DiscordRecipient[]> {
  const db = await getDatabase();
  const [rows] = await db.execute<MemberRecipientRow[]>(
    `SELECT u.pseudo, u.discord_id, u.discord_pseudo, u.discord_verified_at
     FROM bg_team_members tm
     JOIN bg_users u ON u.id = tm.user_id
     WHERE tm.team_id = ? AND tm.left_at IS NULL AND u.is_deleted = 0`,
    [teamId],
  );
  const recipients: DiscordRecipient[] = [];
  for (const row of rows) {
    const handle = row.discord_verified_at ? row.discord_pseudo : null;
    if (!row.discord_id && !handle) continue;
    recipients.push({ discordId: row.discord_id, handle, label: row.pseudo });
  }
  return recipients;
}

/**
 * Le signalement existe et désigne cette équipe — c'est ce lien qui permettra à
 * l'équipe de contester la décision prise sur son logo.
 *
 * @throws REPORT_NOT_FOUND
 * @throws TEAM_NOT_TARGETED
 */
async function assertTeamTargeted(reportId: number, teamId: number): Promise<void> {
  const db = await getDatabase();
  const [reports] = await db.execute<RowDataPacket[]>(
    `SELECT r.id FROM bg_reports r
     JOIN bg_report_targets t ON t.report_id = r.id AND t.target_type = 'TEAM' AND t.target_id = ?
     WHERE r.id = ? AND r.parent_report_id IS NULL LIMIT 1`,
    [teamId, reportId],
  );
  if (reports.length > 0) return;
  const [exists] = await db.execute<RowDataPacket[]>(
    `SELECT id FROM bg_reports WHERE id = ? AND parent_report_id IS NULL LIMIT 1`,
    [reportId],
  );
  throw new Error(exists.length === 0 ? "REPORT_NOT_FOUND" : "TEAM_NOT_TARGETED");
}

/**
 * Prévient les membres actuels d'une équipe que son logo a été supprimé sans
 * délai — depuis un signalement (`reportId`, le message porte le lien de
 * contestation) ou depuis la fiche de l'équipe (`null`). Jamais attendu.
 */
export function notifyTeamLogoRemoved(teamId: number, teamName: string, reportId: number | null): void {
  const url = reportId === null ? null : `${siteCanonicalBase()}${reportConcernedHref(reportId)}`;
  void teamMemberRecipients(teamId)
    .then((recipients) =>
      recipients.length === 0
        ? null
        : pushDiscordDirectMessages(formatLogoRemovedNotice({ teamName, url }), recipients, "logo-removed"),
    )
    .catch((error) => console.error("[moderation] équipe non prévenue de la suppression", error));
}

/**
 * Supprime **sans délai** le logo d'une équipe visée par un signalement — un
 * contenu manifestement illicite, que la quarantaine ne ferait que garder.
 *
 * La décision laisse la même trace qu'un masquage — une ligne de
 * `bg_logo_quarantines`, close à l'instant de son ouverture
 * (`isImmediateLogoRemoval`) —, rattachée au signalement : le panneau la
 * montre, la page de l'équipe visée aussi, et l'équipe est prévenue avec le
 * lien pour contester. Son échéance (`purge_after`) est celle de la
 * contestation, six mois comme au masquage : le signalement est gardé jusque-là
 * (`purgeExpiredReports`), sans quoi l'équipe perdrait la page où répondre dès
 * l'archivage. Un fichier que d'autres équipes désignent encore reste sur le
 * disque, comme au masquage.
 *
 * @throws REPORT_NOT_FOUND
 * @throws TEAM_NOT_TARGETED
 * @throws TEAM_HAS_NO_LOGO
 */
export async function deleteTeamLogoForReport(
  reportId: number,
  teamId: number,
  actor: ReportPerson,
): Promise<LogoQuarantineView> {
  await assertTeamTargeted(reportId, teamId);
  const db = await getDatabase();
  const removedAt = new Date();
  // Rien n'attend plus d'être effacé ; l'échéance dit ici jusqu'à quand la
  // décision se conteste (DSA art. 20), et retient le signalement jusque-là.
  const contestUntil = logoQuarantinePurgeDate(removedAt);
  let teamName: string;
  let logoUrl: string;
  let shared: boolean;
  let quarantineId: number;
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const [teams] = await connection.execute<(RowDataPacket & { name: string; logo_url: string | null })[]>(
      `SELECT name, logo_url FROM bg_teams WHERE id = ? AND solo_user_id IS NULL FOR UPDATE`,
      [teamId],
    );
    if (teams.length === 0 || !teams[0].logo_url) throw new Error("TEAM_HAS_NO_LOGO");
    teamName = teams[0].name;
    logoUrl = teams[0].logo_url;
    await connection.execute(`UPDATE bg_teams SET logo_url = NULL WHERE id = ?`, [teamId]);
    const [sharing] = await connection.execute<(RowDataPacket & { total: number })[]>(
      `SELECT COUNT(*) AS total FROM bg_teams WHERE logo_url = ? AND id <> ?`,
      [logoUrl, teamId],
    );
    shared = Number(sharing[0]?.total ?? 0) > 0;
    const [inserted] = await connection.execute<ResultSetHeader>(
      `INSERT INTO bg_logo_quarantines
         (team_id, report_id, logo_url, hidden_by_user_id, hidden_at, purge_after, status, closed_at)
       VALUES (?, ?, ?, ?, ?, ?, 'PURGED', ?)`,
      [teamId, reportId, logoUrl, actor.userId, removedAt, contestUntil, removedAt],
    );
    quarantineId = Number(inserted.insertId);
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }

  // Après le commit : un `unlink` ne se défait pas. Une adresse étrangère n'a
  // pas de fichier chez nous ; vider la colonne suffisait.
  const files = shared ? null : logoFileLocations(logoUrl, teamId);
  if (files) {
    await unlinkIfPresent(files.live).catch((error) => {
      console.error("[moderation] fichier du logo non effacé", error);
    });
  }

  publishStaffAction(`🗑️ Logo de l'équipe « ${teamName} » supprimé sans délai par le staff (signalement #${reportId}).`, {
    id: actor.userId,
    pseudo: actor.pseudo,
  });
  notifyTeamLogoRemoved(teamId, teamName, reportId);

  const at = removedAt.toISOString();
  return {
    id: quarantineId,
    teamId,
    teamName,
    reportId,
    status: "PURGED",
    hiddenAt: at,
    purgeAfter: contestUntil.toISOString(),
    closedAt: at,
  };
}

/**
 * Masque le logo d'une équipe visée par un signalement.
 *
 * Refusé si le signalement ne désigne pas cette équipe (le lien entre les deux
 * est ce qui permettra à l'équipe de contester), si l'équipe n'a pas de logo, ou
 * si son logo a changé pendant le geste — c'est celui qu'on a vu qu'on masque.
 *
 * @throws REPORT_NOT_FOUND
 * @throws TEAM_NOT_TARGETED
 * @throws TEAM_HAS_NO_LOGO
 * @throws LOGO_NOT_MOVABLE Le logo n'est pas un fichier du site.
 * @throws LOGO_FILE_MISSING Le fichier désigné n'existe plus sur le disque.
 * @throws LOGO_CHANGED
 */
export async function hideTeamLogo(reportId: number, teamId: number, actor: ReportPerson): Promise<LogoQuarantineView> {
  const db = await getDatabase();
  await assertTeamTargeted(reportId, teamId);

  const [teams] = await db.execute<(RowDataPacket & { name: string; logo_url: string | null })[]>(
    `SELECT name, logo_url FROM bg_teams WHERE id = ? AND solo_user_id IS NULL LIMIT 1`,
    [teamId],
  );
  if (teams.length === 0 || !teams[0].logo_url) throw new Error("TEAM_HAS_NO_LOGO");
  const logoUrl = teams[0].logo_url;
  const teamName = teams[0].name;
  const files = logoFileLocations(logoUrl, teamId);
  if (!files) throw new Error("LOGO_NOT_MOVABLE");

  // Un même fichier peut être désigné par plusieurs équipes (le jeu de test en
  // partage un) : le déplacer ferait disparaître le logo des autres. Il est
  // alors **copié** — l'équipe signalée ne l'affiche plus, les autres gardent
  // le leur, et la copie suit le cycle de la quarantaine.
  const [sharing] = await db.execute<(RowDataPacket & { total: number })[]>(
    `SELECT COUNT(*) AS total FROM bg_teams WHERE logo_url = ? AND id <> ?`,
    [logoUrl, teamId],
  );
  const shared = Number(sharing[0]?.total ?? 0) > 0;

  try {
    if (shared) {
      await mkdir(path.dirname(files.quarantined), { recursive: true });
      await copyFile(files.live, files.quarantined);
    } else {
      await moveFile(files.live, files.quarantined);
    }
  } catch (error) {
    // La colonne désigne un fichier absent (sauvegarde restaurée, ménage à la
    // main) : il n'y a rien à garder pour un rétablissement. Le refus le dit, et
    // le retrait immédiat reste le geste qui vide la colonne.
    if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new Error("LOGO_FILE_MISSING");
    throw error;
  }

  const hiddenAt = new Date();
  const purgeAfter = logoQuarantinePurgeDate(hiddenAt);
  let quarantineId: number;
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const [locked] = await connection.execute<(RowDataPacket & { logo_url: string | null })[]>(
      `SELECT logo_url FROM bg_teams WHERE id = ? FOR UPDATE`,
      [teamId],
    );
    if (locked.length === 0 || locked[0].logo_url !== logoUrl) throw new Error("LOGO_CHANGED");
    await connection.execute(`UPDATE bg_teams SET logo_url = NULL WHERE id = ?`, [teamId]);
    const [inserted] = await connection.execute<ResultSetHeader>(
      `INSERT INTO bg_logo_quarantines (team_id, report_id, logo_url, hidden_by_user_id, hidden_at, purge_after)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [teamId, reportId, logoUrl, actor.userId, hiddenAt, purgeAfter],
    );
    quarantineId = Number(inserted.insertId);
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    // Le fichier revient en ligne : la base n'a rien retenu du masquage. Une
    // copie, elle, n'a qu'à disparaître — l'original n'a pas bougé. Et si
    // l'équipe a changé de logo pendant le geste, plus rien ne désigne le
    // fichier : l'envoi du nouveau a voulu l'effacer sans le trouver. Le
    // remettre en ligne republierait le logo signalé sous son ancienne adresse,
    // à jamais — il est effacé, comme l'envoi l'aurait fait.
    const abandoned = (error as Error).message === "LOGO_CHANGED";
    const undo =
      shared || abandoned ? unlinkIfPresent(files.quarantined) : moveFile(files.quarantined, files.live);
    await undo.catch((moveError) => {
      console.error("[moderation] logo non remis en place après échec", moveError);
    });
    throw error;
  } finally {
    connection.release();
  }

  publishStaffAction(formatLogoHiddenLog({ teamName, reportId, purgeAfter }), { id: actor.userId, pseudo: actor.pseudo });
  const url = `${siteCanonicalBase()}${reportConcernedHref(reportId)}`;
  void teamMemberRecipients(teamId)
    .then((recipients) =>
      recipients.length === 0
        ? null
        : pushDiscordDirectMessages(formatLogoHiddenNotice({ teamName, purgeAfter, url }), recipients, "logo-hidden"),
    )
    .catch((error) => console.error("[moderation] équipe non prévenue du masquage", error));

  return {
    id: quarantineId,
    teamId,
    teamName,
    reportId,
    status: "HIDDEN",
    hiddenAt: hiddenAt.toISOString(),
    purgeAfter: purgeAfter.toISOString(),
    closedAt: null,
  };
}

type QuarantineRow = RowDataPacket & {
  id: number;
  team_id: number;
  team_name: string;
  report_id: number | null;
  logo_url: string;
  status: LogoQuarantineStatus;
  hidden_at: Date | string;
  purge_after: Date | string;
  closed_at: Date | string | null;
};

const QUARANTINE_SELECT = `SELECT q.id, q.team_id, t.name AS team_name, q.report_id, q.logo_url, q.status,
       q.hidden_at, q.purge_after, q.closed_at
FROM bg_logo_quarantines q
JOIN bg_teams t ON t.id = q.team_id`;

function toView(row: QuarantineRow): LogoQuarantineView {
  return {
    id: Number(row.id),
    teamId: Number(row.team_id),
    teamName: row.team_name,
    reportId: row.report_id === null ? null : Number(row.report_id),
    status: row.status,
    hiddenAt: toIso(row.hidden_at) ?? new Date().toISOString(),
    purgeAfter: toIso(row.purge_after) ?? new Date().toISOString(),
    closedAt: toIso(row.closed_at),
  };
}

/** Quarantaines rattachées à ces signalements (panneau, page des personnes visées). */
export async function listQuarantinesForReports(reportIds: readonly number[]): Promise<LogoQuarantineView[]> {
  if (reportIds.length === 0) return [];
  const db = await getDatabase();
  const [rows] = await db.execute<QuarantineRow[]>(
    `${QUARANTINE_SELECT}
     WHERE q.report_id IN (${reportIds.map(() => "?").join(", ")})
     ORDER BY q.hidden_at DESC, q.id DESC`,
    [...reportIds],
  );
  return rows.map(toView);
}

/** Lit une quarantaine sous verrou, dans la transaction de l'appelant. */
async function lockQuarantine(connection: PoolConnection, quarantineId: number): Promise<QuarantineRow> {
  const [rows] = await connection.execute<QuarantineRow[]>(`${QUARANTINE_SELECT} WHERE q.id = ? FOR UPDATE`, [
    quarantineId,
  ]);
  if (rows.length === 0) throw new Error("QUARANTINE_NOT_FOUND");
  if (rows[0].status !== "HIDDEN") throw new Error("QUARANTINE_CLOSED");
  return rows[0];
}

/**
 * Rétablit un logo masqué — la contestation a abouti.
 *
 * Refusé si l'équipe a envoyé un **autre** logo entre-temps : remettre l'ancien
 * par-dessus effacerait un choix qu'elle a fait depuis. Le logo masqué reste
 * alors en quarantaine, jusqu'à son échéance ou à sa suppression.
 *
 * @throws QUARANTINE_NOT_FOUND
 * @throws QUARANTINE_CLOSED
 * @throws TEAM_HAS_NEW_LOGO
 * @throws LOGO_NOT_MOVABLE
 */
export async function restoreTeamLogo(quarantineId: number, actor: ReportPerson): Promise<void> {
  const db = await getDatabase();
  const connection = await db.getConnection();
  let row: QuarantineRow;
  let files: { live: string; quarantined: string };
  try {
    await connection.beginTransaction();
    row = await lockQuarantine(connection, quarantineId);
    const [teams] = await connection.execute<(RowDataPacket & { logo_url: string | null })[]>(
      `SELECT logo_url FROM bg_teams WHERE id = ? FOR UPDATE`,
      [row.team_id],
    );
    if (teams.length === 0) throw new Error("QUARANTINE_NOT_FOUND");
    if (teams[0].logo_url) throw new Error("TEAM_HAS_NEW_LOGO");
    const located = logoFileLocations(row.logo_url, Number(row.team_id));
    if (!located) throw new Error("LOGO_NOT_MOVABLE");
    files = located;

    // Déplacé **avant** le commit, sous les verrous : un échec de disque laisse
    // la quarantaine intacte, sans une base qui annoncerait un logo absent.
    await moveFile(files.quarantined, files.live);
    try {
      await connection.execute(`UPDATE bg_teams SET logo_url = ? WHERE id = ?`, [row.logo_url, row.team_id]);
      await connection.execute(
        `UPDATE bg_logo_quarantines SET status = 'RESTORED', closed_at = NOW() WHERE id = ?`,
        [quarantineId],
      );
      await connection.commit();
    } catch (error) {
      await moveFile(files.live, files.quarantined).catch(() => undefined);
      throw error;
    }
  } catch (error) {
    // Après un commit réussi puis un échec plus loin, le rollback n'a plus rien
    // à défaire et peut lever : c'est l'erreur d'origine qui doit remonter.
    try {
      await connection.rollback();
    } catch {
      // Rien à ajouter à l'erreur d'origine.
    }
    throw error;
  } finally {
    connection.release();
  }

  const teamName = row.team_name;
  publishStaffAction(`✅ Logo de l'équipe « ${teamName} » rétabli par le staff (contestation acceptée).`, {
    id: actor.userId,
    pseudo: actor.pseudo,
  });
  void teamMemberRecipients(Number(row.team_id))
    .then((recipients) =>
      recipients.length === 0
        ? null
        : pushDiscordDirectMessages(formatLogoRestoredNotice({ teamName }), recipients, "logo-restored"),
    )
    .catch((error) => console.error("[moderation] équipe non prévenue du rétablissement", error));
}

/**
 * Supprime définitivement un logo en quarantaine — par l'association (avant
 * l'échéance, contestation rejetée) ou d'office (échéance passée).
 *
 * @throws QUARANTINE_NOT_FOUND
 * @throws QUARANTINE_CLOSED
 */
export async function purgeQuarantinedLogo(quarantineId: number, actor: ReportPerson | null): Promise<void> {
  const db = await getDatabase();
  const connection = await db.getConnection();
  let row: QuarantineRow;
  try {
    await connection.beginTransaction();
    row = await lockQuarantine(connection, quarantineId);
    await connection.execute(
      `UPDATE bg_logo_quarantines SET status = 'PURGED', closed_at = NOW() WHERE id = ?`,
      [quarantineId],
    );
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }

  // Après le commit : un `unlink` ne se défait pas. Un échec laisse un résidu
  // dans un dossier que rien ne sert.
  const files = logoFileLocations(row.logo_url, Number(row.team_id));
  if (files) {
    await unlinkIfPresent(files.quarantined).catch((error) => {
      console.error("[moderation] fichier en quarantaine non effacé", error);
    });
  }

  const line = `🗑️ Logo de l'équipe « ${row.team_name} » supprimé définitivement`;
  if (actor) publishStaffAction(`${line} par le staff.`, { id: actor.userId, pseudo: actor.pseudo });
  else console.info(`[moderation] ${line} à l'échéance de sa quarantaine.`);
}

type DueRow = RowDataPacket & {
  id: number;
  purge_after: Date | string;
  report_id: number | null;
  report_status: string | null;
  contested: number;
};

/**
 * Supprime d'office les logos dont la quarantaine est échue et qui n'attendent
 * aucune décision (`canAutoPurgeLogo`). Entraîné par le trafic, avec la purge
 * des signalements.
 */
export async function purgeDueQuarantines(now: Date = new Date()): Promise<number> {
  const db = await getDatabase();
  const [rows] = await db.execute<DueRow[]>(
    `SELECT q.id, q.purge_after, q.report_id, r.status AS report_status,
            EXISTS (SELECT 1 FROM bg_reports c WHERE c.parent_report_id = q.report_id) AS contested
     FROM bg_logo_quarantines q
     LEFT JOIN bg_reports r ON r.id = q.report_id
     WHERE q.status = 'HIDDEN' AND q.purge_after <= ?`,
    [now],
  );
  let purged = 0;
  for (const row of rows) {
    const due = canAutoPurgeLogo({
      purgeAfter: new Date(row.purge_after),
      now,
      contested: Number(row.contested) === 1,
      reportSettled: row.report_id === null || row.report_status === null || row.report_status === "RESOLVED",
    });
    if (!due) continue;
    try {
      await purgeQuarantinedLogo(Number(row.id), null);
      purged += 1;
    } catch (error) {
      // Rétablie ou supprimée entre-temps : rien à faire.
      if ((error as Error).message !== "QUARANTINE_CLOSED") throw error;
    }
  }
  return purged;
}

/** Chemin du fichier d'un logo en quarantaine, pour l'aperçu du panneau. */
export async function quarantinedLogoFile(quarantineId: number): Promise<string | null> {
  const db = await getDatabase();
  const [rows] = await db.execute<
    (RowDataPacket & { logo_url: string; team_id: number; status: LogoQuarantineStatus })[]
  >(`SELECT logo_url, team_id, status FROM bg_logo_quarantines WHERE id = ? LIMIT 1`, [quarantineId]);
  if (rows.length === 0 || rows[0].status !== "HIDDEN") return null;
  return logoFileLocations(rows[0].logo_url, Number(rows[0].team_id))?.quarantined ?? null;
}
