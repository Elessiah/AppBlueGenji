import crypto from "node:crypto";
import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { getDatabase } from "@/lib/server/database";
import { ensureUniquePseudo, resolveRoles } from "@/lib/server/auth";
import { normalizePseudo, parseRoles, toIso } from "@/lib/server/serialization";
import { syncSoloEntryIdentity } from "@/lib/server/solo-entries-service";
import { sanitizePlatformRoles, type PlatformRole } from "@/lib/shared/permissions";
import { getPlayerEntityStats } from "@/lib/server/stats-service";
import type {
  FullProfileResponse,
  PersonalDataExport,
  PublicUserProfile,
  TeamRole,
  UserTeamTimeline,
} from "@/lib/shared/types";

/**
 * Engagements d'un joueur en tournoi : ses équipes (passées et présentes) et
 * son entrée solo, s'il en a une (tournois individuels — voir
 * `lib/server/solo-entries-service.ts`). Un tournoi joué en individuel compte
 * donc dans son palmarès au même titre qu'un tournoi joué en équipe.
 *
 * Le filtre sur les joueurs est appliqué **dans chaque branche** de l'union :
 * une table dérivée n'a pas d'index, et filtrer à l'extérieur ferait scanner
 * toute la table d'adhésions à chaque affichage de `/joueurs` ou de profil.
 * L'appelant doit donc passer la liste d'identifiants **deux fois**.
 *
 * @param placeholders liste de `?` séparés par des virgules (un par joueur).
 */
function userEntriesSql(placeholders: string): string {
  return `(
       SELECT user_id, team_id, left_at
       FROM bg_team_members
       WHERE user_id IN (${placeholders})
       UNION ALL
       SELECT solo_user_id AS user_id, id AS team_id, NULL AS left_at
       FROM bg_teams
       WHERE solo_user_id IN (${placeholders})
     )`;
}

export type GoogleProfilePayload = {
  sub: string;
  email?: string;
  name?: string;
  picture?: string;
};

export type DiscordChallenge = {
  challengeId: number;
  code: string;
  expiresAt: Date;
};

type UserRow = RowDataPacket & {
  id: number;
  pseudo: string;
  avatar_url: string | null;
  overwatch_battletag: string | null;
  marvel_rivals_tag: string | null;
  discord_pseudo: string | null;
  is_adult: 0 | 1 | null;
  visible_avatar: 0 | 1;
  visible_pseudo: 0 | 1;
  visible_overwatch: 0 | 1;
  visible_marvel: 0 | 1;
  visible_major: 0 | 1;
  open_to_recruitment: 0 | 1;
  is_admin?: 0 | 1;
  platform_roles_json?: string | null;
  created_at: Date;
};

type TeamTimelineRow = RowDataPacket & {
  team_id: number;
  team_name: string;
  joined_at: Date;
  left_at: Date | null;
  roles_json: string;
};

function mapPublicUser(row: UserRow): PublicUserProfile {
  return {
    id: Number(row.id),
    pseudo: row.pseudo,
    avatarUrl: row.avatar_url,
    overwatchBattletag: row.overwatch_battletag,
    marvelRivalsTag: row.marvel_rivals_tag,
    isAdult: row.is_adult === null ? null : Boolean(row.is_adult),
    visibility: {
      avatar: Boolean(row.visible_avatar),
      overwatch: Boolean(row.visible_overwatch),
      marvel: Boolean(row.visible_marvel),
      major: Boolean(row.visible_major),
    },
    openToRecruitment: Boolean(row.open_to_recruitment),
    createdAt: toIso(row.created_at)!,
  };
}

/**
 * Applique les réglages de visibilité d'un profil pour un spectateur tiers :
 * chaque champ non public est masqué (l'avatar masqué devient `null`). Aucun
 * effet lorsque le spectateur consulte son propre profil (`isSelf`). Centralise
 * la logique de masquage pour que l'annuaire `/joueurs` et la fiche profil
 * `/joueurs/[id]` restent cohérents.
 *
 * Le **pseudo n'est jamais masqué** : il identifie le joueur dans les brackets,
 * les rosters et les feuilles de match, où l'anonymat n'a pas de sens.
 */
