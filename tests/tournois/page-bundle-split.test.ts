import { describe, expect, it } from "@jest/globals";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Découpage du paquet de la fiche tournoi. La panne est muette : un `import`
 * statique réintroduit à côté du `dynamic()` ne casse rien, il ramène seulement
 * le composant dans le paquet de chaque spectateur — seul `next build` le voit.
 */

const PAGE_DIR = "app/(secured)/tournois/[id]";
const page = readFileSync(join(process.cwd(), PAGE_DIR, "page.tsx"), "utf8");

const LAZY = [
  "SurvivalView",
  "SwissView",
  "EnduranceView",
  "BracketPreview",
  "PhaseStandingsBlock",
  "EntrantContactsPanel",
  "AdminScoreDialog",
  "PlayerScoreDialog",
  "GhostRegistrationDialog",
  "MatchLiveDialog",
  "MatchScheduleDialog",
  "MatchReplayDialog",
  "IssueReportDialog",
  "DeleteTournamentDialog",
  "RollbackRoundDialog",
  "EndurancePenaltyDialog",
  "AdvanceTournamentDialog",
  "TournamentImageDialog",
  "ConfirmActionDialog",
] as const;

describe("paquet de la fiche tournoi", () => {
  it.each(LAZY.map((name) => [name]))("%s est chargé à la demande", (name) => {
    expect(page).toContain(
      `const ${name} = dynamic(() => import("./_components/${name}").then((m) => m.${name}), { ssr: false });`,
    );
    expect(page).not.toMatch(new RegExp(`^import[^;]*\\b${name}\\b[^;]*from`, "m"));
    expect(page).toContain(`<${name}`);
  });

  it("désigne des modules qui existent et exportent le composant nommé", () => {
    for (const name of LAZY) {
      const file = join(process.cwd(), PAGE_DIR, "_components", `${name}.tsx`);
      expect(existsSync(file)).toBe(true);
      expect(readFileSync(file, "utf8")).toMatch(new RegExp(`export (function|const) ${name}\\b`));
    }
  });

  it("n'importe aucun dialogue de façon statique", () => {
    const staticDialogs = page.match(/^import \{[^}]*Dialog\b[^}]*\} from "\.\/_components\/[^"]+";$/gm);
    expect(staticDialogs).toBeNull();
  });
});
