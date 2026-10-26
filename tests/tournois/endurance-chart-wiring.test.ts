import { describe, expect, it } from "@jest/globals";
import { readSource } from "../helpers/read-source";
import frViews from "@/messages/fr/tournamentViews.json";
import enViews from "@/messages/en/tournamentViews.json";

/**
 * Câblage du graphique « Évolution de l'endurance »
 * (`docs/features/ENDURANCE_RANKING_VIEWS.md`, § Graphique) : volet replié,
 * chargement à la demande, mouvement, défilement, couleurs, accessibilité,
 * lecture seule et textes FR + EN.
 */

const DIR = "app/(secured)/tournois/[id]/_components";
const PANEL = readSource(`${DIR}/EnduranceChartPanel.tsx`);
const CHART = readSource(`${DIR}/EnduranceChart.tsx`);
const CSS = readSource(`${DIR}/EnduranceChart.module.css`);
const LIB = readSource("app/(secured)/tournois/[id]/_lib/endurance-chart.ts");
const VIEW = readSource(`${DIR}/EnduranceView.tsx`);

describe("volet et chargement", () => {
  it("le volet est replié à chaque chargement", () => {
    expect(PANEL).toContain("useState(false)");
    expect(PANEL).toContain("<BoardPanel");
    expect(PANEL).toContain('t("endurance.chartTitle")');
  });

  it("le graphique est chargé à la demande, rendu seulement volet ouvert", () => {
    expect(PANEL).toMatch(/dynamic\(\s*\(\) => orReload\(import\("\.\/EnduranceChart"\)/);
    expect(PANEL).not.toMatch(/import \{[^}]*EnduranceChart\b[^}]*\} from "\.\/EnduranceChart"/);
    // BoardPanel ne rend ses enfants qu'ouvert : le graphique se monte au dépliage.
    expect(readSource(`${DIR}/BoardPanel.tsx`)).toContain("{open && (");
  });

  it("la vue d'endurance pose le volet après le journal des sanctions", () => {
    expect(VIEW.indexOf("<EnduranceChartPanel")).toBeGreaterThan(VIEW.indexOf("<PenaltyLog"));
    expect(VIEW).toContain('import { EnduranceChartPanel } from "./EnduranceChartPanel"');
  });
});