function applyVisibility<T extends PublicUserProfile>(profile: T, isSelf: boolean): T {
  if (isSelf) return profile;
  if (!profile.visibility.avatar) profile.avatarUrl = null;
  if (!profile.visibility.overwatch) profile.overwatchBattletag = null;
  if (!profile.visibility.marvel) profile.marvelRivalsTag = null;
  if (!profile.visibility.major) profile.isAdult = null;
  return profile;
}

function hashCode(code: string): string {
  return crypto.createHash("sha256").update(code).digest("hex");
}

function randomCode(): string {
  const randomInt = crypto.randomInt(100000, 1000000);
  return String(randomInt);
}

export async function getUserById(userId: number): Promise<PublicUserProfile | null> {
  const db = await getDatabase();
  const [rows] = await db.execute<UserRow[]>(
    `SELECT
      id,
      pseudo,
      avatar_url,
      overwatch_battletag,
      marvel_rivals_tag,
      discord_pseudo,
      is_adult,
      visible_avatar,
      visible_overwatch,
      visible_marvel,
      visible_major,
      open_to_recruitment,
      created_at
     FROM bg_users
     WHERE id = ?
     LIMIT 1`,
    [userId],
  );

  if (rows.length === 0) return null;
  return mapPublicUser(rows[0]);
}

export async function listPlayers(viewerId: number): Promise<PublicUserProfile[]> {
  const db = await getDatabase();
  const [rows] = await db.execute<UserRow[]>(
    `SELECT
      id,
      pseudo,
      avatar_url,
      overwatch_battletag,
      marvel_rivals_tag,
      discord_pseudo,
      is_adult,
      visible_avatar,
      visible_overwatch,
      visible_marvel,
      visible_major,
      open_to_recruitment,
      created_at
     FROM bg_users
     ORDER BY is_deleted ASC, pseudo ASC`,
  );

  const baseUsers = rows.map((row) =>
    applyVisibility(mapPublicUser(row), Number(row.id) === viewerId),
  );
  const userIds = baseUsers.map((u) => u.id);

  // Les badges de jeu se dérivent des tags bruts : jouer à OW2/MR n'est pas
  // une donnée privée (seule la chaîne exacte du battletag l'est), donc ils
  // restent affichés même si `visible_overwatch`/`visible_marvel` masque le tag.
  const gamesByUserId = new Map<number, ("OW2" | "MR")[]>(
    rows.map((row) => {
      const games: ("OW2" | "MR")[] = [];
      if (row.overwatch_battletag) games.push("OW2");
      if (row.marvel_rivals_tag) games.push("MR");
      return [Number(row.id), games];
    }),
  );

  if (userIds.length === 0) return baseUsers;

  // Get current team memberships and roles
  const [teamMemberships] = await db.execute<
    (RowDataPacket & {
      user_id: number;
      team_id: number;
      team_name: string;
      roles_json: string;
    })[]
  >(
    `SELECT tm.user_id, tm.team_id, t.name AS team_name, tm.roles_json
     FROM bg_team_members tm
     JOIN bg_teams t ON t.id = tm.team_id
     WHERE tm.user_id IN (${userIds.map(() => "?").join(",")})
       AND tm.left_at IS NULL`,
    userIds,
  );

  const membershipByUserId = new Map(teamMemberships.map((m) => [m.user_id, m]));

  // Get tournament counts per user
  const [tournamentsData] = await db.execute<
    (RowDataPacket & {
      user_id: number;
      tournament_count: number;
    })[]
  >(
    `SELECT tm.user_id, COUNT(DISTINCT tr.tournament_id) AS tournament_count
     FROM ${userEntriesSql(userIds.map(() => "?").join(","))} tm
     JOIN bg_tournament_registrations tr ON tr.team_id = tm.team_id
     GROUP BY tm.user_id`,
    [...userIds, ...userIds],
  );

  const tournamentsCountByUserId = new Map(
    tournamentsData.map((t) => [t.user_id, Number(t.tournament_count)]),
  );

  // Get wins/losses per user (simplified: from their current team)
  const [winsLossesData] = await db.execute<
    (RowDataPacket & {
      user_id: number;
      wins: number;
      losses: number;
    })[]
  >(
    `SELECT tm.user_id,
            COALESCE(SUM(CASE WHEN m.winner_team_id = tm.team_id THEN 1 ELSE 0 END), 0) AS wins,
            COALESCE(SUM(CASE WHEN m.loser_team_id = tm.team_id THEN 1 ELSE 0 END), 0) AS losses
     FROM ${userEntriesSql(userIds.map(() => "?").join(","))} tm
     LEFT JOIN bg_tournament_registrations tr ON tr.team_id = tm.team_id
     LEFT JOIN bg_matches m ON m.tournament_id = tr.tournament_id
       AND (m.winner_team_id = tm.team_id OR m.loser_team_id = tm.team_id)
     WHERE tm.left_at IS NULL
     GROUP BY tm.user_id`,
    [...userIds, ...userIds],
  );

  const winsLossesByUserId = new Map(
    winsLossesData.map((wl) => [wl.user_id, { wins: Number(wl.wins), losses: Number(wl.losses) }]),
  );

  return baseUsers.map((user) => {
    const membership = membershipByUserId.get(user.id);
    const games = gamesByUserId.get(user.id) ?? [];

    const wl = winsLossesByUserId.get(user.id) ?? { wins: 0, losses: 0 };

    return {
      ...user,
      team: membership
        ? {
            id: membership.team_id,
            name: membership.team_name,
            colorIndex: membership.team_id % 7,
          }
        : null,
      roles: membership ? parseRoles(membership.roles_json) : [],
      games,
      tournamentsCount: tournamentsCountByUserId.get(user.id) ?? 0,
      wins: wl.wins,
      losses: wl.losses,
    };
  });
}

