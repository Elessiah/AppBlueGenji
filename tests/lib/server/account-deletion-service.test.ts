import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/database");
jest.mock("@/lib/server/solo-entries-service");
jest.mock("@/lib/server/stats-service");

import { deleteOwnAccount, getAccountDeletionMode } from "@/lib/server/users-service";
import { getDatabase } from "@/lib/server/database";

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

function fakeDb(trace: { tournaments: number; organized: number; owned: number }) {
  const queries: Query[] = [];
  const execute = jest.fn(async (sql: string, params: unknown[] = []) => {
    const q = String(sql).replace(/\s+/g, " ").trim();
    queries.push({ sql: q, params });
    if (q.includes("AS tournaments")) return [[trace]];
    return [[]];
  });
  (getDatabase as jest.Mock).mockResolvedValue({ execute } as never);
  return { queries };
}

const has = (queries: Query[], needle: string) => queries.some((q) => q.sql.includes(needle));

const EMPTY = { tournaments: 0, organized: 0, owned: 0 };

beforeEach(() => jest.clearAllMocks());

describe("deleteOwnAccount — effacement complet", () => {
  it("efface la ligne d'un compte qui n'a rien laissé", async () => {
    const { queries } = fakeDb(EMPTY);

    expect(await deleteOwnAccount(7)).toBe("ERASE");
    expect(has(queries, "DELETE FROM bg_users")).toBe(true);
    expect(has(queries, "UPDATE bg_users SET pseudo")).toBe(false);
  });

  it("détache les visites plutôt que de les effacer — la page a bien été vue", async () => {
    const { queries } = fakeDb(EMPTY);

    await deleteOwnAccount(7);

    expect(has(queries, "UPDATE bg_site_visits SET user_id = NULL")).toBe(true);
    expect(has(queries, "DELETE FROM bg_site_visits")).toBe(false);
  });

  it("détache les visites **avant** d'effacer le compte", async () => {
    const { queries } = fakeDb(EMPTY);

    await deleteOwnAccount(7);

    const visits = queries.findIndex((q) => q.sql.includes("bg_site_visits"));
    const user = queries.findIndex((q) => q.sql.includes("DELETE FROM bg_users"));
    expect(visits).toBeGreaterThanOrEqual(0);
    expect(user).toBeGreaterThan(visits);
  });

  it("ne resynchronise aucune entrée solo — un compte effaçable n'en a pas", async () => {
    const { queries } = fakeDb(EMPTY);

    await deleteOwnAccount(7);

    expect(has(queries, "compte_supprime_")).toBe(false);
  });
});

describe("deleteOwnAccount — traces qui retiennent la ligne", () => {
  it.each([
    ["un tournoi joué", { ...EMPTY, tournaments: 1 }],
    ["un tournoi organisé", { ...EMPTY, organized: 1 }],
    ["une équipe possédée", { ...EMPTY, owned: 1 }],
  ])("anonymise sur %s", async (_label, trace) => {
    const { queries } = fakeDb(trace);

    expect(await deleteOwnAccount(7)).toBe("ANONYMIZE");
    expect(has(queries, "DELETE FROM bg_users")).toBe(false);
    expect(has(queries, "compte_supprime_")).toBe(true);
  });

  it("ferme les sessions de la ligne anonymisée", async () => {
    const { queries } = fakeDb({ ...EMPTY, tournaments: 1 });

    await deleteOwnAccount(7);

    expect(has(queries, "DELETE FROM bg_user_sessions")).toBe(true);
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

    await getAccountDeletionMode(7);

    expect(queries).toHaveLength(1);
    expect(queries[0].sql).toContain("AS organized");
    expect(queries[0].sql).toContain("AS owned");
  });
});

describe("getAccountDeletionMode", () => {
  it("n'écrit rien", async () => {
    const { queries } = fakeDb(EMPTY);

    expect(await getAccountDeletionMode(7)).toBe("ERASE");
    expect(queries.every((q) => q.sql.startsWith("SELECT"))).toBe(true);
  });
});
