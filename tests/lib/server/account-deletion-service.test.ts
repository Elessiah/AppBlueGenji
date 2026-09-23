import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/database");
jest.mock("@/lib/server/solo-entries-service");
jest.mock("@/lib/server/stats-service");
jest.mock("@/lib/server/image-upload");

import { deleteOwnAccount, getAccountDeletionPlan } from "@/lib/server/users-service";
import { getDatabase } from "@/lib/server/database";
import { deleteStoredImage } from "@/lib/server/image-upload";
import { fakePool } from "../../helpers/sql-double";

/**
 * L'écriture de la suppression : ce qu'elle efface, ce qu'elle garde, et ce
 * qu'elle refuse d'effacer.
 *
 * Le mode est décidé par le module pur ; ce qui se teste ici, c'est la **lecture
 * des traces** et les gestes qui en découlent — notamment ceux qu'aucune
 * cascade ne fait : `bg_site_visits` n'a pas de clé étrangère (une cascade y
 * effacerait l'historique de fréquentation), donc c'est le lien vers la personne
 * qu'il faut retirer à la main.
 */
type Query = { sql: string; params: unknown[] };

type Trace = { tournaments: number; organized: number; owned: number };

/**
 * La base, et la transaction qui la porte.
 *
 * L'écriture passe par une connexion dédiée : c'est elle qui tient le verrou et
 * la transaction, et le test doit pouvoir dire qu'elle a bien été ouverte,
 * commitée — ou annulée, quand une écriture échoue.
 */
function fakeDb(
  trace: Trace,
  options: {
    avatarUrl?: string | null;
    discordId?: string | null;
    missing?: boolean;
    failOn?: string;
    failWith?: Error;
  } = {},
) {
  const queries: Query[] = [];
  const avatarUrl = options.avatarUrl ?? null;

  const execute = jest.fn(async (sql: string, params: unknown[] = []) => {
    const q = String(sql).replace(/\s+/g, " ").trim();
    queries.push({ sql: q, params });
    if (options.failOn && q.includes(options.failOn)) {
      throw options.failWith ?? new Error("DB_DOWN");
    }
    if (q.includes("AS tournaments")) return [[trace]];
    if (q.includes("SELECT avatar_url, discord_id, created_at FROM bg_users")) {
      return [
        options.missing ? [] : [{ avatar_url: avatarUrl, discord_id: options.discordId ?? null, created_at: "2026-01-02 03:04:05" }],
      ];
    }
    return [[]];
  });

  const connection = {
    execute,
    beginTransaction: jest.fn(async () => {}),
    commit: jest.fn(async () => {}),
    rollback: jest.fn(async () => {}),
    release: jest.fn(() => {}),
  };

  jest.mocked(getDatabase).mockResolvedValue(fakePool({
    execute,
    getConnection: jest.fn(async () => connection),
  }));
  return { queries, connection };
}

const has = (queries: Query[], needle: string) => queries.some((q) => q.sql.includes(needle));

const EMPTY = { tournaments: 0, organized: 0, owned: 0 };

beforeEach(() => {
  jest.clearAllMocks();
});

describe("deleteOwnAccount — effacement complet", () => {
  it("efface la ligne d'un compte qui n'a rien laissé", async () => {
    const { queries } = fakeDb(EMPTY);

    expect(await deleteOwnAccount(7)).toEqual({ mode: "ERASE", reason: null });
    expect(has(queries, "DELETE FROM bg_users")).toBe(true);
    expect(has(queries, "UPDATE bg_users SET pseudo")).toBe(false);
  });

  it("ne touche pas aux visites : elles ne désignent aucun compte", async () => {
    // `bg_site_visits` ne garde qu'une empreinte salée, sans `user_id` : il n'y
    // a plus de lien à détacher, et les visites restent comptées.
    const { queries } = fakeDb(EMPTY);

    await deleteOwnAccount(7);

    expect(has(queries, "bg_site_visits")).toBe(false);
  });

  it("ne resynchronise aucune entrée solo — un compte effaçable n'en a pas", async () => {
    const { queries } = fakeDb(EMPTY);

    await deleteOwnAccount(7);

    expect(has(queries, "compte_supprime_")).toBe(false);
  });
});

