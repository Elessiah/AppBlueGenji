import type { PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { getDatabase, type SqlParams } from "@/lib/server/database";
import { parseRoles, toIso } from "@/lib/server/serialization";
import type {
  TeamDetailResponse,
  TeamJoinRequest,
  TeamListItem,
  TeamMember,
  TeamRole,
  TeamSentInvitation,
} from "@/lib/shared/types";
import { getUserIdByPseudo, sanitizeRoles } from "@/lib/server/users-service";
import { getTeamEntityStats } from "@/lib/server/stats-service";
import { cachedStats } from "@/lib/server/stats-cache";
import { getTeamRankingPosition, loadTeamRanking } from "@/lib/server/ranking-service";
import { compareRankedTeams, rankingMatchJoinSql } from "@/lib/shared/ranking";
import { hasTeamManagementRole } from "@/lib/shared/team-roles";
import { visibleAvatarUrl } from "@/lib/shared/avatar";
import {
  assertTeamNameAvailable,
  assertTeamTagAvailable,
  isTeamNameConflict,
  mapTeamTagConflict,
  resolveTeamTag,
} from "@/lib/server/team-tags";
import { TEAM_NAME_ALREADY_USED, checkTeamName } from "@/lib/shared/team-name";
import { localUploadUrl } from "@/lib/shared/uploads";
import { assertTermsAccepted, recordTermsAcceptance } from "@/lib/server/terms-acceptance";
import { notifyTeamJoinRequest } from "@/lib/server/team-join-notifications";
import { deleteUnreferencedUpload } from "@/lib/server/stored-upload-cleanup";
import type { TeamPageIdentity } from "@/lib/shared/entity-page-titles";

/**
 * Longueur de la barre de forme des cartes d'annuaire. Les fiches en montrent
 * moins (`FORM_LENGTH` de `lib/shared/stats.ts`) : c'est le même historique,
 * lu sur une fenêtre plus courte, jamais un autre calcul.
 */
const LIST_FORM_LENGTH = 10;

type TeamMemberRow = RowDataPacket & {
  membership_id: number;
  user_id: number;
  pseudo: string;
  avatar_url: string | null;
  visible_avatar: 0 | 1;
  is_deleted: 0 | 1;
  roles_json: string;
  joined_at: Date;
};

/**
 * @param viewerUserId Lecteur du roster, pour qu'il continue de voir son propre
 *   avatar même masqué au reste du site (`visibleAvatarUrl`).
 */
function mapMember(row: TeamMemberRow, viewerUserId: number | null): TeamMember {
  const userId = Number(row.user_id);
  return {
    membershipId: Number(row.membership_id),
    userId,
    pseudo: row.pseudo,
    avatarUrl: visibleAvatarUrl(
      row.avatar_url,
      row.visible_avatar === 1,
      userId === viewerUserId,
    ),
    roles: parseRoles(row.roles_json),
    joinedAt: toIso(row.joined_at) ?? new Date().toISOString(),
    isDeleted: row.is_deleted === 1,
  };
}

async function userOwnsTeam(teamId: number, userId: number): Promise<boolean> {
  const db = await getDatabase();
  const [rows] = await db.execute<(RowDataPacket & { roles_json: string })[]>(
    `SELECT roles_json
     FROM bg_team_members
     WHERE team_id = ?
       AND user_id = ?
       AND left_at IS NULL
     LIMIT 1`,
    [teamId, userId],
  );

  if (rows.length === 0) return false;
  const roles = parseRoles(rows[0].roles_json);
  return roles.includes("OWNER");
}

async function getMemberRoles(teamId: number, userId: number): Promise<TeamRole[] | null> {
  const db = await getDatabase();
  const [rows] = await db.execute<(RowDataPacket & { roles_json: string })[]>(
    `SELECT roles_json
     FROM bg_team_members
     WHERE team_id = ?
       AND user_id = ?
       AND left_at IS NULL
     LIMIT 1`,
    [teamId, userId],
  );
  if (rows.length === 0) return null;
  return parseRoles(rows[0].roles_json);
}

/**
 * Transaction d'une écriture sur le roster d'une équipe existante (rôles,
 * propriété, départ, exclusion).
 *
 * Ces gestes lisaient les rôles sur le pool puis écrivaient sans rien relire :
 * un destinataire parti entre les deux ne recevait pas la propriété que
 * l'ancien propriétaire venait de perdre, et l'équipe restait sans `OWNER`. Ils
 * se sérialisent désormais sur **la ligne de l'équipe**, verrouillée en
 * exclusif — la même que prennent la dissolution (`softDeleteTeam`) et, en
 * partagé, l'acceptation (`acceptIntoTeam`), toujours **après** une éventuelle
 * ligne de joueur : c'est l'ordre établi, qui interdit l'interblocage.
 *
 * @param lockUserId compte à verrouiller **avant** l'équipe — en toute première
 *   instruction, comme le fait `acceptIntoTeam` ; sans lui, le verrou de
 *   l'équipe est la première instruction. Sous REPEATABLE READ, c'est la
 *   première lecture ordinaire qui fige l'instantané : toute relecture des
 *   rôles vient donc après le verrou, par {@link lockMemberRoles}.
 */
async function withTeamRosterLock<T>(
  teamId: number,
  work: (connection: PoolConnection) => Promise<T>,
  lockUserId?: (connection: PoolConnection) => Promise<void>,
): Promise<T> {
  const db = await getDatabase();
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    if (lockUserId) await lockUserId(connection);
    await connection.execute(`SELECT id FROM bg_teams WHERE id = ? FOR UPDATE`, [teamId]);
    const result = await work(connection);
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

/** Rôles en cours d'un membre, relus **sous verrou** dans la transaction. */
async function lockMemberRoles(
  connection: Pick<PoolConnection, "execute">,
  teamId: number,
  userId: number,
): Promise<TeamRole[] | null> {
  const [rows] = await connection.execute<(RowDataPacket & { roles_json: string })[]>(
    `SELECT roles_json
     FROM bg_team_members
     WHERE team_id = ?
       AND user_id = ?
       AND left_at IS NULL
     LIMIT 1
     FOR UPDATE`,
    [teamId, userId],
  );
  if (rows.length === 0) return null;
  return parseRoles(rows[0].roles_json);
}

/**
 * Écrit sur **une** ligne d'appartenance en cours, et refuse si l'écriture n'en
 * apparie pas exactement une : sous les verrous de {@link withTeamRosterLock},
 * c'est impossible — le contrôle garde la règle si ce verrou venait à manquer,
 * au lieu d'un `UPDATE` muet qui laisserait le roster à moitié écrit.
 */
async function writeActiveMembership(
  connection: Pick<PoolConnection, "execute">,
  setSql: string,
  params: SqlParams,
  teamId: number,
  userId: number,
): Promise<void> {
  const [res] = await connection.execute<ResultSetHeader>(
    `UPDATE bg_team_members
     SET ${setSql}
     WHERE team_id = ?
       AND user_id = ?
       AND left_at IS NULL`,
    [...params, teamId, userId],
  );
  if (Number(res.affectedRows) !== 1) throw new Error("MEMBER_NOT_FOUND");
}

async function userCanManageTeam(teamId: number, userId: number): Promise<boolean> {
  return hasTeamManagementRole(await getMemberRoles(teamId, userId));
}

/**
 * Vrai si l'équipe est une équipe fantôme (créée par le staff, sans joueur).
 * Une équipe dissoute n'est plus administrable, fantôme ou non.
 */
export async function isGhostTeam(teamId: number): Promise<boolean> {
  const db = await getDatabase();
  const [rows] = await db.execute<(RowDataPacket & { is_ghost: 0 | 1; deleted_at: Date | null })[]>(
    `SELECT is_ghost, deleted_at FROM bg_teams WHERE id = ? LIMIT 1`,
    [teamId],
  );
  return rows.length > 0 && rows[0].is_ghost === 1 && rows[0].deleted_at === null;
}

/**
 * Autorisation d'administration d'une équipe. Deux voies :
 * - être OWNER (ou MANAGER selon l'action) de l'équipe ;
 * - disposer de la permission `tournaments` **et** viser une équipe fantôme.
 *
 * `viewerManagesGhostTeams` est fourni par la route API, seule à connaître les
 * rôles de plateforme du viewer.
 */
async function ghostAdminOverride(teamId: number, viewerManagesGhostTeams: boolean): Promise<boolean> {
  if (!viewerManagesGhostTeams) return false;
  return isGhostTeam(teamId);
}

/**
 * Le droit d'agir sur une équipe au titre de sa gestion **ou** de la dérogation
 * du staff sur une fantôme — puis les conditions d'utilisation
 * (`lib/shared/terms-of-use.ts`), exigées de qui gère **son** équipe et
 * jamais du staff sur une fantôme : c'est alors l'association elle-même qui
 * conduit l'équipe.
 *
 * La dérogation n'est interrogée que si le rôle manque, comme avant : un
 * gérant ne paie pas la lecture de l'équipe.
 *
 * @throws FORBIDDEN
 * @throws TERMS_ACCEPTANCE_REQUIRED
 */
async function assertCanActOnTeam(
  hasRole: boolean,
  requesterId: number,
  teamId: number,
  viewerManagesGhostTeams: boolean,
  requireTerms = true,
): Promise<void> {
  if (hasRole) {
    if (requireTerms) await assertTermsAccepted(requesterId);
    return;
  }
  if (!(await ghostAdminOverride(teamId, viewerManagesGhostTeams))) throw new Error("FORBIDDEN");
}

type TeamListForm = ("w" | "l" | "d")[];

/**
 * Forme de chaque équipe pour l'annuaire : ses dix derniers résultats, le plus
 * récent en tête.
 *
 * La requête parcourt **tous** les matchs de toutes les équipes, par une
 * jointure en `OR` peu favorable aux index, et elle était rejouée à chaque
 * chargement de `/equipes` alors qu'elle ne dépend pas du lecteur. Elle passe
 * donc par `cachedStats`, comme le bilan des joueurs : vidé à chaque score
 * (`tournaments/notifications.ts`), le cache ne retarde jamais une forme — un
 * roster qui bouge ne la change pas, et une équipe créée n'en a aucune.
 */
async function loadTeamListForms(): Promise<Map<number, TeamListForm>> {
  // Forme : les dix derniers résultats de chaque équipe, le plus récent en
  // tête. Même assiette de matchs que le bilan (`playedMatchSql`) et même
  // chronologie que les fiches (`updated_at`, à défaut les dates du tournoi) :
  // la barre de forme de la carte est le début de celle de la fiche, pas une
  // autre lecture des mêmes matchs. Le découpage par équipe se fait en SQL, ce
  // qui évite aussi de ne servir que les 1000 derniers matchs du site — au-delà,
  // les équipes les moins actives n'avaient plus de forme du tout.
  //
  // Le **nul** a sa lettre, et c'est cette assiette partagée qui l'y oblige :
  // depuis qu'elle admet les matchs sans vainqueur, un `CASE … ELSE 'l'` les
  // rangeait en défaites, si bien que la carte affichait une case rouge là où la
  // fiche de la même équipe annonçait « N ».
  const db = await getDatabase();
  const [formRows] = await db.execute<
    (RowDataPacket & { team_id: number; result: "w" | "l" | "d" })[]
  >(
    `SELECT team_id, result
     FROM (
       SELECT
         t.id AS team_id,
         CASE
           WHEN m.winner_team_id IS NULL THEN 'd'
           WHEN m.winner_team_id = t.id THEN 'w'
           ELSE 'l'
         END AS result,
         ROW_NUMBER() OVER (
           PARTITION BY t.id
           ORDER BY COALESCE(m.updated_at, tr.finished_at, tr.start_at) DESC, m.id DESC
         ) AS rn
       FROM bg_teams t
       JOIN bg_matches m
         ON ${rankingMatchJoinSql("t.id")}
       JOIN bg_tournaments tr ON tr.id = m.tournament_id
       WHERE t.deleted_at IS NULL
         AND t.solo_user_id IS NULL
     ) ranked
     WHERE rn <= ${LIST_FORM_LENGTH}
     ORDER BY team_id ASC, rn ASC`,
  );

  const formByTeam = new Map<number, TeamListForm>();
  for (const row of formRows) {
    const teamId = Number(row.team_id);
    const form = formByTeam.get(teamId) ?? [];
    form.push(row.result);
    formByTeam.set(teamId, form);
  }
  return formByTeam;
}

/**
 * Annuaire des équipes.
 *
 * @param viewerId Lecteur de la liste. Sert au seul masquage d'avatar : sans
 *   lui, un joueur qui a masqué le sien ne le verrait pas non plus sur la carte
 *   de sa propre équipe.
 */
export async function listTeams(viewerId: number | null = null): Promise<TeamListItem[]> {
  const db = await getDatabase();

  // Effectif et identité de chaque équipe. Le bilan (victoires, défaites,
  // points) ne se calcule **pas** ici : il vient de `loadTeamRanking`, source
  // unique du classement du site. L'agréger dans cette requête revenait à le
  // multiplier par l'effectif de l'équipe — la jointure des membres et celle
  // des matchs formaient un produit cartésien, et une équipe de six joueurs
  // affichait six fois ses victoires.
  const [teamRows] = await db.execute<
    (RowDataPacket & {
      id: number;
      name: string;
      tag: string | null;
      logo_url: string | null;
      created_at: Date;
      members_count: number;
      is_ghost: 0 | 1;
    })[]
  >(
    `SELECT
      t.id,
      t.name,
      t.tag,
      t.logo_url,
      t.created_at,
      t.is_ghost,
      COALESCE(COUNT(tm.id), 0) AS members_count
     FROM bg_teams t
     LEFT JOIN bg_team_members tm ON tm.team_id = t.id AND tm.left_at IS NULL
     WHERE t.deleted_at IS NULL
       AND t.solo_user_id IS NULL
     GROUP BY t.id, t.name, t.tag, t.logo_url, t.created_at, t.is_ghost`,
  );

  // Forme : mutualisée (voir `loadTeamListForms`), elle ne dépend pas du lecteur.
  const formByTeam = await cachedStats("team-list-forms", loadTeamListForms);

  // Bilan et points : une seule source pour l'annuaire, la fiche et le
  // leaderboard de la landing.
  const rankingByTeam = new Map(
    (await loadTeamRanking({ includeUnplayed: true })).map((row) => [row.teamId, row]),
  );

  // Get roster preview
  const [rosterRows] = await db.execute<
    (RowDataPacket & {
      team_id: number;
      user_id: number;
      pseudo: string;
      avatar_url: string | null;
      visible_avatar: 0 | 1;
    })[]
  >(
    `SELECT
      tm.team_id,
      u.id AS user_id,
      u.pseudo,
      u.avatar_url,
      u.visible_avatar
     FROM (
       SELECT team_id, user_id, ROW_NUMBER() OVER (PARTITION BY team_id ORDER BY joined_at ASC) as rn
       FROM bg_team_members
       WHERE left_at IS NULL
     ) limited_members
     JOIN bg_team_members tm ON tm.user_id = limited_members.user_id AND tm.team_id = limited_members.team_id
     JOIN bg_users u ON u.id = tm.user_id
     WHERE limited_members.rn <= 6
     ORDER BY tm.team_id, tm.joined_at ASC`,
  );

  // Get games practiced
  const [gameRows] = await db.execute<
    (RowDataPacket & {
      team_id: number;
      game: "OW" | "MR";
    })[]
  >(
    `SELECT DISTINCT
      tr.team_id,
      t.game
     FROM bg_tournament_registrations tr
     JOIN bg_tournaments t ON t.id = tr.tournament_id
     ORDER BY tr.team_id, t.game`,
  );

  // Organize roster by team
  const rosterByTeam = new Map<
    number,
    { userId: number; pseudo: string; avatarUrl: string | null }[]
  >();
  for (const row of rosterRows) {
    if (!rosterByTeam.has(row.team_id)) {
      rosterByTeam.set(row.team_id, []);
    }
    const memberId = Number(row.user_id);
    rosterByTeam.get(row.team_id)!.push({
      userId: memberId,
      pseudo: row.pseudo,
      // Le réglage `visible_avatar` vaut ici comme sur une fiche de profil : la
      // vignette du roster lisait `avatar_url` sans le consulter, et rendait
      // donc à tout le site l'image que son propriétaire avait masquée.
      avatarUrl: visibleAvatarUrl(row.avatar_url, row.visible_avatar === 1, memberId === viewerId),
    });
  }

  // Organize games by team
  const gamesByTeam = new Map<number, ("OW" | "MR")[]>();
  for (const row of gameRows) {
    if (!gamesByTeam.has(row.team_id)) {
      gamesByTeam.set(row.team_id, []);
    }
    gamesByTeam.get(row.team_id)!.push(row.game);
  }

  // Transform rows and calculate rank
  const unsorted: Omit<TeamListItem, "rank">[] = teamRows.map((row) => {
    const id = Number(row.id);
    const ranked = rankingByTeam.get(id);
    return {
      id,
      name: row.name,
      tag: row.tag,
      logoUrl: localUploadUrl(row.logo_url),
      membersCount: Number(row.members_count),
      createdAt: toIso(row.created_at)!,
      wins: ranked?.wins ?? 0,
      losses: ranked?.losses ?? 0,
      points: ranked?.points ?? 0,
      // Copie : la table vient du cache, partagée entre tous les lecteurs.
      form: [...(formByTeam.get(id) ?? [])],
      games: gamesByTeam.get(id) || [],
      rosterPreview: rosterByTeam.get(id) || [],
      region: null,
      isGhost: row.is_ghost === 1,
    };
  });

  // Même ordre que le leaderboard de la landing : les classées d'abord, puis la
  // cote, les victoires et le nom. `TeamListItem` porte les quatre champs que
  // `compareRankedTeams` lit, donc la carte se trie avec la règle unique.
  unsorted.sort(compareRankedTeams);

  const teams: TeamListItem[] = unsorted.map((team, index) => ({
    ...team,
    rank: index + 1,
  }));

  return teams;
}

/**
 * Crée une équipe et en fait son auteur OWNER.
 *
 * Le sigle est facultatif (`null` = pas de sigle). Sa forme est validée avant
 * toute écriture, son unicité vérifiée dans la transaction — et rattrapée par
 * l'index unique si une création concurrente a pris le même entre-temps.
 */
export async function createTeam(
  ownerUserId: number,
  name: string,
  description?: string | null,
  tag?: string | null,
): Promise<number> {
  // L'acceptation des conditions est la case du formulaire : la route la
  // vérifie avant d'appeler, et elle est **écrite ici**, dans la transaction
  // qui crée l'équipe — une équipe née sans sa preuve d'acceptation, ou une
  // preuve pour une équipe qui n'a pas pu naître, seraient deux mensonges.
  const db = await getDatabase();
  const normalizedTag = resolveTeamTag(tag);

  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();

    // « Une seule équipe active à la fois » n'est tenu par aucun index : le
    // contrôle se fait sous le verrou de la ligne du joueur, **celui que prend
    // `acceptIntoTeam`**, en toute première instruction (sous REPEATABLE READ,
    // une lecture ordinaire placée avant figerait l'instantané, et l'appartenance
    // relue ensuite serait périmée). Lu sur le pool, hors transaction, il
    // laissait passer deux créations simultanées — ou une création et une
    // acceptation — et le joueur finissait dans deux équipes actives.
    const [account] = await connection.execute<(RowDataPacket & { id: number })[]>(
      `SELECT id FROM bg_users WHERE id = ? FOR UPDATE`,
      [ownerUserId],
    );
    if (account.length === 0) throw new Error("PROFILE_NOT_FOUND");

    const [existingMembership] = await connection.execute<(RowDataPacket & { id: number })[]>(
      `SELECT id
       FROM bg_team_members
       WHERE user_id = ?
         AND left_at IS NULL
       LIMIT 1`,
      [ownerUserId],
    );
    if (existingMembership.length > 0) {
      throw new Error("USER_ALREADY_IN_TEAM");
    }

    await assertTeamTagAvailable(connection, normalizedTag);

    const [teamInsert] = await mapTeamTagConflict(() =>
      connection.execute<ResultSetHeader>(
        `INSERT INTO bg_teams (name, tag, logo_url, description)
         VALUES (?, ?, NULL, ?)`,
        [name.trim(), normalizedTag, description?.trim() ? description.trim() : null],
      ));

    const ownerRoles = JSON.stringify(["OWNER"]);

    await connection.execute(
      `INSERT INTO bg_team_members (team_id, user_id, roles_json)
       VALUES (?, ?, ?)`,
      [teamInsert.insertId, ownerUserId, ownerRoles],
    );

    if (!(await recordTermsAcceptance(ownerUserId, "TEAM_CREATION", connection))) {
      throw new Error("PROFILE_NOT_FOUND");
    }

    await connection.commit();
    return Number(teamInsert.insertId);
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

/**
 * Ce que l'onglet d'une fiche d'équipe a le droit de nommer — le nom, et rien
 * d'autre. Lecture d'une ligne, sans les membres ni les statistiques de
 * {@link getTeamDetail} : elle sert à `generateMetadata`, jouée à chaque
 * ouverture de la fiche en plus de la lecture de la page.
 *
 * Une entrée solo rend `null`, comme `getTeamDetail` : c'est un joueur, sa
 * fiche est son profil. Une équipe dissoute garde son nom, sa fiche aussi.
 */
export async function getTeamPageIdentity(teamId: number): Promise<TeamPageIdentity | null> {
  const db = await getDatabase();
  const [rows] = await db.execute<(RowDataPacket & { name: string })[]>(
    `SELECT name FROM bg_teams WHERE id = ? AND solo_user_id IS NULL LIMIT 1`,
    [teamId],
  );
  return rows.length === 0 ? null : { name: rows[0].name };
}

/**
 * Détail d'une équipe.
 *
 * `viewerManagesGhostTeams` = le viewer dispose de la permission `tournaments`.
 * Il administre alors les équipes **fantômes** (sans joueur rattaché) sans en
 * être membre ; ça ne lui donne aucun droit sur les équipes réelles.
 */
/**
 * Fiche complète d'une équipe.
 *
 * @param includeRanking calcule la place au classement du site. Coûteux — il
 *   faut agréger toutes les équipes — donc réservé à la consultation de la
 *   fiche : les routes de mutation reconstruisent la réponse sans classement.
 */
export async function getTeamDetail(
  teamId: number,
  viewerUserId: number,
  viewerManagesGhostTeams = false,
  includeRanking = false,
): Promise<TeamDetailResponse | null> {
  const db = await getDatabase();

  const [teams] = await db.execute<(RowDataPacket & { id: number; name: string; tag: string | null; logo_url: string | null; description: string | null; created_at: Date; deleted_at: Date | null; is_ghost: 0 | 1; solo_user_id: number | null })[]>(
    `SELECT id, name, tag, logo_url, description, created_at, deleted_at, is_ghost, solo_user_id
     FROM bg_teams
     WHERE id = ?
     LIMIT 1`,
    [teamId],
  );

  // Une entrée solo occupe une ligne de `bg_teams` mais représente un joueur :
  // elle n'a pas de fiche d'équipe, son identité publique est son profil.
  if (teams.length === 0 || teams[0].solo_user_id !== null) return null;

  const isDeleted = teams[0].deleted_at !== null;

  const [membersRows] = await db.execute<TeamMemberRow[]>(
    `SELECT
      tm.id AS membership_id,
      tm.user_id,
      u.pseudo,
      u.avatar_url,
      u.visible_avatar,
      u.is_deleted,
      tm.roles_json,
      tm.joined_at
     FROM bg_team_members tm
     JOIN bg_users u ON u.id = tm.user_id
     WHERE tm.team_id = ?
       AND tm.left_at IS NULL
     ORDER BY u.pseudo ASC`,
    [teamId],
  );

  // Statistiques et historique proviennent de la même collecte : le bilan de
  // chaque ligne ne peut donc pas contredire l'agrégat affiché au-dessus.
  const [{ stats, tournaments }, ranking] = await Promise.all([
    getTeamEntityStats(teamId),
    includeRanking ? getTeamRankingPosition(teamId) : Promise.resolve(null),
  ]);

  const isGhost = teams[0].is_ghost === 1;

  // Une équipe dissoute reste consultable (stats) mais n'est plus administrable
  // ni rejoignable.
  const managedAsGhost = !isDeleted && isGhost && viewerManagesGhostTeams;
  const canManage = !isDeleted && (managedAsGhost || (await userCanManageTeam(teamId, viewerUserId)));

  const viewerRoles = isDeleted ? null : await getMemberRoles(teamId, viewerUserId);
  let viewerMembership: TeamDetailResponse["viewerMembership"] = "NONE";
  if (viewerRoles) {
    viewerMembership = viewerRoles.includes("OWNER") ? "OWNER" : "MEMBER";
  }

  let viewerInvitation: TeamDetailResponse["viewerInvitation"] = "NONE";
  let viewerInvitationId: number | null = null;
  if (!isDeleted && viewerMembership === "NONE") {
    const [inv] = await db.execute<(RowDataPacket & { id: number; kind: "INVITE" | "REQUEST" })[]>(
      `SELECT id, kind
       FROM bg_team_invitations
       WHERE team_id = ? AND user_id = ? AND status = 'PENDING'
       ORDER BY created_at DESC
       LIMIT 1`,
      [teamId, viewerUserId],
    );
    if (inv.length > 0) {
      viewerInvitation = inv[0].kind === "INVITE" ? "INVITED" : "REQUESTED";
      viewerInvitationId = Number(inv[0].id);
    }
  }

  return {
    team: {
      id: Number(teams[0].id),
      name: teams[0].name,
      tag: teams[0].tag,
      logoUrl: localUploadUrl(teams[0].logo_url),
      description: teams[0].description,
      createdAt: toIso(teams[0].created_at)!,
      deletedAt: toIso(teams[0].deleted_at),
      isGhost,
    },
    members: membersRows.map((row) => mapMember(row, viewerUserId)),
    tournaments,
    stats,
    ranking,
    canManage,
    managedAsGhost,
    viewerUserId,
    viewerMembership,
    viewerInvitation,
    viewerInvitationId,
  };
}

/**
 * Met à jour les métadonnées d'une équipe. Un champ absent du patch n'est pas
 * touché ; `tag: null` (ou une chaîne vide) **retire** le sigle.
 */
export async function updateTeamMeta(
  requesterId: number,
  teamId: number,
  patch: { name?: string; description?: string | null; tag?: string | null },
  viewerManagesGhostTeams = false,
): Promise<void> {
  const db = await getDatabase();
  await assertCanActOnTeam(await userOwnsTeam(teamId, requesterId), requesterId, teamId, viewerManagesGhostTeams);

  const updates: string[] = [];
  const params: SqlParams = [];

  if (patch.name !== undefined) {
    // Mêmes bornes qu'à la création : le renommage n'en contrôlait aucune, si
    // bien qu'un nom vide s'enregistrait et qu'un nom trop long partait en
    // erreur MySQL brute jusqu'à la notification.
    const check = checkTeamName(patch.name);
    if (!check.ok) throw new Error(check.reason);
    await assertTeamNameAvailable(db, check.name, teamId);
    updates.push("name = ?");
    params.push(check.name);
  }

  if (patch.description !== undefined) {
    updates.push("description = ?");
    params.push(patch.description?.trim() ? patch.description.trim() : null);
  }

  if (patch.tag !== undefined) {
    const normalizedTag = resolveTeamTag(patch.tag);
    // L'équipe garde le sien : sans cette exclusion, réenregistrer la fiche
    // sans toucher au sigle le déclarerait pris par elle-même.
    await assertTeamTagAvailable(db, normalizedTag, teamId);
    updates.push("tag = ?");
    params.push(normalizedTag);
  }

  if (updates.length === 0) return;

  params.push(teamId);
  try {
    await mapTeamTagConflict(() =>
      db.execute(`UPDATE bg_teams SET ${updates.join(", ")} WHERE id = ?`, params));
  } catch (error) {
    // La course entre deux renommages vers le même nom : le `SELECT` préalable
    // les a laissés passer tous les deux, l'index tranche.
    if (isTeamNameConflict(error)) throw new Error(TEAM_NAME_ALREADY_USED);
    throw error;
  }
}

export async function updateTeamLogo(
  requesterId: number,
  teamId: number,
  logoPath: string | null,
  viewerManagesGhostTeams = false,
): Promise<void> {
  // Retirer un logo n'attend aucune acceptation : c'est justement le geste
  // qu'on veut voir faire à qui doute de ses droits sur l'image.
  await assertCanActOnTeam(
    await userCanManageTeam(teamId, requesterId),
    requesterId,
    teamId,
    viewerManagesGhostTeams,
    logoPath !== null,
  );
  const db = await getDatabase();
  await db.execute(`UPDATE bg_teams SET logo_url = ? WHERE id = ?`, [logoPath, teamId]);
}

/**
 * Retrait d'un logo d'équipe par la modération (permission `moderation`), sans
 * être membre de l'équipe — le geste qui suit un signalement de droit d'auteur.
 *
 * La ligne est relue **sous verrou** : un logo téléversé à l'instant par la
 * gestion de l'équipe serait sinon retiré à la place de celui qu'on a vu. Le
 * fichier, lui, est effacé par l'appelant **après** le commit (un `unlink` ne
 * se défait pas). Une entrée solo n'a pas de logo propre : c'est la copie de
 * l'avatar d'un joueur, qui n'est pas une équipe.
 *
 * @throws TEAM_NOT_FOUND
 * @throws TEAM_HAS_NO_LOGO
 */
export async function removeTeamLogoAsModerator(
  teamId: number,
): Promise<{ teamName: string; removedLogoUrl: string; sharedWithOtherTeams: boolean }> {
  const db = await getDatabase();
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.execute<
      (RowDataPacket & { name: string; logo_url: string | null; solo_user_id: number | null })[]
    >(`SELECT name, logo_url, solo_user_id FROM bg_teams WHERE id = ? FOR UPDATE`, [teamId]);
    if (rows.length === 0 || rows[0].solo_user_id !== null) throw new Error("TEAM_NOT_FOUND");
    const logoUrl = rows[0].logo_url;
    if (!logoUrl) throw new Error("TEAM_HAS_NO_LOGO");
    await connection.execute(`UPDATE bg_teams SET logo_url = NULL WHERE id = ?`, [teamId]);
    // Un même fichier peut être désigné par plusieurs équipes (le jeu de test
    // en partage un) : l'effacer retirerait aussi le logo des autres. Même
    // règle que le masquage (`hideTeamLogo`).
    const [sharing] = await connection.execute<(RowDataPacket & { total: number })[]>(
      `SELECT COUNT(*) AS total FROM bg_teams WHERE logo_url = ? AND id <> ?`,
      [logoUrl, teamId],
    );
    await connection.commit();
    return {
      teamName: rows[0].name,
      removedLogoUrl: logoUrl,
      sharedWithOtherTeams: Number(sharing[0]?.total ?? 0) > 0,
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export async function getTeamLogoUrl(teamId: number): Promise<string | null> {
  const db = await getDatabase();
  const [rows] = await db.execute<(RowDataPacket & { logo_url: string | null })[]>(
    `SELECT logo_url FROM bg_teams WHERE id = ? LIMIT 1`,
    [teamId],
  );
  if (rows.length === 0) return null;
  return rows[0].logo_url;
}

export async function canManageTeam(teamId: number, userId: number): Promise<boolean> {
  return userCanManageTeam(teamId, userId);
}

/**
 * Change les rôles d'un membre. Autorisé aux rôles de gestion (OWNER ou
 * MANAGER) ; un MANAGER ne touche pas aux rôles de l'OWNER.
 *
 * Rôles du demandeur **et** de la cible relus sous le verrou de l'équipe
 * (`withTeamRosterLock`) : lu avant, un `targetIsOwner` périmé réécrivait sans
 * `OWNER` les rôles d'un membre qui venait de recevoir la propriété, et
 * l'équipe restait sans propriétaire.
 */
export async function updateTeamMemberRoles(
  requesterId: number,
  teamId: number,
  memberUserId: number,
  roles: TeamRole[],
): Promise<void> {
  await withTeamRosterLock(teamId, async (connection) => {
    const requesterRoles = await lockMemberRoles(connection, teamId, requesterId);
    if (!requesterRoles) throw new Error("FORBIDDEN");
    const requesterIsOwner = requesterRoles.includes("OWNER");
    const requesterIsManager = requesterRoles.includes("MANAGER");
    if (!requesterIsOwner && !requesterIsManager) throw new Error("FORBIDDEN");
    await assertTermsAccepted(requesterId, connection);

    const targetRoles = await lockMemberRoles(connection, teamId, memberUserId);
    if (!targetRoles) throw new Error("MEMBER_NOT_FOUND");
    const targetIsOwner = targetRoles.includes("OWNER");

    if (targetIsOwner && !requesterIsOwner) {
      throw new Error("FORBIDDEN");
    }

    const filteredRoles = sanitizeRoles(roles).filter((role) => role !== "OWNER");
    if (filteredRoles.length === 0) {
      throw new Error("MISSING_ROLE");
    }

    const finalRoles = targetIsOwner
      ? (["OWNER", ...filteredRoles] as TeamRole[])
      : filteredRoles;

    await writeActiveMembership(
      connection,
      "roles_json = ?",
      [JSON.stringify(finalRoles)],
      teamId,
      memberUserId,
    );
  });
}

/**
 * Exclut (kick) un membre. Autorisé aux rôles de gestion (OWNER ou MANAGER).
 * Le propriétaire ne peut pas être exclu, et nul ne peut s'exclure soi-même
 * via ce chemin (utiliser `leaveTeam`).
 *
 * Sous le verrou de l'équipe, comme le transfert : lu avant, un membre qui
 * recevait la propriété entre la lecture et l'écriture était exclu malgré
 * `CANNOT_KICK_OWNER`, emportant le seul `OWNER` de l'équipe.
 */
export async function removeTeamMember(requesterId: number, teamId: number, memberUserId: number): Promise<void> {
  await withTeamRosterLock(teamId, async (connection) => {
    const requesterRoles = await lockMemberRoles(connection, teamId, requesterId);
    if (!requesterRoles) throw new Error("FORBIDDEN");
    const requesterIsOwner = requesterRoles.includes("OWNER");
    const requesterIsManager = requesterRoles.includes("MANAGER");
    if (!requesterIsOwner && !requesterIsManager) throw new Error("FORBIDDEN");
    await assertTermsAccepted(requesterId, connection);

    if (memberUserId === requesterId) {
      throw new Error("OWNER_CANNOT_LEAVE");
    }

    const targetRoles = await lockMemberRoles(connection, teamId, memberUserId);
    if (!targetRoles) throw new Error("MEMBER_NOT_FOUND");
    if (targetRoles.includes("OWNER")) {
      throw new Error("CANNOT_KICK_OWNER");
    }

    await writeActiveMembership(connection, "left_at = NOW()", [], teamId, memberUserId);
  });
}

/**
 * Un membre quitte volontairement son équipe. Le propriétaire doit d'abord
 * transférer la propriété (`transferTeamOwnership`).
 *
 * Sous le verrou de l'équipe : lu avant, un membre qui recevait la propriété
 * pendant son départ partait avec, et l'équipe restait sans propriétaire.
 */
export async function leaveTeam(userId: number, teamId: number): Promise<void> {
  await withTeamRosterLock(teamId, async (connection) => {
    const roles = await lockMemberRoles(connection, teamId, userId);
    if (!roles) throw new Error("NOT_A_MEMBER");
    if (roles.includes("OWNER")) throw new Error("OWNER_MUST_TRANSFER");

    await writeActiveMembership(connection, "left_at = NOW()", [], teamId, userId);
  });
}

/**
 * Équipe active d'un joueur (une seule, invariant du projet), **avec les rôles
 * qu'il y porte**.
 *
 * Les rôles voyagent avec l'équipe, et pas par un second appel : ils vivent sur
 * la ligne d'appartenance déjà lue, et l'appelant qui en a besoin est justement
 * celui qui ne peut pas se permettre une requête de plus — l'inscription les lit
 * sous le verrou du tournoi (voir `connection` ci-dessous).
 *
 * @param connection Connexion sur laquelle lire. **À fournir dès que l'appelant
 *   est dans une transaction** : sans elle, la fonction emprunte une *seconde*
 *   place du pool (25) alors que la première est retenue par la transaction. Un
 *   appelant qui tient en plus un verrou de ligne — l'inscription retient celle
 *   du tournoi — arme alors un convoi : le porteur du verrou attend une
 *   connexion que les transactions bloquées sur son verrou ne rendront pas, et
 *   rien ne se dénoue avant `innodb_lock_wait_timeout`.
 */
export async function getUserActiveTeam(
  userId: number,
  connection?: Pick<PoolConnection, "execute">,
): Promise<{ teamId: number; teamName: string; roles: TeamRole[] } | null> {
  const db = connection ?? (await getDatabase());
  const [rows] = await db.execute<
    (RowDataPacket & { team_id: number; team_name: string; roles_json: string })[]
  >(
    `SELECT tm.team_id, t.name AS team_name, tm.roles_json
     FROM bg_team_members tm
     JOIN bg_teams t ON t.id = tm.team_id
     WHERE tm.user_id = ?
       AND tm.left_at IS NULL
     LIMIT 1`,
    [userId],
  );

  if (rows.length === 0) return null;

  return {
    teamId: Number(rows[0].team_id),
    teamName: rows[0].team_name,
    roles: parseRoles(rows[0].roles_json),
  };
}

/**
 * Transfère la propriété (`OWNER`) à un autre membre en cours de l'équipe.
 *
 * Tout se joue dans une transaction : compte du destinataire verrouillé en
 * toute première instruction (le verrou que prend la suppression de compte),
 * puis la ligne de l'équipe (`withTeamRosterLock`), puis les rôles des deux
 * membres **relus** sous ces verrous. Lus sur le pool, ils laissaient deux
 * issues : un destinataire parti entre la lecture et l'écriture ne recevait
 * rien pendant que l'ancien propriétaire perdait le rôle (équipe sans
 * `OWNER`, que le staff ne peut pas réparer sur une équipe réelle), et deux
 * transferts simultanés vers deux membres laissaient deux `OWNER`. Chaque
 * écriture doit en outre apparier exactement une ligne, sans quoi tout est
 * défait.
 */
export async function transferTeamOwnership(
  requesterId: number,
  teamId: number,
  newOwnerUserId: number,
): Promise<void> {
  if (requesterId === newOwnerUserId) {
    throw new Error("TRANSFER_TO_SELF");
  }

  let targetDeleted = false;
  await withTeamRosterLock(
    teamId,
    async (connection) => {
      const requesterRoles = await lockMemberRoles(connection, teamId, requesterId);
      if (!requesterRoles || !requesterRoles.includes("OWNER")) {
        throw new Error("FORBIDDEN");
      }
      await assertTermsAccepted(requesterId, connection);

      const targetRoles = await lockMemberRoles(connection, teamId, newOwnerUserId);
      if (!targetRoles) {
        throw new Error("MEMBER_NOT_FOUND");
      }
      // Un compte anonymisé garde sa ligne d'appartenance : lui confier
      // l'équipe la laisserait sans personne capable d'ouvrir une session pour
      // la conduire, et l'état serait définitif — seul le propriétaire
      // transfère ou dissout, et il ne peut être ni exclu ni partir.
      if (targetDeleted) throw new Error("MEMBER_ACCOUNT_DELETED");

      const newOwnerRoles: TeamRole[] = ["OWNER", ...targetRoles.filter((r) => r !== "OWNER")];
      const oldOwnerRemaining = requesterRoles.filter((r) => r !== "OWNER");
      const oldOwnerRoles: TeamRole[] = oldOwnerRemaining.length === 0 ? ["DPS"] : oldOwnerRemaining;

      await writeActiveMembership(
        connection,
        "roles_json = ?",
        [JSON.stringify(oldOwnerRoles)],
        teamId,
        requesterId,
      );
      await writeActiveMembership(
        connection,
        "roles_json = ?",
        [JSON.stringify(newOwnerRoles)],
        teamId,
        newOwnerUserId,
      );
    },
    async (connection) => {
      const [targetAccount] = await connection.execute<(RowDataPacket & { is_deleted: 0 | 1 })[]>(
        `SELECT is_deleted FROM bg_users WHERE id = ? FOR UPDATE`,
        [newOwnerUserId],
      );
      targetDeleted = targetAccount.length === 0 || targetAccount[0].is_deleted === 1;
    },
  );
}

async function teamIsDeleted(teamId: number): Promise<boolean> {
  const db = await getDatabase();
  const [rows] = await db.execute<(RowDataPacket & { deleted_at: Date | null })[]>(
    `SELECT deleted_at FROM bg_teams WHERE id = ? LIMIT 1`,
    [teamId],
  );
  return rows.length > 0 && rows[0].deleted_at !== null;
}

/**
 * Dissout (soft-delete) une équipe : réservé au propriétaire. Les données
 * saisies par les utilisateurs (nom, description, logo — fichier compris, s'il
 * n'est plus désigné ailleurs) sont effacées/anonymisées
 * et les membres détachés, mais la ligne et tout l'historique généré par la
 * plateforme (inscriptions, matchs, classements) sont conservés à jamais.
 */
export async function softDeleteTeam(
  requesterId: number,
  teamId: number,
  viewerManagesGhostTeams = false,
): Promise<void> {
  const db = await getDatabase();
  if (await teamIsDeleted(teamId)) throw new Error("TEAM_ALREADY_DELETED");
  if (
    !(await userOwnsTeam(teamId, requesterId))
    && !(await ghostAdminOverride(teamId, viewerManagesGhostTeams))
  ) {
    throw new Error("FORBIDDEN");
  }

  let previousLogoUrl: string | null = null;
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();

    // Le logo est relu sous verrou, en toute première instruction : c'est le
    // fichier que la dissolution retire, et il n'est effacé qu'après le commit.
    const [locked] = await connection.execute<(RowDataPacket & { logo_url: string | null })[]>(
      `SELECT logo_url FROM bg_teams WHERE id = ? FOR UPDATE`,
      [teamId],
    );
    previousLogoUrl = locked[0]?.logo_url ?? null;

    // Anonymise les données saisies par l'utilisateur et libère les deux
    // identités uniques : le nom **et le sigle**. Le sigle vaut sur tout le
    // site ; laissé sur une équipe dissoute, il resterait pris à jamais par une
    // équipe qui n'existe plus — la ligne, elle, survit pour ses statistiques.
    await connection.execute(
      `UPDATE bg_teams
       SET deleted_at = NOW(),
           name = CONCAT('Équipe dissoute #', id),
           tag = NULL,
           description = NULL,
           logo_url = NULL
       WHERE id = ?`,
      [teamId],
    );

    // Détache tous les membres encore actifs.
    await connection.execute(
      `UPDATE bg_team_members SET left_at = NOW() WHERE team_id = ? AND left_at IS NULL`,
      [teamId],
    );

    // Annule les invitations/demandes en attente.
    await connection.execute(
      `UPDATE bg_team_invitations
       SET status = 'CANCELLED', responded_at = NOW()
       WHERE team_id = ? AND status = 'PENDING'`,
      [teamId],
    );

    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }

  // Vider la colonne ne retirait pas l'image : le fichier restait servi par
  // `/api/uploads/teams/…`, en cache public d'un an. Après le commit (un
  // `unlink` ne se défait pas), et seulement s'il vit dans `teams/` et que plus
  // aucune ligne ne le désigne — un logo partagé reste à qui le porte encore.
  await deleteUnreferencedUpload(previousLogoUrl, "teams");
}

// ───────────────────────────── Invitations & self-service ─────────────────────────────

type InvitationRow = RowDataPacket & {
  id: number;
  team_id: number;
  team_name: string;
  user_id: number;
  pseudo: string;
  kind: "INVITE" | "REQUEST";
  created_at: Date;
};

async function userHasActiveTeam(userId: number): Promise<boolean> {
  const db = await getDatabase();
  const [rows] = await db.execute<(RowDataPacket & { id: number })[]>(
    `SELECT id FROM bg_team_members WHERE user_id = ? AND left_at IS NULL LIMIT 1`,
    [userId],
  );
  return rows.length > 0;
}

/**
 * Fait entrer un joueur dans une équipe en acceptant une invitation ou une
 * demande — **en une seule transaction**.
 *
 * Les trois chemins d'acceptation (le joueur accepte, la gestion accepte, une
 * invitation croise une demande) lisaient `status = 'PENDING'`, relisaient
 * « ce joueur a-t-il une équipe ? », inséraient l'appartenance puis marquaient
 * l'invitation, en quatre instructions sur le pool : deux acceptations
 * simultanées — le joueur clique « Rejoindre » pendant que la gestion accepte sa
 * demande, ou deux équipes l'acceptent au même instant — passaient toutes deux
 * les contrôles, et l'invariant « une seule équipe active » n'est tenu par aucun
 * index.
 *
 * Le verrou est celui de la ligne du **joueur**, en toute première instruction
 * (sous `REPEATABLE READ`, c'est la première lecture ordinaire qui fige
 * l'instantané : placée avant l'attente, elle ferait lire un monde périmé). C'est
 * aussi celui que prennent la suppression de compte et la création d'une entrée
 * solo : une acceptation ne peut donc pas non plus rattacher un compte qu'on est
 * en train d'anonymiser. L'équipe est relue ensuite (une dissolution concurrente
 * rattacherait sinon le joueur à une équipe morte), puis l'invitation est
 * **réservée** par un `UPDATE`
 * conditionné à `PENDING`, relu sur `affectedRows` — une réponse arrivée entre
 * la lecture de l'appelant et ici l'emporte.
 *
 * **Reprise d'une équipe fantôme** : une invitation portant `OWNER` n'est
 * émise que par `claimGhostTeam` (staff `tournaments`) — une invitation de la
 * gestion ne peut jamais le porter. Elle seule fait entrer un joueur dans une
 * fantôme : il y arrive `OWNER`, l'équipe redevient ordinaire (`is_ghost = 0`)
 * et les autres reprises encore en attente sur elle deviennent caduques. Une
 * reprise dont la fantôme a déjà trouvé propriétaire est refusée
 * (`NOT_A_GHOST_TEAM`) plutôt que de faire entrer le joueur dans une équipe
 * réelle qui ne l'a pas invité.
 *
 * @param roles rôles posés à l'arrivée ; vide (demande, invitation d'avant la
 *   colonne) → `DPS`, le défaut d'origine. `OWNER` n'est posé que par une
 *   reprise de fantôme.
 */
async function acceptIntoTeam(
  invitationId: number,
  teamId: number,
  userId: number,
  roles: TeamRole[],
): Promise<void> {
  const claim = isGhostClaimRoles(roles);
  const filtered = sanitizeRoles(roles).filter((r) => r !== "OWNER");
  const payload = claim ? ["OWNER"] : filtered.length === 0 ? ["DPS"] : filtered;

  const db = await getDatabase();
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();

    const [account] = await connection.execute<(RowDataPacket & { is_deleted: 0 | 1 })[]>(
      `SELECT is_deleted FROM bg_users WHERE id = ? FOR UPDATE`,
      [userId],
    );
    if (account.length === 0 || account[0].is_deleted === 1) throw new Error("PLAYER_ACCOUNT_DELETED");

    // L'équipe est relue **sous verrou partagé**, et avant l'invitation : la
    // dissolution (`softDeleteTeam`) écrit l'équipe puis annule ses
    // invitations ; prendre les deux dans le même ordre qu'elle interdit
    // l'interblocage, et une dissolution commitée pendant l'attente est vue.
    // Une reprise **écrit** l'équipe (`is_ghost = 0`) : elle la verrouille donc
    // d'emblée en exclusif — deux reprises concurrentes qui tiendraient chacune
    // un verrou partagé s'interbloqueraient en voulant l'élever.
    const [teams] = await connection.execute<
      (RowDataPacket & { id: number; deleted_at: Date | null; is_ghost: 0 | 1; solo_user_id: number | null })[]
    >(
      `SELECT id, deleted_at, is_ghost, solo_user_id FROM bg_teams WHERE id = ? ${
        claim ? "FOR UPDATE" : "LOCK IN SHARE MODE"
      }`,
      [teamId],
    );
    if (teams.length === 0) throw new Error("TEAM_NOT_FOUND");
    if (teams[0].deleted_at !== null) throw new Error("TEAM_DELETED");
    if (teams[0].solo_user_id !== null) throw new Error("TEAM_NOT_JOINABLE");
    if (claim) {
      if (teams[0].is_ghost !== 1) throw new Error("NOT_A_GHOST_TEAM");
    } else if (teams[0].is_ghost === 1) {
      throw new Error("TEAM_NOT_JOINABLE");
    }

    const [claimed] = await connection.execute<ResultSetHeader>(
      `UPDATE bg_team_invitations
       SET status = 'ACCEPTED', responded_at = NOW()
       WHERE id = ? AND status = 'PENDING'`,
      [invitationId],
    );
    if (Number(claimed.affectedRows) === 0) throw new Error("INVITATION_NOT_PENDING");

    const [active] = await connection.execute<(RowDataPacket & { id: number })[]>(
      `SELECT id FROM bg_team_members WHERE user_id = ? AND left_at IS NULL LIMIT 1`,
      [userId],
    );
    if (active.length > 0) throw new Error("USER_ALREADY_IN_TEAM");

    await connection.execute(
      `INSERT INTO bg_team_members (team_id, user_id, roles_json) VALUES (?, ?, ?)`,
      [teamId, userId, JSON.stringify(payload)],
    );
    // Toute autre invitation/demande en attente de ce joueur devient caduque.
    await connection.execute(
      `UPDATE bg_team_invitations
       SET status = 'CANCELLED', responded_at = NOW()
       WHERE user_id = ? AND status = 'PENDING'`,
      [userId],
    );
    if (claim) {
      // La fantôme a désormais un propriétaire : elle redevient une équipe
      // ordinaire, et les reprises proposées à d'autres joueurs n'ont plus
      // d'objet — les laisser en attente, elles finiraient refusées en
      // `NOT_A_GHOST_TEAM` sous les yeux de qui les accepterait.
      await connection.execute(`UPDATE bg_teams SET is_ghost = 0 WHERE id = ?`, [teamId]);
      await connection.execute(
        `UPDATE bg_team_invitations
         SET status = 'CANCELLED', responded_at = NOW()
         WHERE team_id = ? AND status = 'PENDING'`,
        [teamId],
      );
    }

    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function findPendingInvitation(
  teamId: number,
  userId: number,
): Promise<{ id: number; kind: "INVITE" | "REQUEST"; roles: TeamRole[] } | null> {
  const db = await getDatabase();
  const [rows] = await db.execute<
    (RowDataPacket & { id: number; kind: "INVITE" | "REQUEST"; roles_json: unknown })[]
  >(
    `SELECT id, kind, roles_json FROM bg_team_invitations
     WHERE team_id = ? AND user_id = ? AND status = 'PENDING'
     ORDER BY created_at DESC LIMIT 1`,
    [teamId, userId],
  );
  return rows.length === 0
    ? null
    : { id: Number(rows[0].id), kind: rows[0].kind, roles: invitationRoles(rows[0].roles_json) };
}

/**
 * Rôles portés par une invitation, tels qu'ils seront posés à l'arrivée du
 * joueur. Une invitation sans rôle (demande d'adhésion, ou invitation émise
 * avant la colonne) rend une liste vide : `acceptIntoTeam` pose alors `DPS`,
 * le défaut d'origine.
 */
function invitationRoles(raw: unknown): TeamRole[] {
  return raw == null ? [] : parseRoles(raw);
}

/**
 * L'invitation est-elle la **reprise d'une équipe fantôme** ? Seule
 * `claimGhostTeam` pose `OWNER` sur une invitation : c'est sa marque.
 */
function isGhostClaimRoles(roles: readonly TeamRole[]): boolean {
  return roles.includes("OWNER");
}

/**
 * Rôles demandés à l'invitation : ceux que la gestion peut distribuer, jamais
 * `OWNER` (il se transfère). Absents, ils valent le défaut d'origine ; présents
 * mais vides, c'est un refus — même règle que `updateTeamMemberRoles`, un membre
 * sans rôle n'existant pas.
 */
function resolveInviteRoles(roles: readonly TeamRole[] | undefined): TeamRole[] {
  if (roles === undefined) return ["DPS"];
  const filtered = sanitizeRoles([...roles]).filter((role) => role !== "OWNER");
  if (filtered.length === 0) throw new Error("MISSING_ROLE");
  return filtered;
}

/**
 * La gestion d'équipe invite un joueur (par pseudo). Remplace l'ajout forcé.
 * Si une demande (REQUEST) du joueur est déjà en attente, l'invitation la valide
 * directement et le joueur rejoint l'équipe.
 */
export async function inviteToTeam(
  requesterId: number,
  teamId: number,
  pseudo: string,
  roles?: readonly TeamRole[],
): Promise<"INVITED" | "JOINED"> {
  if (!(await userCanManageTeam(teamId, requesterId))) throw new Error("FORBIDDEN");
  await assertTermsAccepted(requesterId);
  const inviteRoles = resolveInviteRoles(roles);

  const userId = await getUserIdByPseudo(pseudo);
  if (!userId) throw new Error("USER_NOT_FOUND");
  if (await userHasActiveTeam(userId)) throw new Error("USER_ALREADY_IN_TEAM");

  const existing = await findPendingInvitation(teamId, userId);
  if (existing?.kind === "REQUEST") {
    await acceptIntoTeam(existing.id, teamId, userId, inviteRoles);
    return "JOINED";
  }
  if (existing?.kind === "INVITE") throw new Error("ALREADY_INVITED");

  const db = await getDatabase();
  await db.execute(
    `INSERT INTO bg_team_invitations (team_id, user_id, created_by, kind, roles_json, status)
     VALUES (?, ?, ?, 'INVITE', ?, 'PENDING')`,
    [teamId, userId, requesterId, JSON.stringify(inviteRoles)],
  );
  return "INVITED";
}

/**
 * Un joueur demande à rejoindre une équipe (self-service). Si une invitation
 * (INVITE) lui est déjà adressée, la demande la valide et il rejoint directement.
 */
export async function requestToJoinTeam(userId: number, teamId: number): Promise<"REQUESTED" | "JOINED"> {
  if (await userHasActiveTeam(userId)) throw new Error("USER_ALREADY_IN_TEAM");

  const db = await getDatabase();
  const [teams] = await db.execute<
    (RowDataPacket & {
      id: number;
      deleted_at: Date | null;
      is_ghost: 0 | 1;
      solo_user_id: number | null;
    })[]
  >(
    `SELECT id, deleted_at, is_ghost, solo_user_id FROM bg_teams WHERE id = ? LIMIT 1`,
    [teamId],
  );
  if (teams.length === 0) throw new Error("TEAM_NOT_FOUND");
  if (teams[0].deleted_at !== null) throw new Error("TEAM_DELETED");
  // Ni une fantôme ni une entrée solo ne se rejoignent. Ni l'une ni l'autre n'a
  // de membre, donc personne n'a qualité pour répondre : la demande restait
  // en attente à jamais, et son auteur se voyait ensuite refuser toute autre
  // équipe par `ALREADY_REQUESTED`. Une fantôme se **reprend** sur proposition
  // du staff (`POST /api/teams/[id]/claim`, une invitation portant `OWNER`) :
  // « Rejoindre » sur sa fiche accepte cette proposition, et rien d'autre. Une
  // entrée solo n'est pas une équipe, c'est l'identité d'un joueur en tournoi
  // individuel.
  if (teams[0].solo_user_id !== null) throw new Error("TEAM_NOT_JOINABLE");

  const existing = await findPendingInvitation(teamId, userId);
  if (teams[0].is_ghost === 1) {
    if (existing?.kind === "INVITE" && isGhostClaimRoles(existing.roles)) {
      await acceptIntoTeam(existing.id, teamId, userId, existing.roles);
      return "JOINED";
    }
    throw new Error("TEAM_NOT_JOINABLE");
  }

  if (existing?.kind === "INVITE") {
    await acceptIntoTeam(existing.id, teamId, userId, existing.roles);
    return "JOINED";
  }
  if (existing?.kind === "REQUEST") throw new Error("ALREADY_REQUESTED");

  await db.execute(
    `INSERT INTO bg_team_invitations (team_id, user_id, created_by, kind, status)
     VALUES (?, ?, ?, 'REQUEST', 'PENDING')`,
    [teamId, userId, userId],
  );
  // Le propriétaire et les managers sont prévenus en message privé : sans cela,
  // la demande n'existait que pour qui pensait à ouvrir la fiche. Jamais
  // attendu — la demande est enregistrée, le message n'est qu'un avertissement.
  void notifyTeamJoinRequest(teamId, userId).catch((error) =>
    console.error("[teams] gestion non prévenue d'une demande d'adhésion", error),
  );
  return "REQUESTED";
}

/**
 * Répond à une invitation/demande en attente.
 * - INVITE : seul le joueur invité (user_id) peut répondre.
 * - REQUEST : seule la gestion de l'équipe peut répondre.
 */
export async function respondToInvitation(
  actingUserId: number,
  invitationId: number,
  accept: boolean,
): Promise<void> {
  const db = await getDatabase();
  const [rows] = await db.execute<(RowDataPacket & { team_id: number; user_id: number; kind: "INVITE" | "REQUEST"; status: string; roles_json: unknown })[]>(
    `SELECT team_id, user_id, kind, status, roles_json FROM bg_team_invitations WHERE id = ? LIMIT 1`,
    [invitationId],
  );
  if (rows.length === 0) throw new Error("INVITATION_NOT_FOUND");
  const inv = rows[0];
  if (inv.status !== "PENDING") throw new Error("INVITATION_NOT_PENDING");

  if (inv.kind === "INVITE") {
    if (Number(inv.user_id) !== actingUserId) throw new Error("FORBIDDEN");
  } else {
    if (!(await userCanManageTeam(Number(inv.team_id), actingUserId))) throw new Error("FORBIDDEN");
    // Faire entrer quelqu'un dans l'équipe est un geste de gestion ; refuser
    // une demande ne l'est pas — on ne bloque pas un « non ».
    if (accept) await assertTermsAccepted(actingUserId);
  }

  if (!accept) {
    await db.execute(
      `UPDATE bg_team_invitations SET status = 'DECLINED', responded_at = NOW() WHERE id = ?`,
      [invitationId],
    );
    return;
  }

  if (await userHasActiveTeam(Number(inv.user_id))) throw new Error("USER_ALREADY_IN_TEAM");
  // Une demande (REQUEST) ne porte aucun rôle : `acceptIntoTeam` pose DPS.
  await acceptIntoTeam(invitationId, Number(inv.team_id), Number(inv.user_id), invitationRoles(inv.roles_json));
}

/** Invitations (INVITE) en attente adressées au joueur. */
export async function listUserInvitations(userId: number): Promise<
  {
    id: number;
    teamId: number;
    teamName: string;
    kind: "INVITE" | "REQUEST";
    createdAt: string;
    /** Reprise d'une équipe fantôme : l'accepter en fait le propriétaire. */
    ownership: boolean;
  }[]
> {
  const db = await getDatabase();
  const [rows] = await db.execute<(InvitationRow & { roles_json: unknown })[]>(
    `SELECT i.id, i.team_id, t.name AS team_name, i.user_id, u.pseudo, i.kind, i.roles_json, i.created_at
     FROM bg_team_invitations i
     JOIN bg_teams t ON t.id = i.team_id
     JOIN bg_users u ON u.id = i.user_id
     WHERE i.user_id = ? AND i.kind = 'INVITE' AND i.status = 'PENDING'
     ORDER BY i.created_at DESC`,
    [userId],
  );
  return rows.map((r) => ({
    id: Number(r.id),
    teamId: Number(r.team_id),
    teamName: r.team_name,
    kind: r.kind,
    createdAt: toIso(r.created_at) ?? new Date().toISOString(),
    ownership: isGhostClaimRoles(invitationRoles(r.roles_json)),
  }));
}

/**
 * Ce qui attend une réponse, vue gestion : les demandes (REQUEST) reçues et
 * les invitations (INVITE) envoyées — un seul contrôle de droits, une seule
 * requête.
 *
 * Les invitations envoyées ne se voyaient nulle part : ni pour savoir qui
 * attendre, ni pour en retirer une après une erreur de pseudo — réinviter le
 * même joueur ne rendant que `ALREADY_INVITED`.
 *
 * Sur une **fantôme**, le staff `tournaments` y lit les reprises qu'il a
 * proposées (`claimGhostTeam`) : personne d'autre n'a qualité pour le faire,
 * une fantôme n'ayant aucun membre.
 */
export async function listTeamPendingInvitations(
  teamId: number,
  requesterId: number,
  viewerManagesGhostTeams = false,
): Promise<{ requests: TeamJoinRequest[]; invitations: TeamSentInvitation[] }> {
  if (
    !(await userCanManageTeam(teamId, requesterId)) &&
    !(await ghostAdminOverride(teamId, viewerManagesGhostTeams))
  ) {
    throw new Error("FORBIDDEN");
  }
  const db = await getDatabase();
  const [rows] = await db.execute<
    (RowDataPacket & {
      id: number;
      user_id: number;
      pseudo: string;
      kind: "INVITE" | "REQUEST";
      roles_json: unknown;
      created_at: Date;
    })[]
  >(
    `SELECT i.id, i.user_id, u.pseudo, i.kind, i.roles_json, i.created_at
     FROM bg_team_invitations i
     JOIN bg_users u ON u.id = i.user_id
     WHERE i.team_id = ? AND i.status = 'PENDING'
     ORDER BY i.created_at DESC`,
    [teamId],
  );

  const requests: TeamJoinRequest[] = [];
  const invitations: TeamSentInvitation[] = [];
  for (const r of rows) {
    const base = {
      id: Number(r.id),
      userId: Number(r.user_id),
      pseudo: r.pseudo,
      createdAt: toIso(r.created_at) ?? new Date().toISOString(),
    };
    if (r.kind === "REQUEST") {
      requests.push(base);
    } else {
      const roles = invitationRoles(r.roles_json);
      // Invitation d'avant la colonne : le joueur arrivera en DPS, on le dit.
      invitations.push({ ...base, roles: roles.length === 0 ? (["DPS"] as TeamRole[]) : roles });
    }
  }
  return { requests, invitations };
}

/**
 * Retire une invitation ou une demande encore en attente.
 *
 * A qualité celui qui l'a émise, au sens de l'acte et non de la ligne : une
 * **invitation** est l'acte de l'équipe (toute sa gestion, quel que soit le
 * membre qui l'a envoyée — `created_by` peut d'ailleurs être `NULL`), une
 * **demande** est l'acte du joueur. Le destinataire, lui, répond par
 * `respondToInvitation`.
 *
 * L'écriture est conditionnée à `status = 'PENDING'` : une réponse arrivée entre
 * la lecture et l'écriture l'emporte, et l'annulation est refusée plutôt que de
 * réécrire une invitation déjà acceptée.
 *
 * Une **reprise de fantôme** est l'acte du staff `tournaments`, qui doit pouvoir
 * la retirer — un pseudo mal choisi, une proposition devenue sans objet : sans
 * cela, elle attendrait indéfiniment et resterait acceptable des semaines plus
 * tard. D'où la dérogation fantôme, la même que pour le reste de
 * l'administration d'une fantôme (`viewerManagesGhostTeams`).
 */
export async function cancelInvitation(
  actingUserId: number,
  invitationId: number,
  viewerManagesGhostTeams = false,
): Promise<void> {
  const db = await getDatabase();
  const [rows] = await db.execute<
    (RowDataPacket & { team_id: number; user_id: number; kind: "INVITE" | "REQUEST"; status: string })[]
  >(
    `SELECT team_id, user_id, kind, status FROM bg_team_invitations WHERE id = ? LIMIT 1`,
    [invitationId],
  );
  if (rows.length === 0) throw new Error("INVITATION_NOT_FOUND");
  const inv = rows[0];
  if (inv.status !== "PENDING") throw new Error("INVITATION_NOT_PENDING");

  if (inv.kind === "INVITE") {
    const teamId = Number(inv.team_id);
    if (
      !(await userCanManageTeam(teamId, actingUserId)) &&
      !(await ghostAdminOverride(teamId, viewerManagesGhostTeams))
    ) {
      throw new Error("FORBIDDEN");
    }
  } else if (Number(inv.user_id) !== actingUserId) {
    throw new Error("FORBIDDEN");
  }

  const [res] = await db.execute<ResultSetHeader>(
    `UPDATE bg_team_invitations
     SET status = 'CANCELLED', responded_at = NOW()
     WHERE id = ? AND status = 'PENDING'`,
    [invitationId],
  );
  if (Number(res.affectedRows) === 0) throw new Error("INVITATION_NOT_PENDING");
}

