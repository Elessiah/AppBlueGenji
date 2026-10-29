import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT, blockFor } from "./_lib/style-sweep";

/**
 * Cibles tactiles (WCAG 2.5.8) : les petits contrôles relevés par l'audit
 * mobile portent `.tap-target`, qui étend la zone sensible par un
 * pseudo-élément sans toucher à la mise en page — la carte de match garde sa
 * hauteur, sur laquelle l'arbre cale ses connecteurs.
 */
describe("zones de tap étendues", () => {
  it("étend la zone par un pseudo-élément centré, au plancher de 24 px", () => {
    const after = blockFor(/\.tap-target::after\s*\{/);
    expect(after).toMatch(/position:\s*absolute/);
    expect(after).toMatch(/width:\s*max\(100%,\s*24px\)/);
    expect(after).toMatch(/height:\s*max\(100%,\s*24px\)/);
    expect(after).toMatch(/translate\(-50%,\s*-50%\)/);
  });

  it("ne repositionne pas un contrôle déjà positionné", () => {
    // Spécificité nulle : `.aboveOverlay` (z-index 2, au-dessus de la plaque
    // des cartes d'annuaire) garde sa position et son étage.
    expect(blockFor(/:where\(\.tap-target\)\s*\{/)).toMatch(/position:\s*relative/);
  });

  it("laisse déborder la zone d'un `.btn`, qui rogne sinon son contenu", () => {
    expect(blockFor(/\.btn\.tap-target\s*\{/)).toMatch(/overflow:\s*visible/);
  });

  it.each<[string, RegExp]>([
    ["components/cyber/landing/PublicFooter.tsx", /<LocaleLink className="tap-target" href="\/rgpd">/],
    ["components/legal/SiteFooterBar.tsx", /<LocaleLink className="tap-target" href="\/rgpd">/],
    ["app/(secured)/tournois/[id]/_components/TournamentHeader.tsx", /\$\{s\.back\} tap-target/],
    // Abandon et annulation des classements survie, suisse et endurance.
    ["app/(secured)/tournois/[id]/_components/ForfeitRowAction.tsx", /btn tap-target"/],
    ["app/(secured)/tournois/[id]/_components/EnduranceView.tsx", /btn tap-target"/],
    // Pied d'action de la carte de match : action principale, éléments du
    // panneau et bouton « Plus d'actions ».
    ["app/(secured)/tournois/[id]/_components/MatchCardActions.tsx", /"tap-target",\s*inMenu \? styles\.item/],
    ["app/(secured)/tournois/[id]/_components/MatchCardActions.tsx", /`tap-target \$\{styles\.toggle\}/],
    ["components/match-launch/LaunchContactCards.tsx", /\$\{styles\.copy\} tap-target/],
    ["app/(secured)/joueurs/cards/PlayerCard.tsx", /\$\{s\.aboveOverlay\} tap-target/],
    ["app/recrutement/RecruitmentSection.tsx", /\$\{styles\.readMore\} tap-target/],
    // Page du match : « Page du match », « +N » des streams et retour à la fiche.
    ["app/(secured)/tournois/[id]/_components/MatchCardActions.tsx", /\["tap-target", inMenu \? styles\.item/],
    ["app/(secured)/tournois/[id]/_components/MatchLiveStrip.tsx", /\$\{styles\.more\} tap-target/],
    ["app/(secured)/tournois/[id]/_components/MatchPage.tsx", /\$\{styles\.back\} tap-target/],
  ])("%s porte la zone étendue", (file, pattern) => {
    expect(readFileSync(join(ROOT, file), "utf8")).toMatch(pattern);
  });
});

describe("liens de stream rognés par l'ellipse : 24 px par la hauteur de ligne (EF-30)", () => {
  const css = (file: string) => readFileSync(join(ROOT, file), "utf8");

  it("MatchLiveStrip_link_atLeast24pxHigh", () => {
    const block = blockFor(/^\.link \{/m, css("app/(secured)/tournois/[id]/_components/MatchLiveStrip.module.css"));
    expect(block).toContain("min-height: 24px");
    expect(block).toContain("line-height: 24px");
  });

  it("MatchPage_streamLink_atLeast24pxHigh", () => {
    const block = blockFor(/^\.streamLink \{/m, css("app/(secured)/tournois/[id]/_components/MatchPage.module.css"));
    expect(block).toContain("min-height: 24px");
    expect(block).toContain("line-height: 24px");
  });

  it("LiveCard_streamButton_playIconStaysOnFirstLine", () => {
    const block = blockFor(/^\.streamButton \{/m, css("components/cyber/landing/LiveCard.module.css"));
    expect(block).toContain("align-items: flex-start");
  });

  it("MatchPage_mapForm_errorBelowInputAndButtonRow", () => {
    const page = css("app/(secured)/tournois/[id]/_components/MatchPage.tsx");
    const form = page.slice(page.indexOf("<form className={styles.mapForm}"), page.indexOf("</form>", page.indexOf("styles.mapForm")));
    expect(form.indexOf('type="submit"')).toBeLessThan(form.indexOf("<FieldErrorText"));
    expect(form.indexOf("<div className={styles.mapRow}>")).toBeLessThan(form.indexOf('type="submit"'));
  });
});
