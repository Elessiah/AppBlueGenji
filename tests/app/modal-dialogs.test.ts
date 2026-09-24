import { describe, expect, it } from "@jest/globals";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * Toutes les modales du site.
 *
 * Le harnais tourne en environnement `node` : un composant React n'y est pas
 * montable, les invariants se gardent donc sur la **source**. Chacun répond à
 * un défaut constaté dans un navigateur :
 *
 * - **portail** — une modale rendue dans la page hérite des contextes
 *   d'empilement de ses ancêtres. La section 03 de l'accueil (`position:
 *   relative; z-index: 1`) laissait passer les partenaires par-dessus son voile
 *   selon le défilement, le bureau de `/association` les documents ;
 *   `main.page-shell` (`z-index: 1`) laissait la barre de navigation (`50`)
 *   nette et cliquable au-dessus de toutes les modales de l'espace connecté ;
 *   et le `transform` que `.fade-in` laisse posé faisait de la section de
 *   `/profil` la référence de `position: fixed` — la notice BattleTag se
 *   centrait au milieu d'un bloc de 2 500 px, hors de l'écran ;
 * - **pile commune** (`useDialogBehavior`) — un écouteur Échap maison ne
 *   verrouille pas le défilement (la page défilait sous le voile), ne piège pas
 *   la tabulation, et un `overflow` sauvegardé à la main est levé sous la
 *   modale par la fermeture d'une autre ;
 * - **voile** (`useBackdropDismiss`) — `onClick` sur le voile et
 *   `stopPropagation()` sur le panneau ne protègent de rien : une sélection de
 *   texte relâchée hors du panneau envoie son clic au voile, et la saisie
 *   partait avec la modale.
 */

const ROOT = join(__dirname, "..", "..");
const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return entry === "node_modules" ? [] : walk(path);
    return path.endsWith(".tsx") ? [path] : [];
  });
}

const rel = (path: string) => relative(ROOT, path).split("\\").join("/");
const sources = [...walk(join(ROOT, "app")), ...walk(join(ROOT, "components"))].map((path) => ({
  file: rel(path),
  src: stripComments(readFileSync(path, "utf8")),
}));
// `aria-modal` et non `role="dialog"` : deux modales choisissent leur rôle à la
// volée (`role={confirming ? "alertdialog" : "dialog"}`).
const dialogs = sources.filter(({ src }) => /aria-modal/.test(src));

/**
 * Modales montées au niveau de `<body>` ou rendues dès le rendu serveur — un
 * portail y est soit inutile (déjà sous `<body>`), soit impossible (pas de
 * `document` côté serveur).
 */
const NO_PORTAL: Record<string, string> = {
  "components/privacy/PrivacyChangesModal.tsx": "montée par la mise en page racine, rendue côté serveur",
  "components/recruitment-highlight.tsx": "montée par la mise en page racine, rendue côté serveur (LCP)",
  "components/match-launch/MatchLaunchCenter.tsx": "montée par la mise en page racine, directement sous <body>",
  "components/cyber/RgpdConsentModal.tsx": "rendue côté serveur tant que le consentement n'est pas donné",
};

/** Modales qu'un clic à côté ne ferme pas, par choix. */
const NO_BACKDROP_DISMISS: Record<string, string> = {
  "components/privacy/PrivacyChangesModal.tsx": "un choix de confidentialité se tranche par un bouton",
  "components/match-launch/MatchLaunchCenter.tsx": "le lancement d'un match ne se ferme pas par inadvertance",
  "components/cyber/RgpdConsentModal.tsx": "un consentement se tranche par un bouton",
  "app/(secured)/profil/BattletagVisibilityNotice.tsx": "information à un seul bouton, qui doit être lue",
};

describe("modales du site", () => {
  it("sont bien trouvées par le balayage", () => {
    // Garde-fou du balayage lui-même : un motif cassé rendrait tout vert.
    expect(dialogs.length).toBeGreaterThanOrEqual(20);
    expect(dialogs.map((d) => d.file)).toContain("components/cyber/landing/LandingDialog.tsx");
  });

  it.each(Object.keys({ ...NO_PORTAL, ...NO_BACKDROP_DISMISS }))("l'exception %s désigne une modale existante", (file) => {
    expect(dialogs.map((d) => d.file)).toContain(file);
  });

  describe.each(dialogs.map((d) => [d.file, d.src] as [string, string]))("%s", (file, src) => {
    it("passe par la pile commune useDialogBehavior", () => {
      expect(src).toContain("useDialogBehavior(");
      expect(src).not.toMatch(/addEventListener\(\s*["']keydown["']/);
      expect(src).not.toContain("document.body.style.overflow");
    });

    it("est portée dans document.body", () => {
      if (file in NO_PORTAL) return;
      expect(src).toMatch(/createPortal\([\s\S]*document\.body\s*,?\s*\)/);
    });

    it("ne ferme par le voile qu'un geste commencé et fini sur lui", () => {
      // Le motif d'avant — `stopPropagation()` sur le panneau pour que son clic
      // n'atteigne pas le voile — ne sert plus à rien, et signale un voile qui
      // ferme encore sur un simple `onClick`.
      expect(src).not.toContain(".stopPropagation()");
      if (file in NO_BACKDROP_DISMISS) return;
      expect(src).toContain("useBackdropDismiss(");
      expect(src).toContain("{...backdrop}");
    });
  });
});

describe("modales de gestion des pages publiques", () => {
  it.each([
    "components/cyber/landing/AboutStats.tsx",
    "components/cyber/landing/AboutPillars.tsx",
    "components/cyber/landing/SponsorsGrid.tsx",
    "components/cyber/landing/FooterContact.tsx",
    "app/association/BureauSection.tsx",
    "app/benevoles/BenevolesSection.tsx",
    "app/recrutement/RecruitmentSection.tsx",
  ])("%s passe par LandingDialog sans recopier de cadre", (file) => {
    const src = sources.find((s) => s.file === file)?.src ?? "";
    expect(src).toContain("<LandingDialog");
    expect(src).not.toContain("createPortal");
    expect(src).not.toContain('role="dialog"');
    expect(src).not.toMatch(/modalOverlay|styles\.overlay/);
  });

  it("LandingDialog verrouille la fermeture pendant un envoi", () => {
    const src = sources.find((s) => s.file === "components/cyber/landing/LandingDialog.tsx")?.src ?? "";
    expect(src).toMatch(/useDialogBehavior\(\{[^}]*locked: busy/);
    expect(src).toContain("useBackdropDismiss(onClose, busy)");
  });
});
