import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/auth");
jest.mock("@/lib/server/sponsors-service");
jest.mock("@/lib/server/stored-upload-cleanup");

import { POST } from "@/app/api/landing/sponsors/route";
import { getCurrentUser } from "@/lib/server/auth";
import * as service from "@/lib/server/sponsors-service";
import { resetIdempotencyForTests } from "@/lib/server/idempotency";
import { storedUploadExists } from "@/lib/server/stored-upload-cleanup";
import type { Sponsor } from "@/lib/shared/sponsors";
import { authUser } from "../../../helpers/auth-user";

/**
 * EF-70 : un ajout de partenaire renvoyé avec la même clé après la suppression
 * du partenaire (qui a effacé son logo `sponsors/`) le recréait sur une image
 * absente, que plus rien n'effaçait. Comme `POST /api/benevoles` (EF-69).
 */
const admin = authUser({ id: 1, isAdmin: true });
const KEY = "4b1c2d3e-5f60-4a7b-8c9d-0e1f2a3b4c5d";
const LOGO = "/api/uploads/sponsors/5-logo.webp";
const BANNER = "/api/uploads/sponsors/5-banner.webp";
const created: Sponsor = {
  id: 5,
  name: "Test_Partenaire",
  slug: "test-partenaire",
  tier: "PARTNER",
  logoUrl: LOGO,
  bannerUrl: BANNER,
  websiteUrl: null,
  description: null,
  descriptionEn: null,
};

function post(body: unknown) {
  return POST(
    new Request("http://localhost/api/landing/sponsors", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

const sentInput = () => jest.mocked(service.createSponsor).mock.calls.at(-1)?.[0];

describe("POST /api/landing/sponsors — image effacée", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetIdempotencyForTests();
    jest.mocked(getCurrentUser).mockResolvedValue(admin);
    jest.mocked(service.createSponsor).mockResolvedValue(created);
    jest.mocked(service.findSponsor).mockResolvedValue(created);
  });

  it("POST_logoFileMissing_createsWithoutLogo", async () => {
    jest.mocked(storedUploadExists).mockImplementation(async (url) => url !== LOGO);

    await post({ name: "Test_Partenaire", logoUrl: LOGO, bannerUrl: BANNER });

    expect(sentInput()?.logoUrl).toBeNull();
    expect(sentInput()?.bannerUrl).toBe(BANNER);
  });

  it("POST_bannerFileMissing_createsWithoutBanner", async () => {
    jest.mocked(storedUploadExists).mockImplementation(async (url) => url !== BANNER);

    await post({ name: "Test_Partenaire", logoUrl: LOGO, bannerUrl: BANNER });

    expect(sentInput()?.logoUrl).toBe(LOGO);
    expect(sentInput()?.bannerUrl).toBeNull();
  });

  it("POST_imageFilesPresent_keepsBoth", async () => {
    jest.mocked(storedUploadExists).mockResolvedValue(true);

    await post({ name: "Test_Partenaire", logoUrl: LOGO, bannerUrl: BANNER });

    expect(sentInput()?.logoUrl).toBe(LOGO);
    expect(sentInput()?.bannerUrl).toBe(BANNER);
    expect(storedUploadExists).toHaveBeenCalledWith(LOGO, "sponsors");
  });

  it("POST_imageOutsideSponsorsFolder_keptWithoutDiskCheck", async () => {
    await post({ name: "Test_Partenaire", logoUrl: "https://cdn.example/logo.png" });

    expect(sentInput()?.logoUrl).toBe("https://cdn.example/logo.png");
    expect(storedUploadExists).not.toHaveBeenCalled();
  });

  it("POST_noImage_sendsNull", async () => {
    await post({ name: "Test_Partenaire" });

    expect(sentInput()?.logoUrl).toBeNull();
    expect(sentInput()?.bannerUrl).toBeNull();
  });

  it("POST_replayAfterDeleteWithErasedImages_recreatesWithoutThem", async () => {
    jest.mocked(storedUploadExists).mockResolvedValue(true);
    await post({ name: "Test_Partenaire", logoUrl: LOGO, bannerUrl: BANNER, requestKey: KEY });
    // Supprimé entre-temps : la suppression a effacé ses deux fichiers.
    jest.mocked(service.findSponsor).mockResolvedValueOnce(null);
    jest.mocked(storedUploadExists).mockResolvedValue(false);

    const replay = await post({ name: "Test_Partenaire", logoUrl: LOGO, bannerUrl: BANNER, requestKey: KEY });

    expect(replay.status).toBe(201);
    expect(service.createSponsor).toHaveBeenCalledTimes(2);
    expect(sentInput()?.logoUrl).toBeNull();
    expect(sentInput()?.bannerUrl).toBeNull();
  });
});
