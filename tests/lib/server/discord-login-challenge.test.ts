import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import crypto from "node:crypto";

jest.mock("@/lib/server/database");
jest.mock("@/lib/server/solo-entries-service");

import {
  createDiscordLoginChallenge,
  MAX_DISCORD_CODE_ATTEMPTS,
  verifyDiscordChallenge,
} from "@/lib/server/users-service";
import { getDatabase } from "@/lib/server/database";

/**
 * Le code de connexion Discord, et la seule chose qui en fasse un secret : le
 * **décompte des essais**.
 *
 * Six chiffres, c'est un million de combinaisons — un attaquant qui connaît le
 * pseudo Discord d'un joueur (public sur n'importe quel serveur) demande un
 * code, puis énumère. `bg_discord_login_challenges.attempts` existait depuis
 * l'origine et n'était relu nulle part : il s'incrémentait sans jamais rien
 * refuser. Voir `docs/AUTHORIZATION_RULES.md` §1.1.
 */

type Challenge = {
  id: number;
  code_hash: string;
  expires_at: Date;
  consumed_at: Date | null;
  attempts: number;
};

const hash = (code: string) => crypto.createHash("sha256").update(code).digest("hex");

/**
 * Base factice qui **rejoue l'écriture** du compteur plutôt que de la compter :
 * le décompte est la règle elle-même, un espion sur `execute` ne dirait pas si
 * elle tient.
 */
function fakeDb(challenge: Challenge | null) {
  const state = challenge;
  const execute = jest.fn(async (sql: string, params: unknown[] = []) => {
    const q = String(sql).replace(/\s+/g, " ").trim();

    if (q.startsWith("SELECT id, code_hash")) {
      return [state === null ? [] : [state], []];
    }

    if (q.startsWith("UPDATE bg_discord_login_challenges SET consumed_at = CASE")) {
      if (state === null) return [{ affectedRows: 0 }, []];
      // Ordre des affectations : `consumed_at` lit `attempts` **avant**
      // l'incrément, comme MySQL évalue de gauche à droite.
      const limit = Number(params[0]);
      if (state.attempts + 1 >= limit) state.consumed_at = new Date();
      state.attempts += 1;
      return [{ affectedRows: 1 }, []];
    }

    if (q.startsWith("UPDATE bg_discord_login_challenges SET consumed_at = NOW()")) {
      if (state !== null) state.consumed_at = new Date();
      return [{ affectedRows: 1 }, []];
    }

    if (q.startsWith("INSERT INTO bg_discord_login_challenges")) {
      return [{ insertId: 7 }, []];
    }

    if (q.startsWith("SELECT expires_at")) {
      return [[{ expires_at: new Date(Date.now() + 600_000) }], []];
    }

    return [[], []];
  });

  (getDatabase as jest.Mock).mockResolvedValue({ execute } as never);
  return { execute, state };
}

function pendingChallenge(overrides: Partial<Challenge> = {}): Challenge {
  return {
    id: 1,
    code_hash: hash("424242"),
    expires_at: new Date(Date.now() + 600_000),
    consumed_at: null,
    attempts: 0,
    ...overrides,
  };
}

describe("verifyDiscordChallenge — quota d'essais", () => {
  beforeEach(() => jest.clearAllMocks());

  it("accepte le bon code", async () => {
    fakeDb(pendingChallenge());
    await expect(verifyDiscordChallenge("123", "424242")).resolves.toBe(true);
  });

  it("brûle le code au dernier essai raté, et le bon code ne passe plus", async () => {
    const { state } = fakeDb(pendingChallenge());

    for (let attempt = 1; attempt <= MAX_DISCORD_CODE_ATTEMPTS; attempt += 1) {
      await expect(verifyDiscordChallenge("123", "000000")).resolves.toBe(false);
    }

    expect(state?.attempts).toBe(MAX_DISCORD_CODE_ATTEMPTS);
    expect(state?.consumed_at).not.toBeNull();

    // Le vrai propriétaire devra redemander un code : c'est le prix, et il est
    // très inférieur à celui d'une session ouverte par énumération.
    await expect(verifyDiscordChallenge("123", "424242")).resolves.toBe(false);
  });

  it("ne compte pas au-delà du quota : l'essai n'est même pas évalué", async () => {
    // Le quota est relu **avant** la comparaison. Sans cela, le dernier essai
    // resterait gratuit à chaque appel — le code brûlé, mais toujours testable.
    const { state } = fakeDb(
      pendingChallenge({ attempts: MAX_DISCORD_CODE_ATTEMPTS, consumed_at: null }),
    );

    await expect(verifyDiscordChallenge("123", "424242")).resolves.toBe(false);
    expect(state?.attempts).toBe(MAX_DISCORD_CODE_ATTEMPTS);
  });

  it("refuse un code déjà consommé", async () => {
    fakeDb(pendingChallenge({ consumed_at: new Date() }));
    await expect(verifyDiscordChallenge("123", "424242")).resolves.toBe(false);
  });

  it("refuse un code expiré", async () => {
    fakeDb(pendingChallenge({ expires_at: new Date(Date.now() - 1000) }));
    await expect(verifyDiscordChallenge("123", "424242")).resolves.toBe(false);
  });

  it("refuse quand aucun code n'a été demandé", async () => {
    fakeDb(null);
    await expect(verifyDiscordChallenge("123", "424242")).resolves.toBe(false);
  });
});

describe("createDiscordLoginChallenge — un code neuf périme le précédent", () => {
  beforeEach(() => jest.clearAllMocks());

  it("consomme les codes en attente avant d'en émettre un", async () => {
    // `verifyDiscordChallenge` ne lit que le plus récent : sans cette purge,
    // demander un code neuf rouvrirait indéfiniment le quota d'essais, et le
    // plafond par code ne bornerait plus rien.
    const { execute } = fakeDb(null);

    await createDiscordLoginChallenge("123");

    const statements = execute.mock.calls.map(([sql]) =>
      String(sql).replace(/\s+/g, " ").trim(),
    );
    const purge = statements.findIndex((q) =>
      q.startsWith("UPDATE bg_discord_login_challenges SET consumed_at = NOW()"),
    );
    const insert = statements.findIndex((q) =>
      q.startsWith("INSERT INTO bg_discord_login_challenges"),
    );

    expect(purge).toBeGreaterThanOrEqual(0);
    expect(insert).toBeGreaterThan(purge);
  });

  it("rend un code à six chiffres", async () => {
    fakeDb(null);
    const challenge = await createDiscordLoginChallenge("123");
    expect(challenge.code).toMatch(/^\d{6}$/);
  });
});
