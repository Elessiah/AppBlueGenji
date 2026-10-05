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
    ["components/cyber/landing/PublicFooter.tsx", /<Link className="tap-target" href="\/rgpd">/],
    ["components/legal/SiteFooterBar.tsx", /<Link className="tap-target" href="\/rgpd">/],
    ["app/(secured)/tournois/[id]/_components/TournamentHeader.tsx", /\$\{s\.back\} tap-target/],
    ["app/(secured)/tournois/[id]/_components/SurvivalView.tsx", /btn tap-target"/],
    ["app/(secured)/tournois/[id]/_components/SwissView.tsx", /btn tap-target"/],
    ["app/(secured)/tournois/[id]/_components/EnduranceView.tsx", /btn tap-target"/],
    // Pied d'action de la carte de match : action principale, éléments du
    // panneau et bouton « Plus d'actions ».
    ["app/(secured)/tournois/[id]/_components/MatchCardActions.tsx", /"tap-target",\s*inMenu \? styles\.item/],
    ["app/(secured)/tournois/[id]/_components/MatchCardActions.tsx", /`tap-target \$\{styles\.toggle\}/],
    ["components/match-launch/MatchLaunchCenter.tsx", /\$\{styles\.copy\} tap-target/],
    ["app/(secured)/joueurs/cards/PlayerCard.tsx", /\$\{s\.aboveOverlay\} tap-target/],
    ["app/recrutement/RecruitmentSection.tsx", /\$\{styles\.readMore\} tap-target/],
  ])("%s porte la zone étendue", (file, pattern) => {
    expect(readFileSync(join(ROOT, file), "utf8")).toMatch(pattern);
  });
});
