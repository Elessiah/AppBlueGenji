import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/csp-reports");

import { POST } from "@/app/api/csp-report/route";
import { CSP_REPORT_RULE } from "@/lib/server/api-guard";
import { logCspViolations, parseCspReport } from "@/lib/server/csp-reports";
import { resetRateLimit } from "@/lib/server/rate-limit";

function cspReq(body: unknown, headers: Record<string, string> = {}) {
  return new Request("http://localhost/api/csp-report", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

describe("POST /api/csp-report", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetRateLimit(CSP_REPORT_RULE.name);
    jest.mocked(parseCspReport).mockReturnValue([]);
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("répond toujours 204, y compris sur un rapport lisible", async () => {
    const res = await POST(cspReq({ "csp-report": { "violated-directive": "img-src" } }));

    expect(res.status).toBe(204);
    expect(await res.text()).toBe("");
  });

  it("journalise ce que parseCspReport a lu du corps", async () => {
    const parsed = [{ directive: "img-src", blockedOrigin: "https://exemple.invalid", documentPath: "/" }];
    jest.mocked(parseCspReport).mockReturnValue(parsed);

    await POST(cspReq({ "csp-report": {} }));

    expect(logCspViolations).toHaveBeenCalledWith(parsed);
  });

  it("répond 204 sans journaliser sur un corps illisible", async () => {
    const res = await POST(cspReq("pas du json"));

    expect(res.status).toBe(204);
    expect(parseCspReport).not.toHaveBeenCalled();
    expect(logCspViolations).not.toHaveBeenCalled();
  });

  it("répond 204 sans journaliser sur un corps absent", async () => {
    const res = await POST(
      new Request("http://localhost/api/csp-report", { method: "POST" }),
    );

    expect(res.status).toBe(204);
    expect(logCspViolations).not.toHaveBeenCalled();
  });

  it("plafonne le débit par IP plutôt que de journaliser indéfiniment", async () => {
    const headers = { "x-forwarded-for": "203.0.113.9" };
    for (let i = 0; i < CSP_REPORT_RULE.limit; i++) {
      const res = await POST(cspReq({ "csp-report": {} }, headers));
      expect(res.status).toBe(204);
    }

    const throttled = await POST(cspReq({ "csp-report": {} }, headers));

    expect(throttled.status).toBe(429);
    expect(logCspViolations).toHaveBeenCalledTimes(CSP_REPORT_RULE.limit);
  });

  it("ne partage pas le quota entre deux IP distinctes", async () => {
    for (let i = 0; i < CSP_REPORT_RULE.limit; i++) {
      await POST(cspReq({ "csp-report": {} }, { "x-forwarded-for": "203.0.113.9" }));
    }

    const res = await POST(cspReq({ "csp-report": {} }, { "x-forwarded-for": "198.51.100.4" }));

    expect(res.status).toBe(204);
  });
});
