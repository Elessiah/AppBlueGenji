import { describe, expect, it } from "@jest/globals";
import {
  CATEGORY_TABS,
  DEFAULT_FILTERS,
  activeCountsByTab,
  categoryTabLabel,
  filterReports,
  relativeAge,
  statusSummary,
  targetSummary,
} from "@/app/(secured)/admin/signalements/_lib/report-filters";
import { adminReportErrorMessage } from "@/app/(secured)/admin/signalements/_lib/admin-errors";
import type { ReportView } from "@/lib/shared/content-reports";

function report(overrides: Partial<ReportView> = {}): ReportView {
  return {
    id: 1,
    category: "COPYRIGHT",
    status: "OPEN",
    description: "Un logo repris sans autorisation.",
    pagePath: null,
    createdAt: "2026-09-20T10:00:00.000Z",
    updatedAt: "2026-09-20T10:00:00.000Z",
    resolvedAt: null,
    purgeAt: null,
    reporter: null,
    contactName: null,
    contactEmail: null,
    rightsRelation: null,
    assignee: null,
    resolutionNote: null,
    targets: [],
    contests: [],
    quarantines: [],
    ...overrides,
  };
}

const contest = { id: 99, description: "Nous avons les droits.", createdAt: "2026-09-21T10:00:00.000Z", author: null, contactEmail: null };

describe("filterReports", () => {
  it("range ce qui attend : à traiter avant en cours, contesté d'abord, puis le plus ancien", () => {
    const reports = [
      report({ id: 1, status: "IN_PROGRESS", createdAt: "2026-09-01T00:00:00Z" }),
      report({ id: 2, status: "OPEN", createdAt: "2026-09-10T00:00:00Z" }),
      report({ id: 3, status: "OPEN", createdAt: "2026-09-05T00:00:00Z" }),
      report({ id: 4, status: "OPEN", createdAt: "2026-09-15T00:00:00Z", contests: [contest] }),
      report({ id: 5, status: "RESOLVED" }),
    ];
    expect(filterReports(reports, DEFAULT_FILTERS).map((item) => item.id)).toEqual([4, 3, 2, 1]);
  });

  it("montre les archives de la plus récente à la plus ancienne", () => {
    const reports = [
      report({ id: 1, status: "RESOLVED", updatedAt: "2026-09-01T00:00:00Z" }),
      report({ id: 2, status: "RESOLVED", updatedAt: "2026-09-03T00:00:00Z" }),
      report({ id: 3, status: "OPEN" }),
    ];
    expect(filterReports(reports, { ...DEFAULT_FILTERS, status: "ARCHIVED" }).map((item) => item.id)).toEqual([2, 1]);
  });

  it("filtre par catégorie et sur les seuls contestés", () => {
    const reports = [
      report({ id: 1, category: "BUG" }),
      report({ id: 2, category: "COPYRIGHT", contests: [contest] }),
      report({ id: 3, category: "COPYRIGHT" }),
    ];
    expect(filterReports(reports, { ...DEFAULT_FILTERS, category: "BUG" }).map((item) => item.id)).toEqual([1]);
    expect(filterReports(reports, { ...DEFAULT_FILTERS, contestedOnly: true }).map((item) => item.id)).toEqual([2]);
  });

  it("ne modifie pas la liste reçue", () => {
    const reports = [report({ id: 2, createdAt: "2026-09-10T00:00:00Z" }), report({ id: 1, createdAt: "2026-09-01T00:00:00Z" })];
    filterReports(reports, DEFAULT_FILTERS);
    expect(reports.map((item) => item.id)).toEqual([2, 1]);
  });
});

describe("compteurs", () => {
  it("compte les signalements actifs par onglet", () => {
    const counts = activeCountsByTab([
      report({ category: "COPYRIGHT" }),
      report({ category: "COPYRIGHT", status: "IN_PROGRESS" }),
      report({ category: "BUG", status: "RESOLVED" }),
      report({ category: "MODERATION" }),
    ]);
    expect(counts).toEqual({ ALL: 3, COPYRIGHT: 2, MODERATION: 1, BUG: 0, OTHER: 0 });
  });

  it("résume les états, contestés actifs compris", () => {
    expect(
      statusSummary([
        report({ status: "OPEN", contests: [contest] }),
        report({ status: "IN_PROGRESS" }),
        report({ status: "RESOLVED", contests: [contest] }),
      ]),
    ).toEqual({ open: 1, inProgress: 1, archived: 1, contested: 1 });
  });

  it("n'offre pas d'onglet aux contestations, rangées sous leur signalement", () => {
    expect(CATEGORY_TABS).toEqual(["ALL", "COPYRIGHT", "MODERATION", "BUG", "OTHER"]);
    expect(categoryTabLabel("ALL")).toBe("Tous");
    expect(categoryTabLabel("COPYRIGHT")).toBe("Droit d'auteur");
  });
});

describe("targetSummary", () => {
  const target = (type: "USER" | "TEAM" | "TOURNAMENT", label: string, id = 1) => ({
    type,
    id,
    label,
    exists: true,
    imageUrl: null,
    detail: null,
  });

  it("nomme une cible seule et compte les autres", () => {
    expect(
      targetSummary(
        report({
          targets: [target("USER", "Nova", 1), target("USER", "Kira", 2), target("TEAM", "Alpha"), target("TOURNAMENT", "Coupe")],
        }),
      ),
    ).toBe("Alpha · 2 joueurs · Coupe");
  });

  it("est vide sans cible", () => {
    expect(targetSummary(report())).toBe("");
  });
});

describe("relativeAge", () => {
  const now = new Date("2026-09-24T12:00:00Z");
  it.each([
    ["2026-09-24T12:00:00Z", "à l'instant"],
    ["2026-09-24T11:48:00Z", "il y a 12 min"],
    ["2026-09-24T09:00:00Z", "il y a 3 h"],
    ["2026-09-21T12:00:00Z", "il y a 3 j"],
    ["2026-09-25T12:00:00Z", "à l'instant"],
  ])("%s → %s", (iso, expected) => {
    expect(relativeAge(iso, now)).toBe(expected);
  });
});

describe("adminReportErrorMessage", () => {
  it.each([
    "REPORT_NOT_FOUND",
    "REPORT_ACTION_NOT_ALLOWED",
    "TEAM_NOT_TARGETED",
    "TEAM_HAS_NO_LOGO",
    "LOGO_CHANGED",
    "LOGO_NOT_MOVABLE",
    "QUARANTINE_NOT_FOUND",
    "QUARANTINE_CLOSED",
    "TEAM_HAS_NEW_LOGO",
    "LOGO_HIDE_FAILED",
    "LOGO_RESTORE_FAILED",
    "LOGO_PURGE_FAILED",
  ])("dit %s en français", (code) => {
    expect(adminReportErrorMessage(code)).not.toContain(code);
  });

  it("ne laisse jamais sortir un jeton inconnu", () => {
    expect(adminReportErrorMessage("SECRET_CODE")).not.toContain("SECRET_CODE");
    expect(adminReportErrorMessage(null)).toMatch(/Réessaie/);
  });
});
