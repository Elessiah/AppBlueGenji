/**
 * Quarantaine des images signalées (logos d'équipe, avatars de joueur) — service.
 *
 * Les règles (durée, suppression d'office, messages) vivent dans le module pur
 * `lib/shared/logo-quarantine.ts` ; ici, les fichiers, la base et les envois.
 *
 * **Où va le fichier.** Masqué, il quitte `public/uploads/teams` (ou
 * `public/uploads/avatars`) — que la route `/api/uploads/...` sert à quiconque
 * connaît son adresse — pour `data/quarantine/teams` (ou `.../players`), qu'aucune
 * route ne sert. Retirer la seule colonne ne suffirait pas : l'adresse du
 * fichier a pu être copiée, partagée, mise en cache, et resterait valide.
 * Rétabli, il revient à la même adresse ; supprimé, il est effacé.
 *
 * **Ordre des gestes.** Un déplacement de fichier ne se défait pas avec une
 * transaction : le fichier est déplacé **avant** l'écriture, et remis en place
 * si l'écriture échoue. L'inverse laisserait, sur une panne de disque, une base
 * qui annonce une image masquée pendant que le site la sert encore.
 *
 * **Équipe et joueur ne partagent que le cycle et la table** (`team_id` xor
 * `user_id`, comme `bg_teams.solo_user_id` distingue déjà une entrée solo sans
 * colonne « type » à tenir à jour). Leurs gestes d'écriture restent séparés,
 * parce qu'ils ne se ressemblent pas : un logo peut être partagé par plusieurs
 * équipes (le jeu de test en partage un), jamais un avatar ; retirer un avatar
 * doit resynchroniser l'entrée solo du joueur (son logo n'est que son avatar
 * recopié, `lib/server/solo-entries-service.ts`), ce qu'un logo d'équipe n'a
 * jamais à faire. Une seule fonction qui aurait tenté de couvrir les deux
 * aurait fini par oublier l'une des deux règles au premier appel sur l'autre
 * domaine ; les fonctions génériques ci-dessous (lecture, rétablissement,
 * purge) ne connaissent, elles, que ce qui est réellement commun aux deux.
 */