export async function createOrGetGoogleUser(profile: GoogleProfilePayload): Promise<number> {
  const db = await getDatabase();

  const [existing] = await db.execute<(RowDataPacket & { id: number })[]>(
    `SELECT id FROM bg_users WHERE google_sub = ? LIMIT 1`,
    [profile.sub],
  );

  if (existing.length > 0) {
    await db.execute(
      `UPDATE bg_users
       SET email = COALESCE(?, email),
           avatar_url = COALESCE(?, avatar_url)
       WHERE id = ?`,
      [profile.email ?? null, profile.picture ?? null, existing[0].id],
    );
    return Number(existing[0].id);
  }

  if (profile.email) {
    const [emailMatch] = await db.execute<(RowDataPacket & { id: number })[]>(
      `SELECT id FROM bg_users WHERE email = ? LIMIT 1`,
      [profile.email],
    );

    if (emailMatch.length > 0) {
      await db.execute(`UPDATE bg_users SET google_sub = ? WHERE id = ?`, [profile.sub, emailMatch[0].id]);
      return Number(emailMatch[0].id);
    }
  }

  const pseudoSource = profile.name ?? profile.email?.split("@")[0] ?? `player${Date.now().toString().slice(-5)}`;
  const pseudo = await ensureUniquePseudo(pseudoSource);

  const [created] = await db.execute<ResultSetHeader>(
    `INSERT INTO bg_users (pseudo, avatar_url, google_sub, email)
     VALUES (?, ?, ?, ?)`,
    [pseudo, profile.picture ?? null, profile.sub, profile.email ?? null],
  );

  return Number(created.insertId);
}

