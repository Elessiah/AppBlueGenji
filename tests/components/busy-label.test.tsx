import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { BusyLabel } from "@/components/ui/busy-label";

/** Les deux libellés partagent une case : la largeur du bouton ne bouge pas. */
describe("BusyLabel", () => {
  const html = (busy: boolean) => renderToStaticMarkup(<BusyLabel busy={busy} idle="Enregistrer" pending="Enregistrement…" />);

  it("BusyLabel_idle_hasNoBusyMarkerAndRendersBothLabels", () => {
    const out = html(false);
    expect(out).not.toContain("data-busy");
    expect(out).toContain("<span>Enregistrer</span><span>Enregistrement…</span>");
  });

  it("BusyLabel_busy_marksTheWrapper", () => {
    expect(html(true)).toContain('class="busy-label" data-busy="true"');
  });

  it("BusyLabel_anyState_usesNoInlineStyle", () => {
    expect(html(false)).not.toContain("style=");
    expect(html(true)).not.toContain("style=");
  });

  it("globalsCss_busyLabel_sharesOneGridCellAndSwapsVisibility", () => {
    const css = readFileSync("app/globals.css", "utf8");
    expect(css).toMatch(/\.busy-label \{\s+display: inline-grid;/);
    expect(css).toMatch(/\.busy-label > \* \{\s+grid-area: 1 \/ 1;/);
    expect(css).toMatch(/\.busy-label > :last-child,\s+\.busy-label\[data-busy="true"\] > :first-child \{\s+visibility: hidden;/);
    expect(css).toMatch(/\.busy-label\[data-busy="true"\] > :last-child \{\s+visibility: visible;/);
  });
});
