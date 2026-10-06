import { beforeEach, describe, expect, it, jest } from "@jest/globals";

/**
 * Lot 5b : chaque route d'écriture de la page association transmet l'anglais
 * saisi au service, et rend son refus (`*_EN_REQUIRED`) en 400 avec le seul
 * code — la phrase est celle du client (`lib/shared/staff-translation.ts`).
 */
jest.mock("@/lib/server/auth");
jest.mock("@/lib/server/bureau-service");
jest.mock("@/lib/server/about-stats-service");
jest.mock("@/lib/server/about-pillars-service");
jest.mock("@/lib/server/benevoles-service");
jest.mock("@/lib/server/sponsors-service");

import { POST as postBureau } from "@/app/api/association/bureau/route";
import { PUT as putBureau } from "@/app/api/association/bureau/[id]/route";
import { POST as postStat } from "@/app/api/association/about-stats/route";
import { POST as postPillar } from "@/app/api/association/about-pillars/route";
import { POST as postBenevole } from "@/app/api/benevoles/route";
import { POST as postSponsor } from "@/app/api/landing/sponsors/route";
import { getCurrentUser } from "@/lib/server/auth";
import * as aboutPillars from "@/lib/server/about-pillars-service";
import * as aboutStats from "@/lib/server/about-stats-service";
import * as benevoles from "@/lib/server/benevoles-service";
import * as bureau from "@/lib/server/bureau-service";
import * as sponsors from "@/lib/server/sponsors-service";
import { authUser } from "../../helpers/auth-user";

const admin = authUser({ id: 1, isAdmin: true });

function jsonReq(body: unknown, method = "POST") {
  return new Request("http://localhost/api/x", {
    method,
    headers: { "Content-Type": "application/json", Origin: "http://localhost" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(getCurrentUser).mockResolvedValue(admin);
});

describe("l'anglais saisi arrive au service", () => {
  it("bureau (création et modification)", async () => {
    jest.mocked(bureau.createBureauMember).mockResolvedValue({ id: 1, name: "L", role: "P", roleEn: "President", initials: "L", color: "c" });
    jest.mocked(bureau.updateBureauMember).mockResolvedValue({ id: 1, name: "L", role: "P", roleEn: "Chair", initials: "L", color: "c" });
    await postBureau(jsonReq({ name: "L", role: "P", roleEn: "President" }));
    expect(bureau.createBureauMember).toHaveBeenCalledWith(expect.objectContaining({ roleEn: "President" }));
    await putBureau(jsonReq({ name: "L", role: "P", roleEn: "Chair" }, "PUT"), { params: Promise.resolve({ id: "1" }) });
    expect(bureau.updateBureauMember).toHaveBeenCalledWith(1, expect.objectContaining({ roleEn: "Chair" }));
  });

  it("chiffres, cartes, bénévoles, partenaires", async () => {
    jest.mocked(aboutStats.createAboutStat).mockResolvedValue({ id: 1, value: "1", label: "L", labelEn: "L" });
    jest.mocked(aboutPillars.createAboutPillar).mockResolvedValue({ id: 1, title: "T", text: "X", titleEn: "T", textEn: "X" });
    await postStat(jsonReq({ value: "1", label: "L", labelEn: "Label" }));
    expect(aboutStats.createAboutStat).toHaveBeenCalledWith(expect.objectContaining({ labelEn: "Label" }));
    await postPillar(jsonReq({ title: "T", text: "X", titleEn: "Title", textEn: "Text" }));
    expect(aboutPillars.createAboutPillar).toHaveBeenCalledWith(expect.objectContaining({ titleEn: "Title", textEn: "Text" }));
    await postBenevole(jsonReq({ firstName: "A", lastName: "B", category: "Arbitre", categoryEn: "Referee", joinedAt: "2024-01-01" }));
    expect(benevoles.createBenevole).toHaveBeenCalledWith(expect.objectContaining({ categoryEn: "Referee" }));
    await postSponsor(jsonReq({ name: "N", description: "Boutique", descriptionEn: "Store" }));
    expect(sponsors.createSponsor).toHaveBeenCalledWith(expect.objectContaining({ descriptionEn: "Store" }));
  });

  it("un anglais d'un autre type que texte devient absent (refusé ensuite par la validation)", async () => {
    jest.mocked(bureau.createBureauMember).mockRejectedValue(new Error("ROLE_EN_REQUIRED"));
    const res = await postBureau(jsonReq({ name: "L", role: "P", roleEn: 42 }));
    expect(bureau.createBureauMember).toHaveBeenCalledWith(expect.objectContaining({ roleEn: null }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "ROLE_EN_REQUIRED" });
  });
});