export async function createOrGetDiscordUser(discordId: string, pseudoInput?: string): Promise<number> {
  const db = await getDatabase();

  const [existing] = await db.execute<(RowDataPacket & { id: number })[]>(
    `SELECT id FROM bg_users WHERE discord_id = ? LIMIT 1`,
    [discordId],
  );

  if (existing.length > 0) {
    return Number(existing[0].id);
  }

  const rawPseudo = normalizePseudo(pseudoInput || `discord_${discordId.slice(-6)}`);
  const pseudo = await ensureUniquePseudo(rawPseudo);

  const [created] = await db.execute<ResultSetHeader>(
    `INSERT INTO bg_users (pseudo, discord_id)
     VALUES (?, ?)`,
    [pseudo, discordId],
  );

  return Number(created.insertId);
}

/**
 * Indique si un compte du site est déjà rattaché à cet identifiant Discord.
 *
 * Sert au formulaire de connexion : le champ « pseudo site » n'a de sens qu'à
 * la création du compte, il est donc masqué lors des connexions suivantes.
 */
export async function discordAccountExists(discordId: string): Promise<boolean> {
  const db = await getDatabase();

  const [rows] = await db.execute<(RowDataPacket & { id: number })[]>(
    `SELECT id FROM bg_users WHERE discord_id = ? LIMIT 1`,
    [discordId],
  );

  return rows.length > 0;
}

export async function createDiscordLoginChallenge(discordId: string): Promise<DiscordChallenge> {
  const db = await getDatabase();
  const code = randomCode();

  const [insert] = await db.execute<ResultSetHeader>(
    `INSERT INTO bg_discord_login_challenges (discord_id, code_hash, expires_at)
     VALUES (?, ?, DATE_ADD(NOW(), INTERVAL 10 MINUTE))`,
    [discordId, hashCode(code)],
  );

  const [rows] = await db.execute<(RowDataPacket & { expires_at: Date | string })[]>(
    `SELECT expires_at FROM bg_discord_login_challenges WHERE id = ? LIMIT 1`,
    [insert.insertId],
  );

  const rawExpiresAt = rows[0]?.expires_at;
  return {
    challengeId: Number(insert.insertId),
    code,
    // mysql2 peut renvoyer expires_at en string selon la config du pool : on normalise en Date.
    expiresAt: rawExpiresAt ? new Date(rawExpiresAt) : new Date(Date.now() + 10 * 60 * 1000),
  };
}

export async function verifyDiscordChallenge(discordId: string, code: string): Promise<boolean> {
  const db = await getDatabase();

  const [rows] = await db.execute<
    (RowDataPacket & {
      id: number;
      code_hash: string;
      expires_at: Date;
      consumed_at: Date | null;
      attempts: number;
    })[]
  >(
    `SELECT id, code_hash, expires_at, consumed_at, attempts
     FROM bg_discord_login_challenges
     WHERE discord_id = ?
     ORDER BY id DESC
     LIMIT 1`,
    [discordId],
  );

  if (rows.length === 0) return false;

  const challenge = rows[0];
  if (challenge.consumed_at !== null) return false;
  if (new Date(challenge.expires_at).getTime() < Date.now()) return false;

  const valid = challenge.code_hash === hashCode(code);

  if (!valid) {
    await db.execute(`UPDATE bg_discord_login_challenges SET attempts = attempts + 1 WHERE id = ?`, [challenge.id]);
    return false;
  }

  await db.execute(
    `UPDATE bg_discord_login_challenges
     SET consumed_at = NOW()
     WHERE id = ?`,
    [challenge.id],
  );

  return true;
}

