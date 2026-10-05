import { describe, expect, it } from "@jest/globals";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { ERROR_MESSAGES, mapError } from "@/app/(secured)/tournois/[id]/_lib/error-map";

/**
 * Ordre de départ réglé aux flèches seules (docs/features/SEEDING_ORDER.md).
 *
 * Le glisser-déposer a été retiré : sur téléphone, la poignée se déclenchait en
 * voulant faire défiler la liste. Ces tests lisent la source, comme ceux du
 * retrait d'un engagé : le panneau n'a pas de banc de rendu.
 */
const ROOT = join(__dirname, "..", "..");
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");

const PANEL = "app/(secured)/tournois/[id]/_components/RegistrationsPanel.tsx";
const PANEL_CSS = "app/(secured)/tournois/[id]/_components/RegistrationsPanel.module.css";

function stripComments(code: string): string {
  return code.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
}

function ruleBody(css: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`(?:^|\\})\\s*${escaped}\\s*\\{([^}]*)\\}`).exec(stripComments(css));
  expect(match).not.toBeNull();
  return match![1];
}

describe("Ordre de départ — flèches seules", () => {
  const panel = stripComments(read(PANEL));
  const css = read(PANEL_CSS);

  it("n'a plus ni poignée ni geste de glissement", () => {
    expect(panel).not.toMatch(/useSeedingDrag|onPointerDown|flushSync|styles\.grip/);
    expect(existsSync(join(ROOT, "app/(secured)/tournois/[id]/_hooks/useSeedingDrag.ts"))).toBe(false);
    expect(existsSync(join(ROOT, "lib/shared/drag-reorder.ts"))).toBe(false);
    const body = stripComments(css);
    expect(body).not.toMatch(/\.grip|\.dragging|\.dragged|\.reorderable|touch-action:\s*none/);
  });

  it("garde deux vrais boutons, nommés d'après l'engagé", () => {
    expect(panel).toMatch(/aria-label=\{`Monter \$\{reg\.teamName\} d'un rang`\}/);
    expect(panel).toMatch(/aria-label=\{`Descendre \$\{reg\.teamName\} d'un rang`\}/);
    expect(panel.match(/className=\{styles\.arrow\}/g)).toHaveLength(2);
    // De vrais `<button>` : focusables, actionnés à Entrée et à l'espace.
    expect(
      panel.match(/<button\s+type="button"\s+ref=\{[\s\S]*?\}\s+className=\{styles\.arrow\}/g),
    ).toHaveLength(2);
  });

  it("désactive la flèche qui sortirait de la liste", () => {
    expect(panel).toMatch(/disabled=\{busy \|\| index === 0\}/);
    expect(panel).toMatch(/disabled=\{busy \|\| index === rows\.length - 1\}/);
  });

  it("ne réagit qu'au clic, jamais au défilement", () => {
    expect(panel).toMatch(/onClick=\{\(\) => move\(reg\.teamId, "up"\)\}/);
    expect(panel).toMatch(/onClick=\{\(\) => move\(reg\.teamId, "down"\)\}/);
    expect(ruleBody(css, ".arrow")).toMatch(/touch-action:\s*manipulation/);
  });

  it("marque l'état désactivé par les couleurs, jamais par l'opacité", () => {
    const disabled = ruleBody(css, ".arrow:disabled");
    expect(disabled).not.toMatch(/opacity/);
    expect(disabled).toMatch(/color:\s*var\(--ink-mute\)/);
    expect(ruleBody(css, ".remove:disabled")).not.toMatch(/opacity/);
  });

  it("agrandit les flèches au doigt", () => {
    const mobile = /@media \(max-width: 720px\) \{([\s\S]*?)\n\}/.exec(stripComments(css));
    expect(mobile).not.toBeNull();
    expect(mobile![1]).toMatch(/\.arrow\s*\{\s*width:\s*44px;\s*height:\s*44px;/);
  });

  it("ne propose les flèches que tant que l'ordre est modifiable", () => {
    expect(panel).toMatch(
      /const reorderable = staff && lockReason === null && detail\.registrations\.length > 1;/,
    );
    expect(panel).toMatch(/STARTED: "Le tournoi a commencé : l'ordre de départ est désormais figé\."/);
  });
});

describe("Refus d'un réordonnancement après le coup d'envoi", () => {
  it("traduit le code en phrase française", () => {
    expect(ERROR_MESSAGES.SEEDING_LOCKED_STARTED).toBeDefined();
    expect(mapError("SEEDING_LOCKED_STARTED")).toMatch(/commencé/);
    expect(mapError("SEEDING_LOCKED")).toMatch(/score/);
  });
});
