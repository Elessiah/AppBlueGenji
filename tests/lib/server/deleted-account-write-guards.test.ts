import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/database");

import { getUserIdByPseudo, updateOwnProfile } from "@/lib/server/users-service";

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
  (getDatabase as jest.Mock).mockResolvedValue({ execute, getConnection });
  return getConnection;
}

describe("updateOwnProfile — une ligne supprimée n'accepte plus rien", () => {
  beforeEach(() => jest.clearAllMocks());
  afterEach(() => jest.restoreAllMocks());

  it("borne l'écriture aux comptes vivants", async () => {
    const execute = jest.fn().mockResolvedValue([{ affectedRows: 1 }]);
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
    const execute = jest.fn().mockResolvedValue([{ affectedRows: 0 }]);
    await mockDb(execute);

    await expect(updateOwnProfile(42, { pseudo: "Nova" })).rejects.toThrow("ACCOUNT_DELETED");
  });

  it("ne republie pas l'identité de l'entrée solo quand l'écriture est refusée", async () => {
    const execute = jest.fn().mockResolvedValue([{ affectedRows: 0 }]);
    const getConnection = await mockDb(execute);

    await expect(updateOwnProfile(42, { pseudo: "Nova" })).rejects.toThrow("ACCOUNT_DELETED");

    // Sans ce refus, le pseudo réel repartait vers le logo et le nom de l'entrée
    // solo — c'est-à-dire jusqu'à la carte de match en direct de la vitrine,
    // que lit un visiteur sans compte.
    expect(getConnection).not.toHaveBeenCalled();
  });

  it("laisse passer une sauvegarde ordinaire, resynchronisation comprise", async () => {
    const execute = jest.fn().mockResolvedValue([{ affectedRows: 1 }]);
    const getConnection = await mockDb(execute);

    await expect(updateOwnProfile(42, { pseudo: "Nova" })).resolves.toBeUndefined();
    expect(getConnection).toHaveBeenCalled();
  });
});

describe("getUserIdByPseudo — un compte supprimé ne se rattache plus", () => {
  beforeEach(() => jest.clearAllMocks());
  afterEach(() => jest.restoreAllMocks());

  it("écarte les lignes mortes en base, pas côté appelant", async () => {
    const execute = jest.fn().mockResolvedValue([[{ id: 7 }]]);
    await mockDb(execute);

    await getUserIdByPseudo("Nova");

    const [sql] = execute.mock.calls[0] as [string];
    expect(sql).toMatch(/is_deleted = 0/);
  });

  it("rend null quand aucune ligne vivante ne porte le pseudo", async () => {
    const execute = jest.fn().mockResolvedValue([[]]);
    await mockDb(execute);

    // `null` est exactement ce que les deux appelants traduisent en
    // `USER_NOT_FOUND` : rien à apprendre de plus chez eux.
    await expect(getUserIdByPseudo("compte_supprime_412")).resolves.toBeNull();
  });
});