describe("deleteOwnAccount — traces qui retiennent la ligne", () => {
  it.each([
    ["un tournoi joué", { ...EMPTY, tournaments: 1 }, "TOURNAMENTS"],
    ["un tournoi organisé", { ...EMPTY, organized: 1 }, "ORGANIZED_TOURNAMENTS"],
    ["une équipe possédée", { ...EMPTY, owned: 1 }, "OWNED_TEAMS"],
  ])("anonymise sur %s, et le dit", async (_label, trace, reason) => {
    const { queries } = fakeDb(trace);

    // Le motif remonte jusqu'à l'écran : « tes statistiques restent » ne veut
    // rien dire à qui n'en a aucune.
    expect(await deleteOwnAccount(7)).toEqual({ mode: "ANONYMIZE", reason });
    expect(has(queries, "DELETE FROM bg_users")).toBe(false);
    expect(has(queries, "compte_supprime_")).toBe(true);
  });

  it("ferme les sessions de la ligne anonymisée", async () => {
    const { queries } = fakeDb({ ...EMPTY, tournaments: 1 });

    await deleteOwnAccount(7);

    expect(has(queries, "DELETE FROM bg_user_sessions")).toBe(true);
  });

  /**
   * Le dernier chemin par lequel un compte supprimé rejoignait une équipe
   * vivante. Une demande d'adhésion déposée avant la suppression reste visible
   * du gérant ; l'accepter passe par `respondToInvitation`, qui travaille sur un
   * identifiant et non sur un pseudo — le filtre de `getUserIdByPseudo` ne
   * l'atteint pas. Le compte réapparaissait au roster et « avec équipe » à
   * l'annuaire.
   */
  it("annule les invitations et demandes restées en attente", async () => {
    const { queries } = fakeDb({ ...EMPTY, tournaments: 1 });

    await deleteOwnAccount(7);

    const cancel = queries.find((q) => q.sql.includes("bg_team_invitations"));
    expect(cancel).toBeDefined();
    expect(cancel!.sql).toContain("status = 'CANCELLED'");
    expect(cancel!.sql).toContain("status = 'PENDING'");
    expect(cancel!.params).toEqual([7]);
  });

  it("annule dans la transaction, jamais après le commit", async () => {
    const { queries, connection } = fakeDb({ ...EMPTY, tournaments: 1 });

    await deleteOwnAccount(7);

    // Les requêtes relevées sont celles de la connexion verrouillée ; le commit
    // vient après la dernière d'entre elles.
    expect(has(queries, "bg_team_invitations")).toBe(true);
    expect(connection.commit).toHaveBeenCalled();
  });

  it("laisse la cascade faire le ménage d'un effacement complet", async () => {
    const { queries } = fakeDb(EMPTY);

    await deleteOwnAccount(7);

    // `fk_bg_team_inv_user` est en `ON DELETE CASCADE` : écrire ici serait une
    // instruction de plus sur une table qui disparaît avec la ligne.
    expect(has(queries, "bg_team_invitations")).toBe(false);
  });
});

/**
 * `bg_discord_login_challenges` n'a **aucune clé étrangère** : elle est indexée
 * sur un identifiant Discord, pas sur un compte du site. Aucune cascade ne la
 * couvre, et son seul ménage est la purge des lignes expirées depuis un jour,
 * déclenchée par la demande de code d'un *autre* joueur — un soir calme,
 * l'identifiant Discord d'un compte effacé restait en base indéfiniment, alors
 * que la confirmation promet « sans laisser de trace sur le site ».
 */
