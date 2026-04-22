import crypto from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { RowDataPacket } from "mysql2/promise";
import { getDatabase } from "@/lib/server/database";
import { normalizePseudo, slugifyPseudo } from "@/lib/server/serialization";

export type AuthUser = {
  id: number;
  pseudo: string;
  avatarUrl: string | null;
  discordId: string | null;
  googleSub: string | null;
  email: string | null;
  isAdult: boolean | null;
  isAdmin: boolean;
};

type UserRow = RowDataPacket & {
  id: number;
  pseudo: string;
  avatar_url: string | null;
  discord_id: string | null;
  google_sub: string | null;
  email: string | null;
  is_adult: 0 | 1 | null;
  is_admin: 0 | 1;
};

const SESSION_COOKIE = "bg_session";
const OAUTH_COOKIE = "bg_google_oauth";
const SESSION_TTL_DAYS = 30;

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function randomToken(bytes = 48): string {
  return crypto.randomBytes(bytes).toString("hex");
}

function baseCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
  };
}

function fromRow(row: UserRow): AuthUser {
  return {
    id: Number(row.id),
    pseudo: row.pseudo,
    avatarUrl: row.avatar_url,
    discordId: row.discord_id,
    googleSub: row.google_sub,
    email: row.email,
    isAdult: row.is_adult === null ? null : Boolean(row.is_adult),
    isAdmin: Boolean(row.is_admin),
  };
}

export async function createSession(userId: number): Promise<void> {
  const db = await getDatabase();
  const token = randomToken(48);
  const tokenHash = hashToken(token);

  await db.execute(`DELETE FROM bg_user_sessions WHERE expires_at < NOW()`);
  await db.execute(
    `INSERT INTO bg_user_sessions (token_hash, user_id, expires_at)
     VALUES (?, ?, DATE_ADD(NOW(), INTERVAL ? DAY))`,
    [tokenHash, userId, SESSION_TTL_DAYS],
  );

  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, token, {
    ...baseCookieOptions(),
    maxAge: SESSION_TTL_DAYS * 24 * 60 * 60,
  });
}

export async function clearSession(): Promise<void> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (token) {
    const db = await getDatabase();
    await db.execute(`DELETE FROM bg_user_sessions WHERE token_hash = ?`, [hashToken(token)]);
  }
  cookieStore.set(SESSION_COOKIE, "", {
    ...baseCookieOptions(),
    maxAge: 0,
  });
}

export async function getCurrentUser(): Promise<AuthUser | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const db = await getDatabase();
  const [rows] = await db.execute<UserRow[]>(
    `SELECT u.id, u.pseudo, u.avatar_url, u.discord_id, u.google_sub, u.email, u.is_adult, u.is_admin
     FROM bg_user_sessions s
     JOIN bg_users u ON u.id = s.user_id
     WHERE s.token_hash = ?
       AND s.expires_at > NOW()
     LIMIT 1`,
    [hashToken(token)],
  );

  if (rows.length === 0) {
    return null;
  }

  return fromRow(rows[0]);
}

export async function requireCurrentUser(): Promise<AuthUser> {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/connexion");
  }
  return user;
}

export async function saveGoogleOAuthState(state: string, redirectTo: string): Promise<void> {
  const cookieStore = await cookies();
  const payload = Buffer.from(JSON.stringify({ state, redirectTo })).toString("base64url");
  cookieStore.set(OAUTH_COOKIE, payload, {
    ...baseCookieOptions(),
    maxAge: 10 * 60,
  });
}

export async function consumeGoogleOAuthState(): Promise<{ state: string; redirectTo: string } | null> {
  const cookieStore = await cookies();
  const payload = cookieStore.get(OAUTH_COOKIE)?.value;
  cookieStore.set(OAUTH_COOKIE, "", {
    ...baseCookieOptions(),
    maxAge: 0,
  });

  if (!payload) return null;

  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
      state: string;
      redirectTo: string;
    };
    if (!parsed.state || !parsed.redirectTo) return null;
    return parsed;
  } catch {
    return null;
  }
}

async function pseudoExists(candidate: string): Promise<boolean> {
  const db = await getDatabase();
  const [rows] = await db.execute<(RowDataPacket & { c: number })[]>(
    `SELECT COUNT(*) AS c FROM bg_users WHERE pseudo = ?`,
    [candidate],
  );
  return Number(rows[0]?.c ?? 0) > 0;
}

export async function ensureUniquePseudo(raw: string): Promise<string> {
  const normalized = normalizePseudo(raw);
  const safe = slugifyPseudo(normalized) || `player${Math.floor(Math.random() * 10000)}`;

  if (!(await pseudoExists(safe))) {
    return safe;
  }

  let suffix = 1;
  while (suffix < 1000) {
    const candidate = `${safe.slice(0, Math.max(1, 36 - String(suffix).length))}_${suffix}`;
    if (!(await pseudoExists(candidate))) {
      return candidate;
    }
    suffix += 1;
  }

  return `${safe.slice(0, 30)}_${Date.now().toString().slice(-5)}`;
}

