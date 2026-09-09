import { describe, expect, it } from "@jest/globals";
import {
  acceptedLogoContentType,
  isPrivateLogoHostname,
  isStoredSponsorLogo,
  parseRemoteLogoUrl,
  sponsorLogoProxyPath,
  sponsorLogoSrc,
} from "@/lib/shared/sponsor-logo";

describe("sponsorLogoSrc", () => {
  it("returns null when there is no logo", () => {
    expect(sponsorLogoSrc({ id: 1, logoUrl: null })).toBeNull();
    expect(sponsorLogoSrc({ id: 1, logoUrl: "" })).toBeNull();
    expect(sponsorLogoSrc({ id: 1, logoUrl: "   " })).toBeNull();
  });

  it("serves an imported logo from our uploads route", () => {
    expect(sponsorLogoSrc({ id: 7, logoUrl: "/uploads/sponsors/1-abc.webp" })).toBe(
      "/api/uploads/sponsors/1-abc.webp",
    );
  });

  it("leaves an already-served upload url untouched", () => {
    expect(sponsorLogoSrc({ id: 7, logoUrl: "/api/uploads/sponsors/1-abc.webp" })).toBe(
      "/api/uploads/sponsors/1-abc.webp",
    );
  });

  it("routes a pasted remote url through the proxy, never to the third party", () => {
    const src = sponsorLogoSrc({ id: 42, logoUrl: "https://cdn.example.com/logo.png" });
    expect(src).toBe("/api/landing/sponsors/42/logo");
    expect(src).not.toContain("example.com");
  });

  it("trims the stored value before deciding", () => {
    expect(sponsorLogoSrc({ id: 42, logoUrl: "  https://cdn.example.com/logo.png  " })).toBe(
      "/api/landing/sponsors/42/logo",
    );
  });

  it("keeps the raw url for fallback sponsors, which have no row to read back", () => {
    // `FALLBACK_SPONSORS` porte des identifiants négatifs : le relais ne
    // trouverait rien en base et répondrait 404.
    expect(sponsorLogoSrc({ id: -3, logoUrl: "https://cdn.example.com/logo.png" })).toBe(
      "https://cdn.example.com/logo.png",
    );
  });

  it("builds the proxy path from the sponsor id", () => {
    expect(sponsorLogoProxyPath(12)).toBe("/api/landing/sponsors/12/logo");
  });
});

describe("isStoredSponsorLogo", () => {
  it("recognises both the disk and the served form", () => {
    expect(isStoredSponsorLogo("/uploads/sponsors/a.webp")).toBe(true);
    expect(isStoredSponsorLogo("/api/uploads/sponsors/a.webp")).toBe(true);
  });

  it("rejects remote urls and empty values", () => {
    expect(isStoredSponsorLogo("https://cdn.example.com/a.png")).toBe(false);
    expect(isStoredSponsorLogo(null)).toBe(false);
    expect(isStoredSponsorLogo(undefined)).toBe(false);
  });
});

describe("parseRemoteLogoUrl", () => {
  it("accepts a plain https url", () => {
    expect(parseRemoteLogoUrl("https://cdn.example.com/logo.png")?.hostname).toBe("cdn.example.com");
  });

  it.each([
    ["http://cdn.example.com/logo.png", "clear text"],
    ["ftp://cdn.example.com/logo.png", "another scheme"],
    ["data:image/png;base64,AAAA", "a data url"],
    ["javascript:alert(1)", "a script url"],
    ["/uploads/sponsors/a.webp", "a relative path"],
    ["not a url", "garbage"],
    ["", "an empty string"],
  ])("rejects %s (%s)", (value) => {
    expect(parseRemoteLogoUrl(value)).toBeNull();
  });

  it("rejects hosts on the machine's own network", () => {
    for (const host of ["localhost", "127.0.0.1", "10.0.0.5", "192.168.1.1", "169.254.169.254"]) {
      expect(parseRemoteLogoUrl(`https://${host}/logo.png`)).toBeNull();
    }
  });
});

describe("isPrivateLogoHostname", () => {
  it("accepts ordinary public hosts", () => {
    for (const host of ["cdn.example.com", "8.8.8.8", "images-ext-1.discordapp.net", "203.0.113.7"]) {
      expect(isPrivateLogoHostname(host)).toBe(false);
    }
  });

  it("rejects loopback and link-local names", () => {
    for (const host of ["localhost", "app.localhost", "printer.local", "vault.internal", "db.home.arpa"]) {
      expect(isPrivateLogoHostname(host)).toBe(true);
    }
  });

  it("rejects the private IPv4 ranges", () => {
    for (const host of [
      "0.0.0.0",
      "127.0.0.1",
      "10.1.2.3",
      "172.16.0.1",
      "172.31.255.255",
      "192.168.0.1",
      "169.254.169.254",
      "100.64.0.1",
      "239.0.0.1",
    ]) {
      expect(isPrivateLogoHostname(host)).toBe(true);
    }
  });

  it("keeps the public halves of the 172.x and 100.x blocks", () => {
    expect(isPrivateLogoHostname("172.15.0.1")).toBe(false);
    expect(isPrivateLogoHostname("172.32.0.1")).toBe(false);
    expect(isPrivateLogoHostname("100.63.0.1")).toBe(false);
    expect(isPrivateLogoHostname("100.128.0.1")).toBe(false);
  });

  it("rejects IPv6 loopback, link-local and unique-local addresses", () => {
    for (const host of ["::1", "[::1]", "fe80::1", "fd00::1", "fc00::1", "::ffff:127.0.0.1"]) {
      expect(isPrivateLogoHostname(host)).toBe(true);
    }
  });

  it("rejects an empty hostname", () => {
    expect(isPrivateLogoHostname("")).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(isPrivateLogoHostname("LOCALHOST")).toBe(true);
  });
});

describe("acceptedLogoContentType", () => {
  it("accepts the raster formats and normalises the header", () => {
    expect(acceptedLogoContentType("image/png")).toBe("image/png");
    expect(acceptedLogoContentType("IMAGE/WEBP; charset=binary")).toBe("image/webp");
    expect(acceptedLogoContentType("  image/avif  ")).toBe("image/avif");
  });

  it("rejects svg — a scriptable document served from our own origin", () => {
    expect(acceptedLogoContentType("image/svg+xml")).toBeNull();
  });

  it("rejects anything that is not an accepted image type", () => {
    expect(acceptedLogoContentType("text/html")).toBeNull();
    expect(acceptedLogoContentType("application/octet-stream")).toBeNull();
    expect(acceptedLogoContentType(null)).toBeNull();
    expect(acceptedLogoContentType("")).toBeNull();
  });
});
