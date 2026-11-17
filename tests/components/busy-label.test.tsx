import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { BusyLabel } from "@/components/ui/busy-label";

/**
 * Seul le libellé actif est dans le DOM (nom du bouton, `textContent`) ;
 * l'autre réserve sa largeur en pseudo-élément invisible (`data-alt`).
 */
describe("BusyLabel", () => {
  const html = (busy: boolean) => renderToStaticMarkup(<BusyLabel busy={busy} idle="Enregistrer" pending="Enregistrement…" />);

  it("BusyLabel_idle_onlyIdleTextInDom", () => {
    expect(html(false)).toBe('<span class="busy-label" data-alt="Enregistrement…"><span>Enregistrer</span></span>');
  });

  it("BusyLabel_busy_onlyPendingTextInDom", () => {
    expect(html(true)).toBe('<span class="busy-label" data-busy="true" data-alt="Enregistrer"><span>Enregistrement…</span></span>');
  });

  it("BusyLabel_anyState_noInlineStyle", () => {
    expect(html(false)).not.toContain("style=");
    expect(html(true)).not.toContain("style=");
  });

  it("globalsCss_busyLabel_reservesAltWidthInvisibly", () => {
    const css = readFileSync("app/globals.css", "utf8");
    expect(css).toMatch(/\.busy-label \{\s+display: inline-grid;/);
    expect(css).toMatch(/\.busy-label > \*,\s+\.busy-label::after \{\s+grid-area: 1 \/ 1;/);
    expect(css).toMatch(/\.busy-label::after \{\s+content: attr\(data-alt\);\s+content: attr\(data-alt\) \/ "";\s+visibility: hidden;/);
  });
});
