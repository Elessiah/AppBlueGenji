import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  COMMON_RULES,
  TOURNAMENT_RULE_MODES,
  availableRuleModes,
  ruleModeBySlug,
  ruleModeForFormat,
  rulesHrefForFormat,
  upcomingRuleModes,
} from "@/lib/shared/tournament-rules";
import { SCORE_REPORT_TIMEOUT_MINUTES } from "@/lib/shared/constants";
import { LAUNCH_AUTO_DELAY_MINUTES } from "@/lib/shared/match-launch";
import { FORMAT_LABELS } from "@/lib/shared/tournament-labels";
import type { TournamentFormat } from "@/lib/shared/types";

const ROOT = join(__dirname, "..", "..", "..");
const ALL_FORMATS: TournamentFormat[] = ["SINGLE", "DOUBLE", "SWISS", "SURVIVAL", "MULTI", "BG_SURVIE"];

describe("tournament-rules — intégrité du registre", () => {
  it("couvre tous les formats de tournoi, sans doublon", () => {
    const formats = TOURNAMENT_RULE_MODES.map((m) => m.format).sort();
    expect(formats).toEqual([...ALL_FORMATS].sort());
  });

  it("expose des slugs uniques et utilisables en URL", () => {
    const slugs = TOURNAMENT_RULE_MODES.map((m) => m.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const slug of slugs) {
      expect(slug).toMatch(/^[a-z0-9-]+$/);
    }
  });

  it("fournit un contenu non vide pour chaque mode", () => {
    for (const mode of TOURNAMENT_RULE_MODES) {
      expect(mode.label.length).toBeGreaterThan(0);
      expect(mode.tagline.length).toBeGreaterThan(0);
      expect(mode.facts.length).toBeGreaterThanOrEqual(2);
      expect(mode.principles.length).toBeGreaterThanOrEqual(2);
      expect(mode.sections.length).toBeGreaterThanOrEqual(2);
      expect(mode.diagramCaption.length).toBeGreaterThan(0);
      for (const section of mode.sections) {
        expect(section.title.length).toBeGreaterThan(0);
        expect(section.body.length + (section.bullets?.length ?? 0)).toBeGreaterThan(0);
      }
    }
  });

  it("répartit les modes entre disponibles et à venir", () => {
    expect(availableRuleModes().length).toBeGreaterThan(0);
    expect(availableRuleModes().length + upcomingRuleModes().length).toBe(
      TOURNAMENT_RULE_MODES.length,
    );
    // Les modes proposés à la création d'un tournoi doivent être documentés
    // comme disponibles (cf. app/(secured)/tournois/creer/page.tsx). Les quatre
    // formats sont ouverts depuis l'activation de la ronde suisse.
    const creatable: TournamentFormat[] = ["SINGLE", "DOUBLE", "SWISS", "SURVIVAL"];
    for (const format of creatable) {
      expect(ruleModeForFormat(format)?.status).toBe("AVAILABLE");
    }
  });

  it("n'annonce plus aucun mode comme « bientôt disponible »", () => {
    // Garde-fou : un mode documenté mais fermé à la création doit rester en
    // `SOON` tant que `app/api/tournaments/route.ts` refuse son format.
    expect(upcomingRuleModes()).toEqual([]);
  });
});

describe("tournament-rules — résolution", () => {
  it("résout un mode par slug", () => {
    expect(ruleModeBySlug("survie")?.format).toBe("SURVIVAL");
    expect(ruleModeBySlug("inconnu")).toBeNull();
  });

  it("résout un mode par format de tournoi", () => {
    for (const format of ALL_FORMATS) {
      expect(ruleModeForFormat(format)?.format).toBe(format);
    }
  });

  it("construit le lien d'aide de chaque format", () => {
    expect(rulesHrefForFormat("SURVIVAL")).toBe("/regles/survie");
    expect(rulesHrefForFormat("SINGLE")).toBe("/regles/elimination-simple");
    for (const format of ALL_FORMATS) {
      expect(rulesHrefForFormat(format)).toMatch(/^\/regles\/[a-z0-9-]+$/);
    }
  });
});

