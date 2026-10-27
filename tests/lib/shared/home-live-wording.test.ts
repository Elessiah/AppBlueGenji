import { describe, expect, it } from "@jest/globals";
import { readSource } from "../../helpers/read-source";
import frLanding from "@/messages/fr/landing.json";
import enLanding from "@/messages/en/landing.json";
import frShare from "@/messages/fr/share.json";
import enShare from "@/messages/en/share.json";

/**
 * Glossaire (`LIVE_STREAMS.md`) : « En direct » / « live » ne désigne qu'une
 * vraie diffusion. Les brackets de l'accueil se mettent à jour en temps réel,
 * ils ne sont pas « en direct » ; la carte vide attend un match lancé, diffusé
 * ou non.
 */
const SOURCES = ["lib/shared/share-metadata.ts", "lib/shared/site-copy.ts"];

describe("accueil — « En direct » réservé à la diffusion", () => {
  it.each(SOURCES)("%s ne parle plus de brackets « en direct »", (path) => {
    const source = readSource(path);
    expect(source).not.toMatch(/brackets en direct/i);
    expect(source).not.toMatch(/live brackets/i);
    expect(source).toContain("brackets en temps réel");
  });

  it("description et sous-titre d'aperçu de l'accueil, FR et EN", () => {
    expect(frLanding.meta.description).toContain("brackets en temps réel");
    expect(enLanding.meta.description).toContain("real-time brackets");
    expect(frShare.pages.home.subtitle).toContain("brackets en temps réel");
    expect(enShare.pages.home.subtitle).toContain("real-time brackets");
    for (const text of [frLanding.meta.description, frShare.pages.home.subtitle]) expect(text).not.toMatch(/en direct/i);
    for (const text of [enLanding.meta.description, enShare.pages.home.subtitle]) expect(text).not.toMatch(/\blive\b/i);
  });

  it("la carte sans match n'annonce pas un match « en direct »", () => {
    expect(frLanding.live.emptyMatch).toBe("Le prochain match sera affiché ici dès son lancement.");
    expect(enLanding.live.emptyMatch).toBe("The next match will show up here as soon as it starts.");
  });
});
