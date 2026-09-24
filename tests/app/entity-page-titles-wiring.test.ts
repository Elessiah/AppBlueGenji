import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import type { Metadata } from "next";
import { resolveTitle } from "next/dist/lib/metadata/resolvers/resolve-title";

jest.mock("@/lib/server/auth");
jest.mock("@/lib/server/database");

import { generateMetadata as teamMetadata } from "@/app/(secured)/equipes/[id]/layout";
import { generateMetadata as playerMetadata } from "@/app/(secured)/joueurs/[id]/layout";
import { metadata as teamsMetadata } from "@/app/(secured)/equipes/layout";
import { metadata as playersMetadata } from "@/app/(secured)/joueurs/layout";
import { getCurrentUser } from "@/lib/server/auth";
import { getDatabase } from "@/lib/server/database";
import { getTeamPageIdentity } from "@/lib/server/teams-service";
import { getPlayerPageIdentity } from "@/lib/server/users-service";
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
  execute.mockReset();
  jest.mocked(getDatabase).mockResolvedValue(fakePool({ execute }));
  mockedUser.mockResolvedValue(authUser({ id: 7 }));
});

describe("fiche d'équipe", () => {
  it("s'intitule du nom de l'équipe, sous le gabarit du site", async () => {
    execute.mockResolvedValue([[{ name: "Dragon Squad" }]]);
    const metadata = await teamMetadata(params("12"));

    expect(tabTitle(teamsMetadata, metadata)).toBe(`Dragon Squad · Équipe · ${SITE_NAME}`);
    expect(execute).toHaveBeenCalledWith(expect.any(String), [12]);
  });

  it("ne déclare qu'un titre : ni encart ni URL canonique", async () => {
    execute.mockResolvedValue([[{ name: "Dragon Squad" }]]);
    expect(Object.keys(await teamMetadata(params("12")))).toEqual(["title"]);
  });

  it("ne nomme rien à un lecteur non connecté, et ne lit pas la base", async () => {
    mockedUser.mockResolvedValue(null);
    expect(await teamMetadata(params("12"))).toEqual({ title: "Équipe" });
    expect(execute).not.toHaveBeenCalled();
  });

  it("retombe sur le titre générique pour un identifiant invalide, sans rien lire", async () => {
    expect(await teamMetadata(params("12abc"))).toEqual({ title: "Équipe" });
    expect(mockedUser).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
  });

  it("retombe sur le titre générique pour une équipe introuvable", async () => {
    execute.mockResolvedValue([[]]);
    expect(await teamMetadata(params("12"))).toEqual({ title: "Équipe" });
  });

  it("ne fait pas échouer la page quand la base est injoignable", async () => {
    execute.mockRejectedValue(new Error("ECONNREFUSED"));
    expect(await teamMetadata(params("12"))).toEqual({ title: "Équipe" });
  });
});

describe("fiche de joueur", () => {
  it("s'intitule du pseudo, sous le gabarit du site", async () => {
    execute.mockResolvedValue([[{ pseudo: "Nova", is_deleted: 0 }]]);
    const metadata = await playerMetadata(params("5"));

    expect(tabTitle(playersMetadata, metadata)).toBe(`Nova · Joueur · ${SITE_NAME}`);
    expect(execute).toHaveBeenCalledWith(expect.any(String), [5]);
  });

  it("annonce un compte anonymisé sans son pseudo d'emprunt", async () => {
    execute.mockResolvedValue([[{ pseudo: "Renard_Discret", is_deleted: 1 }]]);
    expect(await playerMetadata(params("5"))).toEqual({ title: "Compte supprimé · Joueur" });
  });

  it("ne nomme personne à un lecteur non connecté, et ne lit pas la base", async () => {
    mockedUser.mockResolvedValue(null);
    expect(await playerMetadata(params("5"))).toEqual({ title: "Joueur" });
    expect(execute).not.toHaveBeenCalled();
  });

  it("retombe sur le titre générique quand la session ne se lit pas", async () => {
    mockedUser.mockRejectedValue(new Error("ECONNREFUSED"));
    expect(await playerMetadata(params("5"))).toEqual({ title: "Joueur" });
  });

  it("retombe sur le titre générique pour un identifiant invalide", async () => {
    expect(await playerMetadata(params("0"))).toEqual({ title: "Joueur" });
    expect(execute).not.toHaveBeenCalled();
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
