import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/auth");
jest.mock("@/lib/server/content-reports");
jest.mock("@/lib/server/logo-quarantine");
jest.mock("@/lib/server/terms-acceptance");
jest.mock("@/lib/server/teams-service");
jest.mock("@/lib/server/image-upload");
jest.mock("@/lib/server/staff-audit");

import { POST as submitReport } from "@/app/api/reports/route";
import { GET as searchTargets } from "@/app/api/reports/targets/route";
import { GET as readConcerned } from "@/app/api/reports/[id]/route";
import { GET as contestable } from "@/app/api/reports/contestable/route";
import { GET as adminList } from "@/app/api/admin/reports/route";
import { PATCH as adminAction } from "@/app/api/admin/reports/[id]/route";
import { POST as hideLogo } from "@/app/api/admin/reports/[id]/logo-quarantine/route";
import { POST as restoreLogo } from "@/app/api/admin/logo-quarantines/[id]/restore/route";
import { DELETE as purgeLogo } from "@/app/api/admin/logo-quarantines/[id]/route";
import { DELETE as removeTeamLogo } from "@/app/api/admin/teams/[id]/logo/route";
import { POST as acceptTerms } from "@/app/api/profile/terms/route";
import { getCurrentUser } from "@/lib/server/auth";
import {
  applyReportAction,
  createReport,
  getConcernedReport,
  listContestableReports,
  listReports,
  resolveReportTargets,
  searchReportTargets,
} from "@/lib/server/content-reports";
import { hideTeamLogo, purgeQuarantinedLogo, restoreTeamLogo } from "@/lib/server/logo-quarantine";
import { recordTermsAcceptance } from "@/lib/server/terms-acceptance";
import { removeTeamLogoAsModerator } from "@/lib/server/teams-service";
import { deleteStoredImage } from "@/lib/server/image-upload";
import { publishStaffAction } from "@/lib/server/staff-audit";
import { resetRateLimit } from "@/lib/server/rate-limit";
import { REPORT_SUBMIT_RULE } from "@/lib/server/api-guard";
import { TERMS_VERSION } from "@/lib/shared/terms-of-use";
import { authUser } from "../../../helpers/auth-user";

const member = authUser({ id: 5, pseudo: "Nova" });
const admin = authUser({ id: 1, pseudo: "Admin", isAdmin: true, roles: ["ADMIN"] });
const referee = authUser({ id: 2, pseudo: "Arbitre", roles: ["ARBITRE"] });

const params = (id: string) => ({ params: Promise.resolve({ id }) });
const json = (url: string, method: string, body: unknown, headers: Record<string, string> = {}) =>
  new Request(url, { method, headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });

const validReport = {
  category: "BUG",
  description: "Le bouton d'inscription ne répond plus depuis ce matin.",
  consent: true,
  pagePath: "/tournois",
};

beforeEach(() => {
  jest.clearAllMocks();
  resetRateLimit(REPORT_SUBMIT_RULE.name);
  jest.mocked(getCurrentUser).mockResolvedValue(null);
});

