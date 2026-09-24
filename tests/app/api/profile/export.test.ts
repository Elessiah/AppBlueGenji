import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/auth");
jest.mock("@/lib/server/users-service");

import { GET } from "@/app/api/profile/export/route";
import { getCurrentUser } from "@/lib/server/auth";
import { exportOwnData } from "@/lib/server/users-service";
import { emptyDeepStats } from "@/lib/shared/stats";
import type { PersonalDataExport } from "@/lib/shared/types";
import { authUser } from "../../../helpers/auth-user";

const user = authUser({ id: 42 });

function sampleExport(): PersonalDataExport {
  return {
    exportedAt: "2026-07-04T00:00:00.000Z",
    account: {
      id: 42,
      pseudo: "player",
      discordId: "123",
      discordPseudo: "player#0001",
      discordVerifiedAt: null,
      // La porte par laquelle le Discord a été rattaché fait partie de ce que
      // l'export rend : `null` ici, comme sur un rattachement antérieur à la
      // colonne (`lib/shared/account-connections.ts`).
      discordLinkMethod: null,
      googleSub: null,
      blizzardSub: null,
      isAdult: true,
      isAdmin: false,
      createdAt: "2026-01-01T00:00:00.000Z",
    },
    profile: {
      avatarUrl: null,
      overwatchBattletag: "Player#1234",
      marvelRivalsTag: null,
      visibility: { avatar: false, overwatch: false, marvel: false, major: false },
      openToRecruitment: true,
    },
    stats: emptyDeepStats(new Date("2026-07-04T00:00:00.000Z")),
    teamsTimeline: [],
    tournaments: [],
    privacyAcknowledgments: [],
    termsAcceptances: [],
    reports: [],
  };
}

describe("GET /api/profile/export", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("rejects anonymous users with 401", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(null);
    const res = await GET();
    expect(res.status).toBe(401);
    expect(exportOwnData).not.toHaveBeenCalled();
  });

  it("exports only the authenticated user's own data", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(user);
    jest.mocked(exportOwnData).mockResolvedValue(sampleExport());

    const res = await GET();
    expect(res.status).toBe(200);
    // L'export porte sur l'id du user authentifié — jamais un tiers.
    expect(exportOwnData).toHaveBeenCalledWith(42);

    const body = JSON.parse(await res.text()) as PersonalDataExport;
    expect(body.account.id).toBe(42);
    // L'adresse n'a plus de champ : la colonne a été retirée de `bg_users`, et
    // l'export ne peut donc plus la porter (`docs/DATABASE_SCHEMA.md`). Le type
    // refuse déjà un `email` dans le gabarit (`npm run typecheck`) ; l'assertion
    // tient la règle sur ce que la route **renvoie**, qu'aucun type ne borne.
    expect(body.account).not.toHaveProperty("email");
  });

  it("serves the payload as a downloadable JSON attachment", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(user);
    jest.mocked(exportOwnData).mockResolvedValue(sampleExport());

    const res = await GET();
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(res.headers.get("content-disposition")).toBe(
      'attachment; filename="bluegenji-donnees-42.json"',
    );
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("returns 404 when the profile no longer exists", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(user);
    jest.mocked(exportOwnData).mockRejectedValue(new Error("PROFILE_NOT_FOUND"));

    const res = await GET();
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "PROFILE_NOT_FOUND" });
  });
});