describe("deleteOwnAccount — les défis de connexion par message privé", () => {
  it.each([
    ["un compte effacé", EMPTY],
    ["un compte anonymisé", { ...EMPTY, tournaments: 1 }],
  ])("efface les défis portant l'identifiant Discord (%s)", async (_label, trace) => {
    const { queries } = fakeDb(trace, { discordId: "900000000000000001" });

    await deleteOwnAccount(7);

    const purge = queries.find((q) => q.sql.includes("bg_discord_login_challenges"));
    expect(purge).toBeDefined();
    expect(purge!.sql).toContain("DELETE FROM bg_discord_login_challenges");
    expect(purge!.params).toEqual(["900000000000000001"]);
  });

  it("relève l'identifiant sous le verrou, avant que la ligne ne le perde", async () => {
    const { queries } = fakeDb(EMPTY, { discordId: "900000000000000001" });

    await deleteOwnAccount(7);

    // La lecture verrouillante rend l'identifiant en même temps que l'avatar :
    // une seconde lecture, après l'écriture, ne trouverait plus rien — la ligne
    // est partie (effacement) ou vidée de son `discord_id` (anonymisation).
    const locked = queries.findIndex((q) => q.sql.includes("FOR UPDATE"));
    expect(locked).toBe(0);
    expect(queries[0].sql).toContain("discord_id");
  });

  it("n'écrit rien quand le compte n'a jamais eu de Discord", async () => {
    const { queries } = fakeDb(EMPTY);

    await deleteOwnAccount(7);

    expect(has(queries, "bg_discord_login_challenges")).toBe(false);
  });

  it("efface dans la transaction : un rollback ne doit pas les avoir perdus", async () => {
    const { queries, connection } = fakeDb(EMPTY, { discordId: "900000000000000001" });

    await deleteOwnAccount(7);

    expect(has(queries, "bg_discord_login_challenges")).toBe(true);
    expect(connection.commit).toHaveBeenCalled();
    expect(connection.rollback).not.toHaveBeenCalled();
  });
});

describe("loadAccountTrace — ce qu'on interroge", () => {
  it("compte l'entrée solo par elle-même : aucune cascade ne la couvre", async () => {
    const { queries } = fakeDb(EMPTY);

    await deleteOwnAccount(7);

    const trace = queries.find((q) => q.sql.includes("AS tournaments"))!;
    expect(trace.sql).toContain("FROM bg_teams WHERE solo_user_id = ?");
  });

  it("écarte les équipes dissoutes et les appartenances closes du critère OWNER", async () => {
    const { queries } = fakeDb(EMPTY);

    await deleteOwnAccount(7);

    const trace = queries.find((q) => q.sql.includes("AS tournaments"))!;
    expect(trace.sql).toContain("t.deleted_at IS NULL");
    expect(trace.sql).toContain("m.left_at IS NULL");
  });

  it("retient toute appartenance, close comprise, pour l'engagement en tournoi", async () => {
    const { queries } = fakeDb(EMPTY);

    await deleteOwnAccount(7);

    const trace = queries.find((q) => q.sql.includes("AS tournaments"))!;
    const engagement = trace.sql.slice(0, trace.sql.indexOf("AS tournaments"));
    expect(engagement).toContain("bg_tournament_registrations");
    expect(engagement).not.toContain("left_at");
  });

  it("pose les trois questions en une requête — un await entre elles les désaccorderait", async () => {
    const { queries } = fakeDb(EMPTY);

    await getAccountDeletionPlan(7);

    expect(queries).toHaveLength(1);
    expect(queries[0].sql).toContain("AS organized");
    expect(queries[0].sql).toContain("AS owned");
  });

  it("est lue **après** le verrou : avant lui, elle daterait d'avant l'attente", async () => {
    const { queries } = fakeDb(EMPTY);

    await deleteOwnAccount(7);

    const lock = queries.findIndex((q) => q.sql.includes("FOR UPDATE"));
    const trace = queries.findIndex((q) => q.sql.includes("AS tournaments"));
    expect(lock).toBe(0);
    expect(trace).toBeGreaterThan(lock);
  });
});

describe("getAccountDeletionPlan", () => {
  it("n'écrit rien", async () => {
    const { queries } = fakeDb(EMPTY);

    expect(await getAccountDeletionPlan(7)).toEqual({ mode: "ERASE", reason: null });
    expect(queries.every((q) => q.sql.startsWith("SELECT"))).toBe(true);
  });
});

describe("deleteOwnAccount — transaction et verrou", () => {
  it("ouvre une transaction, verrouille la ligne du compte, puis commite", async () => {
    const { queries, connection } = fakeDb(EMPTY);

    await deleteOwnAccount(7);

    expect(connection.beginTransaction).toHaveBeenCalled();
    expect(queries[0].sql).toContain("FOR UPDATE");
    expect(queries[0].sql).toContain("FROM bg_users");
    expect(connection.commit).toHaveBeenCalled();
    expect(connection.rollback).not.toHaveBeenCalled();
    expect(connection.release).toHaveBeenCalled();
  });

  it("annule tout si l'effacement échoue — jamais de visites détachées sans compte effacé", async () => {
    const { connection } = fakeDb(EMPTY, { failOn: "DELETE FROM bg_users" });

    await expect(deleteOwnAccount(7)).rejects.toThrow("DB_DOWN");

    expect(connection.commit).not.toHaveBeenCalled();
    expect(connection.rollback).toHaveBeenCalled();
    expect(connection.release).toHaveBeenCalled();
  });

  it("refuse un compte disparu plutôt que d'écrire à vide", async () => {
    const { connection } = fakeDb(EMPTY, { missing: true });

    await expect(deleteOwnAccount(7)).rejects.toThrow("USER_NOT_FOUND");

    expect(connection.rollback).toHaveBeenCalled();
  });
});

