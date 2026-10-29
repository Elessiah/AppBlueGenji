import { describe, expect, it } from "@jest/globals";
import { concernedReportLoadFailure } from "@/lib/shared/concerned-report-load";

describe("concernedReportLoadFailure", () => {
  it.each([404, 403, 401])("le statut %i dit « introuvable » : réessayer n'y change rien", (status) => {
    expect(concernedReportLoadFailure(status)).toBe("missing");
  });

  it.each([500, 502, 503, 429, 400])("le statut %i propose de réessayer", (status) => {
    expect(concernedReportLoadFailure(status)).toBe("error");
  });

  it("une requête qui n'a pas abouti (réseau) propose de réessayer", () => {
    expect(concernedReportLoadFailure(null)).toBe("error");
  });
});
