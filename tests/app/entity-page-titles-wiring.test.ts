import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import type { Metadata } from "next";
import { resolveTitle } from "next/dist/lib/metadata/resolvers/resolve-title";

jest.mock("@/lib/server/auth");
jest.mock("@/lib/server/database");
// Fiches traduites (lot 9) : la langue de la requête, simulée.
let mockLocale: "fr" | "en" = "fr";
jest.mock("@/lib/server/request-locale", () => ({ requestLocale: async () => mockLocale }));

import { generateMetadata as teamMetadata } from "@/app/(secured)/equipes/[id]/layout";
import { generateMetadata as playerMetadata } from "@/app/(secured)/joueurs/[id]/layout";
import { generateMetadata as teamsLayoutMetadata } from "@/app/(secured)/equipes/layout";
import { generateMetadata as playersLayoutMetadata } from "@/app/(secured)/joueurs/layout";
import { getCurrentUser } from "@/lib/server/auth";
import { getDatabase } from "@/lib/server/database";
import { getTeamPageIdentity } from "@/lib/server/teams/detail";
import { getPlayerPageIdentity } from "@/lib/server/users/full-profile";
import { SITE_TITLE_TEMPLATE } from "@/lib/shared/page-metadata";
import { SITE_NAME } from "@/lib/shared/share-metadata";
import { authUser } from "../helpers/auth-user";
import { type SqlQuery, fakePool } from "../helpers/sql-double";

/**
 * Titres des fiches d'équipe et de joueur, du côté du câblage : la mise en page
 * lit la bonne ligne, pour le bon lecteur, et son titre passe bien sous le
 * gabarit du site. La rédaction est testée à part
 * (`tests/lib/shared/entity-page-titles.test.ts`).
 */

const mockedUser = jest.mocked(getCurrentUser);
const execute = jest.fn<SqlQuery>();

const params = (id: string) => ({ children: null, params: Promise.resolve({ id }) });

/** Titre de l'onglet, résolu comme Next le fait le long des mises en page. */
function tabTitle(parent: Metadata, own: Metadata): string {
  const root = resolveTitle({ default: SITE_NAME, template: SITE_TITLE_TEMPLATE }, null);
  const segment = resolveTitle(parent.title ?? null, root.template);
  return resolveTitle(own.title ?? null, segment.template).absolute;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockLocale = "fr";
  execute.mockReset();
  jest.mocked(getDatabase).mockResolvedValue(fakePool({ execute }));
  mockedUser.mockResolvedValue(authUser({ id: 7 }));
});

describe("fiche d'équipe", () => {
  it("s'intitule du nom de l'équipe, sous le gabarit du site", async () => {
    execute.mockResolvedValue([[{ name: "Dragon Squad" }]]);
    const metadata = await teamMetadata(params("12"));

    expect(tabTitle(await teamsLayoutMetadata(), metadata)).toBe(`Dragon Squad · Équipe · ${SITE_NAME}`);
    expect(execute).toHaveBeenCalledWith(expect.any(String), [12]);
  });

  it("la canonique de **cette** fiche, pas d'og:url, et un encart générique même quand le nom est connu", async () => {
    execute.mockResolvedValue([[{ name: "Dragon Squad" }]]);
    const metadata = await teamMetadata(params("12"));
    expect(Object.keys(metadata).sort((a, b) => a.localeCompare(b))).toEqual(["alternates", "openGraph", "title", "twitter"]);
    // Lot 9 : la fiche est traduite — canonique et `hreflang` réciproques.
    expect(metadata.alternates).toEqual({
      canonical: "/equipes/12",
      languages: { fr: "/equipes/12", en: "/en/equipes/12", "x-default": "/equipes/12" },
    });
    // Le nom est dans l'onglet d'un membre connecté, jamais dans l'encart.
    expect(JSON.stringify([metadata.openGraph, metadata.twitter])).not.toContain("Dragon Squad");
    expect((metadata.openGraph as { url?: unknown }).url).toBeUndefined();
  });

  it("ne nomme rien à un lecteur non connecté, et ne lit pas la base", async () => {
    mockedUser.mockResolvedValue(null);
    expect(await teamMetadata(params("12"))).toMatchObject({ title: "Équipe" });
    expect(execute).not.toHaveBeenCalled();
  });

  it("désigne l'image nominative de l'équipe sans aucune lecture pour elle", async () => {
    mockedUser.mockResolvedValue(null);
    const metadata = await teamMetadata(params("12"));
    expect(metadata.twitter).toMatchObject({ images: ["/og/fr/team-12.png"] });
    expect(execute).not.toHaveBeenCalled();
  });

  it("garde l'image générique pour un identifiant invalide", async () => {
    const metadata = await teamMetadata(params("12abc"));
    expect(metadata.twitter).toMatchObject({ images: ["/og/fr/team.png"] });
  });

  it("retombe sur le titre générique pour un identifiant invalide, sans rien lire", async () => {
    expect(await teamMetadata(params("12abc"))).toMatchObject({ title: "Équipe" });
    expect(mockedUser).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
  });

  it("retombe sur le titre générique pour une équipe introuvable", async () => {
    execute.mockResolvedValue([[]]);
    expect(await teamMetadata(params("12"))).toMatchObject({ title: "Équipe" });
  });

  it("ne fait pas échouer la page quand la base est injoignable", async () => {
    execute.mockRejectedValue(new Error("ECONNREFUSED"));
    expect(await teamMetadata(params("12"))).toMatchObject({ title: "Équipe" });
  });
});