describe("deleteOwnAccount — le fichier de l'avatar", () => {
  it("efface la photo d'un compte effacé : sa ligne partie, plus rien ne la désigne", async () => {
    const { connection } = fakeDb(EMPTY, { avatarUrl: "/api/uploads/avatars/7-ab.webp" });

    await deleteOwnAccount(7);

    expect(deleteStoredImage).toHaveBeenCalledWith("/uploads/avatars/7-ab.webp");
    // Après le commit : un `unlink` ne se défait pas.
    expect(connection.commit).toHaveBeenCalled();
  });

  it("efface aussi la photo d'un compte anonymisé — `avatar_url` passe à NULL", async () => {
    fakeDb({ ...EMPTY, tournaments: 1 }, { avatarUrl: "/api/uploads/avatars/7-cd.webp" });

    await deleteOwnAccount(7);

    expect(deleteStoredImage).toHaveBeenCalledWith("/uploads/avatars/7-cd.webp");
  });

  it("ne touche à rien quand la photo n'est pas un fichier à nous", async () => {
    fakeDb(EMPTY, { avatarUrl: "https://exemple.invalid/photo.png" });

    await deleteOwnAccount(7);

    expect(deleteStoredImage).toHaveBeenCalledWith(null);
  });

  it("ne garde pas la photo si l'écriture est annulée", async () => {
    fakeDb(EMPTY, {
      avatarUrl: "/api/uploads/avatars/7-ef.webp",
      failOn: "DELETE FROM bg_users",
    });

    await expect(deleteOwnAccount(7)).rejects.toThrow("DB_DOWN");

    expect(deleteStoredImage).not.toHaveBeenCalled();
  });

  it("un disque récalcitrant ne fait pas échouer une suppression commitée", async () => {
    jest.mocked(deleteStoredImage).mockImplementation(() => {
      throw new Error("EACCES");
    });
    fakeDb(EMPTY, { avatarUrl: "/api/uploads/avatars/7-gh.webp" });

    await expect(deleteOwnAccount(7)).resolves.toEqual({ mode: "ERASE", reason: null });
  });
});

describe("deleteOwnAccount — un refus de la base ne part pas tel quel", () => {
  /** Ce que MySQL rend quand une clé étrangère en `RESTRICT` retient la ligne. */
  function referencedRow(): Error {
    const error = new Error(
      "Cannot delete or update a parent row: a foreign key constraint fails " +
        "(`bluegenji`.`bg_tournaments`, CONSTRAINT `fk_bg_tournaments_organizer` ...)",
    ) as Error & { code: string };
    error.code = "ER_ROW_IS_REFERENCED_2";
    return error;
  }

  it("rend un code stable plutôt que le message de MySQL", async () => {
    // Le contrôle de clé étrangère lit la dernière version commitée et non
    // l'instantané : un tournoi créé après la lecture des traces retient la
    // ligne, et la route rend le message de l'erreur telle quelle.
    fakeDb(EMPTY, { failOn: "DELETE FROM bg_users", failWith: referencedRow() });

    await expect(deleteOwnAccount(7)).rejects.toThrow("ACCOUNT_STILL_REFERENCED");
  });

  it("n'en fait pas un fourre-tout : une autre panne remonte telle quelle", async () => {
    fakeDb(EMPTY, { failOn: "DELETE FROM bg_users" });

    await expect(deleteOwnAccount(7)).rejects.toThrow("DB_DOWN");
  });

  it("annule tout de même la transaction", async () => {
    const { connection } = fakeDb(EMPTY, {
      failOn: "DELETE FROM bg_users",
      failWith: referencedRow(),
    });

    await expect(deleteOwnAccount(7)).rejects.toThrow();

    expect(connection.rollback).toHaveBeenCalled();
    expect(connection.commit).not.toHaveBeenCalled();
  });
});