describe("POST /api/reports", () => {
  it("accepte un signalement anonyme, et le transmet sans compte", async () => {
    jest.mocked(createReport).mockResolvedValue(12);
    const res = await submitReport(json("http://localhost/api/reports", "POST", validReport));
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ id: 12 });
    expect(createReport).toHaveBeenCalledWith(expect.objectContaining({ category: "BUG", pagePath: "/tournois" }), {
      userId: null,
      managesTournaments: false,
    });
  });

  it("transmet le compte et la permission `tournaments` du signalant connecté", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(referee);
    jest.mocked(createReport).mockResolvedValue(13);
    await submitReport(json("http://localhost/api/reports", "POST", validReport));
    expect(createReport).toHaveBeenCalledWith(expect.anything(), { userId: 2, managesTournaments: true });
  });

  it("refuse une saisie invalide en 400, sans rien écrire ni consommer de quota", async () => {
    for (let i = 0; i < REPORT_SUBMIT_RULE.limit + 2; i += 1) {
      const res = await submitReport(
        json("http://localhost/api/reports", "POST", { ...validReport, consent: false }, { "x-forwarded-for": "203.0.113.9" }),
      );
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "REPORT_CONSENT_REQUIRED" });
    }
    expect(createReport).not.toHaveBeenCalled();
  });

  it("refuse un corps illisible en 400", async () => {
    const res = await submitReport(new Request("http://localhost/api/reports", { method: "POST", body: "{" }));
    expect(res.status).toBe(400);
  });

  it(`plafonne à ${REPORT_SUBMIT_RULE.limit} envois par IP sans compte`, async () => {
    jest.mocked(createReport).mockResolvedValue(1);
    const send = () =>
      submitReport(json("http://localhost/api/reports", "POST", validReport, { "x-forwarded-for": "203.0.113.7" }));
    for (let i = 0; i < REPORT_SUBMIT_RULE.limit; i += 1) expect((await send()).status).toBe(201);
    expect((await send()).status).toBe(429);
  });

  it.each<[string, number]>([
    ["REPORT_TARGET_NOT_FOUND", 400],
    ["REPORT_CONTEST_LOGIN_REQUIRED", 401],
    ["REPORT_TARGETS_REQUIRE_LOGIN", 401],
    ["REPORT_NOT_CONCERNED", 403],
    ["REPORTS_SATURATED", 429],
  ])("traduit %s en %i", async (code, status) => {
    jest.mocked(createReport).mockRejectedValue(new Error(code));
    const res = await submitReport(json("http://localhost/api/reports", "POST", validReport));
    expect(res.status).toBe(status);
    expect(await res.json()).toEqual({ error: code });
  });

  it("ne laisse sortir aucun message interne sur une panne", async () => {
    jest.spyOn(console, "error").mockImplementation(() => undefined);
    jest.mocked(createReport).mockRejectedValue(new Error("ER_NO_SUCH_TABLE: Table 'secret.bg_reports'"));
    const res = await submitReport(json("http://localhost/api/reports", "POST", validReport));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "REPORT_FAILED" });
  });
});

describe("GET /api/reports/targets", () => {
  it("est réservé aux comptes connectés : l'annuaire l'est", async () => {
    const res = await searchTargets(new Request("http://localhost/api/reports/targets?type=USER&q=nova"));
    expect(res.status).toBe(401);
    expect(searchReportTargets).not.toHaveBeenCalled();
  });

  it("refuse un type inconnu", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(member);
    const res = await searchTargets(new Request("http://localhost/api/reports/targets?type=MATCH&q=x"));
    expect(res.status).toBe(400);
  });

  it("cherche par nom", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(member);
    jest.mocked(searchReportTargets).mockResolvedValue([]);
    await searchTargets(new Request("http://localhost/api/reports/targets?type=TEAM&q=alp"));
    expect(searchReportTargets).toHaveBeenCalledWith("TEAM", "alp", { userId: 5, managesTournaments: false });
  });

  it("résout des identifiants, filtrés et bornés", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(member);
    jest.mocked(resolveReportTargets).mockResolvedValue([]);
    await searchTargets(new Request("http://localhost/api/reports/targets?type=USER&ids=3,3,abc,-1,4"));
    expect(resolveReportTargets).toHaveBeenCalledWith(
      [
        { type: "USER", id: 3 },
        { type: "USER", id: 4 },
      ],
      { userId: 5, managesTournaments: false },
    );
  });
});

