import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";

jest.mock("@/lib/server/database");

import {
  createOrGetBlizzardUser,
  createOrGetDiscordUser,
  getUserIdByPseudo,
  setUserRoles,
  updateOwnProfile,
} from "@/lib/server/users-service";

/**
 * Ce qu'une ligne morte ne doit plus accepter ni fournir.
 *
 * L'anonymisation est **irréversible** et sans recours : elle promet qu'un
 * pseudo, un BattleTag et un tag Discord ont disparu du site. Deux chemins la
 * contredisaient en silence, et aucun ne rend d'erreur observable.
 *
 * 1. **La sauvegarde du profil**, partie avant la suppression, se bloque sur le
 *    verrou de `deleteOwnAccount` et reprend après son commit : sans
 *    `is_deleted = 0`, elle reposait l'identité réelle sur la ligne anonymisée,
 *    puis `syncSoloEntryIdentity` la republiait jusque dans les brackets.
 * 2. **La résolution d'un pseudo** rendait encore le compte mort : son pseudo
 *    `compte_supprime_<id>` existe toujours, donc il restait invitable dans une
 *    équipe — et, par la reprise d'une fantôme, il pouvait en devenir
 *    propriétaire sans personne pour ouvrir la session qui l'administre.
 */

/**
 * Le pool, avec une connexion distincte pour la resynchronisation solo.
 *
 * `getConnection` est rendu observable : c'est par lui, et par lui seul, que
 * passe `syncSoloEntryIdentity` — le témoin le plus direct qu'une identité a
 * été (ou non) republiée dans les brackets.
 */
async function mockDb(execute: jest.Mock) {
  const { getDatabase } = await import("@/lib/server/database");
  const getConnection = jest.fn(async () => ({
    execute: jest.fn<() => Promise<unknown>>().mockResolvedValue([[], []]),
    release: () => undefined,
  }));
  (getDatabase as jest.Mock).mockResolvedValue({ execute, getConnection } as never);
  return getConnection;
}

describe("updateOwnProfile — une ligne supprimée n'accepte plus rien", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("borne l'écriture aux comptes vivants", async () => {
    const execute = jest.fn().mockResolvedValue([{ affectedRows: 1 }] as never);
    await mockDb(execute);

    await updateOwnProfile(42, { pseudo: "Nova" });

    const update = (execute.mock.calls as [string, unknown[]][]).find(([sql]) =>
      /UPDATE bg_users/.test(sql),
    );
    expect(update).toBeDefined();
    expect(update![0]).toMatch(/WHERE id = \? AND is_deleted = 0/);
  });

  it("refuse la sauvegarde arrivée après l'anonymisation", async () => {
    // `affectedRows` compte les lignes **appariées** (mysql2 pose `FOUND_ROWS`) :
    // zéro ne dit pas « rien n'a changé » mais « aucune ligne vivante ».
    const execute = jest.fn().mockResolvedValue([{ affectedRows: 0 }] as never);
    await mockDb(execute);

    await expect(updateOwnProfile(42, { pseudo: "Nova" })).rejects.toThrow("ACCOUNT_DELETED");
  });

  it("ne republie pas l'identité de l'entrée solo quand l'écriture est refusée", async () => {
    const execute = jest.fn().mockResolvedValue([{ affectedRows: 0 }] as never);
    const getConnection = await mockDb(execute);

    await expect(updateOwnProfile(42, { pseudo: "Nova" })).rejects.toThrow("ACCOUNT_DELETED");

    // Sans ce refus, le pseudo réel repartait vers le logo et le nom de l'entrée
    // solo — c'est-à-dire jusqu'à la carte de match en direct de la vitrine,
    // que lit un visiteur sans compte.
    expect(getConnection).not.toHaveBeenCalled();
  });

  it("laisse passer une sauvegarde ordinaire, resynchronisation comprise", async () => {
    const execute = jest.fn().mockResolvedValue([{ affectedRows: 1 }] as never);
    const getConnection = await mockDb(execute);

    await expect(updateOwnProfile(42, { pseudo: "Nova" })).resolves.toBeUndefined();
    expect(getConnection).toHaveBeenCalled();
  });
});

describe("getUserIdByPseudo — un compte supprimé ne se rattache plus", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("écarte les lignes mortes en base, pas côté appelant", async () => {
    const execute = jest.fn().mockResolvedValue([[{ id: 7 }]] as never);
    await mockDb(execute);

    await getUserIdByPseudo("Nova");

    const [sql] = execute.mock.calls[0] as [string];
    expect(sql).toMatch(/is_deleted = 0/);
  });

  it("rend null quand aucune ligne vivante ne porte le pseudo", async () => {
    const execute = jest.fn().mockResolvedValue([[]] as never);
    await mockDb(execute);

    // `null` est exactement ce que les deux appelants traduisent en
    // `USER_NOT_FOUND` : rien à apprendre de plus chez eux.
    await expect(getUserIdByPseudo("compte_supprime_412")).resolves.toBeNull();
  });
});

