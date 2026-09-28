import { createHash, randomBytes } from "node:crypto";
import { config as loadEnv } from "dotenv";
import mysql from "mysql2/promise";
import type { APIRequestContext, Browser, BrowserContext } from "@playwright/test";
import { request as playwrightRequest } from "@playwright/test";
import { TERMS_VERSION } from "../../lib/shared/terms-of-use";

/**
 * Fixture du parcours joueur (`e2e/player-journey.spec.ts`).
 *
 * Deux joueurs **réels** s'affrontent : chacun doit voir sa propre page, avec sa
 * propre session — c'est tout l'objet du parcours (l'un propose un score,
 * l'autre le confirme). Le bypass `DEV_AUTH_USER_ID` n'offre qu'une identité
 * par serveur ; la fixture ouvre donc de vraies sessions, en posant la ligne
 * `bg_user_sessions` et le cookie `bg_session` comme le ferait une connexion
 * (`lib/server/auth.ts`).
 *
 * Tout le reste passe **par l'API**, comme un utilisateur : création des
 * équipes, du tournoi, inscriptions, avancée jusqu'au coup d'envoi. Seuls les
 * comptes, leurs sessions et leur acceptation des conditions d'utilisation
 * sont écrits en base — le site n'a aucune route pour créer un compte sans
 * fournisseur OAuth.
 */

loadEnv({ path: ".env" });

export type Player = {
  id: number;
  pseudo: string;
  token: string;
  teamId: number;
  teamName: string;
};

export type JourneyFixture = {
  admin: { id: number; token: string };
  playerA: Player;
  playerB: Player;
  db: mysql.Connection;
  baseURL: string;
  tournamentIds: number[];
};

/** Base joignable et bypass inactif : sans les deux, le parcours ne peut pas tourner. */
export function journeyUnavailableReason(): string | null {
  if (process.env.E2E_AUTH_USER) {
    return "Le bypass DEV_AUTH_USER_ID (E2E_AUTH_USER) masque les sessions : lancer ce parcours sans lui.";
  }
  if (!process.env.DB_HOST || !process.env.DB_DATABASE) {
    return "Base MySQL non configurée (.env) : parcours joueur ignoré.";
  }
  return null;
}

async function connect(): Promise<mysql.Connection> {
  return mysql.createConnection({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT ? Number(process.env.DB_PORT) : undefined,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_DATABASE,
  });
}

async function createUser(
  db: mysql.Connection,
  pseudo: string,
  isAdmin: boolean,
): Promise<{ id: number; token: string }> {
  const [result] = await db.execute<mysql.ResultSetHeader>(
    `INSERT INTO bg_users (pseudo, is_adult, is_admin) VALUES (?, 1, ?)`,
    [pseudo, isAdmin ? 1 : 0],
  );
  const id = Number(result.insertId);
  await db.execute(
    `INSERT INTO bg_terms_acceptances (user_id, version, context) VALUES (?, ?, 'SIGNUP')`,
    [id, TERMS_VERSION],
  );
  const token = randomBytes(32).toString("hex");
  await db.execute(
    `INSERT INTO bg_user_sessions (token_hash, user_id, expires_at)
     VALUES (?, ?, DATE_ADD(NOW(), INTERVAL 1 DAY))`,
    [createHash("sha256").update(token).digest("hex"), id],
  );
  return { id, token };
}

/** Client HTTP authentifié par la session donnée. */
export async function apiAs(baseURL: string, token: string): Promise<APIRequestContext> {
  return playwrightRequest.newContext({
    baseURL,
    extraHTTPHeaders: { cookie: `bg_session=${token}` },
  });
}

/** Contexte de navigateur ouvert sur la session du joueur. */
export async function browserAs(
  browser: Browser,
  baseURL: string,
  token: string,
): Promise<BrowserContext> {
  const context = await browser.newContext({ baseURL });
  const { hostname } = new URL(baseURL);
  await context.addCookies([
    { name: "bg_session", value: token, domain: hostname, path: "/", httpOnly: true, sameSite: "Lax" },
  ]);
  return context;
}

async function expectOk<T>(response: Awaited<ReturnType<APIRequestContext["get"]>>, what: string): Promise<T> {
  if (!response.ok()) {
    throw new Error(`${what} : ${response.status()} ${await response.text()}`);
  }
  return (await response.json()) as T;
}

