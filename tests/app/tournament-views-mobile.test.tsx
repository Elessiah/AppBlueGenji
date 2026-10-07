import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { TournamentProgress } from "@/app/(secured)/tournois/[id]/_components/TournamentProgress";
import { SurvivalRounds } from "@/app/(secured)/tournois/[id]/_components/SurvivalView";
import { bracketMatch } from "../helpers/bracket-match";
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
const rounds = read("_components", "RoundColumns.tsx");
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
  it("les colonnes communes défilent jusqu'à la dernière manche", () => {
    expect(rounds).toContain("revealKey={lastRound}");
    expect(rounds).toContain("roundNum === lastRound ? { [SCROLL_REVEAL_ATTRIBUTE]");
  });

  it.each<[string, string]>([
    ["SwissView", swiss],
    ["SurvivalView", survival],
  ])("%s passe par les colonnes communes", (_name, source) => {
    expect(source).toContain("<RoundColumns");
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
    expect(survival).toMatch(/<span className=\{styles\.survivalAction\} lang=\{actionLang\}>\s*<button/);
  });
});

describe("Phase survie d'un multi-phases", () => {
  const closedSurvival = () =>
    page.slice(
      page.indexOf('if (formatForBracket === "SURVIVAL" && isMulti) {'),
      page.indexOf('if (detail.card.format === "BG_SURVIE" && detail.endurance) {'),
    );

  it("ne rend la vue survie que si l'instantané décrit la phase affichée", () => {
    expect(page).toContain(
      'if (formatForBracket === "SURVIVAL" && detail.survival && rankingMetaIsSelectedPhase) {',
    );
  });

  it("une phase survie close montre ses manches seules puis son classement de phase", () => {
    const closed = closedSurvival();
    expect(closed.length).toBeGreaterThan(0);
    expect(closed).toContain("<SurvivalRounds");
    expect(closed).toContain("matches={filteredMatches}");
    expect(closed).toContain("cutSchedule={null}");
    expect(closed).toContain("{finishedPhaseStandings}");
    expect(closed).not.toContain("<SurvivalView");
    expect(closed).not.toContain("detail.survival");
    expect(closed).not.toContain("<BracketSections");
  });

  it("la branche des phases closes précède l'arbre à élimination", () => {
    const closedAt = page.indexOf('if (formatForBracket === "SURVIVAL" && isMulti) {');
    expect(closedAt).toBeGreaterThan(page.indexOf('formatForBracket === "SURVIVAL" && detail.survival'));
    expect(closedAt).toBeLessThan(page.indexOf("<BracketSections"));
  });

  it("les manches sont un export du module de la vue survie, chargé à la demande", () => {
    expect(survival).toMatch(/export function SurvivalRounds\b/);
    expect(survival).toContain("<SurvivalRounds");
    expect(page).toContain(
      'const SurvivalRounds = dynamic(() => orReload(import("./_components/SurvivalView").then((m) => m.SurvivalRounds)), { ssr: false });',
    );
  });
});

describe("SurvivalRounds — marques de coupe", () => {
  // Exemptions seules : la carte d'une exemption ne demande aucun contexte de
  // match, le rendu reste isolé.
  const byes = [1, 2, 3].map((round) =>
    bracketMatch({ id: round, roundNumber: round, team1Id: 10, team1Name: "Alpha", team2Id: null }),
  );
  const noop = () => undefined;

  it("sans cadence connue, les manches s'affichent sans coupe ni barrage", () => {
    const markup = renderToStaticMarkup(
      <SurvivalRounds
        matches={byes}
        allTournamentMatches={byes}
        cutSchedule={null}
        adminResolvable={() => false}
        onOpenAdminModal={noop}
        emptyLabel="Rien"
      />,
    );
    expect(markup).toContain("Manche 1");
    expect(markup).toContain("Manche 3");
    expect(markup).not.toContain("Coupe");
    expect(markup).not.toContain("Barrage");
  });

  it("avec une cadence, marque barrage et coupes", () => {
    const markup = renderToStaticMarkup(
      <SurvivalRounds
        matches={byes}
        allTournamentMatches={byes}
        cutSchedule={{ roundsBeforeFirstCut: 1, roundsPerCut: 1, barrageRounds: 1 }}
        adminResolvable={() => false}
        onOpenAdminModal={noop}
        emptyLabel="Rien"
      />,
    );
    expect(markup).toContain("Barrage");
    expect(markup).toContain("Coupe");
  });

  it("sans manche, affiche le libellé vide", () => {
    const markup = renderToStaticMarkup(
      <SurvivalRounds
        matches={[]}
        allTournamentMatches={[]}
        cutSchedule={null}
        adminResolvable={() => false}
        onOpenAdminModal={noop}
        emptyLabel="Aucune manche"
      />,
    );
    expect(markup).toContain("Aucune manche");
  });
});

describe("Phase suisse d'un multi-phases", () => {
  it("rend la vue suisse pour la phase en cours, et ses rondes seules pour une phase close", () => {
    expect(page).toContain(
      'if (formatForBracket === "SWISS" && detail.swiss && rankingMetaIsSelectedPhase) {',
    );
    expect(page).toMatch(/rankingMetaIsSelectedPhase =\s*!isMulti \|\| \(selectedPhase !== null && selectedPhase\.id === detail\.currentPhaseId\)/);
    const closed = page.slice(
      page.indexOf('if (formatForBracket === "SWISS") {'),
      page.indexOf("if (!filteredMatches.length) {"),
    );
    expect(closed).toContain("<SwissRounds");
    expect(closed).not.toContain("<BracketSections");
    expect(closed).toContain("{finishedPhaseStandings}");
  });

  it("la vue suisse ne reçoit que les matchs de la phase affichée", () => {
    const current = page.slice(
      page.indexOf('formatForBracket === "SWISS" && detail.swiss'),
      page.indexOf('if (formatForBracket === "SWISS") {'),
    );
    expect(current).toContain("matches={filteredMatches}");
    // Dernière phase close avec le tournoi : la vue porte déjà le classement.
    expect(current).not.toContain("{finishedPhaseStandings}");
  });

  it("remonte les vues à manches à chaque changement de phase", () => {
    for (const view of ["<SurvivalView", "<SurvivalRounds", "<SwissView", "<SwissRounds"]) {
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
