import { describe, expect, it } from "@jest/globals";
import { NextRequest } from "next/server";
import { LEGACY_GOOGLE_ONE_TAP_COOKIE, middleware } from "@/middleware";

function request(cookie?: string): NextRequest {
  return new NextRequest("https://bluegenji.test/tournois", {
    headers: cookie ? { cookie } : {},
  });
}

describe("middleware — cookie de l'invite Google One Tap retirée", () => {
  it("efface g_state chez qui le porte encore, sur n'importe quelle page", () => {
    const response = middleware(request(`${LEGACY_GOOGLE_ONE_TAP_COOKIE}=0_l:0; bg_session=abc`));
    const setCookie = response.headers.get("set-cookie") ?? "";
    expect(setCookie).toMatch(/^g_state=;/);
    expect(setCookie).toMatch(/Expires=Thu, 01 Jan 1970/i);
    expect(setCookie).toMatch(/Path=\//i);
    // Les autres cookies ne sont pas touchés.
    expect(setCookie).not.toMatch(/bg_session/);
  });

  it("ne pose aucun cookie quand g_state est absent", () => {
    expect(middleware(request("bg_session=abc")).headers.get("set-cookie")).toBeNull();
  });
});
