import { describe, expect, it } from "@jest/globals";
import {
  sponsorBannerSrc,
  sponsorCardMedia,
  sponsorInitial,
  sponsorWebsiteHref,
  sponsorWebsiteLabel,
} from "@/lib/shared/sponsor-card";
import { sponsorLogoProxyPath } from "@/lib/shared/sponsor-logo";

const BANNER = "/api/uploads/sponsors/1-banner.webp";
const LOGO = "/api/uploads/sponsors/1-logo.webp";

describe("sponsorBannerSrc", () => {
  it("serves an uploaded banner from our origin", () => {
    expect(sponsorBannerSrc({ bannerUrl: BANNER })).toBe(BANNER);
    // Forme disque ancienne → forme servie.
    expect(sponsorBannerSrc({ bannerUrl: "/uploads/sponsors/b.webp" })).toBe("/api/uploads/sponsors/b.webp");
  });

  it.each([null, "", "  ", "https://cdn.example.com/b.png", "/api/uploads/avatars/1.webp"])(
    "returns null for %p — jamais une origine étrangère ni un autre dossier",
    (bannerUrl) => {
      expect(sponsorBannerSrc({ bannerUrl })).toBeNull();
    },
  );
});

describe("sponsorCardMedia", () => {
  it("BANNER quand un bandeau existe, le logo passant en pastille", () => {
    expect(sponsorCardMedia({ id: 1, bannerUrl: BANNER, logoUrl: LOGO })).toEqual({
      layout: "BANNER",
      bannerSrc: BANNER,
      logoSrc: LOGO,
    });
  });

  it("BANNER sans logo", () => {
    expect(sponsorCardMedia({ id: 1, bannerUrl: BANNER, logoUrl: null })).toEqual({
      layout: "BANNER",
      bannerSrc: BANNER,
      logoSrc: null,
    });
  });

  it("LOGO sans bandeau — un logo collé passe par le relais", () => {
    const logoUrl = "https://cdn.example.com/logo.png";
    expect(sponsorCardMedia({ id: 4, bannerUrl: null, logoUrl })).toEqual({
      layout: "LOGO",
      bannerSrc: null,
      logoSrc: sponsorLogoProxyPath(4, logoUrl),
    });
  });

  it("PLACEHOLDER sans aucune image", () => {
    expect(sponsorCardMedia({ id: 1, bannerUrl: null, logoUrl: null }).layout).toBe("PLACEHOLDER");
  });

  it("un bandeau étranger ne compte pas : la carte retombe sur le logo", () => {
    expect(sponsorCardMedia({ id: 1, bannerUrl: "https://cdn/b.png", logoUrl: LOGO }).layout).toBe("LOGO");
  });

  it("un partenaire de secours au logo collé n'a pas d'image (pas de relais sans ligne en base)", () => {
    expect(sponsorCardMedia({ id: -1, bannerUrl: null, logoUrl: "https://cdn/l.png" }).layout).toBe("PLACEHOLDER");
  });
});

describe("sponsorWebsiteHref", () => {
  it("keeps http(s) links", () => {
    expect(sponsorWebsiteHref("https://www.youtube.com/@akiu")).toBe("https://www.youtube.com/@akiu");
    expect(sponsorWebsiteHref(" http://exemple.fr ")).toBe("http://exemple.fr/");
  });

  it.each([null, undefined, "", "  ", "javascript:alert(1)", "mailto:a@b.c", "exemple.fr", "https://"])(
    "returns null for %p",
    (url) => {
      expect(sponsorWebsiteHref(url)).toBeNull();
    },
  );
});

describe("sponsorWebsiteLabel", () => {
  it("shows the host without www", () => {
    expect(sponsorWebsiteLabel("https://www.instant-gaming.com/?igr=gamer-1")).toBe("instant-gaming.com");
    expect(sponsorWebsiteLabel("https://discord.gg/abc")).toBe("discord.gg");
  });

  it("returns null without a usable link", () => {
    expect(sponsorWebsiteLabel("javascript:alert(1)")).toBeNull();
    expect(sponsorWebsiteLabel(null)).toBeNull();
  });
});

describe("sponsorInitial", () => {
  it("returns the first character, uppercased", () => {
    expect(sponsorInitial("akiu")).toBe("A");
    expect(sponsorInitial("  émeraude")).toBe("É");
  });

  it("does not split an emoji", () => {
    expect(sponsorInitial("🎮 Club")).toBe("🎮");
  });

  it("falls back on a question mark for an empty name", () => {
    expect(sponsorInitial("   ")).toBe("?");
  });
});
