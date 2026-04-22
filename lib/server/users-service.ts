import crypto from "node:crypto";
import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { getDatabase } from "@/lib/server/database";
import { ensureUniquePseudo } from "@/lib/server/auth";
import { normalizePseudo, parseRoles, toIso } from "@/lib/server/serialization";
import type {
  FullProfileResponse,
  PublicUserProfile,
  TeamHistoryRow,
  TeamRole,
  UserTeamTimeline,
} from "@/lib/shared/types";

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
  is_adult: 0 | 1 | null;
  visible_avatar: 0 | 1;
  visible_pseudo: 0 | 1;
  visible_overwatch: 0 | 1;
  visible_marvel: 0 | 1;
  visible_major: 0 | 1;
  created_at: Date;
};

type TeamTimelineRow = RowDataPacket & {
  team_id: number;
  team_name: string;
  joined_at: Date;
  left_at: Date | null;
  roles_json: string;
};

type TournamentHistoryRow = RowDataPacket & {
  tournament_id: number;
  tournament_name: string;
  tournament_state: "UPCOMING" | "REGISTRATION" | "RUNNING" | "FINISHED";
  final_rank: number | null;
  wins: number;
  losses: number;
  played_at: Date;
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
      pseudo: Boolean(row.visible_pseudo),
      overwatch: Boolean(row.visible_overwatch),
      marvel: Boolean(row.visible_marvel),
      major: Boolean(row.visible_major),
    },
    createdAt: row.created_at.toISOString(),
  };
}

function hashCode(code: string): string {
  return crypto.createHash("sha256").update(code).digest("hex");
}

function randomCode(): string {
  const randomInt = crypto.randomInt(100000, 1000000);
  return String(randomInt);
}

function mapHistoryRow(row: TournamentHistoryRow): TeamHistoryRow {
  return {
    tournamentId: Number(row.tournament_id),
    tournamentName: row.tournament_name,
    state: row.tournament_state,
    finalRank: row.final_rank === null ? null : Number(row.final_rank),
    wins: Number(row.wins ?? 0),
    losses: Number(row.losses ?? 0),
    playedAt: toIso(row.played_at) ?? new Date().toISOString(),
  };
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
      is_adult,
      visible_avatar,
      visible_pseudo,
      visible_overwatch,
      visible_marvel,
      visible_major,
      created_at
     FROM bg_users
     WHERE id = ?
     LIMIT 1`,
    [userId],
  );

  if (rows.length === 0) return null;
  return mapPublicUser(rows[0]);
}

export async function listPlayers(): Promise<PublicUserProfile[]> {
  const db = await getDatabase();
  const [rows] = await db.execute<UserRow[]>(
    `SELECT
      id,
      pseudo,
      avatar_url,
      overwatch_battletag,
      marvel_rivals_tag,
      is_adult,
      visible_avatar,
      visible_pseudo,
      visible_overwatch,
      visible_marvel,
      visible_major,
      created_at
     FROM bg_users
     ORDER BY pseudo ASC`,
  );

  return rows.map(mapPublicUser);
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

export async function createDiscordLoginChallenge(discordId: string): Promise<DiscordChallenge> {
  const db = await getDatabase();
  const code = randomCode();

  const [insert] = await db.execute<ResultSetHeader>(
    `INSERT INTO bg_discord_login_challenges (discord_id, code_hash, expires_at)
     VALUES (?, ?, DATE_ADD(NOW(), INTERVAL 10 MINUTE))`,
    [discordId, hashCode(code)],
  );

  const [rows] = await db.execute<(RowDataPacket & { expires_at: Date })[]>(
    `SELECT expires_at FROM bg_discord_login_challenges WHERE id = ? LIMIT 1`,
    [insert.insertId],
  );

  return {
    challengeId: Number(insert.insertId),
    code,
    expiresAt: rows[0]?.expires_at ?? new Date(Date.now() + 10 * 60 * 1000),
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
    avatarUrl?: string | null;
    overwatchBattletag?: string | null;
    marvelRivalsTag?: string | null;
    isAdult?: boolean | null;
    visibility?: {
      avatar?: boolean;
      pseudo?: boolean;
      overwatch?: boolean;
      marvel?: boolean;
      major?: boolean;
    };
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
         avatar_url = ?,
         overwatch_battletag = ?,
         marvel_rivals_tag = ?,
         is_adult = ?,
         visible_avatar = COALESCE(?, visible_avatar),
         visible_pseudo = COALESCE(?, visible_pseudo),
         visible_overwatch = COALESCE(?, visible_overwatch),
         visible_marvel = COALESCE(?, visible_marvel),
         visible_major = COALESCE(?, visible_major)
     WHERE id = ?`,
    [
      patch.pseudo ? normalizePseudo(patch.pseudo) : null,
      patch.avatarUrl === undefined ? null : patch.avatarUrl,
      patch.overwatchBattletag === undefined ? null : patch.overwatchBattletag,
      patch.marvelRivalsTag === undefined ? null : patch.marvelRivalsTag,
      patch.isAdult === undefined ? null : patch.isAdult,
      patch.visibility?.avatar ?? null,
      patch.visibility?.pseudo ?? null,
      patch.visibility?.overwatch ?? null,
      patch.visibility?.marvel ?? null,
      patch.visibility?.major ?? null,
      userId,
    ],
  );
}