describe("GET /api/reports/[id] et /contestable", () => {
  it("exige un compte", async () => {
    expect((await readConcerned(new Request("http://localhost"), params("3"))).status).toBe(401);
    expect((await contestable()).status).toBe(401);
  });

  it("répond 404 à qui n'est pas visé, comme pour un signalement inexistant", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(member);
    jest.mocked(getConcernedReport).mockResolvedValue(null);
    const res = await readConcerned(new Request("http://localhost"), params("3"));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "REPORT_NOT_FOUND" });
    expect((await readConcerned(new Request("http://localhost"), params("abc"))).status).toBe(404);
  });

  it("liste les signalements contestables du lecteur", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(member);
    jest.mocked(listContestableReports).mockResolvedValue([]);
    const res = await contestable();
    expect(await res.json()).toEqual({ reports: [] });
    expect(listContestableReports).toHaveBeenCalledWith(5);
  });
});

describe("routes du panneau — permission `moderation`", () => {
  const calls: [string, () => Promise<Response>][] = [
    ["liste", () => adminList()],
    ["geste", () => adminAction(json("http://localhost", "PATCH", { action: "TAKE" }), params("3"))],
    ["masquage", () => hideLogo(json("http://localhost", "POST", { teamId: 4 }), params("3"))],
    ["rétablissement", () => restoreLogo(new Request("http://localhost"), params("3"))],
    ["suppression en quarantaine", () => purgeLogo(new Request("http://localhost"), params("3"))],
    ["retrait immédiat", () => removeTeamLogo(new Request("http://localhost"), params("4"))],
  ];

  it.each(calls)("%s : refusé à un arbitre (403) et à un visiteur (401)", async (_label, call) => {
    jest.mocked(getCurrentUser).mockResolvedValue(referee);
    expect((await call()).status).toBe(403);
    jest.mocked(getCurrentUser).mockResolvedValue(null);
    expect((await call()).status).toBe(401);
  });

  it("liste les signalements pour un administrateur", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(admin);
    jest.mocked(listReports).mockResolvedValue([]);
    expect(await (await adminList()).json()).toEqual({ reports: [] });
  });

  it("applique un geste avec sa note, au nom de l'administrateur", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(admin);
    const res = await adminAction(json("http://localhost", "PATCH", { action: "RESOLVE", note: "Logo retiré" }), params("3"));
    expect(res.status).toBe(200);
    expect(applyReportAction).toHaveBeenCalledWith(3, "RESOLVE", { userId: 1, pseudo: "Admin" }, "Logo retiré");
  });

  it.each<[string, number]>([
    ["REPORT_NOT_FOUND", 404],
    ["REPORT_ACTION_NOT_ALLOWED", 409],
  ])("traduit le refus %s en %i", async (code, status) => {
    jest.mocked(getCurrentUser).mockResolvedValue(admin);
    jest.mocked(applyReportAction).mockRejectedValue(new Error(code));
    expect((await adminAction(json("http://localhost", "PATCH", { action: "TAKE" }), params("3"))).status).toBe(status);
  });

  it("refuse un geste inconnu et un identifiant invalide", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(admin);
    expect((await adminAction(json("http://localhost", "PATCH", { action: "DELETE" }), params("3"))).status).toBe(400);
    expect((await adminAction(json("http://localhost", "PATCH", { action: "TAKE" }), params("0"))).status).toBe(400);
  });

  it("masque le logo d'une équipe visée", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(admin);
    jest.mocked(hideTeamLogo).mockResolvedValue({
      id: 30,
      teamId: 4,
      teamName: "Alpha",
      reportId: 3,
      status: "HIDDEN",
      hiddenAt: "2026-09-24T10:00:00.000Z",
      purgeAfter: "2027-03-23T10:00:00.000Z",
      closedAt: null,
    });
    const res = await hideLogo(json("http://localhost", "POST", { teamId: 4 }), params("3"));
    expect(res.status).toBe(201);
    expect(hideTeamLogo).toHaveBeenCalledWith(3, 4, { userId: 1, pseudo: "Admin" });
  });

  it.each<[string, number]>([
    ["REPORT_NOT_FOUND", 404],
    ["TEAM_NOT_TARGETED", 409],
    ["TEAM_HAS_NO_LOGO", 409],
    ["LOGO_CHANGED", 409],
    ["LOGO_NOT_MOVABLE", 409],
  ])("traduit le refus de masquage %s en %i", async (code, status) => {
    jest.mocked(getCurrentUser).mockResolvedValue(admin);
    jest.mocked(hideTeamLogo).mockRejectedValue(new Error(code));
    expect((await hideLogo(json("http://localhost", "POST", { teamId: 4 }), params("3"))).status).toBe(status);
  });

  it.each<[string, number]>([
    ["QUARANTINE_NOT_FOUND", 404],
    ["QUARANTINE_CLOSED", 409],
    ["TEAM_HAS_NEW_LOGO", 409],
  ])("traduit le refus de rétablissement %s en %i", async (code, status) => {
    jest.mocked(getCurrentUser).mockResolvedValue(admin);
    jest.mocked(restoreTeamLogo).mockRejectedValue(new Error(code));
    expect((await restoreLogo(new Request("http://localhost"), params("30"))).status).toBe(status);
  });

  it("supprime un logo en quarantaine avant l'échéance", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(admin);
    expect((await purgeLogo(new Request("http://localhost"), params("30"))).status).toBe(200);
    expect(purgeQuarantinedLogo).toHaveBeenCalledWith(30, { userId: 1, pseudo: "Admin" });
  });
});

