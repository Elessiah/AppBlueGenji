import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  RULES_PAGE_ANCHORS,
  outlineAnchorIds,
  ruleAnchorSlug,
  ruleSectionAnchors,
  rulesPageOutline,
} from "@/lib/shared/rules-page-outline";
import { TOURNAMENT_RULE_MODES, ruleModeBySlug } from "@/lib/shared/tournament-rules";
import frRules from "@/messages/fr/rules.json";

const labels = frRules.toc;

describe("ruleAnchorSlug", () => {
  it("retire accents, apostrophes et ponctuation", () => {
    expect(ruleAnchorSlug("Phase qualificative — l'endurance")).toBe("phase-qualificative-l-endurance");
    expect(ruleAnchorSlug("Forfait : deux gestes à ne pas confondre")).toBe(
      "forfait-deux-gestes-a-ne-pas-confondre",
    );
  });

  it("ne laisse aucun tiret en bord", () => {
    expect(ruleAnchorSlug("  « Déroulé »  ")).toBe("deroule");
  });

  it("rend une chaîne vide pour un titre sans lettre", () => {
    expect(ruleAnchorSlug("— ? —")).toBe("");
  });
});

describe("ruleSectionAnchors", () => {
  it("préfixe chaque ancre pour ne jamais heurter une ancre fixe", () => {
    expect(ruleSectionAnchors([{ title: "Classement final" }])).toEqual([
      "regle-classement-final",
    ]);
  });

  it("départage deux titres identiques", () => {
    const anchors = ruleSectionAnchors([
      { title: "Forfait" },
      { title: "Forfait" },
      { title: "Forfait !" },
    ]);
    expect(anchors).toEqual(["regle-forfait", "regle-forfait-2", "regle-forfait-3"]);
  });

  it("donne une ancre à un titre sans lettre", () => {
    expect(ruleSectionAnchors([{ title: "—" }])).toEqual(["regle-section"]);
  });
});

describe("rulesPageOutline", () => {
  const mode = ruleModeBySlug("bluegenji-survie")!;

  it("n'annonce les réglages du tournoi que s'ils sont affichés", () => {
    const without = rulesPageOutline(mode, { hasTournamentSettings: false, labels });
    const withSettings = rulesPageOutline(mode, { hasTournamentSettings: true, labels });
    expect(without.map((e) => e.id)).not.toContain(RULES_PAGE_ANCHORS.tournament);
    expect(withSettings[0].id).toBe(RULES_PAGE_ANCHORS.tournament);
  });

  it("suit l'ordre de la page", () => {
    expect(rulesPageOutline(mode, { hasTournamentSettings: true, labels }).map((e) => e.id)).toEqual([
      RULES_PAGE_ANCHORS.tournament,
      RULES_PAGE_ANCHORS.essentials,
      RULES_PAGE_ANCHORS.details,
      RULES_PAGE_ANCHORS.common,
      RULES_PAGE_ANCHORS.others,
    ]);
  });

  it("liste chaque règle du mode sous « Règles du mode », avec l'ancre de la page", () => {
    const details = rulesPageOutline(mode, { hasTournamentSettings: false, labels }).find(
      (e) => e.id === RULES_PAGE_ANCHORS.details,
    )!;
    expect(details.children?.map((c) => c.label)).toEqual(mode.sections.map((s) => s.title));
    expect(details.children?.map((c) => c.id)).toEqual(ruleSectionAnchors(mode.sections));
  });

  it("prend les libellés de la langue de la page et les ancres qu'on lui donne", () => {
    const outline = rulesPageOutline(
      { sections: [{ title: "Cuts", body: [] }] },
      { hasTournamentSettings: true, labels: { ...labels, details: "Mode rules" }, anchors: ["regle-coupes"] },
    );
    expect(outline.find((e) => e.id === RULES_PAGE_ANCHORS.details)).toEqual({
      id: RULES_PAGE_ANCHORS.details,
      label: "Mode rules",
      children: [{ id: "regle-coupes", label: "Cuts" }],
    });
    expect(outline[0].label).toBe(labels.tournament);
  });

  it.each(TOURNAMENT_RULE_MODES.map((m) => [m.slug, m] as [string, typeof m]))(
    "%s : toutes les ancres sont uniques",
    (_slug, m) => {
      const ids = outlineAnchorIds(rulesPageOutline(m, { hasTournamentSettings: true, labels }));
      expect(new Set(ids).size).toBe(ids.length);
    },
  );
});

/**
 * Le sommaire et les titres descendent du même plan : une ancre qui ne serait
 * posée que d'un côté donnerait un lien qui ne mène nulle part, sans erreur.
 */
describe("page /regles/[slug]", () => {
  const source = readFileSync(join(process.cwd(), "app/regles/[slug]/page.tsx"), "utf8");

  it("pose chaque ancre fixe du sommaire sur un titre", () => {
    for (const key of Object.keys(RULES_PAGE_ANCHORS)) {
      expect(source).toContain(`id={RULES_PAGE_ANCHORS.${key}}`);
    }
  });

  it("pose les ancres des règles par le même calcul que le sommaire", () => {
    expect(source).toContain("ruleSectionAnchors(frenchMode.sections)");
    expect(source).toContain("anchors: ruleAnchors");
    expect(source).toContain("id={ruleAnchors[i]}");
    expect(source).toContain("<RulesToc entries={outline}");
  });
});
