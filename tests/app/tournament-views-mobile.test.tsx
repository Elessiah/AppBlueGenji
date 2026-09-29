import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { TournamentProgress } from "@/app/(secured)/tournois/[id]/_components/TournamentProgress";
import { tournamentCard } from "../helpers/tournament-card";
import { tournamentDetail } from "../helpers/tournament-detail";

/**
 * Vues de tournoi sur écran étroit : frise et rangées de manches s'ouvrent sur
 * l'élément **courant**, l'action d'abandon passe sous le nom, et une phase
 * suisse d'un multi-phases n'est jamais dessinée en arbre à élimination.
 */

const ROOT = join(__dirname, "..", "..");
const DIR = join(ROOT, "app", "(secured)", "tournois", "[id]");
const read = (...parts: string[]) => readFileSync(join(DIR, ...parts), "utf8");

const page = read("page.tsx");
const swiss = read("_components", "SwissView.tsx");
const survival = read("_components", "SurvivalView.tsx");
const css = read("_components", "RankingViews.module.css");

const PAST = "2026-01-01T10:00:00.000Z";

describe("TournamentProgress — étape courante", () => {
  it("marque la seule étape courante comme cible du défilement", () => {
    const markup = renderToStaticMarkup(
      <TournamentProgress
        detail={tournamentDetail({
          card: tournamentCard({
            state: "RUNNING",
            startVisibilityAt: PAST,
            registrationOpenAt: PAST,
            registrationCloseAt: PAST,
            startAt: PAST,
          }),
        })}
      />,
    );
    const marked = markup.match(/<li[^>]*data-scroll-reveal=""[^>]*>/g) ?? [];
    expect(marked).toHaveLength(1);
    expect(marked[0]).toContain('aria-current="step"');
  });
});

describe("Rangées de manches — ouvertes sur la dernière", () => {
  it.each<[string, string]>([
    ["SwissView", swiss],
    ["SurvivalView", survival],
  ])("%s défile jusqu'à la dernière manche", (_name, source) => {
    expect(source).toContain("revealKey={lastRound}");
    expect(source).toContain("roundNum === lastRound ? { [SCROLL_REVEAL_ATTRIBUTE]");
  });
});

describe("Classements — action sous le nom sous 720 px", () => {
  it("la feuille déplace l'action sous le nom et retire sa colonne", () => {
    const narrow = css.slice(css.indexOf("@media (max-width: 720px)"));
    expect(narrow).toMatch(/\.swissAction\s*\{[^}]*grid-column:\s*2 \/ -1/);
    expect(narrow).toMatch(/\.swissTable\[data-with-action\]\s*\{[^}]*grid-template-columns:\s*auto minmax\(6em, 1fr\) auto auto auto auto auto;/);
    expect(narrow).toMatch(/\.survivalAction\s*\{[^}]*flex-basis:\s*100%/);
    // Une cellule d'action sans bouton ne laisse pas de ligne vide.
    expect(narrow).toMatch(/\.swissAction:not\(:has\(button\)\)\s*\{\s*display:\s*none;/);
  });

  it("les pistes de la ronde suisse ne sont plus posées en ligne, où elles battraient la requête média", () => {
    expect(swiss).not.toContain("gridTemplateColumns: standingsColumns");
    expect(swiss).toContain("className={styles.swissTable}");
    expect(swiss.match(/className=\{styles\.swissAction\}/g)).toHaveLength(2);
    // Aucun `display` en ligne sur la cellule : il battrait son masquage étroit.
    expect(swiss).not.toMatch(/className=\{styles\.swissAction\}\s+style=/);
  });

  it("le bouton d'abandon de la survie vit dans sa cellule d'action", () => {
    expect(survival).toContain("className={styles.survivalRow}");
    expect(survival).toMatch(/<span className=\{styles\.survivalAction\}>\s*<button/);
  });
});

describe("Phase suisse d'un multi-phases", () => {
  it("rend la vue suisse pour la phase en cours, et ses rondes seules pour une phase close", () => {
    expect(page).toContain(
      'formatForBracket === "SWISS" && detail.swiss && swissMetaIsSelectedPhase ? (',
    );
    expect(page).toMatch(/swissMetaIsSelectedPhase =\s*!isMulti \|\| \(selectedPhase !== null && selectedPhase\.id === detail\.currentPhaseId\)/);
    const closed = page.slice(
      page.indexOf(') : formatForBracket === "SWISS" ? ('),
      page.indexOf(") : !filteredMatches.length ? ("),
    );
    expect(closed).toContain("<SwissRounds");
    expect(closed).not.toContain("<BracketSections");
    expect(closed).toContain("{finishedPhaseStandings}");
  });

  it("la vue suisse ne reçoit que les matchs de la phase affichée", () => {
    const current = page.slice(
      page.indexOf('formatForBracket === "SWISS" && detail.swiss'),
      page.indexOf(') : formatForBracket === "SWISS" ? ('),
    );
    expect(current).toContain("matches={filteredMatches}");
    // Dernière phase close avec le tournoi : la vue porte déjà le classement.
    expect(current).not.toContain("{finishedPhaseStandings}");
  });

  it("remonte les vues à manches à chaque changement de phase", () => {
    for (const view of ["<SurvivalView", "<SwissView", "<SwissRounds"]) {
      const at = page.search(new RegExp(`${view}\\r?\\n`));
      expect(at).toBeGreaterThan(-1);
      expect(page.slice(at, page.indexOf("/>", at))).toContain("key={phaseViewKey}");
    }
  });

  it("les rondes sont un export du module de la vue suisse, chargé à la demande", () => {
    expect(swiss).toMatch(/export function SwissRounds\b/);
    expect(page).toContain(
      'const SwissRounds = dynamic(() => orReload(import("./_components/SwissView").then((m) => m.SwissRounds)), { ssr: false });',
    );
  });
});
