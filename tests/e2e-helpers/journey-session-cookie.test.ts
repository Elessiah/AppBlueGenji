import { describe, expect, it } from "@jest/globals";
import { journeySessionCookie } from "../../e2e/helpers/player-journey-fixture";

/**
 * Le parcours joueur pose lui-même le cookie de session : contre une build de
 * production servie en https, il doit porter le nom `__Host-` que le site lit,
 * et `Secure` — sinon tout le parcours tourne déconnecté.
 */
describe("journeySessionCookie", () => {
  it("journeySessionCookie_httpsBaseUrl_returnsHostPrefixedSecureCookie", () => {
    expect(journeySessionCookie("https://staging.example.test")).toEqual({
      name: "__Host-bg_session",
      secure: true,
    });
  });

  it("journeySessionCookie_httpBaseUrl_returnsBareCookie", () => {
    expect(journeySessionCookie("http://localhost:3100")).toEqual({ name: "bg_session", secure: false });
  });

  it("journeySessionCookie_httpWithProductionOverride_returnsHostPrefixedSecureCookie", () => {
    expect(journeySessionCookie("http://localhost:3000", "1")).toEqual({ name: "__Host-bg_session", secure: true });
  });

  it("journeySessionCookie_httpsWithDevelopmentOverride_returnsBareCookie", () => {
    expect(journeySessionCookie("https://localhost:3100", "0")).toEqual({ name: "bg_session", secure: false });
  });

  it("journeySessionCookie_unknownOverride_fallsBackToProtocol", () => {
    expect(journeySessionCookie("https://staging.example.test", "yes")).toEqual({
      name: "__Host-bg_session",
      secure: true,
    });
  });
});
