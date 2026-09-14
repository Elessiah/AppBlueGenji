import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import crypto from "node:crypto";

jest.mock("@/lib/server/database");
jest.mock("@/lib/server/solo-entries-service");

import {
  createDiscordLoginChallenge,
  discardDiscordChallenge,
  DISCORD_CODE_WINDOW_MINUTES,
  MAX_DISCORD_CODE_ATTEMPTS,
  MAX_DISCORD_CODES_PER_WINDOW,
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
 *
 * La trace distingue ce qui passe par le **pool** de ce qui passe par la
 * **connexion du verrou**, et garde `GET_LOCK`/`RELEASE_LOCK` à leur place :
 * l'exclusion mutuelle de l'émission de codes est un verrou de MySQL, qu'aucune
 * fausse base ne peut imiter — ce qu'on peut vérifier ici, c'est que le code lui
 * en donne les moyens (un verrou nommé par compte, rendu quoi qu'il arrive, et
 * le comptage comme l'insertion **dedans**).
 */
function fakeDb(challenge: Challenge | null, recentCodes = 0, lockAcquired = true) {
  const state = challenge;
  const trace: { origin: "pool" | "tx"; sql: string }[] = [];
  const lifecycle: string[] = [];

  const runner = (origin: "pool" | "tx") =>
    jest.fn(async (sql: string, params: unknown[] = []) => {
      const q = String(sql).replace(/\s+/g, " ").trim();
      trace.push({ origin, sql: q });

      if (q.startsWith("SELECT id, code_hash")) {
        return [state === null ? [] : [{ ...state }], []];
      }

      // Comptage des codes délivrés dans la fenêtre.
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

  const execute = runner("pool");
  const connectionExecute = runner("tx");
  const connection = {
    execute: connectionExecute,
    // `withNamedLock` prend et rend le verrou par `query`, pas par `execute`.
    query: jest.fn(async (sql: string) => {
      const text = String(sql);
      if (text.includes("GET_LOCK")) {
        lifecycle.push("GET_LOCK");
        return [[{ acquired: lockAcquired ? 1 : 0 }], []];
      }
      if (text.includes("RELEASE_LOCK")) {
        lifecycle.push("RELEASE_LOCK");
        return [[{}], []];
      }
      return [[], []];
    }),
    release: jest.fn(() => void lifecycle.push("RELEASE")),
    destroy: jest.fn(() => void lifecycle.push("DESTROY")),
  };
  const getConnection = jest.fn(async () => connection);

  (getDatabase as jest.Mock).mockResolvedValue({ execute, getConnection } as never);
  return { execute, connection, trace, lifecycle, state };
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

  it("ne lit que le **dernier** code émis", async () => {
    // C'est ce qui rend un code neuf suffisant pour périmer le précédent, sans
    // aucune écriture — et ce qui oblige, symétriquement, à supprimer la ligne
    // d'un envoi raté (voir `discardDiscordChallenge`).
    const { execute } = fakeDb(pendingChallenge());

    await verifyDiscordChallenge("123", "424242");

    const read = statementsOf(execute).find((q) => q.startsWith("SELECT id, code_hash"))!;
    expect(read).toContain("ORDER BY id DESC");
    expect(read).toContain("LIMIT 1");
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
    const { trace } = fakeDb(null, MAX_DISCORD_CODES_PER_WINDOW);

    await expect(createDiscordLoginChallenge("123")).rejects.toThrow("TOO_MANY_CODE_REQUESTS");
    expect(trace.some(({ sql }) => sql.startsWith("INSERT"))).toBe(false);
  });

  it("rend le verrou et la connexion quand il refuse", async () => {
    const { lifecycle } = fakeDb(null, MAX_DISCORD_CODES_PER_WINDOW);

    await expect(createDiscordLoginChallenge("123")).rejects.toThrow("TOO_MANY_CODE_REQUESTS");

    // Un verrou nommé survit à la requête : non rendu, il ferait attendre le
    // prochain appelant jusqu'au délai complet.
    expect(lifecycle).toEqual(["GET_LOCK", "RELEASE_LOCK", "RELEASE"]);
  });

  it("compte et insère **sous le verrou du compte**", async () => {
    // La borne était un `SELECT COUNT(*)` puis, un `await` plus loin, un
    // `INSERT` : des demandes lancées de front lisaient toutes le même compte et
    // inséraient chacune leur ligne — autant de codes en jeu, chacun rouvrant
    // cinq essais. L'exclusion elle-même appartient à MySQL, qu'une fausse base
    // ne peut pas imiter ; ce qui se vérifie ici, c'est que le code la demande :
    // un verrou pris, les deux instructions **dedans** et sur sa connexion, le
    // verrou rendu.
    const { trace, lifecycle, connection, execute } = fakeDb(null, 0);

    await createDiscordLoginChallenge("123");

    const count = trace.find(({ sql }) => sql.startsWith("SELECT COUNT(*) AS c"))!;
    const insert = trace.find(({ sql }) => sql.startsWith("INSERT"))!;

    expect(count.origin).toBe("tx");
    expect(insert.origin).toBe("tx");
    expect(lifecycle).toEqual(["GET_LOCK", "RELEASE_LOCK", "RELEASE"]);
    expect(connection.execute.mock.calls.length).toBeGreaterThanOrEqual(2);
    // Ni l'un ni l'autre ne doit repasser par le pool : la connexion empruntée
    // est la seule qui porte le verrou.
    expect(statementsOf(execute).some((q) => q.startsWith("SELECT COUNT(*) AS c"))).toBe(false);
    expect(statementsOf(execute).some((q) => q.startsWith("INSERT"))).toBe(false);
  });

  it("porte le verrou sur **le compte visé**, pas sur la table", async () => {
    // Deux joueurs qui demandent un code au même instant ne s'attendent pas.
    const { connection } = fakeDb(null, 0);

    await createDiscordLoginChallenge("123456789012345678");

    const [, params] = connection.query.mock.calls[0] as [string, unknown[]];
    expect(String(params[0])).toContain("123456789012345678");
  });

  it("refuse comme un plafond quand le verrou ne vient pas", async () => {
    // Cinq secondes d'attente sur un compte dont deux instructions font tout le
    // travail, c'est une avalanche de demandes pour ce compte. On la refuse
    // comme telle plutôt que de rendre une panne interne — et refuser est le
    // sens sûr : passer outre délivrerait un code de plus sans l'avoir compté.
    const { trace } = fakeDb(null, 0, false);

    await expect(createDiscordLoginChallenge("123")).rejects.toThrow("TOO_MANY_CODE_REQUESTS");
    expect(trace.some(({ sql }) => sql.startsWith("INSERT"))).toBe(false);
  });

  it("compte sur la fenêtre annoncée", async () => {
    const { connection } = fakeDb(null, 0);
    await createDiscordLoginChallenge("123");

    const count = connection.execute.mock.calls.find(([sql]) =>
      String(sql)
        .replace(/\s+/g, " ")
        .includes("SELECT COUNT(*) AS c FROM bg_discord_login_challenges"),
    ) as [string, unknown[]];
    expect(count[1]).toEqual(["123", DISCORD_CODE_WINDOW_MINUTES]);
  });

  it("fait le ménage des codes expirés de longue date, hors verrou", async () => {
    // Rien n'effaçait jamais une ligne : la table grossissait d'une ligne par
    // demande, dont celles fabriquées avec des identifiants inventés. Le ménage
    // ne vise aucun compte en particulier : il n'a rien à faire sous un verrou
    // qui, lui, en désigne un.
    const { trace } = fakeDb(null, 0);
    await createDiscordLoginChallenge("123");

    const purge = trace.find(({ sql }) => sql.startsWith("DELETE FROM bg_discord_login_challenges"))!;
    expect(purge.origin).toBe("pool");
  });

  it("ne périme **pas** les codes précédents : il n'y a rien à écrire", async () => {
    // `verifyDiscordChallenge` ne lit que le dernier émis : le précédent est
    // déjà inatteignable, marquer son `consumed_at` ne changerait rien
    // d'observable. Les périmer *avant* l'envoi laissait en revanche le joueur
    // sans code du tout quand le bot était injoignable.
    const { trace } = fakeDb(null, 0);
    await createDiscordLoginChallenge("123");

    expect(
      trace.some(({ sql }) =>
        sql.startsWith("UPDATE bg_discord_login_challenges SET consumed_at = NOW()"),
      ),
    ).toBe(false);
  });

  it("rend un code à six chiffres", async () => {
    fakeDb(null, 0);
    const challenge = await createDiscordLoginChallenge("123");
    expect(challenge.code).toMatch(/^\d{6}$/);
  });
});

describe("discardDiscordChallenge", () => {
  beforeEach(() => jest.clearAllMocks());

  it("supprime la ligne, plutôt que de la marquer consommée", async () => {
    // Le comptage de la fenêtre porte sur `created_at` sans regarder
    // `consumed_at` : un message privé jamais parti dépenserait sinon le budget
    // de codes de la victime. Et c'est la suppression, non la consommation, qui
    // rend au code précédent sa place de dernier émis.
    const { execute } = fakeDb(null, 0);

    await discardDiscordChallenge(42);

    const [sql, params] = execute.mock.calls[0] as [string, unknown[]];
    expect(String(sql).replace(/\s+/g, " ")).toContain(
      "DELETE FROM bg_discord_login_challenges WHERE id = ?",
    );
    expect(params).toEqual([42]);
  });
});