import { copyFile, mkdir, rename, unlink } from "node:fs/promises";
import path from "node:path";
import type { PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { getDatabase } from "@/lib/server/database";
import { notifyUsers, toNotificationRecipient, type NotificationRecipient } from "@/lib/server/notify";
import { moderationPush } from "@/lib/shared/push-messages";
import { publishStaffAction } from "@/lib/server/staff-audit";
import { siteCanonicalBase } from "@/lib/server/site-url";
import { toIso } from "@/lib/server/serialization";
import { syncSoloEntryIdentityOn } from "@/lib/server/solo-entries-service";
import { rotateHiddenAvatarFile } from "@/lib/server/avatar-rotation";
import { toDiskUploadPath } from "@/lib/shared/uploads";
import { reportConcernedHref, type ReportCategory, type ReportPerson } from "@/lib/shared/content-reports";
import { ANONYMOUS_PLAYER_LABEL } from "@/lib/shared/log-privacy";
import { TERMS_PATH } from "@/lib/shared/terms-of-use";
import {
  MODERATION_TERMS_ANCHOR,
  moderationGroundsFor,
  type ModerationGrounds,
  canAutoPurgeLogo,
  formatAvatarHiddenLog,
  formatAvatarHiddenNotice,
  formatAvatarRemovedNotice,
  formatAvatarRestoredNotice,
  formatLogoHiddenLog,
  formatLogoHiddenNotice,
  formatLogoRemovedNotice,
  formatLogoRestoredNotice,
  logoQuarantinePurgeDate,
  type LogoQuarantineStatus,
  type LogoQuarantineView,
  type QuarantineTargetType,
} from "@/lib/shared/logo-quarantine";
import { discordInline } from "@/lib/shared/discord-text";

const TEAM_UPLOAD_PREFIX = "/uploads/teams/";
const USER_UPLOAD_PREFIX = "/uploads/avatars/";
/** Nom d'un fichier téléversé tel que `storeImageBuffer` les écrit (logo ou avatar). */
const LOGO_FILENAME = /^[A-Za-z0-9_-]+\.webp$/;

/** Dossier de la quarantaine des logos d'équipe, hors de tout ce que le site sert. */
export function quarantineDirectory(): string {
  return path.join(process.cwd(), "data", "quarantine", "teams");
}

/** Dossier de la quarantaine des avatars, hors de tout ce que le site sert. */
export function avatarQuarantineDirectory(): string {
  return path.join(process.cwd(), "data", "quarantine", "players");
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

/**
 * Les deux emplacements d'un avatar — en ligne et en quarantaine —, ou `null`
 * si l'adresse n'est pas celle d'un avatar téléversé. Même garde-fou que
 * `logoFileLocations` ; un avatar n'est jamais partagé entre deux comptes, donc
 * le nom en quarantaine n'a besoin de porter que le joueur.
 */
export function avatarFileLocations(
  avatarUrl: string,
  userId: number,
): { live: string; quarantined: string } | null {
  const relative = toDiskUploadPath(avatarUrl);
  if (!relative || !relative.startsWith(USER_UPLOAD_PREFIX)) return null;
  const filename = relative.slice(USER_UPLOAD_PREFIX.length);
  if (!LOGO_FILENAME.test(filename) || !Number.isSafeInteger(userId) || userId <= 0) return null;
  return {
    live: path.join(process.cwd(), "public", "uploads", "avatars", filename),
    quarantined: path.join(avatarQuarantineDirectory(), `user-${userId}-${filename}`),
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
  id: number;
  pseudo: string;
  discord_id: string | null;
  discord_pseudo: string | null;
  discord_verified_at: Date | string | null;
};

/**
 * Membres actuels d'une équipe, à prévenir d'une décision sur son logo. Le
 * message privé ne part que par un moyen **prouvé** (identifiant, ou tag
 * certifié) ; le push, aux appareils que chacun a abonnés.
 */
async function teamMemberRecipients(teamId: number): Promise<NotificationRecipient[]> {
  const db = await getDatabase();
  const [rows] = await db.execute<MemberRecipientRow[]>(
    `SELECT u.id, u.pseudo, u.discord_id, u.discord_pseudo, u.discord_verified_at
     FROM bg_team_members tm
     JOIN bg_users u ON u.id = tm.user_id
     WHERE tm.team_id = ? AND tm.left_at IS NULL AND u.is_deleted = 0`,
    [teamId],
  );
  return rows.map((row) => toNotificationRecipient(row, "proven"));
}

/** Un joueur, à prévenir d'une décision sur son avatar — au plus une entrée. */
async function userRecipient(userId: number): Promise<NotificationRecipient[]> {
  const db = await getDatabase();
  const [rows] = await db.execute<MemberRecipientRow[]>(
    `SELECT id, pseudo, discord_id, discord_pseudo, discord_verified_at FROM bg_users
     WHERE id = ? AND is_deleted = 0`,
    [userId],
  );
  return rows.slice(0, 1).map((row) => toNotificationRecipient(row, "proven"));
}

/**
 * Le signalement existe et désigne cette cible (équipe ou joueur) — c'est ce
 * lien qui permet à la personne concernée de contester la décision prise sur
 * son image. Les deux domaines posent exactement la même question, seul le
 * refus qui nomme la cible change : une seconde fonction n'aurait fait que
 * recopier celle-ci en changeant un littéral.
 *
 * @throws REPORT_NOT_FOUND
 * @throws TEAM_NOT_TARGETED | USER_NOT_TARGETED
 */
async function assertTargeted(
  reportId: number,
  targetType: "TEAM" | "USER",
  targetId: number,
): Promise<ModerationGrounds> {
  const db = await getDatabase();
  const [reports] = await db.execute<(RowDataPacket & { category: ReportCategory })[]>(
    `SELECT r.category FROM bg_reports r
     JOIN bg_report_targets t ON t.report_id = r.id AND t.target_type = ? AND t.target_id = ?
     WHERE r.id = ? AND r.parent_report_id IS NULL LIMIT 1`,
    [targetType, targetId, reportId],
  );
  if (reports.length > 0) return moderationGroundsFor(reports[0].category);
  const [exists] = await db.execute<RowDataPacket[]>(
    `SELECT id FROM bg_reports WHERE id = ? AND parent_report_id IS NULL LIMIT 1`,
    [reportId],
  );
  if (exists.length === 0) throw new Error("REPORT_NOT_FOUND");
  throw new Error(targetType === "TEAM" ? "TEAM_NOT_TARGETED" : "USER_NOT_TARGETED");
}

/** Adresse de la clause des conditions d'utilisation que les messages invoquent. */
function moderationTermsUrl(): string {
  return `${siteCanonicalBase()}${TERMS_PATH}#${MODERATION_TERMS_ANCHOR}`;
}

/**
 * Le fondement d'une décision rattachée à ce signalement — relu en base,
 * l'appelant ne connaissant que son identifiant. Hors signalement, ou
 * signalement déjà effacé : les règles du site.
 */
async function reportGrounds(reportId: number | null): Promise<ModerationGrounds> {
  if (reportId === null) return moderationGroundsFor(null);
  const db = await getDatabase();
  const [rows] = await db.execute<(RowDataPacket & { category: ReportCategory })[]>(
    `SELECT category FROM bg_reports WHERE id = ? LIMIT 1`,
    [reportId],
  );
  return moderationGroundsFor(rows[0]?.category ?? null);
}

/**
 * Prévient les membres actuels d'une équipe que son logo a été supprimé sans
 * délai — depuis un signalement (`reportId`, le message porte le lien de
 * contestation) ou depuis la fiche de l'équipe (`null`). Jamais attendu.
 */
export function notifyTeamLogoRemoved(teamId: number, teamName: string, reportId: number | null): void {
  const url = reportId === null ? null : `${siteCanonicalBase()}${reportConcernedHref(reportId)}`;
  void Promise.all([reportGrounds(reportId), teamMemberRecipients(teamId)])
    .then(([grounds, recipients]) =>
      notifyUsers(recipients, {
        topic: "MODERATION",
        discord: {
          message: formatLogoRemovedNotice({ teamName, url, grounds, termsUrl: moderationTermsUrl() }),
          context: "logo-removed",
        },
        push: moderationPush({ kind: "REMOVED", teamName, teamId, reportId }),
      }),
    )
    .catch((error) => console.error("[moderation] équipe non prévenue de la suppression", error));
}

/**
 * Prévient un joueur que son avatar a été supprimé sans délai — depuis un
 * signalement (`reportId`, le message porte le lien de contestation) ou depuis
 * sa fiche (`null`). Même rôle que `notifyTeamLogoRemoved`. Jamais attendu.
 */
export function notifyUserAvatarRemoved(userId: number, reportId: number | null): void {
  const url = reportId === null ? null : `${siteCanonicalBase()}${reportConcernedHref(reportId)}`;
  void Promise.all([reportGrounds(reportId), userRecipient(userId)])
    .then(([grounds, recipients]) =>
      notifyUsers(recipients, {
        topic: "MODERATION",
        discord: {
          message: formatAvatarRemovedNotice({ url, grounds, termsUrl: moderationTermsUrl() }),
          context: "avatar-removed",
        },
        push: moderationPush({ kind: "REMOVED", reportId }),
      }),
    )
    .catch((error) => console.error("[moderation] joueur non prévenu de la suppression", error));
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
  await assertTargeted(reportId, "TEAM", teamId);
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

  publishStaffAction(`🗑️ Logo de l'équipe « ${discordInline(teamName)} » supprimé sans délai par le staff (signalement #${reportId}).`, {
    id: actor.userId,
    pseudo: actor.pseudo,
  });
  notifyTeamLogoRemoved(teamId, teamName, reportId);

  const at = removedAt.toISOString();
  return {
    id: quarantineId,
    targetType: "TEAM",
    targetId: teamId,
    targetName: teamName,
    reportId,
    status: "PURGED",
    hiddenAt: at,
    purgeAfter: contestUntil.toISOString(),
    closedAt: at,
  };
}

/**
 * Supprime **sans délai** l'avatar d'un joueur visé par un signalement — même
 * rôle que `deleteTeamLogoForReport`, sans la question du partage (un avatar
 * n'est jamais désigné par deux comptes) mais avec la resynchronisation de
 * l'entrée solo, dont le logo n'est que l'avatar recopié
 * (`lib/server/solo-entries-service.ts`) : sans elle, le fichier effacé plus
 * bas resterait désigné par `bg_teams.logo_url`.
 *
 * @throws REPORT_NOT_FOUND
 * @throws USER_NOT_TARGETED
 * @throws USER_HAS_NO_AVATAR
 */
export async function deleteUserAvatarForReport(
  reportId: number,
  userId: number,
  actor: ReportPerson,
): Promise<LogoQuarantineView> {
  await assertTargeted(reportId, "USER", userId);
  const db = await getDatabase();
  const removedAt = new Date();
  const contestUntil = logoQuarantinePurgeDate(removedAt);
  let pseudo: string;
  let avatarUrl: string;
  let quarantineId: number;
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const [users] = await connection.execute<(RowDataPacket & { pseudo: string; avatar_url: string | null })[]>(
      `SELECT pseudo, avatar_url FROM bg_users WHERE id = ? AND is_deleted = 0 FOR UPDATE`,
      [userId],
    );
    if (users.length === 0 || !users[0].avatar_url) throw new Error("USER_HAS_NO_AVATAR");
    pseudo = users[0].pseudo;
    avatarUrl = users[0].avatar_url;
    await connection.execute(`UPDATE bg_users SET avatar_url = NULL WHERE id = ? AND is_deleted = 0`, [userId]);
    await syncSoloEntryIdentityOn(connection, userId);
    const [inserted] = await connection.execute<ResultSetHeader>(
      `INSERT INTO bg_logo_quarantines
         (user_id, report_id, logo_url, hidden_by_user_id, hidden_at, purge_after, status, closed_at)
       VALUES (?, ?, ?, ?, ?, ?, 'PURGED', ?)`,
      [userId, reportId, avatarUrl, actor.userId, removedAt, contestUntil, removedAt],
    );
    quarantineId = Number(inserted.insertId);
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }

  const files = avatarFileLocations(avatarUrl, userId);
  if (files) {
    await unlinkIfPresent(files.live).catch((error) => {
      console.error("[moderation] fichier de l'avatar non effacé", error);
    });
  }

  publishStaffAction(`🗑️ Avatar d'${ANONYMOUS_PLAYER_LABEL} supprimé sans délai par le staff (signalement #${reportId}).`, {
    id: actor.userId,
    pseudo: actor.pseudo,
  });
  notifyUserAvatarRemoved(userId, reportId);

  const at = removedAt.toISOString();
  return {
    id: quarantineId,
    targetType: "USER",
    targetId: userId,
    targetName: pseudo,
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
  const grounds = await assertTargeted(reportId, "TEAM", teamId);

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
      notifyUsers(recipients, {
        topic: "MODERATION",
        discord: {
          message: formatLogoHiddenNotice({ teamName, purgeAfter, url, grounds, termsUrl: moderationTermsUrl() }),
          context: "logo-hidden",
        },
        push: moderationPush({ kind: "HIDDEN", teamName, teamId, reportId }),
      }),
    )
    .catch((error) => console.error("[moderation] équipe non prévenue du masquage", error));

  return {
    id: quarantineId,
    targetType: "TEAM",
    targetId: teamId,
    targetName: teamName,
    reportId,
    status: "HIDDEN",
    hiddenAt: hiddenAt.toISOString(),
    purgeAfter: purgeAfter.toISOString(),
    closedAt: null,
  };
}

/**
 * Masque l'avatar d'un joueur visé par un signalement — même rôle que
 * `hideTeamLogo`, sans la question du partage (voir `deleteUserAvatarForReport`)
 * mais avec la même resynchronisation de l'entrée solo.
 *
 * @throws REPORT_NOT_FOUND
 * @throws USER_NOT_TARGETED
 * @throws USER_HAS_NO_AVATAR
 * @throws AVATAR_NOT_MOVABLE L'avatar n'est pas un fichier du site.
 * @throws AVATAR_FILE_MISSING Le fichier désigné n'existe plus sur le disque.
 * @throws AVATAR_CHANGED
 */
export async function hideUserAvatarForReport(
  reportId: number,
  userId: number,
  actor: ReportPerson,
): Promise<LogoQuarantineView> {
  const db = await getDatabase();
  const grounds = await assertTargeted(reportId, "USER", userId);

  const [users] = await db.execute<(RowDataPacket & { pseudo: string; avatar_url: string | null })[]>(
    `SELECT pseudo, avatar_url FROM bg_users WHERE id = ? AND is_deleted = 0 LIMIT 1`,
    [userId],
  );
  if (users.length === 0 || !users[0].avatar_url) throw new Error("USER_HAS_NO_AVATAR");
  const avatarUrl = users[0].avatar_url;
  const pseudo = users[0].pseudo;
  const files = avatarFileLocations(avatarUrl, userId);
  if (!files) throw new Error("AVATAR_NOT_MOVABLE");

  try {
    await moveFile(files.live, files.quarantined);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new Error("AVATAR_FILE_MISSING");
    throw error;
  }

  const hiddenAt = new Date();
  const purgeAfter = logoQuarantinePurgeDate(hiddenAt);
  let quarantineId: number;
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const [locked] = await connection.execute<(RowDataPacket & { avatar_url: string | null })[]>(
      `SELECT avatar_url FROM bg_users WHERE id = ? AND is_deleted = 0 FOR UPDATE`,
      [userId],
    );
    if (locked.length === 0 || locked[0].avatar_url !== avatarUrl) throw new Error("AVATAR_CHANGED");
    await connection.execute(`UPDATE bg_users SET avatar_url = NULL WHERE id = ? AND is_deleted = 0`, [userId]);
    await syncSoloEntryIdentityOn(connection, userId);
    const [inserted] = await connection.execute<ResultSetHeader>(
      `INSERT INTO bg_logo_quarantines (user_id, report_id, logo_url, hidden_by_user_id, hidden_at, purge_after)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [userId, reportId, avatarUrl, actor.userId, hiddenAt, purgeAfter],
    );
    quarantineId = Number(inserted.insertId);
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    const abandoned = (error as Error).message === "AVATAR_CHANGED";
    const undo = abandoned ? unlinkIfPresent(files.quarantined) : moveFile(files.quarantined, files.live);
    await undo.catch((moveError) => {
      console.error("[moderation] avatar non remis en place après échec", moveError);
    });
    throw error;
  } finally {
    connection.release();
  }

  publishStaffAction(formatAvatarHiddenLog({ reportId, purgeAfter }), { id: actor.userId, pseudo: actor.pseudo });
  const url = `${siteCanonicalBase()}${reportConcernedHref(reportId)}`;
  void userRecipient(userId)
    .then((recipients) =>
      notifyUsers(recipients, {
        topic: "MODERATION",
        discord: {
          message: formatAvatarHiddenNotice({ purgeAfter, url, grounds, termsUrl: moderationTermsUrl() }),
          context: "avatar-hidden",
        },
        push: moderationPush({ kind: "HIDDEN", reportId }),
      }),
    )
    .catch((error) => console.error("[moderation] joueur non prévenu du masquage", error));

  return {
    id: quarantineId,
    targetType: "USER",
    targetId: userId,
    targetName: pseudo,
    reportId,
    status: "HIDDEN",
    hiddenAt: hiddenAt.toISOString(),
    purgeAfter: purgeAfter.toISOString(),
    closedAt: null,
  };
}

type QuarantineRow = RowDataPacket & {
  id: number;
  target_type: QuarantineTargetType;
  target_id: number;
  target_name: string;
  report_id: number | null;
  logo_url: string;
  status: LogoQuarantineStatus;
  hidden_at: Date | string;
  purge_after: Date | string;
  closed_at: Date | string | null;
};

// `COALESCE` porte le générique : une ligne d'équipe n'a pas de `u.pseudo` à
// joindre, une ligne de joueur pas de `t.name`, et le seul des deux qui n'est
// pas nul est déjà celui qu'il faut lire.
const QUARANTINE_SELECT = `SELECT q.id,
       CASE WHEN q.team_id IS NOT NULL THEN 'TEAM' ELSE 'USER' END AS target_type,
       COALESCE(q.team_id, q.user_id) AS target_id,
       COALESCE(t.name, u.pseudo) AS target_name,
       q.report_id, q.logo_url, q.status, q.hidden_at, q.purge_after, q.closed_at
FROM bg_logo_quarantines q
LEFT JOIN bg_teams t ON t.id = q.team_id
LEFT JOIN bg_users u ON u.id = q.user_id`;

function toView(row: QuarantineRow): LogoQuarantineView {
  return {
    id: Number(row.id),
    targetType: row.target_type,
    targetId: Number(row.target_id),
    targetName: row.target_name,
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
 * Rétablit une image masquée — la contestation a abouti.
 *
 * Refusé si la personne concernée a envoyé une **autre** image entre-temps :
 * remettre l'ancienne par-dessus effacerait un choix fait depuis. L'image
 * masquée reste alors en quarantaine, jusqu'à son échéance ou à sa suppression.
 *
 * Les deux domaines partagent la mécanique (verrou, déplacement de fichier
 * avant le commit, remise en place si l'écriture échoue) mais pas l'écriture :
 * une équipe n'a rien d'autre à recopier, un joueur doit resynchroniser son
 * entrée solo (`deleteUserAvatarForReport`).
 *
 * @throws QUARANTINE_NOT_FOUND
 * @throws QUARANTINE_CLOSED
 * @throws TEAM_HAS_NEW_LOGO | USER_HAS_NEW_AVATAR
 * @throws LOGO_NOT_MOVABLE | AVATAR_NOT_MOVABLE
 */
export async function restoreReportedImage(quarantineId: number, actor: ReportPerson): Promise<void> {
  const db = await getDatabase();
  const connection = await db.getConnection();
  let row: QuarantineRow;
  let files: { live: string; quarantined: string };
  try {
    await connection.beginTransaction();
    row = await lockQuarantine(connection, quarantineId);
    const isTeam = row.target_type === "TEAM";
    const targetId = Number(row.target_id);

    // Deux instructions **statiques**, une par domaine — une SQL bâtie par
    // interpolation de nom de table/colonne se dérobe au `grep`, et ce fichier
    // tient par ailleurs à ce que chaque écriture reste une chaîne qu'on
    // retrouve telle quelle dans le code (voir `hideTeamLogo`/
    // `hideUserAvatarForReport`, qui ne partagent pas non plus leurs requêtes).
    const [owners] = isTeam
      ? await connection.execute<(RowDataPacket & { image_url: string | null })[]>(
          `SELECT logo_url AS image_url FROM bg_teams WHERE id = ? FOR UPDATE`,
          [targetId],
        )
      : // Un compte anonymisé n'a plus d'avatar à retrouver, et ne doit surtout
        // pas en recevoir un par ce chemin : la condition l'exclut de la même
        // façon qu'une ligne disparue (`QUARANTINE_NOT_FOUND`), sans quoi le
        // rétablissement republierait une identité sur une ligne que la
        // suppression a vidée.
        await connection.execute<(RowDataPacket & { image_url: string | null })[]>(
          `SELECT avatar_url AS image_url FROM bg_users WHERE id = ? AND is_deleted = 0 FOR UPDATE`,
          [targetId],
        );
    if (owners.length === 0) throw new Error("QUARANTINE_NOT_FOUND");
    if (owners[0].image_url) throw new Error(isTeam ? "TEAM_HAS_NEW_LOGO" : "USER_HAS_NEW_AVATAR");
    const located = isTeam
      ? logoFileLocations(row.logo_url, targetId)
      : avatarFileLocations(row.logo_url, targetId);
    if (!located) throw new Error(isTeam ? "LOGO_NOT_MOVABLE" : "AVATAR_NOT_MOVABLE");
    files = located;

    // Déplacé **avant** le commit, sous les verrous : un échec de disque laisse
    // la quarantaine intacte, sans une base qui annoncerait une image absente.
    await moveFile(files.quarantined, files.live);
    try {
      if (isTeam) {
        await connection.execute(`UPDATE bg_teams SET logo_url = ? WHERE id = ?`, [row.logo_url, targetId]);
      } else {
        await connection.execute(`UPDATE bg_users SET avatar_url = ? WHERE id = ? AND is_deleted = 0`, [
          row.logo_url,
          targetId,
        ]);
        await syncSoloEntryIdentityOn(connection, targetId);
      }
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

  if (row.target_type === "TEAM") {
    const teamName = row.target_name;
    publishStaffAction(`✅ Logo de l'équipe « ${discordInline(teamName)} » rétabli par le staff (contestation acceptée).`, {
      id: actor.userId,
      pseudo: actor.pseudo,
    });
    void teamMemberRecipients(Number(row.target_id))
      .then((recipients) =>
        notifyUsers(recipients, {
          topic: "MODERATION",
          discord: { message: formatLogoRestoredNotice({ teamName }), context: "logo-restored" },
          push: moderationPush({ kind: "RESTORED", teamName, teamId: Number(row.target_id), reportId: null }),
        }),
      )
      .catch((error) => console.error("[moderation] équipe non prévenue du rétablissement", error));
  } else {
    // Rétabli à son adresse d'origine, déjà vue de tous. Si le joueur a masqué
    // son avatar pendant la quarantaine, la bascule n'a rien pu renommer
    // (`avatar_url` était vide) : le renommage se joue donc ici — sans effet sur
    // un avatar visible.
    try {
      await rotateHiddenAvatarFile(Number(row.target_id));
    } catch (error) {
      console.error("[moderation] avatar rétabli non renommé", error);
    }
    publishStaffAction(`✅ Avatar d'${ANONYMOUS_PLAYER_LABEL} rétabli par le staff (contestation acceptée).`, {
      id: actor.userId,
      pseudo: actor.pseudo,
    });
    void userRecipient(Number(row.target_id))
      .then((recipients) =>
        notifyUsers(recipients, {
          topic: "MODERATION",
          discord: { message: formatAvatarRestoredNotice(), context: "avatar-restored" },
          push: moderationPush({ kind: "RESTORED", reportId: null }),
        }),
      )
      .catch((error) => console.error("[moderation] joueur non prévenu du rétablissement", error));
  }
}

