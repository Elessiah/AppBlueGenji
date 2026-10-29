import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { createAboutPillar, listAboutPillars } from "@/lib/server/about-pillars-service";
import { createAboutStat, updateAboutStat } from "@/lib/server/about-stats-service";
import { createBenevole, updateBenevole } from "@/lib/server/benevoles-service";
import { createBureauMember, listBureauMembers, updateBureauMember } from "@/lib/server/bureau-service";
import { clearCache } from "@/lib/server/cache";
import { createRecruitmentAd, getRecruitmentSpotlight, listRecruitmentAds } from "@/lib/server/recruitment-service";
import { createSponsor } from "@/lib/server/sponsors-service";
import { type SqlMock, type SqlQuery, fakePool } from "../../helpers/sql-double";

/**
 * Lot 5b de l'i18n : l'anglais des contenus saisis par le staff
 * (`lib/shared/staff-translation.ts`) — écrit dans sa colonne `<colonne>_en`,
 * relu avec le français, obligatoire à l'écriture (refus **avant** la base),
 * et une annonce sans anglais retirée de la mise en avant anglaise.
 */
jest.mock("@/lib/server/database");

async function mockDb(execute: SqlMock) {
  const { getDatabase } = await import("@/lib/server/database");
  jest.mocked(getDatabase).mockResolvedValue(fakePool({ execute }));
}

beforeEach(() => {
  jest.clearAllMocks();
  clearCache();
});
afterEach(() => {
  clearCache();
  jest.restoreAllMocks();
});

describe("écriture — l'anglais est obligatoire, refusé avant toute requête", () => {
  it.each([
    ["bureau", () => createBureauMember({ name: "Léo", role: "Président" }), "ROLE_EN_REQUIRED"],
    ["chiffre", () => createAboutStat({ value: "12", label: "Arbitres" }), "LABEL_EN_REQUIRED"],
    ["carte « À propos »", () => createAboutPillar({ title: "T", text: "X", titleEn: "T" }), "TEXT_EN_REQUIRED"],
    [
      "bénévole",
      () => createBenevole({ firstName: "A", lastName: "B", category: "Arbitre", joinedAt: "2024-01-01" }),
      "CATEGORY_EN_REQUIRED",
    ],
    ["partenaire décrit", () => createSponsor({ name: "N", description: "Boutique" }), "DESCRIPTION_EN_REQUIRED"],
    ["annonce", () => createRecruitmentAd({ title: "Arbitres", titleEn: "Referees", body: "Texte" }), "BODY_EN_REQUIRED"],
  ])("%s", async (_name, write, code) => {
    const execute = jest.fn<SqlQuery>();
    await mockDb(execute);
    await expect(write()).rejects.toThrow(code);
    expect(execute).not.toHaveBeenCalled();
  });
});

