import crypto from "node:crypto";
import * as React from "react";
import { cookies } from "next/headers";
import type { RowDataPacket, ResultSetHeader } from "mysql2/promise";
import { getDatabase } from "@/lib/server/database";
import { SESSION_RETENTION_DAYS } from "@/lib/shared/processing-register";
import { localAvatarUrl } from "@/lib/shared/avatar";
import { TERMS_POSTPONED_COOKIE } from "@/lib/shared/global-modals";
import { normalizePseudo, slugifyPseudo } from "@/lib/server/serialization";
import { sanitizePlatformRoles, type PlatformRole } from "@/lib/shared/permissions";
import { recordConnection } from "@/lib/server/connection-logs";
import { activeSuspensionSql, assertNotSuspended, purgeEndedSuspensions } from "@/lib/server/account-suspensions";
import type { ConnectionLogEvent } from "@/lib/shared/connection-logs";

export type AuthUser = {
  id: number;
  pseudo: string;
  avatarUrl: string | null;
  discordId: string | null;
  googleSub: string | null;
  isAdult: boolean | null;
  isAdmin: boolean;
  /** Rôles de permission cumulables (inclut `ADMIN` si `isAdmin`). */
  roles: PlatformRole[];
};

type UserRow = RowDataPacket & {
  id: number;
  pseudo: string;
  avatar_url: string | null;
  discord_id: string | null;
  google_sub: string | null;
  is_adult: 0 | 1 | null;
  is_admin: 0 | 1;
  platform_roles_json: string | null;
};

/**
 * Reconstitue la liste complète des rôles d'un utilisateur : le rôle `ADMIN`
 * dérive de `is_admin`, les autres rôles cumulables sont stockés en JSON.
 * L'ensemble est dédupliqué et trié par `sanitizePlatformRoles`.
 */
export function resolveRoles(isAdmin: boolean, rolesJson: unknown): PlatformRole[] {
  const stored = sanitizePlatformRoles(rolesJson);
  return sanitizePlatformRoles(isAdmin ? ["ADMIN", ...stored] : stored);
}

const SESSION_COOKIE = "bg_session";
// Déclarée dans le registre des traitements (`/rgpd/registre`), d'où elle vient.
const SESSION_TTL_DAYS = SESSION_RETENTION_DAYS;

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
    // Le compte voit **son** avatar, sans passer par la visibilité — mais la
    // règle d'origine s'applique ici aussi : `ArenaNav` et `PublicHeader` le
    // rendent par `next/image`, qui lève sur une origine absente de
    // `remotePatterns`. Une URL Google restée en base casserait donc toutes
    // les pages de ce compte, au lieu de simplement fuiter comme avant.
    avatarUrl: localAvatarUrl(row.avatar_url),
    discordId: row.discord_id,
    googleSub: row.google_sub,
    isAdult: row.is_adult === null ? null : Boolean(row.is_adult),
    isAdmin: Boolean(row.is_admin),
    roles: resolveRoles(Boolean(row.is_admin), row.platform_roles_json),
  };
}

/**
 * Ouvre une session — point de passage unique des quatre portes d'entrée.
 * `event` nomme la porte : l'ouverture est consignée au journal des données
 * de connexion (`lib/shared/connection-logs.ts`, obligation légale de
 * l'hébergeur), sans jamais pouvoir faire échouer la connexion.
 */
export async function createSession(userId: number, event: ConnectionLogEvent): Promise<void> {
  // Un compte suspendu n'ouvre pas de session, quelle que soit la porte :
  // `AccountSuspendedError` porte l'exposé de la décision, que la porte rend
  // lisible (`lib/shared/account-suspension.ts`). Contrôle *avant* toute
  // écriture ; la course avec un prononcé concurrent est tranchée par
  // `getCurrentUser`, qui écarte la session d'un compte suspendu.
  await assertNotSuspended(userId);
  const db = await getDatabase();
  const token = randomToken(48);
  const tokenHash = hashToken(token);

  await db.execute(`DELETE FROM bg_user_sessions WHERE expires_at < NOW()`);
  await purgeEndedSuspensions();
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
  forgetTermsPostponement(cookieStore);
  await recordConnection(userId, event);
}

/**
 * Le report « Plus tard » des conditions (`bg_terms_later`) n'est lié à aucun
 * compte : il tombe à chaque ouverture et fermeture de session, sans quoi le
 * report d'un joueur vaudrait pour le suivant sur un ordinateur partagé.
 */
function forgetTermsPostponement(cookieStore: Awaited<ReturnType<typeof cookies>>): void {
  cookieStore.set(TERMS_POSTPONED_COOKIE, "", { path: "/", sameSite: "lax", maxAge: 0 });
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
  forgetTermsPostponement(cookieStore);
}

/**
 * Empreinte de la session de cette requête, ou `""` sans cookie — une
 * empreinte SHA-256 n'est jamais vide, si bien que `token_hash <> ""` désigne
 * alors **toutes** les sessions du compte (le contournement de développement
 * n'en porte aucune).
 */
async function currentTokenHash(): Promise<string> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  return token ? hashToken(token) : "";
}

/** Sessions encore valides du compte, hors celle de cette requête. */
export async function countOtherSessions(userId: number): Promise<number> {
  const db = await getDatabase();
  const [rows] = await db.execute<(RowDataPacket & { c: number })[]>(
    `SELECT COUNT(*) AS c FROM bg_user_sessions
     WHERE user_id = ? AND token_hash <> ? AND expires_at > NOW()`,
    [userId, await currentTokenHash()],
  );
  return Number(rows[0]?.c ?? 0);
}

