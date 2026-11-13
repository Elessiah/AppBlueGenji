import { describe, expect, it } from "@jest/globals";
import { readSource } from "../helpers/read-source";
import frEndurance from "@/messages/fr/tournamentEndurance.json";
import enEndurance from "@/messages/en/tournamentEndurance.json";
import frChart from "@/messages/fr/tournamentEnduranceChart.json";
import enChart from "@/messages/en/tournamentEnduranceChart.json";

/** L'espace `endurance` entier : la vue et son graphique (EF-17 : deux fichiers, un morceau chacun). */
const frViews = { endurance: { ...frEndurance.endurance, ...frChart.endurance } };
const enViews = { endurance: { ...enEndurance.endurance, ...enChart.endurance } };

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
const LINES = readSource(`${DIR}/EnduranceChartLines.tsx`);
const ANIMATE = readSource("app/(secured)/tournois/[id]/_lib/use-endurance-chart-animate.ts");

describe("volet et chargement", () => {
  it("le volet est replié à chaque chargement", () => {
    expect(PANEL).toContain("useState(false)");
    expect(PANEL).toContain("<BoardPanel");
    expect(PANEL).toContain('t("endurance.chartTitle")');
  });

  it("le graphique est chargé à la demande, rendu seulement volet ouvert", () => {
    expect(PANEL).toMatch(/dynamic\(\s*\(\) => orReload\(withViewText\(import\("\.\/EnduranceChart"\)/);
    // Son anglais part avec son morceau, volet ouvert seulement (EF-17).
    expect(PANEL).toContain("ENGLISH_ENDURANCE_CHART))");
    expect(PANEL).not.toMatch(/import \{[^}]*EnduranceChart\b[^}]*\} from "\.\/EnduranceChart"/);
    // BoardPanel ne rend ses enfants qu'ouvert : le graphique se monte au dépliage.
    expect(readSource(`${DIR}/BoardPanel.tsx`)).toContain("{open && (");
  });

  it("la vue d'endurance pose le volet après le journal des sanctions", () => {
    expect(VIEW.indexOf("<EnduranceChartPanel")).toBeGreaterThan(VIEW.indexOf("<PenaltyLog"));
    expect(VIEW).toContain('import { EnduranceChartPanel } from "./EnduranceChartPanel"');
  });
});

describe("performance (64 engagés × 12 manches)", () => {
  it("un retour vers une manche antérieure saute sans animation invisible", () => {
    // `drawn = min(progress, shown)` coupe déjà la courbe : une descente
    // 4 → 2 tournerait ~1,3 s de requestAnimationFrame sans rien changer.
    expect(LINES).toMatch(/if \(!animate \|\| to <= from\)/);
  });

  it("tris, couleurs, fond, légende et tableau sr-only ne se refont pas à chaque image", () => {
    expect(CHART).toContain("const order = useMemo(() => chartOrderAt(series, shown, lastRound), [series, shown, lastRound]);");
    expect(CHART).toContain("chartTopOf(order, endurance.playoffSize)");
    expect(CHART).toContain("chartThresholdOf(order, shown, lastRound, endurance.playoffSize)");
    expect(CHART).not.toContain("series.indexOf(");
    for (const name of ["colors", "entries", "backdrop", "legend", "srTable"]) {
      expect(CHART).toMatch(new RegExp(`const ${name} = useMemo`));
    }
  });

  it("l'avancement de l'animation ne vit que dans le composant des courbes, jamais à la racine", () => {
    expect(CHART).not.toMatch(/setProgress|\bdrawn\b|chartAnimationFrame|requestAnimationFrame|chartLine\(/);
    expect(LINES).toContain("const [progress, setProgress] = useState(animate ? 0 : shown);");
    expect(LINES).toContain("export const EnduranceChartLines = memo(");
    expect(LINES).toContain("chartLinePath(entry.item, shown, geometry)");
    expect(LINES).toContain("chartLineAt(path, drawn)");
    expect(CHART).toContain("<EnduranceChartLines");
    expect(CHART).toContain("{backdrop}");
    expect(CHART).toContain("{legend}");
    expect(CHART).toContain("{srTable}");
  });

  it("la zone de survol est calculée une fois par manche et géométrie, pas à chaque image", () => {
    expect(CHART).toContain("hit: chartHitPath(item, shown, geometry)");
    expect(LINES).not.toContain("chartHitPath");
    expect(LIB).not.toMatch(/hit \+= .*progress/);
  });

  it("courbes dans l'ordre stable du général : le survol ne déplace aucun nœud", () => {
    expect(CHART).not.toMatch(/\.sort\(\(a, b\) => Number\(a\.isHover\)/);
    expect(CHART).toMatch(/series\.flatMap\(\(item\) => \{/);
    expect(LINES).toContain('data-hovering={hover === null ? undefined : ""}');
    expect(LINES).toContain("<HoverOverlay");
    expect(CSS).toMatch(/\.lines\[data-hovering\] > \.curve \{\s*opacity: 0\.3;/);
    expect(CSS).toMatch(/\.overlay \{\s*pointer-events: none;/);
  });

  it("le survol ne reconstruit que les lignes concernées de la légende", () => {
    expect(CHART).toContain("const LegendRow = memo(function LegendRow(");
    expect(CHART).toContain("isHover={hover === item.teamId}");
    // Rappels stables : mode et sélection se lisent par une référence.
    expect(CHART).toContain("pickRef.current = { mode, picked };");
    for (const stable of ["enter", "leave", "focusItem", "blurItem"]) {
      expect(CHART).toMatch(new RegExp(`const ${stable} = useCallback\\(`));
    }
  });

  it("des objets poussés de même contenu gardent séries et légende : clé de contenu", () => {
    expect(CHART).toMatch(/const inputKey = useMemo\(\s*\(\) => enduranceChartInputKey\(pushedEndurance, pushedMatches\),\s*\[pushedEndurance, pushedMatches\],\s*\);/);
    expect(CHART).toMatch(/useMemo\(\(\) => \(\{ endurance: pushedEndurance, matches: pushedMatches \}\), \[inputKey\]\)/);
  });

  it("l'animation totale est plafonnée", () => {
    expect(LINES).toContain("const perRoundMs = chartRoundMs(to - from);");
    expect(LINES).toContain("chartAnimationFrame(from, to, now - started, perRoundMs)");
  });
});

describe("mouvement", () => {
  it("lit le régime client et le mouvement réduit, dans un seul crochet partagé", () => {
    expect(ANIMATE).toContain("useClientPower()");
    expect(ANIMATE).toContain("useClientPowerInput()");
    expect(ANIMATE).toContain("return decorativeMotion && !reducedMotion;");
    expect(CHART).toContain("const animate = useEnduranceChartAnimate();");
    expect(PANEL).toContain("const animate = useEnduranceChartAnimate();");
  });

  it("une seule image sans animation, rAF annulé au démontage (repli)", () => {
    expect(LINES).toMatch(/if \(!animate \|\| to <= from\) \{\s*setProgress\(to\);\s*return;/);
    expect(LINES).toContain("cancelAnimationFrame(frame.current)");
    expect(LINES).toMatch(/runTo\(shown, 0\);\s*return stop;/);
  });

  it("une manche poussée par le flux volet ouvert est suivie si le lecteur suit la dernière", () => {
    expect(CHART).toContain("useState<number | null>(null)");
    expect(CHART).toContain("const shown = chartShownRound(target, lastRound);");
    expect(CHART).toContain("setTarget(chartTargetFor(round, lastRound));");
    expect(LINES).toMatch(/if \(previous === shown\) return;\s*runTo\(shown, Math\.min\(progressRef\.current, previous\)\);/);
  });

  it("« Rejouer l'animation » : absent quand rien ne s'anime, et l'en-tête ne dit plus « animé »", () => {
    expect(CHART).toMatch(/\{animate && \(\s*<button type="button" onClick=\{replay\}/);
    expect(LINES).toMatch(/if \(lastReplay\.current === replayKey\) return;\s*lastReplay\.current = replayKey;\s*runTo\(shown, 0\);/);
    expect(PANEL).toContain('t(animate ? "endurance.chartMeta" : "endurance.chartMetaStatic")');
    expect(frViews.endurance.chartMeta).toContain("animé");
    expect(frViews.endurance.chartMetaStatic).not.toContain("animé");
    expect(enViews.endurance.chartMetaStatic).not.toContain("animated");
  });

  it("l'encart dit à l'écran qu'une sélection est pleine (toast, FR + EN)", () => {
    expect(CHART).toContain('import { useToast } from "@/components/ui/toast";');
    expect(CHART).toContain("if (next.full) showError(t(`endurance.chartPickMax${kind}`, { max: ENDURANCE_CHART_PICK_MAX }), { once: true });");
    for (const base of ["chartPickMaxTeam", "chartPickMaxSolo"]) {
      expect(frViews.endurance).toHaveProperty(base);
      expect(enViews.endurance).toHaveProperty(base);
    }
  });

  it("l'encart garde sa hauteur quand la légende passe dessous", () => {
    expect(CSS).toMatch(/@container enduranceChart \(max-width: 797px\) \{\s*\.info \{\s*min-height: \d+px;/);
  });

  it("le texte du SVG grossit par paliers quand le tracé se rétrécit", () => {
    for (const width of [599, 439, 289]) expect(CSS).toContain(`@container endurancePlot (max-width: ${width}px)`);
    expect(CSS).toMatch(/\.plot \{\s*\/\*[^]*?\*\/\s*container: endurancePlot \/ inline-size;/);
    expect(CSS).toMatch(/\.chart \{\s*\/\*[^]*?\*\/\s*container: enduranceChart \/ inline-size;/);
  });

  it("endurancePlotBands_eachBand_rendersAtLeast11PxAtItsLowerBound", () => {
    // Le SVG est mis à l'échelle (largeur ÷ 760) : chaque palier rend ≥ 11 px à la
    // borne basse de sa bande (la suivante, + 1 px ; 200 px pour la dernière).
    const bands = [...CSS.matchAll(/@container endurancePlot \(max-width: (\d+)px\) \{\s*\.axisY,[^{]*\{\s*font-size: (\d+)px;/g)].map(
      (m) => ({ max: Number(m[1]), size: Number(m[2]) }),
    );
    expect(bands.length).toBeGreaterThanOrEqual(8);
    bands.forEach((band, index) => {
      const lower = index + 1 < bands.length ? bands[index + 1].max + 1 : 200;
      expect((band.size * lower) / 760).toBeGreaterThanOrEqual(11);
    });
  });

  it("endurancePlot_veryNarrow_hidesEveryOtherRoundLabel", () => {
    expect(CSS).toMatch(/@container endurancePlot \(max-width: 289px\) \{\s*\.axisXSparse \{\s*display: none;/);
    expect(CHART).toContain("round % 2 === 0 ? ` ${styles.axisXSparse}` : \"\"");
  });

  it("enduranceChartLines_hitZones_delegatedHandlersOnGroup", () => {
    expect(LINES).toContain("data-team-id={item.teamId}");
    expect(LINES).toContain("onMouseOver={handleOver}");
    expect(LINES).toContain("onClick={handleClick}");
    expect(LINES).not.toContain("onMouseEnter=");
  });

  it("aucune animation CSS infinie", () => {
    expect(CSS).not.toMatch(/animation\s*:/);
    expect(CSS).not.toContain("infinite");
  });
});

describe("légende : survol, focus, lecteur d'écran", () => {
  it("un `mouseleave` revient à l'engagé qui a le focus clavier, ailleurs que sur le SVG entier", () => {
    expect(CHART).toContain("const leave = useCallback(() => setHover(focusedRef.current), []);");
    expect(CHART).not.toContain("onMouseLeave={() => setHover(null)}");
    // Délégué au groupe : quitter une zone de survol pour hors d'une zone rend la main.
    expect(LINES).toContain("hitTeamId(event.relatedTarget) === null) onLeave();");
  });

  it("un retri de la légende recale le survol et garde le bouton focalisé visible", () => {
    expect(CHART).toMatch(/setHover\(focusedRef\.current\);\s*\}, \[series\]\);/);
    expect(CHART).toMatch(/scrollIntoView\(\{ block: "nearest" \}\);[^]*?\}, \[order\]\);/);
    expect(CHART).toContain('data-legend-item=""');
  });

  it("le nom de la zone défilante n'est pas répété sur la liste", () => {
    expect(CHART).toMatch(/<ScrollArea orientation="y" ariaLabel=\{t\(`endurance\.chartLegend\$\{kind\}`\)\}/);
    expect(CHART).toMatch(/<ul className=\{styles\.legendList\}>/);
  });

  it("place, points, écart et état tracé / masqué sont lus ; aria-pressed réservé à la sélection", () => {
    for (const key of ["chartLegendRankLabel", "chartLegendPointsLabel", "chartLegendDeltaLabel", "chartLegendDrawn", "chartLegendHidden"]) {
      expect(CHART).toContain(`endurance.${key}`);
      expect(frViews.endurance).toHaveProperty(key);
      expect(enViews.endurance).toHaveProperty(key);
    }
    expect(CHART).toContain("aria-pressed={pickMode ? isPicked : undefined}");
    expect(CHART).toMatch(/\{!pickMode && \(\s*<span className="sr-only">/);
  });

  it("le libellé du SVG compte les courbes réellement tracées", () => {
    expect(CHART).toContain('t("endurance.chartSvgEmpty", { round: shown })');
    expect(CHART).toContain("count: entries.length");
    expect(CHART).not.toContain("count: series.length");
  });

  it("la manche affichée est marquée dans l'encart, les suivantes en retrait", () => {
    expect(CHART).toContain('aria-current={index + 1 === shown ? "step" : undefined}');
    expect(CSS).toMatch(/\.stepShown \{[^}]*box-shadow/);
    expect(CSS).toMatch(/\.stepAfter \{\s*color: var\(--ink-dim\)/);
  });

  it("une pénalité d'arbitrage est marquée dans la légende, l'encart et le tableau", () => {
    expect(CHART).toContain("function PenaltyMark(");
    expect((CHART.match(/<PenaltyMark /g) ?? []).length).toBeGreaterThanOrEqual(2);
    expect(CHART).toContain('t("endurance.penaltyBadgeSr", { points: penaltyOf(state) })');
  });

  it("noms en deux lignes au plus, sans coupure à ~79 px", () => {
    expect(CSS).toMatch(/\.legendName \{[^}]*-webkit-line-clamp: 2;/);
    expect(CSS).not.toMatch(/\.legendName \{[^}]*white-space: nowrap/);
  });

  it("le formateur « +2 / −1 / 0 » est partagé avec les vues du classement", () => {
    expect(CHART).toContain("signedDelta");
    expect(CHART).not.toContain("function signed(");
    expect(readSource(`${DIR}/EnduranceRankingViews.tsx`)).not.toContain("function signed(");
  });
});

describe("couleurs, polices, accessibilité", () => {
  it("le seuil (trait-point) ne se confond pas avec la courbe survolée hors Top N (tirets simples)", () => {
    expect(CSS).toMatch(/\.cut \{[^}]*stroke-dasharray: 10 4 2 4;/);
    expect(LINES).toContain('const HOVER_DASH = "7 5";');
  });

  it("aucun ambre dans les tracés ni la palette ; l'ambre n'est que le repère de sanction", () => {
    const amber = /--amber\b|--amber-rgb|245,\s*165,\s*36|#f5a524|\bAMBER\b/i;
    for (const source of [PANEL, CHART, LINES, LIB]) expect(source).not.toMatch(amber);
    const outsideMark = CSS.replace(/\.penaltyMark \{[^}]*\}/, "");
    expect(outsideMark).not.toMatch(amber);
    expect(CSS).toMatch(/\.penaltyMark \{[^}]*--amber-rgb/);
  });

  it("le seuil des play-offs n'a la couleur d'aucune courbe de la palette", () => {
    expect(CSS).toMatch(/\.cut \{\s*stroke: var\(--ink-mute\);/);
    expect(CSS).not.toMatch(/\.cut(Label)? \{[^}]*accent-green/);
  });

  it("la courbe survolée hors Top N est en tirets, comme sa pastille", () => {
    expect(LINES).toContain("strokeDasharray: hover.color === null ? HOVER_DASH : undefined");
    expect(CSS).toMatch(/\.swatchHover \{[^}]*dashed/);
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
    for (const handler of ["onMouseEnter={() => onHover(item.teamId)}", "onFocus={() => onFocusItem(item.teamId)}", "onClick={() => onToggle(item.teamId)}"]) {
      expect(CHART).toContain(handler);
    }
    expect(CHART).toContain("aria-pressed=");
  });

  it("manches à venir désactivées", () => {
    expect(CHART).toContain('disabled={state === "UPCOMING"}');
  });
});

describe("noms, lecture seule, stockage", () => {
  it("les noms passent par le nom nettoyé d'EntrantName, jamais en HTML", () => {
    expect(CHART).toContain("<ShownName teamId={item.teamId} name={item.teamName} />");
    expect(CHART).toContain("<ShownName teamId={hovered.teamId} name={hovered.teamName} />");
    expect(CHART).toContain("useShownEntrantName(teamId, name)");
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
    const used = new Set([...keys(PANEL), ...keys(CHART), ...keys(LINES)]);
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
    for (const base of ["chartModes", "chartHintTop", "chartHintPick", "chartHintAll", "chartHintWrap", "chartPickMax", "chartLegend", "chartSvg", "chartInfoEmpty", "chartTableCaption"]) {
      expect(frViews.endurance).toHaveProperty(`${base}Team`);
      expect(frViews.endurance).toHaveProperty(`${base}Solo`);
      expect(enViews.endurance).toHaveProperty(`${base}Solo`);
    }
  });
});