describe("mouvement", () => {
  it("lit le régime client et le mouvement réduit", () => {
    expect(CHART).toContain("useClientPower()");
    expect(CHART).toContain("useClientPowerInput()");
    expect(CHART).toContain("const animate = decorativeMotion && !reducedMotion;");
  });

  it("une seule image sans animation, rAF annulé au démontage (repli)", () => {
    expect(CHART).toMatch(/if \(!animate \|\| from === to\) \{\s*setProgress\(to\);\s*return;/);
    expect(CHART).toContain("cancelAnimationFrame(frame.current)");
    expect(CHART).toMatch(/runTo\(lastRound, 0\);\s*return stop;/);
  });

  it("une manche poussée par le flux volet ouvert est suivie si le lecteur suit la dernière", () => {
    expect(CHART).toContain("useState<number | null>(null)");
    expect(CHART).toContain("const shown = chartShownRound(target, lastRound);");
    expect(CHART).toContain("setTarget(chartTargetFor(round, lastRound));");
    expect(CHART).toMatch(/if \(previous === lastRound \|\| target !== null\) return;\s*runTo\(lastRound, Math\.min\(progressRef\.current, previous\)\);/);
  });

  it("l'encart lit le bilan à la manche affichée, comme le rang", () => {
    expect(CHART).toContain("...chartRecordAt(hovered, shown, lastRound),");
    expect(CHART).not.toContain("wins: hovered.standing.wins");
  });

  it("« Effacer la sélection » reste monté (focus gardé), aria-disabled une fois vide", () => {
    expect(CHART).toMatch(/\{mode === "PICK" && \(\s*<button[^>]*aria-disabled=\{picked\.length === 0\}/);
    expect(CHART).not.toContain('mode === "PICK" && picked.length > 0 &&');
    expect(CSS).toMatch(/\.ghostButton\[aria-disabled="true"\] \{[^}]*color: var\(--ink-dim\);/);
  });

  it("l'aide du mode est derrière un bouton « i », jamais en paragraphe permanent", () => {
    expect(CHART).toContain('import { InfoHint, InfoHintRow } from "@/components/ui/info-hint";');
    expect(CHART).toMatch(/<InfoHint id=\{`\$\{hintId\}-mode`\} subject=\{t\(`endurance\.chartModes\$\{kind\}`\)\}>\s*\{modeHint\}\s*<\/InfoHint>/);
    expect(CHART).not.toContain("<p className={styles.hint}>{modeHint}</p>");
  });

  it("aucune animation CSS infinie", () => {
    expect(CSS).not.toMatch(/animation\s*:/);
    expect(CSS).not.toContain("infinite");
  });
});

describe("couleurs, polices, accessibilité", () => {
  it("aucun ambre", () => {
    const amber = /--amber\b|--amber-rgb|245,\s*165,\s*36|#f5a524|\bAMBER\b/i;
    for (const source of [PANEL, CHART, CSS, LIB]) expect(source).not.toMatch(amber);
  });

  it("texte HTML ≥ 11 px, pas d'opacité sur un bouton désactivé", () => {
    const sizes = [...CSS.matchAll(/font-size:\s*(\d+)px/g)].map((m) => Number(m[1]));
    expect(Math.min(...sizes)).toBeGreaterThanOrEqual(11);
    expect(CSS).not.toMatch(/:disabled\s*\{[^}]*opacity/);
  });

  it("légende dans une ScrollArea nommée", () => {
    expect(CHART).toMatch(/<ScrollArea orientation="y" ariaLabel=\{t\(`endurance\.chartLegend\$\{kind\}`\)\}/);
    expect(CHART).not.toMatch(/overflow(-y)?:\s*auto/);
    expect(CSS).not.toMatch(/overflow(-y)?:\s*auto/);
  });

  it("SVG nommé, tableau pour lecteurs d'écran", () => {
    expect(CHART).toContain('role="img"');
    expect(CHART).toContain("aria-label={svgLabel}");
    expect(CHART).toContain('<table className="sr-only">');
    expect(CHART).toContain("<caption>");
    expect(CHART).toContain('<th scope="row">');
  });

  it("survol, focus et clic donnent le même résultat dans la légende", () => {
    for (const handler of ["onMouseEnter={() => setHover(item.teamId)}", "onFocus={() => setHover(item.teamId)}", "onClick={() => toggle(item.teamId)}"]) {
      expect(CHART).toContain(handler);
    }
    expect(CHART).toContain("aria-pressed=");
  });

  it("manches à venir désactivées", () => {
    expect(CHART).toContain('disabled={state === "UPCOMING"}');
  });
});

describe("noms, lecture seule, stockage", () => {
  it("les noms passent par visibleText, jamais en HTML", () => {
    expect(CHART).toContain("visibleText(item.teamName)");
    expect(CHART).toContain("visibleText(hovered.teamName)");
    expect(CHART).not.toContain("dangerouslySetInnerHTML");
  });

  it("la sélection n'est stockée nulle part, aucun geste d'écriture", () => {
    for (const source of [PANEL, CHART, LIB]) {
      expect(source).not.toMatch(/localStorage|sessionStorage|indexedDB|document\.cookie|fetch\(/);
    }
    expect(CHART).not.toMatch(/onForfeit|onPenalize|renderActions|canForfeit/);
  });
});

describe("textes FR + EN", () => {
  it("chaque clé du graphique existe dans les deux langues", () => {
    const keys = (source: string) => [...source.matchAll(/endurance\.(chart[A-Za-z]+)/g)].map((m) => m[1]);
    // `endurance.chartModes${kind}` se lit « chartModes » : la variante est vérifiée plus bas.
    const used = new Set([...keys(PANEL), ...keys(CHART)]);
    const fr = frViews.endurance as Record<string, string>;
    const en = enViews.endurance as Record<string, string>;
    const chartKeys = Object.keys(fr).filter((key) => key.startsWith("chart"));
    expect(chartKeys.length).toBeGreaterThan(20);
    for (const key of chartKeys) expect(en[key]).toEqual(expect.any(String));
    for (const key of used) {
      const variants = [key, `${key}Team`, `${key}Solo`].filter((k) => k in fr);
      expect(variants.length).toBeGreaterThan(0);
    }
  });

  it("variantes équipe / joueur pour les textes qui nomment l'engagé", () => {
    for (const base of ["chartModes", "chartHintTop", "chartHintPick", "chartHintAll", "chartLegend", "chartSvg", "chartInfoEmpty", "chartTableCaption"]) {
      expect(frViews.endurance).toHaveProperty(`${base}Team`);
      expect(frViews.endurance).toHaveProperty(`${base}Solo`);
      expect(enViews.endurance).toHaveProperty(`${base}Solo`);
    }
  });
});