export async function updateOwnProfile(
  userId: number,
  patch: {
    pseudo?: string;
    overwatchBattletag?: string | null;
    marvelRivalsTag?: string | null;
    discordPseudo?: string | null;
    isAdult?: boolean | null;
    visibility?: {
      avatar?: boolean;
      overwatch?: boolean;
      marvel?: boolean;
      major?: boolean;
    };
    openToRecruitment?: boolean;
  },
): Promise<void> {
  const db = await getDatabase();

  if (patch.pseudo) {
    const normalized = normalizePseudo(patch.pseudo);
    const [conflicts] = await db.execute<(RowDataPacket & { id: number })[]>(
      `SELECT id FROM bg_users WHERE pseudo = ? AND id <> ? LIMIT 1`,
      [normalized, userId],
    );
    if (conflicts.length > 0) {
      throw new Error("PSEUDO_ALREADY_USED");
    }
  }

  await db.execute(
    `UPDATE bg_users
     SET pseudo = COALESCE(?, pseudo),
         overwatch_battletag = ?,
         marvel_rivals_tag = ?,
         discord_pseudo = ?,
         is_adult = ?,
         visible_avatar = COALESCE(?, visible_avatar),
         visible_overwatch = COALESCE(?, visible_overwatch),
         visible_marvel = COALESCE(?, visible_marvel),
         visible_major = COALESCE(?, visible_major),
         open_to_recruitment = COALESCE(?, open_to_recruitment)
     WHERE id = ?`,
    [
      patch.pseudo ? normalizePseudo(patch.pseudo) : null,
      patch.overwatchBattletag === undefined ? null : patch.overwatchBattletag,
      patch.marvelRivalsTag === undefined ? null : patch.marvelRivalsTag,
      patch.discordPseudo === undefined ? null : patch.discordPseudo,
      patch.isAdult === undefined ? null : patch.isAdult,
      patch.visibility?.avatar ?? null,
      patch.visibility?.overwatch ?? null,
      patch.visibility?.marvel ?? null,
      patch.visibility?.major ?? null,
      patch.openToRecruitment ?? null,
      userId,
    ],
  );

  // L'entrée solo (tournois individuels) affiche le pseudo du joueur dans les
  // brackets : elle suit le renommage.
  if (patch.pseudo) {
    await syncSoloEntryIdentity(userId);
  }
}

/**
 * Anonymise (« supprime ») le compte de l'utilisateur : toutes les données
 * personnelles sont effacées et les moyens de connexion révoqués, mais les
 * statistiques et l'historique générés par la plateforme sont conservés
 * (les adhésions d'équipe restent rattachées à un profil anonyme).
 */
export async function anonymizeOwnAccount(userId: number): Promise<void> {
  const db = await getDatabase();
  await db.execute(
    `UPDATE bg_users
     SET pseudo = CONCAT('compte_supprime_', id),
         avatar_url = NULL,
         overwatch_battletag = NULL,
         marvel_rivals_tag = NULL,
         discord_pseudo = NULL,
         is_adult = NULL,
         discord_id = NULL,
         google_sub = NULL,
         email = NULL,
         visible_avatar = 0,
         visible_overwatch = 0,
         visible_marvel = 0,
         visible_major = 0,
         open_to_recruitment = 0,
         is_deleted = 1
     WHERE id = ?`,
    [userId],
  );
  await db.execute(`DELETE FROM bg_user_sessions WHERE user_id = ?`, [userId]);
  // Le pseudo anonymisé doit aussi remplacer le nom affiché en tournoi.
  await syncSoloEntryIdentity(userId);
}

export async function updateUserAvatar(userId: number, avatarPath: string | null): Promise<void> {
  const db = await getDatabase();
  await db.execute(
    `UPDATE bg_users SET avatar_url = ? WHERE id = ?`,
    [avatarPath, userId],
  );
  // Le logo de l'entrée solo est l'avatar du joueur.
  await syncSoloEntryIdentity(userId);
}

