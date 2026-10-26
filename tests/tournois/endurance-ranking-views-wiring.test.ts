import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Câblage de la refonte du plateau « BlueGenji Survie », lot 1
 * (`docs/features/ENDURANCE_RANKING_VIEWS.md`) : ordre des blocs, gestes de
 * chaque rôle toujours atteignables, gestes du classement réservés à la vue
 * « Général », règles transverses (noms, défilement, mouvement).
 */

const ROOT = join(__dirname, "..", "..");
const DIR = join("app", "(secured)", "tournois", "[id]");
const read = (...parts: string[]) => readFileSync(join(ROOT, DIR, ...parts), "utf8");

const VIEW = read("_components", "EnduranceView.tsx");
const RANKING = read("_components", "EnduranceRankingViews.tsx");
const RANKING_CSS = read("_components", "EnduranceRankingViews.module.css");
const CARD = read("_components", "EnduranceCard.tsx");
const PANELS = read("_components", "EnduranceRoundPanels.tsx");
const PAGE = read("_components", "TournamentSheet.tsx");
const SPECTATOR = readFileSync(join(ROOT, "lib", "shared", "spectator-view.ts"), "utf8");

/** Position d'un motif dans le rendu de la vue, après le `return (` principal. */
function renderIndex(pattern: string): number {
  const body = VIEW.slice(VIEW.indexOf("<EnduranceCard"));
  const index = body.indexOf(pattern);
  expect(index).toBeGreaterThanOrEqual(0);
  return index;
}