/**
 * Supprime définitivement une image en quarantaine — par l'association (avant
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

  const isTeam = row.target_type === "TEAM";
  const targetId = Number(row.target_id);
  const reportId = row.report_id === null ? null : Number(row.report_id);

  // Après le commit : un `unlink` ne se défait pas. Un échec laisse un résidu
  // dans un dossier que rien ne sert.
  const files = isTeam ? logoFileLocations(row.logo_url, targetId) : avatarFileLocations(row.logo_url, targetId);
  if (files) {
    await unlinkIfPresent(files.quarantined).catch((error) => {
      console.error("[moderation] fichier en quarantaine non effacé", error);
    });
  }

  // `line` sert la ligne Discord *et* le journal serveur d'une purge d'office :
  // une seule chaîne, jamais de pseudo, même dans sa moitié qui ne part que
  // dans pm2 — sans quoi il faudrait deux variables à tenir cohérentes.
  const line = isTeam
    ? `🗑️ Logo de l'équipe « ${discordInline(row.target_name)} » supprimé définitivement`
    : `🗑️ Avatar d'${ANONYMOUS_PLAYER_LABEL} supprimé définitivement`;
  if (actor) {
    publishStaffAction(`${line} par le staff.`, { id: actor.userId, pseudo: actor.pseudo });
    // Avant l'échéance annoncée : la personne concernée attend une date qui ne
    // vaut plus, elle apprend la décision (DSA art. 17) comme elle apprendrait
    // un rétablissement. À l'échéance, le message du masquage l'a déjà dite.
    if (isTeam) notifyTeamLogoRemoved(targetId, row.target_name, reportId);
    else notifyUserAvatarRemoved(targetId, reportId);
  } else {
    console.info(`[moderation] ${line} à l'échéance de sa quarantaine.`);
  }
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
 *
 * Seule la contestation d'une **personne visée** retient l'image : celle de
 * l'auteur du signalement (`canContestReport`) conteste la décision dans
 * l'autre sens — il voudrait l'image partie, pas gardée —, et la compter
 * prolongerait au-delà de l'échéance annoncée la garde d'une image que
 * personne n'a défendue. L'auteur qui est **aussi** visé (joueur désigné, ou
 * membre actuel d'une équipe désignée) conteste en visé, comme `createContest`
 * le compte ; et un compte effacé (auteur `NULL`) compte comme visé : dans le
 * doute, on garde.
 */
