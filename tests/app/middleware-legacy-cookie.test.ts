import { describe, expect, it } from "@jest/globals";
import { NextRequest } from "next/server";
import { LEGACY_GOOGLE_ONE_TAP_COOKIE, middleware } from "@/middleware";
import { SUSPENSION_NOTICE_COOKIE } from "@/lib/shared/account-suspension";

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

describe("middleware — exposé d'une suspension lu une seule fois", () => {
  const onPath = (path: string, cookie: string) =>
    middleware(new NextRequest(`https://bluegenji.test${path}`, { headers: { cookie } }));

  it("efface le cookie dans la réponse de /connexion, sans le retirer de la requête lue par la page", () => {
    const response = onPath("/connexion?error=suspended", `${SUSPENSION_NOTICE_COOKIE}=abc`);
    const setCookie = response.headers.get("set-cookie") ?? "";
    expect(setCookie).toMatch(new RegExp(`^${SUSPENSION_NOTICE_COOKIE}=;`));
    expect(setCookie).toMatch(/Max-Age=0/i);
    expect(setCookie).toMatch(/Path=\/connexion/i);
    // La requête transmise à la page garde son en-tête `cookie` d'origine.
    expect(response.headers.get("x-middleware-request-cookie")).toBe(`${SUSPENSION_NOTICE_COOKIE}=abc`);
  });

  it("ne touche à rien ailleurs, ni sans le cookie", () => {
    expect(onPath("/tournois", `${SUSPENSION_NOTICE_COOKIE}=abc`).headers.get("set-cookie")).toBeNull();
    expect(onPath("/connexion", "bg_session=abc").headers.get("set-cookie")).toBeNull();
  });
});
