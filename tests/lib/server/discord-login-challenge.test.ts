import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import crypto from "node:crypto";

jest.mock("@/lib/server/database");
jest.mock("@/lib/server/solo-entries-service");

import {
  createDiscordLoginChallenge,
  DISCORD_CODE_WINDOW_MINUTES,
  MAX_DISCORD_CODE_ATTEMPTS,
  MAX_DISCORD_CODES_PER_WINDOW,
  retireOtherDiscordChallenges,
  verifyDiscordChallenge,
} from "@/lib/server/users-service";
import { getDatabase } from "@/lib/server/database";

/**
 * Le code de connexion Discord, et les deux bornes qui en font un secret.
 *
 * Six chiffres, c'est un million de combinaisons : sans décompte, une porte
 * ouverte. `bg_discord_login_challenges.attempts` existait depuis l'origine et
 * n'était relu nulle part. Les deux bornes vivent **en base** — le plafond de
 * débit en mémoire ne couvre qu'un processus, et son seau se vide entièrement
 * dès qu'on lui fabrique dix mille clés. Voir `docs/AUTHORIZATION_RULES.md`
 * §1.1.
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
 * Base factice qui **rejoue** les écritures plutôt que de les compter : le
 * décompte est la règle elle-même, un espion sur `execute` ne dirait pas si elle
 * tient. La réservation d'essai est rejouée avec sa clause `WHERE`, seule façon
 * de voir qu'elle est atomique.
 */
