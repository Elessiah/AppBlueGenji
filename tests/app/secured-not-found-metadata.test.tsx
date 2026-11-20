import { beforeEach, describe, expect, it, jest } from "@jest/globals";

/**
 * Titre d'onglet des espaces réservés (`docs/features/ERROR_PAGES_AND_ANCHORS.md`) :
 * un compte sans la permission reçoit la page introuvable, son onglet le dit
 * aussi (jamais le titre de l'espace) ; sans session, aucun titre.
 */
let mockLocale: "fr" | "en" = "fr";
jest.mock("@/lib/server/request-locale", () => ({ requestLocale: async () => mockLocale }));
jest.mock("@/lib/server/auth", () => ({ getCurrentUser: jest.fn() }));

import { generateMetadata as planningMetadata } from "@/app/(secured)/planning/layout";
import { generateMetadata as reportsMetadata } from "@/app/(secured)/admin/signalements/layout";
import { getCurrentUser } from "@/lib/server/auth";
import { authUser } from "../helpers/auth-user";

const NOT_FOUND_METADATA = {
  title: { absolute: "Page introuvable · BlueGenji Esport" },
  robots: { index: false, follow: false },
};

beforeEach(() => {
  mockLocale = "fr";
  jest.mocked(getCurrentUser).mockReset();
});

describe("PlanningLayout — titre", () => {
  it("generateMetadata_noSession_noTitle", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(null);
    expect(await planningMetadata()).toEqual({});
  });

  it("generateMetadata_withoutPlanningPermission_notFoundTitle", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(authUser());
    expect(await planningMetadata()).toEqual(NOT_FOUND_METADATA);
  });

  it("generateMetadata_withoutPlanningPermissionInEnglish_englishNotFoundTitle", async () => {
    mockLocale = "en";
    jest.mocked(getCurrentUser).mockResolvedValue(authUser());
    expect((await planningMetadata()).title).toEqual({ absolute: "Page not found · BlueGenji Esport" });
  });

  it("generateMetadata_prodRole_planningTitle", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(authUser({ roles: ["PROD"] }));
    const metadata = await planningMetadata();
    expect(metadata.robots).toBeUndefined();
    expect(JSON.stringify(metadata.title)).toContain("Planning");
  });
});

describe("ReportsAdminLayout — titre", () => {
  it("generateMetadata_noSession_noTitle", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(null);
    expect(await reportsMetadata()).toEqual({});
  });

  it("generateMetadata_withoutModeration_notFoundTitle", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(authUser({ roles: ["ARBITRE"] }));
    expect(await reportsMetadata()).toEqual(NOT_FOUND_METADATA);
  });

  it("generateMetadata_admin_reportsTitle", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(authUser({ isAdmin: true }));
    expect(JSON.stringify((await reportsMetadata()).title)).toContain("Signalements");
  });
});