/**
 * Ferme toutes les sessions du compte **sauf celle de cette requête** — le
 * « déconnecter mes autres appareils » de `/profil`, et le geste qui suit le
 * détachement d'une porte d'entrée.
 *
 * Sans lui, une session volée restait valide trente jours sans recours : seules
 * la déconnexion de l'appareil courant et la suppression du compte effaçaient
 * des lignes de `bg_user_sessions`, et détacher le fournisseur compromis — le
 * réflexe après la prise d'un compte Google ou Discord — ne fermait aucune des
 * sessions qu'il avait ouvertes. Les sessions expirées partent avec, sans être
 * comptées : les compter ferait annoncer des appareils fantômes.
 *
 * @returns le nombre de sessions encore valides qui ont été fermées.
 */
export async function revokeOtherSessions(userId: number): Promise<number> {
  const db = await getDatabase();
  const current = await currentTokenHash();
  // Deux instructions pour que le compte rendu ne compte que des sessions qui
  // ouvraient encore quelque chose.
  await db.execute(
    `DELETE FROM bg_user_sessions WHERE user_id = ? AND token_hash <> ? AND expires_at <= NOW()`,
    [userId, current],
  );
  const [result] = await db.execute<ResultSetHeader>(
    `DELETE FROM bg_user_sessions WHERE user_id = ? AND token_hash <> ?`,
    [userId, current],
  );
  return Number(result.affectedRows ?? 0);
}

/**
 * Provisionne (ou réutilise) un utilisateur de test « vierge » déterministe :
 * non-admin, sans équipe, sans battletags ni majorité renseignés, stats à 0.
 * Utilisé pour les tests E2E du parcours « nouveau compte » via
 * `DEV_AUTH_USER_ID=fresh`, afin de ne pas dépendre d'un compte réel.
 */
const FRESH_TEST_PSEUDO = "e2e_fresh_account";

async function ensureFreshTestUser(): Promise<number> {
  const db = await getDatabase();
  const [existing] = await db.execute<UserRow[]>(
    `SELECT id FROM bg_users WHERE pseudo = ? LIMIT 1`,
    [FRESH_TEST_PSEUDO],
  );
  if (existing.length > 0) return Number(existing[0].id);

  try {
    const [res] = await db.execute<ResultSetHeader>(
      `INSERT INTO bg_users (pseudo, is_admin, is_adult) VALUES (?, 0, NULL)`,
      [FRESH_TEST_PSEUDO],
    );
    return Number(res.insertId);
  } catch {
    // Création concurrente (contrainte unique sur pseudo) : on relit la ligne.
    const [row] = await db.execute<UserRow[]>(
      `SELECT id FROM bg_users WHERE pseudo = ? LIMIT 1`,
      [FRESH_TEST_PSEUDO],
    );
    if (row.length > 0) return Number(row[0].id);
    throw new Error("FRESH_TEST_USER_PROVISION_FAILED");
  }
}

async function getDevBypassUser(): Promise<AuthUser | null> {
  // Liste blanche stricte : le bypass n'est actif QUE lorsqu'on est explicitement
  // en développement (`next dev` → NODE_ENV="development"). Toute autre valeur
  // — "production", "test", "staging", ou NODE_ENV non défini — le désactive.
  // Une liste noire (« tout sauf production ») laisserait le bypass ouvert sur un
  // serveur mal configuré où NODE_ENV n'est pas positionné.
  if (process.env.NODE_ENV !== "development") return null;
  const rawId = process.env.DEV_AUTH_USER_ID;
  if (!rawId) return null;

  let userId: number;
  if (rawId === "fresh") {
    userId = await ensureFreshTestUser();
  } else {
    userId = Number(rawId);
    if (!Number.isInteger(userId) || userId <= 0) return null;
  }

  const db = await getDatabase();
  const [rows] = await db.execute<UserRow[]>(
    `SELECT id, pseudo, avatar_url, discord_id, google_sub, is_adult, is_admin, platform_roles_json
     FROM bg_users
     WHERE id = ?
       AND is_deleted = 0
     LIMIT 1`,
    [userId],
  );

  if (rows.length === 0) return null;
  return fromRow(rows[0]);
}

// `cache` de React n'est fourni qu'au runtime (React Server Components / Next) ;
// le paquet `react` résolu sous Jest ne l'expose pas. On retombe alors sur
// l'identité (pas de mémoïsation en test, comportement inchangé).
const reactCache = (React as {
  cache?: <T extends (...args: never[]) => unknown>(fn: T) => T;
}).cache;
const requestCache: <T extends (...args: never[]) => unknown>(fn: T) => T =
  typeof reactCache === "function" ? reactCache : (fn) => fn;

/**
 * Résout l'utilisateur courant pour la requête en cours. Mémoïsé via `cache()`
 * de React : les multiples appelants d'un même rendu (PublicHeader, PublicFooter,
 * la page elle-même…) partagent une seule requête de session au lieu d'en
 * émettre une chacun.
 */
export const getCurrentUser = requestCache(async (): Promise<AuthUser | null> => {
  const devUser = await getDevBypassUser();
  if (devUser) return devUser;

  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const db = await getDatabase();
  const [rows] = await db.execute<UserRow[]>(
    `SELECT u.id, u.pseudo, u.avatar_url, u.discord_id, u.google_sub, u.is_adult, u.is_admin, u.platform_roles_json
     FROM bg_user_sessions s
     JOIN bg_users u ON u.id = s.user_id
     WHERE s.token_hash = ?
       AND s.expires_at > NOW()
       AND u.is_deleted = 0
       AND NOT EXISTS (
         SELECT 1 FROM bg_account_suspensions sus
         WHERE sus.user_id = u.id AND ${activeSuspensionSql("sus")}
       )
     LIMIT 1`,
    [hashToken(token)],
  );

  if (rows.length === 0) {
    return null;
  }

  return fromRow(rows[0]);
});

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

