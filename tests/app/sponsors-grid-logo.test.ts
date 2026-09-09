import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "..", "..");
const source = readFileSync(
  join(ROOT, "components/cyber/landing/SponsorsGrid.tsx"),
  "utf8",
);

/**
 * La vitrine est le seul endroit du site qui rende une URL saisie librement par
 * le staff. Le jour où elle repasserait sur un `<img>` pointant cette URL, la
 * page rappellerait des CDN étrangers sans qu'aucun test de logique ne s'en
 * aperçoive : les six audits qui en dépendent ne se voient qu'à l'exécution.
 * D'où ce garde-fou au niveau source, comme pour `PublicHeader`.
 */
describe("SponsorsGrid — logos servis depuis notre origine", () => {
  const publicGrid = source.slice(
    source.indexOf("displaySponsors.map"),
    source.indexOf("{open && mounted"),
  );

  it("passe par la porte unique `sponsorLogoSrc`", () => {
    expect(source).toContain('from "@/lib/shared/sponsor-logo"');
    expect(publicGrid).toContain("sponsorLogoSrc(sponsor)");
  });

  it("ne met jamais `sponsor.logoUrl` dans le src de la vitrine", () => {
    expect(publicGrid).not.toContain("sponsor.logoUrl");
    expect(publicGrid).not.toContain("toServedUploadUrl(sponsor");
  });

  it("rend le logo public avec next/image, jamais avec un <img> brut", () => {
    expect(source).toContain('import Image from "next/image"');
    expect(publicGrid).toContain("<Image");
    expect(publicGrid).not.toContain("<img");
  });

  it("déclare `sizes` — sans lui, `fill` demande la plus grande variante à tout le monde", () => {
    expect(publicGrid).toContain("sizes=");
    // Les deux points de rupture de la grille (3 colonnes, puis 2 sous 900 px).
    expect(publicGrid).toContain("max-width: 900px");
  });

  it("garde un <img> brut pour l'aperçu de la modale, qui montre une URL non enregistrée", () => {
    const modal = source.slice(source.indexOf("{open && mounted"));
    expect(modal).toContain("<img");
    expect(modal).toContain("form.logoUrl");
  });
});