describe("écriture — l'anglais va dans sa colonne", () => {
  it("bureau : role_en", async () => {
    const execute = jest.fn<SqlQuery>().mockResolvedValue([{ insertId: 3, affectedRows: 1 }]);
    await mockDb(execute);
    const member = await createBureauMember({ name: "Léo", role: "Président", roleEn: " President " });
    expect(member.roleEn).toBe("President");
    const [sql, values] = execute.mock.calls[0];
    expect(String(sql)).toContain("role_en");
    expect(values).toContain("President");

    await updateBureauMember(3, { name: "Léo", role: "Président", roleEn: "Chair" });
    expect(String(execute.mock.calls[1][0])).toContain("role_en = ?");
    expect(execute.mock.calls[1][1]).toContain("Chair");
  });

  it("chiffre : label_en", async () => {
    const execute = jest.fn<SqlQuery>().mockResolvedValue([{ insertId: 4, affectedRows: 1 }]);
    await mockDb(execute);
    await createAboutStat({ value: "12", label: "Arbitres", labelEn: "Referees" });
    expect(String(execute.mock.calls[0][0])).toContain("label_en");
    await updateAboutStat(4, { value: "12", label: "Arbitres", labelEn: "Refs" });
    expect(execute.mock.calls[1][1]).toEqual(["12", "Arbitres", "Refs", 4]);
  });

  it("partenaire : description_en (rien sans description)", async () => {
    const execute = jest.fn<SqlQuery>().mockResolvedValueOnce([[]]).mockResolvedValue([{ insertId: 5 }]);
    await mockDb(execute);
    const sponsor = await createSponsor({ name: "Shop", description: "Boutique", descriptionEn: "Store" });
    expect(sponsor.descriptionEn).toBe("Store");
    const insert = execute.mock.calls.find(([sql]) => String(sql).includes("INSERT"));
    expect(String(insert?.[0])).toContain("description_en");
  });

  it("annonce : title_en, roles_en, body_en", async () => {
    const execute = jest.fn<SqlQuery>().mockResolvedValue([{ insertId: 6 }]);
    await mockDb(execute);
    const ad = await createRecruitmentAd({ title: "Arbitres", titleEn: "Referees", roles: "Arbitrer", rolesEn: "Referee" });
    expect([ad.titleEn, ad.rolesEn, ad.bodyEn]).toEqual(["Referees", "Referee", null]);
    expect(String(execute.mock.calls[0][0])).toMatch(/title_en, roles_en, body_en/);
  });

  it("bénévole : category_en, recopié sur toute la catégorie", async () => {
    const execute = jest
      .fn<SqlQuery>()
      .mockResolvedValueOnce([[{ category_order: 10 }]]) // ordre de la catégorie
      .mockResolvedValueOnce([{ insertId: 7 }]) // INSERT
      .mockResolvedValue([{ affectedRows: 2 }]); // recopie
    await mockDb(execute);
    const created = await createBenevole({
      firstName: "A",
      lastName: "B",
      category: "Arbitre",
      categoryEn: "Referee",
      joinedAt: "2024-01-01",
    });
    expect(created.categoryEn).toBe("Referee");
    const share = execute.mock.calls.at(-1);
    expect(String(share?.[0])).toContain("UPDATE bg_benevoles SET category_en = ? WHERE category = ?");
    expect(share?.[1]).toEqual(["Referee", "Arbitre"]);

    execute.mockClear();
    execute.mockResolvedValueOnce([[{ category_order: 10 }]]).mockResolvedValue([{ affectedRows: 1 }]);
    await updateBenevole(7, { firstName: "A", lastName: "B", category: "Arbitre", categoryEn: "Refs", joinedAt: "2024-01-01" });
    expect(execute.mock.calls.at(-1)?.[1]).toEqual(["Refs", "Arbitre"]);
  });
});

describe("lecture — l'anglais est relu avec le français", () => {
  it("bureau et cartes : colonnes _en lues, NULL gardé", async () => {
    const execute = jest
      .fn<SqlQuery>()
      .mockResolvedValueOnce([[{ id: 1, name: "Léo", role: "Président", role_en: null, initials: "L", color: "c" }]])
      .mockResolvedValueOnce([[{ id: 2, title: "T", text: "X", title_en: "T", text_en: "X en" }]]);
    await mockDb(execute);
    expect((await listBureauMembers())[0].roleEn).toBeNull();
    expect(String(execute.mock.calls[0][0])).toContain("role_en");
    expect((await listAboutPillars())[0]).toMatchObject({ titleEn: "T", textEn: "X en" });
  });

  it("annonces : la page reçoit les deux langues", async () => {
    const execute = jest.fn<SqlQuery>().mockResolvedValue([[]]);
    await mockDb(execute);
    await listRecruitmentAds(true);
    expect(String(execute.mock.calls[0][0])).toContain("title_en, roles_en, body_en");
  });
});

describe("mise en avant du recrutement sous /en", () => {
  const row = (id: number, titleEn: string | null) => ({
    id,
    title: `Annonce ${id}`,
    title_en: titleEn,
    roles_en: null,
    body_en: null,
    team_name: null,
    domain: "AUTRE",
    roles: null,
    body: null,
    contact_url: null,
    contact_discord: null,
    contact_discord_id: null,
    contact_preferred: "AUTO",
    priority: "PRIORITY",
    active: 1,
  });

  it("ne garde que les annonces traduites, dans leur anglais ; le français est inchangé", async () => {
    const execute = jest.fn<SqlQuery>().mockResolvedValue([[row(1, "Opening 1"), row(2, null)]]);
    await mockDb(execute);
    const fr = await getRecruitmentSpotlight();
    expect(fr.banner.map((ad) => ad.title)).toEqual(["Annonce 1", "Annonce 2"]);
    const en = await getRecruitmentSpotlight("en");
    expect(en.banner.map((ad) => ad.title)).toEqual(["Opening 1"]);
    expect(en.modal.map((ad) => ad.id)).toEqual([1]);
    // Une seule lecture : le cache sert les deux langues.
    expect(execute).toHaveBeenCalledTimes(1);
  });
});
