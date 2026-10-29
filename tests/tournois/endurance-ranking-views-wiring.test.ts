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
  it("en-tête, classement (sa légende « hors course » dans son panneau), sanctions, graphique, aperçu, play-offs, manches", () => {
    const order = [
      "<EnduranceCard",
      "<EnduranceRankingViews",
      "outLegend={",
      "<PenaltyLog",
      "<EnduranceChartPanel",
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
    expect(actions).toContain("forfeitAction(standing, isMine, canForfeitRow(standing.teamId, standing.status))");
    const forfeit = VIEW.slice(VIEW.indexOf("const forfeitAction"), VIEW.indexOf("const renderActions"));
    expect(forfeit).toContain("forfeitable && onForfeit !== undefined");
    expect(forfeit).toContain("!canCancelRow(standing.status) || onCancelForfeit === undefined");
    expect(forfeit).toContain("!cancellableIds.has(standing.teamId)");
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
    expect(RANKING).toContain("const index = resolveEnduranceViewIndex(views, selectedKey)");
    // Un onglet est clé par sa manche : « M3 en cours » → « Manche 3 » garde le focus.
    expect(RANKING).toContain("key={enduranceTabKey(candidate)}");
  });

  it("annonce la vue atteinte par les flèches ou la navigation du bas, jamais par un onglet", () => {
    expect(RANKING).toContain('<span className="sr-only" aria-live="polite">');
    expect(RANKING).toContain("else announce(viewTitle(views[target], text))");
    // La région est vidée avant d'y écrire : la même vue deux fois de suite se réannonce.
    expect(RANKING).toContain('setAnnouncement("");');
    expect(RANKING).toContain("setTimeout(() => setAnnouncement(title), 60)");
    expect(RANKING).toContain("clearTimeout(announceTimer.current)");
    // Un onglet cliqué annule l'annonce en attente de la navigation du bas.
    expect(RANKING).toMatch(/if \(focus\) \{[^}]*clearTimeout\(announceTimer\.current\);[^}]*setAnnouncement\(""\);/);
    // Un onglet cliqué garde le focus et s'annonce de lui-même.
    expect(RANKING).toContain("onClick={() => go(candidateIndex, true)}");
  });

  it("la navigation du bas ramène le haut du classement à l'écran", () => {
    expect(RANKING).toContain("onClick={() => goFromBottom(index - 1)}");
    expect(RANKING).toContain("onClick={() => goFromBottom(index + 1)}");
    expect(RANKING).toContain("getComputedStyle(document.documentElement).scrollPaddingTop");
    expect(RANKING).toContain("if (root.getBoundingClientRect().top < (Number.isFinite(arrival) ? arrival : 0)) {");
    expect(RANKING).toContain('root.scrollIntoView({ block: "start" });');
  });

  it("ne glisse que vers une vue demandée, jamais sur un changement du flux", () => {
    expect(RANKING).toContain("slide !== null && slide.key === enduranceViewKey(view) ? slide : null");
    // Le panneau n'est pas recréé à chaque vue : deux mouvements alternés relancent l'animation.
    expect(RANKING).not.toMatch(/key=\{enduranceViewKey\(view\)\}/);
    expect(RANKING).toContain("styles.slideFromLeftAlt");
    expect(RANKING_CSS).toContain("endurance-view-in-right-alt");
  });

  it("une ligne sortie s'estompe sans éteindre ses gestes", () => {
    expect(RANKING).not.toContain("style={{ opacity: ROW_OPACITY");
    expect(RANKING).toContain('"--row-fade": ROW_OPACITY[row.status]');
    // Plancher 0,9 : texte discret et rouge au-dessus de 4,5:1, même sur la
    // ligne du lecteur (calcul dans forfeit-buttons-label-in-name.test.ts).
    expect(RANKING).toMatch(/OUT_OF_CONTENTION: 0\.95,\s*ELIMINATED: 0\.9,\s*FORFEIT: 0\.9,/);
    expect(RANKING_CSS).toMatch(/\.fadable > :not\(\.rowActions\) \{\s*opacity: var\(--row-fade, 1\);/);
  });

  it("le plateau coupe sans annuler la barre collante", () => {
    const pageCss = readFileSync(join(ROOT, DIR, "page.module.css"), "utf8");
    expect(pageCss).toMatch(/\.board:global\(\.ds-block\) \{\s*overflow: clip;/);
    expect(RANKING_CSS).toMatch(/\.bar \{\s*position: sticky;/);
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

  it("arrivées au bout, les flèches gardent le focus (aria-disabled, jamais disabled)", () => {
    expect(RANKING).toContain("aria-disabled={prev === null}");
    expect(RANKING).toContain("aria-disabled={next === null}");
    expect(RANKING).not.toMatch(/\sdisabled=\{/);
    expect(RANKING).toMatch(/if \(target < 0 \|\| target >= views\.length/);
    expect(RANKING_CSS).toMatch(/\.arrow\[aria-disabled="true"\] \{[^}]*color: var\(--ink-quiet\)/);
  });

  it("le glissement lit le régime de charge et la préférence de mouvement, sans boucle", () => {
    expect(RANKING).toContain("const { decorativeMotion } = useClientPower();");
    expect(RANKING_CSS).toContain("@media (prefers-reduced-motion: reduce)");
    expect(RANKING_CSS).not.toContain("infinite");
  });

  it("le repli mobile libelle chaque case, colonne « MANCHE n » comprise", () => {
    expect(RANKING).toContain("data-label={label}");
    // Avant la première manche tirée : ni cellule ni en-tête, pas de ligne blanche.
    expect(RANKING).toContain("{columnRound !== null && <span>{columnLabel}</span>}");
    expect(RANKING).toContain("{columnCells !== null && (");
    expect(RANKING).not.toContain("<span data-label={columnLabel} />");
    expect(RANKING).toContain("rowClass(withActions, wideActions, columnRound !== null)");
    expect(RANKING_CSS).toMatch(/:global\(\.table-row\)\.rowWithWideActions\.noRound \{\s*grid-template-columns: 56px/);
    expect(RANKING_CSS).toMatch(/@media \(max-width: 920px\) \{[^@]*\.row\.noRound/);
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

  it("replie la manche ouverte d'office quand elle se clôt, sauf rouverte à la main", () => {
    expect(PANELS).toContain("if (previous !== null && !openedByHand.current.has(previous)) next.delete(previous);");
    expect(PANELS).toContain("openedByHand.current.add(round);");
    expect(PANELS).toContain("openedByHand.current.delete(round);");
  });
});

describe("EnduranceCard — bandeau des play-offs", () => {
  it("compte l'arbre complet, pas les seuls tours posés (la barre ne recule pas)", () => {
    expect(CARD).toContain("endurancePlayoffProgress(playoffs)");
    expect(CARD).not.toContain("total: playoffs.length");
  });

  it("nomme la barre selon ce qu'elle mesure : la manche, puis les play-offs", () => {
    expect(CARD).toContain('t(current ? "endurance.stripProgress" : "endurance.stripProgressPlayoffs")');
  });

  it("ne fait tourner l'horloge que si un match non joué de la manche porte une date", () => {
    expect(CARD).toContain("hasScheduledPendingMatch(matches, current.round)");
  });

  it("dit où en est le tournoi entre deux manches, avant les play-offs", () => {
    expect(CARD).toContain("enduranceLastClosedRound(matches)");
    expect(CARD).toContain("progress === null && closedRound !== null");
    expect(CARD).toContain('lastRoundPlayed ? "endurance.stripPlayoffsSoon" : "endurance.stripSoon"');
    expect(CARD).toContain("!endurance.playoffsStarted && !isFinished");
  });
});

describe("EnduranceRoundPanels — volet ouvert d'office", () => {
  it("se replie aussi quand plus aucune manche n'est à ouvrir, sauf ouverte à la main", () => {
    expect(PANELS).not.toContain("if (autoOpen === null || autoOpen === lastAutoOpen.current) return;");
    expect(PANELS).toContain("if (autoOpen === lastAutoOpen.current) return;");
    expect(PANELS).toContain("if (previous !== null && !openedByHand.current.has(previous)) next.delete(previous);");
    expect(PANELS).toContain("if (autoOpen !== null) next.add(autoOpen);");
  });
});

describe("EnduranceRankingViews — pénalité de la manche", () => {
  it("la case « MANCHE n » dit la pénalité que sa variation compte", () => {
    expect(RANKING).toContain("{cell.penalty > 0 && (");
    expect(RANKING).toContain('t("endurance.cellPenalty", { points: String(cell.penalty) })');
  });
});

describe("EnduranceRankingViews — repères et noms accessibles", () => {
  const messages = (lang: string) =>
    JSON.parse(readFileSync(join(ROOT, "messages", lang, "tournamentViews.json"), "utf8")).endurance as Record<string, string>;

  it("la zone défilante, la liste d'onglets et la navigation du bas portent trois noms différents", () => {
    expect(RANKING).toContain('ariaLabel={t("endurance.viewsScrollLabel")}');
    expect(RANKING).toContain('aria-label={t("endurance.viewsTabsLabel")}');
    expect(RANKING).toContain('aria-label={t("endurance.viewsNavLabel")}');
    for (const lang of ["fr", "en"]) {
      const m = messages(lang);
      expect(new Set([m.viewsScrollLabel, m.viewsTabsLabel, m.viewsNavLabel]).size).toBe(3);
    }
  });

  it("l'onglet sélectionné est ramené dans la zone défilante", () => {
    expect(RANKING).toContain("revealKey={enduranceViewKey(view)}");
    expect(RANKING).toContain('data-scroll-reveal={selected ? "" : undefined}');
  });

  it("garde le focus clavier quand le bouton du bas disparaît", () => {
    expect(RANKING).toContain("if (target === 0) bottomNextRef.current?.focus");
    expect(RANKING).toContain("else if (target === views.length - 1) bottomPrevRef.current?.focus");
  });

  it("une seule pastille de pénalité, lue une fois, pour le capital et les trois cases", () => {
    expect(RANKING.match(/<PenaltyBadge/g)).toHaveLength(4);
    expect(RANKING).toContain('<span aria-hidden="true">{visible}</span>');
    expect(RANKING).toContain('text.t("endurance.penaltyBadgeSr", { points })');
  });

  it("la vue « déjà joués » nomme la référence des ▲▼, et la vue unique rend son sous-titre", () => {
    expect(RANKING).toContain('t("endurance.subGeneral", { base: String(base) })');
    expect(RANKING).toContain("{!hasBar && (");
    expect(RANKING).toContain("<div className={`mono ${styles.viewSub}`}>{sub}</div>");
  });

  it("la barre collée publie sa hauteur et se compacte au mobile", () => {
    expect(RANKING).toContain("typeof ResizeObserver");
    expect(RANKING).toContain("typeof IntersectionObserver");
    expect(RANKING).toContain('"--endurance-bar-h"');
    expect(RANKING_CSS).toMatch(/\.fadable :is\([^)]*\) \{\s*scroll-margin-top: var\(--endurance-bar-h, 0px\);/);
    expect(RANKING_CSS).toMatch(/\.tabs \{[^}]*padding-block: 3px;/);
    expect(RANKING_CSS).toMatch(/@media \(max-width: 720px\) \{[^@]*\.barStuck \.viewSub \{\s*display: none;/);
  });

  it("« S3 » s'explique derrière un « i », en français et en anglais", () => {
    expect(RANKING).toContain("<InfoHint");
    for (const lang of ["fr", "en"]) {
      const m = messages(lang);
      for (const key of ["seedHintLabel", "seedHintSubject", "seedHint", "stripProgressPlayoffs", "stripDone", "stripSoon", "stripPlayoffsSoon"]) {
        expect(m[key]).toBeTruthy();
      }
    }
  });

  it("« S3 » : le « i » n'apparaît que si la vue a des lignes à expliquer", () => {
    expect(RANKING).toMatch(/\{rows\.length > 0 && \(\s*<InfoHintRow>[\s\S]*?seedHintLabel[\s\S]*?<\/InfoHintRow>/);
  });

  it("le bandeau entre deux manches ne promet pas une échéance qu'il ignore", () => {
    for (const lang of ["fr", "en"]) {
      const m = messages(lang);
      for (const key of ["stripSoon", "stripPlayoffsSoon"]) {
        expect(m[key]).not.toMatch(/bient[oô]t|soon/i);
      }
    }
  });
});