describe("fiche de joueur", () => {
  it("s'intitule du pseudo, sous le gabarit du site", async () => {
    execute.mockResolvedValue([[{ pseudo: "Nova", is_deleted: 0 }]]);
    const metadata = await playerMetadata(params("5"));

    expect(tabTitle(await playersLayoutMetadata(), metadata)).toBe(`Nova · Joueur · ${SITE_NAME}`);
    expect(execute).toHaveBeenCalledWith(expect.any(String), [5]);
    // Le pseudo n'atteint jamais l'encart de partage (RGPD).
    expect(JSON.stringify([metadata.openGraph, metadata.twitter])).not.toContain("Nova");
  });

  it("annonce un compte anonymisé sans son pseudo d'emprunt", async () => {
    execute.mockResolvedValue([[{ pseudo: "Renard_Discret", is_deleted: 1 }]]);
    expect(await playerMetadata(params("5"))).toMatchObject({ title: "Compte supprimé · Joueur" });
  });

  it("ne nomme personne à un lecteur non connecté, et ne lit pas la base", async () => {
    mockedUser.mockResolvedValue(null);
    expect(await playerMetadata(params("5"))).toMatchObject({ title: "Joueur" });
    expect(execute).not.toHaveBeenCalled();
  });

  it("retombe sur le titre générique quand la session ne se lit pas", async () => {
    mockedUser.mockRejectedValue(new Error("ECONNREFUSED"));
    expect(await playerMetadata(params("5"))).toMatchObject({ title: "Joueur" });
  });

  it("retombe sur le titre générique pour un identifiant invalide", async () => {
    expect(await playerMetadata(params("0"))).toMatchObject({ title: "Joueur" });
    expect(execute).not.toHaveBeenCalled();
  });
});

describe("fiches en anglais (lot 9)", () => {
  it("titre, canonique et image d'une fiche d'équipe dans la langue de l'adresse", async () => {
    mockLocale = "en";
    execute.mockResolvedValue([[{ name: "Dragon Squad" }]]);
    const metadata = await teamMetadata(params("12"));
    expect(tabTitle(await teamsLayoutMetadata(), metadata)).toBe(`Dragon Squad · Team · ${SITE_NAME}`);
    expect(metadata.alternates).toMatchObject({ canonical: "/en/equipes/12" });
    expect(metadata.twitter).toMatchObject({ images: ["/og/en/team-12.png"] });
  });

  it("un compte anonymisé s'annonce « Deleted account »", async () => {
    mockLocale = "en";
    execute.mockResolvedValue([[{ pseudo: "Renard_Discret", is_deleted: 1 }]]);
    const metadata = await playerMetadata(params("5"));
    expect(metadata).toMatchObject({ title: "Deleted account · Player" });
    expect(metadata.alternates).toMatchObject({ canonical: "/en/joueurs/5" });
  });

  it("les listes s'intitulent en anglais", async () => {
    mockLocale = "en";
    expect((await playersLayoutMetadata()).title).toEqual({ default: "Players", template: SITE_TITLE_TEMPLATE });
    expect((await teamsLayoutMetadata()).title).toEqual({ default: "Teams", template: SITE_TITLE_TEMPLATE });
  });
});

describe("lectures des identités de fiche", () => {
  it("n'identifie pas une entrée solo comme une équipe", async () => {
    execute.mockResolvedValue([[]]);
    await expect(getTeamPageIdentity(3)).resolves.toBeNull();
    const [sql] = execute.mock.calls[0];
    expect(sql).toMatch(/solo_user_id IS NULL/);
    // Le nom seul : un titre n'a besoin ni des membres ni du classement.
    expect(sql).toMatch(/^SELECT name FROM bg_teams\b/);
  });

  it("rend le nom d'une équipe", async () => {
    execute.mockResolvedValue([[{ name: "Alpha" }]]);
    await expect(getTeamPageIdentity(3)).resolves.toEqual({ name: "Alpha" });
  });

  it("rend le pseudo et l'état de suppression d'un compte, et rien d'autre", async () => {
    execute.mockResolvedValue([[{ pseudo: "Nova", is_deleted: 0 }]]);
    await expect(getPlayerPageIdentity(9)).resolves.toEqual({ pseudo: "Nova", isDeleted: false });
    const [sql] = execute.mock.calls[0];
    expect(sql).toMatch(/^SELECT pseudo, is_deleted FROM bg_users\b/);
  });

  it("rend null pour un compte introuvable", async () => {
    execute.mockResolvedValue([[]]);
    await expect(getPlayerPageIdentity(9)).resolves.toBeNull();
  });
});