export async function purgeDueQuarantines(now: Date = new Date()): Promise<number> {
  const db = await getDatabase();
  const [rows] = await db.execute<DueRow[]>(
    `SELECT q.id, q.purge_after, q.report_id, r.status AS report_status,
            EXISTS (SELECT 1 FROM bg_reports c
                    WHERE c.parent_report_id = q.report_id
                      AND (r.reporter_user_id IS NULL OR c.reporter_user_id IS NULL
                           OR c.reporter_user_id <> r.reporter_user_id
                           -- Auteur **et** visé : il conteste en visé, comme
                           -- \`createContest\` le compte.
                           OR EXISTS (
                             SELECT 1 FROM bg_report_targets t
                             WHERE t.report_id = q.report_id
                               AND ((t.target_type = 'USER' AND t.target_id = c.reporter_user_id)
                                    OR (t.target_type = 'TEAM' AND EXISTS (
                                          SELECT 1 FROM bg_team_members tm
                                          WHERE tm.team_id = t.target_id AND tm.user_id = c.reporter_user_id
                                            AND tm.left_at IS NULL))))
                          )) AS contested
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

/** Chemin du fichier d'une image en quarantaine, pour l'aperçu du panneau. */
export async function quarantinedLogoFile(quarantineId: number): Promise<string | null> {
  const db = await getDatabase();
  const [rows] = await db.execute<
    (RowDataPacket & {
      logo_url: string;
      team_id: number | null;
      user_id: number | null;
      status: LogoQuarantineStatus;
    })[]
  >(`SELECT logo_url, team_id, user_id, status FROM bg_logo_quarantines WHERE id = ? LIMIT 1`, [quarantineId]);
  if (rows.length === 0 || rows[0].status !== "HIDDEN") return null;
  const row = rows[0];
  const located =
    row.team_id !== null
      ? logoFileLocations(row.logo_url, Number(row.team_id))
      : avatarFileLocations(row.logo_url, Number(row.user_id));
  return located?.quarantined ?? null;
}