describe("DELETE /api/admin/teams/[id]/logo", () => {
  it("retire le logo, efface le fichier après l'écriture et trace le geste", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(admin);
    jest.mocked(removeTeamLogoAsModerator).mockResolvedValue({ teamName: "Alpha", removedLogoUrl: "/api/uploads/teams/4-a.webp" });
    jest.mocked(deleteStoredImage).mockResolvedValue(undefined);

    const res = await removeTeamLogo(new Request("http://localhost"), params("4"));
    expect(res.status).toBe(200);
    expect(deleteStoredImage).toHaveBeenCalledWith("/uploads/teams/4-a.webp");
    expect(publishStaffAction).toHaveBeenCalledWith(expect.stringContaining("« Alpha »"), { id: 1, pseudo: "Admin" });
  });

  it.each<[string, number]>([
    ["TEAM_NOT_FOUND", 404],
    ["TEAM_HAS_NO_LOGO", 409],
  ])("traduit %s en %i", async (code, status) => {
    jest.mocked(getCurrentUser).mockResolvedValue(admin);
    jest.mocked(removeTeamLogoAsModerator).mockRejectedValue(new Error(code));
    expect((await removeTeamLogo(new Request("http://localhost"), params("4"))).status).toBe(status);
  });
});

describe("POST /api/profile/terms", () => {
  it("exige un compte", async () => {
    expect((await acceptTerms(json("http://localhost", "POST", { version: TERMS_VERSION }))).status).toBe(401);
  });

  it("n'enregistre que l'acceptation de la version en vigueur", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(member);
    const res = await acceptTerms(json("http://localhost", "POST", { version: TERMS_VERSION - 1 }));
    expect(res.status).toBe(409);
    expect(recordTermsAcceptance).not.toHaveBeenCalled();
  });

  it("enregistre l'acceptation d'un gérant d'équipe", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(member);
    jest.mocked(recordTermsAcceptance).mockResolvedValue(true);
    const res = await acceptTerms(json("http://localhost", "POST", { version: TERMS_VERSION }));
    expect(res.status).toBe(200);
    expect(recordTermsAcceptance).toHaveBeenCalledWith(5, "TEAM_MANAGEMENT");
  });

  it("répond 404 pour un compte disparu", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(member);
    jest.mocked(recordTermsAcceptance).mockResolvedValue(false);
    expect((await acceptTerms(json("http://localhost", "POST", { version: TERMS_VERSION }))).status).toBe(404);
  });
});