describe("setUserRoles — la course se dit, elle ne se tait pas", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("refuse le rôle posé sur une ligne morte au lieu de l'annoncer enregistré", async () => {
    // Le `SELECT` trouve un compte vivant, la suppression se glisse dans le
    // `await`, l'`UPDATE` n'apparie plus rien. Sans ce refus, l'écran
    // d'administration affichait les rôles comme sauvegardés alors qu'aucune
    // ligne n'avait bougé.
    const execute = jest
      .fn()
      .mockResolvedValueOnce([[{ id: 7 }]] as never)
      .mockResolvedValueOnce([{ affectedRows: 0 }] as never);
    await mockDb(execute);

    await expect(setUserRoles(7, ["ARBITRE"])).rejects.toThrow("USER_NOT_FOUND");
  });

  it("rend les rôles normalisés quand l'écriture a bien apparié la ligne", async () => {
    const execute = jest
      .fn()
      .mockResolvedValueOnce([[{ id: 7 }]] as never)
      .mockResolvedValueOnce([{ affectedRows: 1 }] as never);
    await mockDb(execute);

    await expect(setUserRoles(7, ["ARBITRE"])).resolves.toEqual(["ARBITRE"]);

    const [sql] = execute.mock.calls[1] as [string];
    expect(sql).toMatch(/WHERE id = \? AND is_deleted = 0/);
  });
});

/**
 * Les **connexions** aussi arrivent après le commit de la suppression.
 *
 * Ces deux chemins résolvent leur compte sur une identité de fournisseur
 * (`discord_id`, `blizzard_sub`) que l'anonymisation vient de mettre à `NULL` :
 * une connexion déjà partie a lu l'identifiant d'avant, et son écriture retombe
 * sur la ligne vidée. C'est la même course que la sauvegarde de profil, mais
 * par la porte d'entrée, et pas la moins chère des deux — la branche Discord
 * **recertifie** le tag qu'elle réécrit, et `canViewDiscordTag` rouvre alors
 * une coordonnée à l'arbitrage de tout tournoi encore vivant où l'engagé
 * anonymisé figure.
 *
 * La session ouverte dans la foulée, elle, n'est pas le sujet : `getCurrentUser`
 * et la lecture par jeton portent déjà `is_deleted = 0`.
 */
describe("connexions OAuth — une ligne supprimée ne reprend pas son identité", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("Discord : ne réécrit ni le tag ni sa certification sur un compte mort", async () => {
    // Le `SELECT` a résolu le compte avant la suppression ; l'`UPDATE` arrive
    // après son commit.
    const execute = jest
      .fn()
      .mockResolvedValueOnce([[{ id: 412 }], []] as never) // compte résolu sur discord_id
      .mockResolvedValue([{ affectedRows: 0 }] as never);
    await mockDb(execute);

    await createOrGetDiscordUser("100000000000000001", undefined, "nova");

    const update = execute.mock.calls.find(([sql]) =>
      String(sql).includes("discord_verified_at = NOW()"),
    ) as [string, unknown[]];
    expect(update).toBeDefined();
    expect(update[0]).toMatch(/is_deleted = 0/);
  });

  it("Blizzard : ne repose pas le BattleTag sur un compte mort", async () => {
    const execute = jest
      .fn()
      .mockResolvedValueOnce([[{ id: 412 }], []] as never) // compte résolu sur blizzard_sub
      .mockResolvedValue([{ affectedRows: 0 }] as never);
    await mockDb(execute);

    await createOrGetBlizzardUser("sub-412", "Nova#2143");

    const update = execute.mock.calls.find(([sql]) =>
      String(sql).includes("SET overwatch_battletag = ?"),
    ) as [string, unknown[]];
    expect(update).toBeDefined();
    expect(update[0]).toMatch(/is_deleted = 0/);
  });

  it("ne laisse plus aucune écriture de `bg_users` sans sa garde", () => {
    // Le contrôle qui tient vraiment : la règle est « toute écriture sur
    // `bg_users` porte `is_deleted = 0` », et elle se perd au prochain chemin
    // ajouté si rien ne la relit en bloc. Trois exceptions nommées, et elles
    // seules — l'anonymisation *pose* le drapeau, la migration de démarrage
    // rattrape des colonnes de visibilité, et le rapatriement d'avatars ne
    // sélectionne que des URL distantes, qu'une ligne anonymisée n'a plus.
    const source = readFileSync(
      join(__dirname, "..", "..", "..", "lib", "server", "users-service.ts"),
      "utf8",
    );
    const writes = [...source.matchAll(/UPDATE bg_users\b[\s\S]{0,400}?`/g)].map((m) => m[0]);
    expect(writes.length).toBeGreaterThanOrEqual(5);
    for (const write of writes) {
      // `anonymizeAccount` est celle qui écrit `is_deleted = 1` : elle ne peut
      // pas se garder elle-même.
      if (write.includes("is_deleted = 1")) continue;
      expect(write).toMatch(/is_deleted = 0/);
    }
  });
});