export async function setUpJourney(baseURL: string): Promise<JourneyFixture> {
  const db = await connect();
  const stamp = `${Date.now().toString(36)}${randomBytes(2).toString("hex")}`;

  const admin = await createUser(db, `e2e_admin_${stamp}`, true);
  const players: Player[] = [];
  for (const side of ["a", "b"] as const) {
    const user = await createUser(db, `e2e_joueur_${side}_${stamp}`, false);
    const teamName = `E2E ${side.toUpperCase()} ${stamp}`;
    const api = await apiAs(baseURL, user.token);
    const created = await expectOk<{ id?: number; teamId?: number }>(
      await api.post("/api/teams", { data: { name: teamName, acceptTerms: true } }),
      `création de l'équipe ${side}`,
    );
    await api.dispose();
    players.push({
      id: user.id,
      pseudo: `e2e_joueur_${side}_${stamp}`,
      token: user.token,
      teamId: Number(created.id ?? created.teamId),
      teamName,
    });
  }

  return { admin, playerA: players[0], playerB: players[1], db, baseURL, tournamentIds: [] };
}

/**
 * Tournoi à élimination simple, deux équipes, lancé : une seule rencontre,
 * la finale, jouable. Format FT2 (premier à deux manches).
 *
 * @returns l'identifiant du tournoi et celui de son unique match.
 */
export async function startDuelTournament(
  fixture: JourneyFixture,
  name: string,
): Promise<{ tournamentId: number; matchId: number }> {
  const adminApi = await apiAs(fixture.baseURL, fixture.admin.token);
  const hour = 3_600_000;
  const now = Date.now();
  const created = await expectOk<{ id: number }>(
    await adminApi.post("/api/tournaments", {
      data: {
        name,
        format: "SINGLE",
        game: "OW",
        participantType: "TEAM",
        maxTeams: 8,
        matchFormatType: "FT",
        matchFormatValue: 2,
        registrationMinPlayers: 1,
        registrationDiscordRequirement: "NONE",
        registrationBlizzardRequirement: "NONE",
        startVisibilityAt: new Date(now - 2 * hour).toISOString(),
        registrationOpenAt: new Date(now - hour).toISOString(),
        registrationCloseAt: new Date(now + 24 * hour).toISOString(),
        startAt: new Date(now + 48 * hour).toISOString(),
      },
    }),
    "création du tournoi",
  );
  const tournamentId = Number(created.id);
  fixture.tournamentIds.push(tournamentId);

  for (const player of [fixture.playerA, fixture.playerB]) {
    const api = await apiAs(fixture.baseURL, player.token);
    await expectOk(await api.post(`/api/tournaments/${tournamentId}/register`, { data: {} }), `inscription de ${player.teamName}`);
    await api.dispose();
  }

  // Inscriptions → clôture → coup d'envoi : deux avancées.
  for (let step = 0; step < 2; step++) {
    await expectOk(
      await adminApi.post(`/api/admin/tournaments/${tournamentId}/advance`, { data: {} }),
      "avancée du tournoi",
    );
  }

  const detail = await expectOk<{ card: { state: string }; matches: { id: number; team1Id: number | null; team2Id: number | null }[] }>(
    await adminApi.get(`/api/tournaments/${tournamentId}`),
    "lecture du tournoi",
  );
  await adminApi.dispose();
  if (detail.card.state !== "RUNNING") throw new Error(`tournoi non lancé : ${detail.card.state}`);
  const match = detail.matches.find((m) => m.team1Id !== null && m.team2Id !== null);
  if (!match) throw new Error("aucune rencontre jouable après le lancement");
  return { tournamentId, matchId: match.id };
}

/** Les deux équipes se déclarent prêtes : le match est lancé. */
export async function launchMatch(fixture: JourneyFixture, matchId: number): Promise<void> {
  for (const player of [fixture.playerA, fixture.playerB]) {
    const api = await apiAs(fixture.baseURL, player.token);
    await expectOk(await api.post(`/api/matches/${matchId}/ready`, { data: { ready: true } }), `« Prêt » de ${player.teamName}`);
    await api.dispose();
  }
}

/** Nettoyage : tournois par l'API (le chemin qui efface tout ce qui en dépend), puis comptes et équipes. */
export async function tearDownJourney(fixture: JourneyFixture | null): Promise<void> {
  if (!fixture) return;
  try {
    const adminApi = await apiAs(fixture.baseURL, fixture.admin.token);
    for (const id of fixture.tournamentIds) {
      await adminApi.delete(`/api/admin/tournaments/${id}`);
    }
    await adminApi.dispose();
    const teamIds = [fixture.playerA.teamId, fixture.playerB.teamId];
    const userIds = [fixture.admin.id, fixture.playerA.id, fixture.playerB.id];
    await fixture.db.query(`DELETE FROM bg_team_members WHERE team_id IN (?)`, [teamIds]);
    await fixture.db.query(`DELETE FROM bg_teams WHERE id IN (?)`, [teamIds]);
    await fixture.db.query(`DELETE FROM bg_users WHERE id IN (?)`, [userIds]);
  } finally {
    await fixture.db.end();
  }
}