describe("tournament-rules — Survie par coupes et BlueGenji Survie", () => {
  it("nomme la Survie par coupes comme le reste du site, sans ambiguïté avec BlueGenji Survie", () => {
    const survival = ruleModeForFormat("SURVIVAL");
    expect(survival?.label).toBe(FORMAT_LABELS.SURVIVAL);
    expect(survival?.label).toBe("Survie par coupes");
    expect(ruleModeForFormat("BG_SURVIE")?.label).toBe(FORMAT_LABELS.BG_SURVIE);
    // Chacune renvoie explicitement à l'autre pour marquer la différence.
    expect(survival?.principles.join(" ")).toContain("BlueGenji Survie");
    expect(ruleModeForFormat("BG_SURVIE")?.principles.join(" ")).toContain("Survie par coupes");
  });

  it("documente les pénalités d'endurance de BlueGenji Survie", () => {
    const titles = ruleModeForFormat("BG_SURVIE")?.sections.map((s) => s.title);
    expect(titles).toContain("Pénalités d'endurance");
  });
});

describe("tournament-rules — règles communes", () => {
  it("décrit le report des scores et le forfait", () => {
    const titles = COMMON_RULES.map((r) => r.title);
    expect(titles).toContain("Report des scores");
    expect(titles).toContain("Forfait");
  });

  it("décrit aussi le lancement, le format des matchs et le double forfait", () => {
    const titles = COMMON_RULES.map((r) => r.title);
    expect(titles).toEqual(
      expect.arrayContaining(["Lancement d'un match", "Format des matchs", "Double forfait"]),
    );
  });

  it("annonce le délai de lancement d'office réellement appliqué", () => {
    const launch = COMMON_RULES.find((r) => r.title === "Lancement d'un match");
    expect(launch?.bullets?.join(" ")).toContain(`${LAUNCH_AUTO_DELAY_MINUTES} minutes`);
  });

  it("n'annonce plus qu'un forfait fait toujours quitter le tournoi (faux en BlueGenji Survie)", () => {
    const forfeit = COMMON_RULES.find((r) => r.title === "Forfait");
    const text = [...(forfeit?.body ?? []), ...(forfeit?.bullets ?? [])].join(" ");
    expect(text).not.toContain("L'équipe quitte le tournoi");
    expect(text).toContain("BlueGenji Survie");
  });

  it("annonce le délai de confirmation réellement appliqué par le moteur", () => {
    const reporting = COMMON_RULES.find((r) => r.title === "Report des scores");
    expect(reporting?.bullets?.join(" ")).toContain(String(SCORE_REPORT_TIMEOUT_MINUTES));
  });
});

describe("tournament-rules — câblage des pages", () => {
  const read = (path: string) => readFileSync(join(ROOT, path), "utf8");

  it("expose l'onglet « Règles des tournois » dans le menu burger", () => {
    const nav = read("components/cyber/landing/PublicNavMenu.tsx");
    expect(nav).toContain('href: "/regles"');
    expect(nav).toContain("Règles des tournois");
  });

  it("pré-génère une page par mode et renvoie 404 sur un slug inconnu", () => {
    const page = read("app/regles/[slug]/page.tsx");
    expect(page).toContain("generateStaticParams");
    expect(page).toContain("notFound()");
  });

  it("affiche le bouton d'aide flottant sur les pages de tournoi", () => {
    const detailPage = read("app/(secured)/tournois/[id]/page.tsx");
    // Le bouton cible le mode **affiché à l'écran** : sur un tournoi multi-phases,
    // sélectionner une autre phase change la page de règles visée.
    expect(detailPage).toContain("<RulesHelpFab format={visibleFormat}");
    // Et porte le tournoi, pour que les règles affichent ses réglages.
    expect(detailPage).toContain("tournamentId={detail.card.id}");
    expect(detailPage).toContain("visibleRulesFormat(detail.card, selectedPhase)");
    expect(read("app/(secured)/tournois/page.tsx")).toContain("<RulesHelpFab />");
    expect(read("components/rules/RulesHelpFab.tsx")).toContain("cta-float-help");
  });

  it("style le bouton flottant dans la feuille globale", () => {
    expect(read("app/globals.css")).toContain(".cta-float-help");
  });
});