function fakeDb(challenge: Challenge | null, recentCodes = 0) {
  const state = challenge;
  const execute = jest.fn(async (sql: string, params: unknown[] = []) => {
    const q = String(sql).replace(/\s+/g, " ").trim();

    if (q.startsWith("SELECT id, code_hash")) {
      return [state === null ? [] : [{ ...state }], []];
    }

    if (q.startsWith("SELECT COUNT(*) AS c FROM bg_discord_login_challenges")) {
      return [[{ c: recentCodes }], []];
    }

    // Réservation d'un essai : la clause `WHERE attempts < ?` décide, et
    // `affectedRows` la rapporte — comme le fait MySQL sous le verrou de ligne.
    if (q.startsWith("UPDATE bg_discord_login_challenges SET consumed_at = CASE")) {
      if (state === null) return [{ affectedRows: 0 }, []];
      const limit = Number(params[0]);
      if (state.consumed_at !== null || state.attempts >= limit) {
        return [{ affectedRows: 0 }, []];
      }
      // `consumed_at` lit `attempts` **avant** l'incrément, comme MySQL évalue
      // les affectations de gauche à droite.
      if (state.attempts + 1 >= limit) state.consumed_at = new Date();
      state.attempts += 1;
      return [{ affectedRows: 1 }, []];
    }

    if (q.startsWith("UPDATE bg_discord_login_challenges SET consumed_at = NOW()")) {
      if (state !== null) state.consumed_at = new Date();
      return [{ affectedRows: 1 }, []];
    }

    if (q.startsWith("DELETE FROM bg_discord_login_challenges")) {
      return [{ affectedRows: 0 }, []];
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

const statementsOf = (execute: jest.Mock) =>
  execute.mock.calls.map(([sql]) => String(sql).replace(/\s+/g, " ").trim());

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

  it("réserve l'essai avant de comparer : pas de dernier essai gratuit", async () => {
    // Le quota était relu sur la ligne chargée, puis décompté par une écriture
    // séparée. Ici c'est la réservation qui tranche, et elle échoue.
    const { state, execute } = fakeDb(
      pendingChallenge({ attempts: MAX_DISCORD_CODE_ATTEMPTS, consumed_at: null }),
    );

    await expect(verifyDiscordChallenge("123", "424242")).resolves.toBe(false);
    expect(state?.attempts).toBe(MAX_DISCORD_CODE_ATTEMPTS);
    // Aucune écriture de consommation : la réservation a refusé avant.
    expect(
      statementsOf(execute).filter((q) =>
        q.startsWith("UPDATE bg_discord_login_challenges SET consumed_at = NOW()"),
      ),
    ).toHaveLength(0);
  });

  it("n'accorde pas un essai de plus à une rafale simultanée", async () => {
    // Le cœur de la correction : le `SELECT` et l'`UPDATE` sont séparés par un
    // `await`. Lancées de front, dix vérifications lisaient toutes
    // `attempts = 0` et comparaient toutes une combinaison. La clause
    // `WHERE attempts < ?` de la réservation est ce qui les départage.
    const { state } = fakeDb(pendingChallenge());

    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        verifyDiscordChallenge("123", String(100000 + i)),
      ),
    );

    expect(results.every((ok) => ok === false)).toBe(true);
    expect(state?.attempts).toBe(MAX_DISCORD_CODE_ATTEMPTS);
  });

  it("réserve un essai même quand le code est bon", async () => {
    // Sans conséquence — la réussite consomme la ligne — mais c'est ce qui rend
    // la réservation atomique : elle précède la comparaison.
    const { state } = fakeDb(pendingChallenge());

    await expect(verifyDiscordChallenge("123", "424242")).resolves.toBe(true);
    expect(state?.attempts).toBe(1);
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

describe("createDiscordLoginChallenge — nombre de codes délivrables", () => {
  beforeEach(() => jest.clearAllMocks());

  it("délivre tant que la fenêtre n'est pas pleine", async () => {
    fakeDb(null, MAX_DISCORD_CODES_PER_WINDOW - 1);
    const challenge = await createDiscordLoginChallenge("123");
    expect(challenge.code).toMatch(/^\d{6}$/);
  });

  it("refuse au-delà, et n'écrit alors aucune ligne", async () => {
    // C'est **cette** borne qui tient la force brute : le plafond en mémoire se
    // laisse vider (`bucket.clear()`) par qui lui fabrique assez de clés.
    const { execute } = fakeDb(null, MAX_DISCORD_CODES_PER_WINDOW);

    await expect(createDiscordLoginChallenge("123")).rejects.toThrow("TOO_MANY_CODE_REQUESTS");
    expect(statementsOf(execute).some((q) => q.startsWith("INSERT"))).toBe(false);
  });

  it("compte sur la fenêtre annoncée", async () => {
    const { execute } = fakeDb(null, 0);
    await createDiscordLoginChallenge("123");

    const count = execute.mock.calls.find(([sql]) =>
      String(sql).replace(/\s+/g, " ").includes("SELECT COUNT(*) AS c FROM bg_discord_login_challenges"),
    ) as [string, unknown[]];
    expect(count[1]).toEqual(["123", DISCORD_CODE_WINDOW_MINUTES]);
  });

  it("fait le ménage des codes expirés de longue date", async () => {
    // Rien n'effaçait jamais une ligne : la table grossissait d'une ligne par
    // demande, dont celles fabriquées avec des identifiants inventés.
    const { execute } = fakeDb(null, 0);
    await createDiscordLoginChallenge("123");

    expect(statementsOf(execute).some((q) => q.startsWith("DELETE FROM bg_discord_login_challenges")))
      .toBe(true);
  });

  it("ne périme **pas** les codes précédents : l'envoi n'a pas encore eu lieu", async () => {
    // Les invalider ici laissait le joueur sans code du tout quand le bot était
    // injoignable : l'ancien tué, le neuf jamais reçu. C'est l'appelant qui
    // appelle `retireOtherDiscordChallenges`, une fois l'envoi réussi.
    const { execute } = fakeDb(null, 0);
    await createDiscordLoginChallenge("123");

    expect(
      statementsOf(execute).some((q) =>
        q.startsWith("UPDATE bg_discord_login_challenges SET consumed_at = NOW()"),
      ),
    ).toBe(false);
  });

  it("rend un code à six chiffres", async () => {
    fakeDb(null, 0);
    const challenge = await createDiscordLoginChallenge("123");
    expect(challenge.code).toMatch(/^\d{6}$/);
  });
});

describe("retireOtherDiscordChallenges", () => {
  beforeEach(() => jest.clearAllMocks());

  it("périme les autres codes en attente, en épargnant celui qu'on vient d'envoyer", async () => {
    // `verifyDiscordChallenge` ne lit que le plus récent : sans cette purge, un
    // ancien code resterait ouvert sans que ses essais soient jamais décomptés,
    // et demander un code neuf rouvrirait le quota indéfiniment.
    const { execute } = fakeDb(null, 0);

    await retireOtherDiscordChallenges("123", 7);

    const [sql, params] = execute.mock.calls[0] as [string, unknown[]];
    expect(String(sql).replace(/\s+/g, " ")).toContain("consumed_at IS NULL AND id <> ?");
    expect(params).toEqual(["123", 7]);
  });
});