export async function getFullProfile(
  viewerId: number,
  targetUserId: number,
  viewerIsAdmin = false,
): Promise<FullProfileResponse | null> {
  const db = await getDatabase();

  const [userRows] = await db.execute<UserRow[]>(
    `SELECT
      id,
      pseudo,
      avatar_url,
      overwatch_battletag,
      marvel_rivals_tag,
      discord_pseudo,
      is_adult,
      visible_avatar,
      visible_overwatch,
      visible_marvel,
      visible_major,
      open_to_recruitment,
      is_admin,
      platform_roles_json,
      created_at
    FROM bg_users
    WHERE id = ?
    LIMIT 1`,
    [targetUserId],
  );

  if (userRows.length === 0) return null;

  const isSelf = viewerId === targetUserId;
  const targetIsAdmin = Boolean(userRows[0].is_admin);
  const targetRoles = resolveRoles(targetIsAdmin, userRows[0].platform_roles_json);
  const profile = mapPublicUser(userRows[0]);

  if (isSelf) {
    profile.discordPseudo = userRows[0].discord_pseudo;
  } else {
    applyVisibility(profile, false);
  }

  const [timelineRows] = await db.execute<TeamTimelineRow[]>(
    `SELECT
      tm.team_id,
      t.name AS team_name,
      tm.joined_at,
      tm.left_at,
      tm.roles_json
     FROM bg_team_members tm
     JOIN bg_teams t ON t.id = tm.team_id
     WHERE tm.user_id = ?
     ORDER BY tm.joined_at DESC`,
    [targetUserId],
  );

  const timeline: UserTeamTimeline[] = timelineRows.map((row) => ({
    teamId: Number(row.team_id),
    teamName: row.team_name,
    joinedAt: toIso(row.joined_at) ?? new Date().toISOString(),
    leftAt: toIso(row.left_at),
    roles: parseRoles(row.roles_json),
  }));

  // Statistiques et palmarès viennent de la même collecte (`stats-service`) :
  // mêmes définitions que côté équipe, et surtout mêmes bornes d'appartenance.
  // L'ancienne requête, jointe sans condition de date, listait aussi le même
  // tournoi une fois par équipe du joueur.
  const { stats, tournaments } = await getPlayerEntityStats(targetUserId);

  return {
    profile,
    stats,
    teamsTimeline: timeline,
    tournaments,
    // Ne pas divulguer qui est admin / quels rôles aux non-admins : réservé au viewer admin.
    isAdmin: viewerIsAdmin ? targetIsAdmin : false,
    roles: viewerIsAdmin ? targetRoles : [],
    // Les rôles staff sont des titres publics affichés à tous les visiteurs.
    displayRoles: targetRoles,
    isSelf,
    viewerIsAdmin,
  };
}

/**
 * Rassemble l'intégralité des données personnelles du propriétaire du compte
 * pour l'export RGPD (droit à la portabilité, art. 20). Retourne les données
 * brutes non masquées — l'appelant DOIT s'assurer que `userId` est bien celui
 * de l'utilisateur authentifié (jamais un tiers).
 */