export async function getFullProfile(viewerId: number, targetUserId: number): Promise<FullProfileResponse | null> {
  const db = await getDatabase();

  const [userRows] = await db.execute<UserRow[]>(
    `SELECT
      id,
      pseudo,
      avatar_url,
      overwatch_battletag,
      marvel_rivals_tag,
      is_adult,
      visible_avatar,
      visible_pseudo,
      visible_overwatch,
      visible_marvel,
      visible_major,
      created_at
    FROM bg_users
    WHERE id = ?
    LIMIT 1`,
    [targetUserId],
  );

  if (userRows.length === 0) return null;

  const isSelf = viewerId === targetUserId;
  const profile = mapPublicUser(userRows[0]);

  if (!isSelf) {
    if (!profile.visibility.avatar) profile.avatarUrl = null;
    if (!profile.visibility.overwatch) profile.overwatchBattletag = null;
    if (!profile.visibility.marvel) profile.marvelRivalsTag = null;
    if (!profile.visibility.major) profile.isAdult = null;
    if (!profile.visibility.pseudo) profile.pseudo = `Joueur #${profile.id}`;
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

  const [historyRows] = await db.execute<TournamentHistoryRow[]>(
    `SELECT
      t.id AS tournament_id,
      t.name AS tournament_name,
      t.state AS tournament_state,
      r.final_rank,
      COALESCE(SUM(CASE WHEN m.winner_team_id = tm.team_id THEN 1 ELSE 0 END), 0) AS wins,
      COALESCE(SUM(CASE WHEN m.loser_team_id = tm.team_id THEN 1 ELSE 0 END), 0) AS losses,
      COALESCE(t.finished_at, t.start_at) AS played_at
    FROM bg_team_members tm
    JOIN bg_tournament_registrations r ON r.team_id = tm.team_id
    JOIN bg_tournaments t ON t.id = r.tournament_id
    LEFT JOIN bg_matches m ON m.tournament_id = t.id
      AND (m.winner_team_id = tm.team_id OR m.loser_team_id = tm.team_id)
    WHERE tm.user_id = ?
    GROUP BY t.id, t.name, t.state, r.final_rank, played_at
    ORDER BY played_at DESC`,
    [targetUserId],
  );

  const tournaments = historyRows.map(mapHistoryRow);

  const [statRows] = await db.execute<
    (RowDataPacket & {
      tournaments_played: number;
      tournaments_won: number;
      matches_won: number;
      matches_lost: number;
      best_rank: number | null;
      avg_rank: number | null;
    })[]
  >(
    `SELECT
      COUNT(DISTINCT r.tournament_id) AS tournaments_played,
      COALESCE(SUM(CASE WHEN r.final_rank = 1 THEN 1 ELSE 0 END), 0) AS tournaments_won,
      COALESCE(SUM(CASE WHEN m.winner_team_id = tm.team_id THEN 1 ELSE 0 END), 0) AS matches_won,
      COALESCE(SUM(CASE WHEN m.loser_team_id = tm.team_id THEN 1 ELSE 0 END), 0) AS matches_lost,
      MIN(r.final_rank) AS best_rank,
      AVG(r.final_rank) AS avg_rank
    FROM bg_team_members tm
    LEFT JOIN bg_tournament_registrations r ON r.team_id = tm.team_id
    LEFT JOIN bg_matches m ON m.tournament_id = r.tournament_id
      AND (m.winner_team_id = tm.team_id OR m.loser_team_id = tm.team_id)
    WHERE tm.user_id = ?`,
    [targetUserId],
  );

  const statsRow = statRows[0];

  return {
    profile,
    stats: {
      tournamentsPlayed: Number(statsRow?.tournaments_played ?? 0),
      tournamentsWon: Number(statsRow?.tournaments_won ?? 0),
      matchesWon: Number(statsRow?.matches_won ?? 0),
      matchesLost: Number(statsRow?.matches_lost ?? 0),
      bestRank: statsRow?.best_rank === null ? null : Number(statsRow?.best_rank),
      averageRank: statsRow?.avg_rank === null ? null : Number(Number(statsRow?.avg_rank).toFixed(2)),
    },
    teamsTimeline: timeline,
    tournaments,
    isSelf,
  };
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