describe("EnduranceView — ordre des blocs", () => {
  it("en-tête, classement, légende, sanctions, emplacement du graphique, aperçu, play-offs, manches", () => {
    const order = [
      "<EnduranceCard",
      "<EnduranceRankingViews",
      "showOutLegend && (",
      "<PenaltyLog",
      "Évolution de l'endurance",
      "<EnduranceNextRoundPanel",
      "<BracketSections",
      "<EnduranceRoundPanels",
    ].map(renderIndex);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it("ne garde plus le tableau « manche par manche »", () => {
    expect(VIEW).not.toContain("EnduranceHistory");
    expect(VIEW).not.toContain("endurance-history");
  });
});

describe("gestes de chaque rôle — toujours atteignables", () => {
  it("la page passe tous les gestes à la vue", () => {
    const call = PAGE.slice(PAGE.indexOf("<EnduranceView"), PAGE.indexOf("/>", PAGE.indexOf("<EnduranceView")));
    for (const prop of [
      "canForfeit=",
      "onForfeit=",
      "canCancelForfeit=",
      "onCancelForfeit=",
      "canPenalize=",
      "onPenalize=",
      "onLiftPenalty=",
      "adminResolvable=",
      "onOpenAdminModal=",
      "showNextRound=",
    ]) {
      expect(call).toContain(prop);
    }
  });

  it("pénalité, forfait et annulation gardent leurs gardes, dans `renderActions`", () => {
    const actions = VIEW.slice(VIEW.indexOf("const renderActions"), VIEW.indexOf("<EnduranceCard"));
    expect(actions).toContain("canPenalizeRow(standing.status) && onPenalize !== undefined");
    expect(actions).toContain("forfeitable && onForfeit !== undefined");
    expect(actions).toContain("canCancelRow(standing.status) && onCancelForfeit !== undefined");
    expect(actions).toContain("const forfeitable = canForfeitRow(standing.teamId, standing.status)");
    expect(VIEW).toMatch(/renderActions=\{renderActions\}/);
  });

  it("le retrait d'une sanction reste dans le journal, réservé à l'arbitrage", () => {
    expect(VIEW).toContain("canPenalize && !endurance.playoffsStarted && !isFinished ? onLiftPenalty : undefined");
  });

  it("les cartes de match (score, programmation, live, arbitrage) restent dans les volets", () => {
    expect(PANELS).toContain("<MatchRow");
    expect(PANELS).toContain("adminResolvable={adminResolvable(match)}");
    expect(PANELS).toContain("onOpenAdminModal={onOpenAdminModal}");
    expect(PANELS).toContain('text.t("bracket.yourMatch")');
  });

  it("l'aperçu de la manche suivante reste un outil d'arbitrage, au-dessus des manches", () => {
    expect(VIEW).toMatch(/\{nextRound && \(\s*<PodiumTiersOff>\s*<EnduranceNextRoundPanel/);
  });
});

describe("EnduranceRankingViews — gestes réservés au Général", () => {
  it("n'affiche la colonne d'action que dans la vue « Général »", () => {
    expect(RANKING).toContain('const isGeneral = view.kind === "GENERAL"');
    expect(RANKING).toContain("const withActions = isGeneral && showActions && renderActions !== undefined");
    expect(RANKING).toContain("{withActions && <span className={styles.rowActions}>{renderActions?.(standing)}</span>}");
    // Aucun autre appel des gestes dans le composant.
    expect(RANKING.match(/renderActions\?\.\(/g)).toHaveLength(1);
  });

  it("ouvre sur le Général, et le retrouve quand la vue suivie disparaît", () => {
    expect(RANKING).toContain('useState("general")');
    expect(RANKING).toContain("foundIndex === -1 ? views.length - 1 : foundIndex");
  });
});

describe("règles transverses", () => {
  it("les noms passent par EntrantName, jamais par l'initiale du maquettage", () => {
    expect(RANKING).toContain("<EntrantName");
    expect(CARD).toContain("<EntrantName");
    expect(RANKING).not.toMatch(/href=\{?["`]\/equipes/);
  });

  it("les onglets défilent dans un ScrollArea libellé et suivent le motif ARIA des onglets", () => {
    expect(RANKING).toMatch(/<ScrollArea[^>]*ariaLabel=/);
    expect(RANKING).toContain('role="tablist"');
    expect(RANKING).toContain('role="tab"');
    expect(RANKING).toContain("aria-selected={selected}");
    expect(RANKING).toContain("aria-controls={panelId}");
    expect(RANKING).toContain('role={views.length > 1 ? "tabpanel" : undefined}');
    expect(RANKING).toMatch(/ArrowLeft:[\s\S]*ArrowRight:[\s\S]*Home:[\s\S]*End:/);
  });

  it("les flèches font 44 px et portent un nom", () => {
    expect(RANKING_CSS).toMatch(/\.arrow \{[^}]*min-width: 44px;[^}]*min-height: 44px;/);
    expect(RANKING).toContain('aria-label={t("endurance.viewPrev")}');
    expect(RANKING).toContain('aria-label={t("endurance.viewNext")}');
  });

  it("le glissement lit le régime de charge et la préférence de mouvement, sans boucle", () => {
    expect(RANKING).toContain("const { decorativeMotion } = useClientPower();");
    expect(RANKING_CSS).toContain("@media (prefers-reduced-motion: reduce)");
    expect(RANKING_CSS).not.toContain("infinite");
  });

  it("le repli mobile libelle chaque case, colonne « MANCHE n » comprise", () => {
    expect(RANKING).toContain("data-label={columnLabel}");
    expect(RANKING).toContain("data-label={label}");
    expect(RANKING).toContain('data-label="#"');
    expect(RANKING_CSS).toContain("@media (max-width: 920px)");
  });

  it("aucune police sous 11 px dans les nouvelles feuilles", () => {
    const sizes = [...RANKING_CSS.matchAll(/font-size: (\d+)px/g)].map((m) => Number(m[1]));
    expect(Math.min(...sizes)).toBeGreaterThanOrEqual(11);
  });

  it("le prochain match attend le montage pour lire l'heure", () => {
    expect(CARD).toContain("useClock(NEXT_MATCH_CLOCK_MS");
  });

  it("la page sans compte reçoit le rang par manche tel quel", () => {
    // Les cases du classement voyagent avec `...snapshot.endurance` : seuls
    // le motif et l'auteur d'une sanction sont effacés.
    expect(SPECTATOR).toContain("...snapshot.endurance,");
  });
});

describe("EnduranceRoundPanels — ordre et ouverture", () => {
  it("ouvre la manche en cours et range les closes de la plus récente à la plus ancienne", () => {
    expect(PANELS).toContain("defaultOpenEnduranceRound(sections)");
    expect(PANELS).toContain("const ordered = orderEnduranceRoundSections(sections)");
    expect(PANELS).toContain("{ordered.map((section) =>");
  });

  it("garde l'ancre et l'ouverture d'une nouvelle manche venue du flux", () => {
    expect(PANELS).toContain("useMatchAnchorTarget()");
    expect(PANELS).toContain("autoOpen === lastAutoOpen.current");
  });
});