export async function exportOwnData(userId: number): Promise<PersonalDataExport> {
  const db = await getDatabase();
  const [rows] = await db.execute<
    (RowDataPacket & {
      id: number;
      pseudo: string;
      avatar_url: string | null;
      overwatch_battletag: string | null;
      marvel_rivals_tag: string | null;
      discord_pseudo: string | null;
      discord_id: string | null;
      google_sub: string | null;
      email: string | null;
      is_adult: 0 | 1 | null;
      is_admin: 0 | 1;
      visible_avatar: 0 | 1;
      visible_overwatch: 0 | 1;
      visible_marvel: 0 | 1;
      visible_major: 0 | 1;
      open_to_recruitment: 0 | 1;
      created_at: Date;
    })[]
  >(
    `SELECT id, pseudo, avatar_url, overwatch_battletag, marvel_rivals_tag,
            discord_pseudo, discord_id, google_sub, email, is_adult, is_admin,
            visible_avatar, visible_overwatch, visible_marvel, visible_major,
            open_to_recruitment, created_at
     FROM bg_users
     WHERE id = ? AND is_deleted = 0
     LIMIT 1`,
    [userId],
  );

  if (rows.length === 0) throw new Error("PROFILE_NOT_FOUND");
  const row = rows[0];

  // Réutilise l'agrégation existante pour les stats, l'historique d'équipes et
  // le palmarès de tournois (vue « self » = données complètes non masquées).
  const full = await getFullProfile(userId, userId);
  if (!full) throw new Error("PROFILE_NOT_FOUND");

  return {
    exportedAt: new Date().toISOString(),
    account: {
      id: Number(row.id),
      pseudo: row.pseudo,
      email: row.email,
      discordId: row.discord_id,
      discordPseudo: row.discord_pseudo,
      googleSub: row.google_sub,
      isAdult: row.is_adult === null ? null : Boolean(row.is_adult),
      isAdmin: Boolean(row.is_admin),
      createdAt: toIso(row.created_at) ?? new Date().toISOString(),
    },
    profile: {
      avatarUrl: row.avatar_url,
      overwatchBattletag: row.overwatch_battletag,
      marvelRivalsTag: row.marvel_rivals_tag,
      visibility: {
        avatar: Boolean(row.visible_avatar),
        overwatch: Boolean(row.visible_overwatch),
        marvel: Boolean(row.visible_marvel),
        major: Boolean(row.visible_major),
      },
      openToRecruitment: Boolean(row.open_to_recruitment),
    },
    stats: full.stats,
    teamsTimeline: full.teamsTimeline,
    tournaments: full.tournaments,
  };
}

/**
 * Remplace l'intégralité des rôles de permission d'un utilisateur.
 * Le rôle `ADMIN` est persisté via la colonne `is_admin` ; les autres rôles
 * cumulables (ARBITRE, COMMUNITY_MANAGER, RECRUTEUR) dans `platform_roles_json`.
 * Réservé aux administrateurs (contrôle d'accès effectué côté route API).
 *
 * @returns la liste normalisée des rôles effectivement enregistrés.
 */
export async function setUserRoles(
  targetUserId: number,
  roles: PlatformRole[],
): Promise<PlatformRole[]> {
  const db = await getDatabase();
  const [rows] = await db.execute<(RowDataPacket & { id: number })[]>(
    `SELECT id FROM bg_users WHERE id = ? AND is_deleted = 0 LIMIT 1`,
    [targetUserId],
  );
  if (rows.length === 0) {
    throw new Error("USER_NOT_FOUND");
  }

  const sanitized = sanitizePlatformRoles(roles);
  const isAdmin = sanitized.includes("ADMIN");
  // Ne persister en JSON que les rôles cumulables non-ADMIN (ADMIN ⇔ is_admin).
  const nonAdminRoles = sanitized.filter((role) => role !== "ADMIN");

  await db.execute(
    `UPDATE bg_users SET is_admin = ?, platform_roles_json = ? WHERE id = ?`,
    [isAdmin ? 1 : 0, JSON.stringify(nonAdminRoles), targetUserId],
  );

  return sanitized;
}

export async function getUserIdByPseudo(pseudo: string): Promise<number | null> {
  const db = await getDatabase();
  const [rows] = await db.execute<(RowDataPacket & { id: number })[]>(
    `SELECT id FROM bg_users WHERE pseudo = ? LIMIT 1`,
    [normalizePseudo(pseudo)],
  );

  return rows.length === 0 ? null : Number(rows[0].id);
}

export async function getActiveMembershipTeamId(userId: number): Promise<number | null> {
  const db = await getDatabase();
  const [rows] = await db.execute<(RowDataPacket & { team_id: number })[]>(
    `SELECT team_id
     FROM bg_team_members
     WHERE user_id = ?
       AND left_at IS NULL
     ORDER BY id DESC
     LIMIT 1`,
    [userId],
  );

  return rows.length === 0 ? null : Number(rows[0].team_id);
}

export function sanitizeRoles(roles: TeamRole[]): TeamRole[] {
  const parsed = parseRoles(roles);
  const unique = new Set(parsed);
  if (unique.size === 0) {
    unique.add("OWNER");
  }
  return Array.from(unique);
}


