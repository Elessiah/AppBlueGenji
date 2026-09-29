import { describe, expect, it } from "@jest/globals";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * Dialogues de la fiche tournoi sur un petit écran.
 *
 * Harnais `node` : les invariants se gardent sur la source. Chacun répond à un
 * défaut relevé par l'audit responsive :
 *
 * - **hauteur bornée** — sans `max-height`, « Diffusion du match » dépliée
 *   (432 px) sortait de l'écran en paysage (390 px), boutons compris, alors que
 *   le défilement de la page est verrouillé ; une borne en `100vh` vaut la
 *   *grande* hauteur sur iOS et laisse passer le clavier virtuel ;
 * - **champs de score** — sous ~340 px ils tombaient à 21 px, chiffre invisible ;
 * - **modale de lancement** — « Prêt » à 800 px du haut sur un 320 × 568, et le
 *   focus d'ouverture sur un « Copier » de 17 px.
 */

const ROOT = join(__dirname, "..", "..");
const DIR = join(ROOT, "app", "(secured)", "tournois", "[id]", "_components");
const read = (path: string) => readFileSync(path, "utf8").replace(/\r\n/g, "\n");
const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");

function rule(css: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return css.match(new RegExp(`(?:^|\\n)${escaped} \\{[^}]*\\}`))?.[0] ?? "";
}

describe("dialogues de la fiche tournoi — hauteur bornée", () => {
  const globals = stripComments(read(join(ROOT, "app", "globals.css")));

  it("la classe partagée borne en `dvh` avec repli `vh` et défile", () => {
    const bounded = rule(globals, ".dialog-bounded");
    expect(bounded).toContain("max-height: calc(100vh - 32px)");
    expect(bounded).toContain("max-height: calc(100dvh - 32px)");
    // Le repli vient d'abord : la seconde déclaration l'emporte là où `dvh` existe.
    expect(bounded.indexOf("100vh")).toBeLessThan(bounded.indexOf("100dvh"));
    expect(bounded).toContain("overflow-y: auto");
  });

  const inlineDialogs = readdirSync(DIR).filter((name) => {
    if (!name.endsWith(".tsx")) return false;
    const src = read(join(DIR, name));
    return src.includes('aria-modal="true"') && !src.includes("styles.");
  });

  it("repère bien les dialogues stylés en ligne", () => {
    expect(inlineDialogs).toEqual(
      expect.arrayContaining([
        "MatchLiveDialog.tsx",
        "MatchScheduleDialog.tsx",
        "MatchReplayDialog.tsx",
        "IssueReportDialog.tsx",
        "EndurancePenaltyDialog.tsx",
        "TournamentImageDialog.tsx",
      ]),
    );
  });

  it.each(["MatchLiveDialog.tsx", "MatchScheduleDialog.tsx", "MatchReplayDialog.tsx", "IssueReportDialog.tsx", "EndurancePenaltyDialog.tsx", "AdvanceTournamentDialog.tsx", "DeleteTournamentDialog.tsx", "RemoveEntrantDialog.tsx", "RollbackRoundDialog.tsx", "TournamentImageDialog.tsx"])(
    "%s porte `.dialog-bounded` et aucune borne en `vh` en ligne",
    (name) => {
      const src = stripComments(read(join(DIR, name)));
      expect(src).toContain('className="dialog-bounded"');
      expect(src).not.toMatch(/maxHeight:\s*"[^"]*\bvh/);
    },
  );

  it.each(["ScoreDialog.module.css", "ConfirmActionDialog.module.css"])(
    "%s borne `.dialog` en `dvh`",
    (name) => {
      const dialog = rule(stripComments(read(join(DIR, name))), ".dialog");
      expect(dialog).toContain("max-height: calc(100dvh - 32px)");
      expect(dialog).toMatch(/overflow(-y)?: auto/);
    },
  );
});

describe("champs de score sur un petit écran", () => {
  const css = stripComments(read(join(DIR, "ScoreDialog.module.css")));

  it("un champ ne descend pas sous 44 px", () => {
    expect(rule(css, ".field")).toContain("min-width: 44px");
  });

  it("les deux côtés s'empilent sous 375 px", () => {
    const media = css.match(/@media \(max-width: 374px\) \{[\s\S]*?\n\}/)?.[0] ?? "";
    expect(media).toMatch(/\.scores \{[^}]*grid-template-columns: minmax\(0, 1fr\);/);
  });
});

describe("modale de lancement sur un petit écran", () => {
  const tsx = read(join(ROOT, "components", "match-launch", "MatchLaunchCenter.tsx"));
  const css = stripComments(read(join(ROOT, "components", "match-launch", "MatchLaunchCenter.module.css")));

  it("la barre d'actions et la confirmation sont collées au bas", () => {
    const sticky = css.match(/\.footer,\n\.confirm \{[^}]*\}/)?.[0] ?? "";
    expect(sticky).toContain("position: sticky");
    expect(sticky).toContain("bottom: calc(-1 * var(--modal-pad))");
    // Fond opaque : ce qui défile dessous ne doit pas transparaître.
    expect(sticky).toContain("background: var(--cyber-bg-1");
  });

  it("le focus d'ouverture va à « Prêt », puis à « Voir le match »", () => {
    const readyOff = tsx.indexOf("{partyWord}");
    const readyOn = tsx.indexOf("✓ Prêt — annuler");
    const view = tsx.indexOf("Voir le match");
    const firstCopy = tsx.indexOf("Copier\n");
    for (const label of [readyOff, readyOn, view]) {
      const opening = tsx.lastIndexOf("<", tsx.lastIndexOf(">", label));
      expect(tsx.slice(opening, label)).toContain("data-autofocus");
    }
    // Les boutons « Copier » ne sont jamais marqués.
    const copyOpening = tsx.lastIndexOf("<button", firstCopy);
    expect(tsx.slice(copyOpening, firstCopy)).not.toContain("data-autofocus");
    // « Prêt » précède « Voir le match » dans le DOM : c'est lui que le premier
    // élément marqué désigne quand il est rendu.
    expect(readyOn).toBeLessThan(view);
    expect(readyOff).toBeLessThan(view);
  });

  it("les noms d'équipe des fiches passent à la ligne au lieu d'être rognés", () => {
    const sideName = rule(css, ".sideName");
    expect(sideName).not.toContain("text-overflow: ellipsis");
    expect(sideName).not.toContain("white-space: nowrap");
    expect(sideName).toContain("overflow-wrap: anywhere");
  });
});
