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
        "MatchScheduleDialog.tsx",
        "MatchReplayDialog.tsx",
        "TournamentImageDialog.tsx",
        "TournamentDialogFrame.tsx",
      ]),
    );
  });

  it.each(["MatchScheduleDialog.tsx", "MatchReplayDialog.tsx", "TournamentDialogFrame.tsx", "TournamentImageDialog.tsx"])(
    "%s porte `.dialog-bounded` et aucune borne en `vh` en ligne",
    (name) => {
      const src = stripComments(read(join(DIR, name)));
      expect(src).toContain('className="dialog-bounded"');
      expect(src).not.toMatch(/maxHeight:\s*"[^"]*\bvh/);
    },
  );

  it.each(["MatchLiveDialog.tsx", "IssueReportDialog.tsx", "EndurancePenaltyDialog.tsx", "TournamentDialogShell.tsx", "DeleteTournamentDialog.tsx", "RollbackRoundDialog.tsx"])(
    "%s passe par le cadre commun, sans borne en `vh` en ligne",
    (name) => {
      const src = stripComments(read(join(DIR, name)));
      expect(src).toContain("<TournamentDialogFrame");
      expect(src).not.toMatch(/maxHeight:\s*"[^"]*\bvh/);
    },
  );

  it.each([join(DIR, "ScoreDialog.module.css"), join(ROOT, "components", "ui", "confirm-action-dialog.module.css")])(
    "%s borne `.dialog` en `dvh`",
    (path) => {
      const dialog = rule(stripComments(read(path)), ".dialog");
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

  it("la barre d'actions et la confirmation restent sous la zone qui défile", () => {
    // La modale ne défile pas ; son contenu défile dans une <ScrollArea>, et les
    // actions en sont des sœurs, donc toujours visibles.
    const modal = rule(css, ".modal");
    expect(modal).toContain("overflow: hidden");
    expect(modal).toContain("max-height: calc(100dvh - 32px)");
    expect(rule(css, ".scroll")).toContain("min-height: 0");
    const bar = css.match(/\.footer,\n\.confirm \{[^}]*\}/)?.[0] ?? "";
    expect(bar).toContain("flex-shrink: 0");
    // Ni `sticky` ni `scroll-padding` : la barre collée masquait le focus, et
    // sa compensation faisait défiler la modale à l'ouverture.
    expect(css).not.toContain("position: sticky");
    expect(css).not.toContain("scroll-padding");
    const scrollOpen = tsx.indexOf("className={styles.scroll}");
    const scrollClose = tsx.indexOf("</ScrollArea>");
    expect(scrollOpen).toBeGreaterThan(-1);
    expect(tsx.slice(scrollOpen, scrollClose)).toContain("<header");
    expect(tsx.slice(scrollOpen, scrollClose)).not.toContain("{partyWord}");
    expect(tsx.indexOf("{partyWord}")).toBeGreaterThan(scrollClose);
  });

  it("le focus d'ouverture va au seul « Prêt » qui ouvre une confirmation", () => {
    const openingOf = (label: string) => {
      const at = tsx.indexOf(label);
      expect(at).toBeGreaterThan(-1);
      return tsx.slice(tsx.lastIndexOf("<", tsx.lastIndexOf(">", at)), at);
    };
    const readyOff = openingOf("{partyWord}");
    expect(readyOff).toContain("data-autofocus");
    expect(readyOff).toContain("setConfirming(true)");
    // Un Entrée égaré sur une modale ouverte d'office ne doit rien déclencher :
    // ni retrait du « Prêt » (sans confirmation), ni navigation.
    // Lot 8b-2 : les libellés viennent de `shell.launchModal`, cités par clé.
    expect(openingOf('t("launchModal.cancelReady")')).not.toContain("data-autofocus");
    expect(openingOf('{t("launchModal.viewMatch")}')).not.toContain("data-autofocus");
    expect(openingOf('{t("launchModal.copy")}')).not.toContain("data-autofocus");
    expect(tsx.match(/^\s*data-autofocus$/gm)).toHaveLength(1);
  });

  it("les noms d'équipe des fiches passent à la ligne au lieu d'être rognés", () => {
    const sideName = rule(css, ".sideName");
    expect(sideName).not.toContain("text-overflow: ellipsis");
    expect(sideName).not.toContain("white-space: nowrap");
    expect(sideName).toContain("overflow-wrap: anywhere");
  });
});
