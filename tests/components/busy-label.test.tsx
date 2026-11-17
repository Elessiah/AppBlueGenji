import { describe, expect, it } from "@jest/globals";
import { renderToStaticMarkup } from "react-dom/server";
import { BusyLabel } from "@/components/ui/busy-label";

/** Les deux libellés partagent une case : la largeur du bouton ne bouge pas. */
describe("BusyLabel", () => {
  const html = (busy: boolean) => renderToStaticMarkup(<BusyLabel busy={busy} idle="Enregistrer" pending="Enregistrement…" />);

  it("BusyLabel_idle_showsIdleAndHidesPending", () => {
    const out = html(false);
    expect(out).toContain('visibility:visible">Enregistrer<');
    expect(out).toContain('visibility:hidden">Enregistrement…<');
  });

  it("BusyLabel_busy_swapsVisibility", () => {
    const out = html(true);
    expect(out).toContain('visibility:hidden">Enregistrer<');
    expect(out).toContain('visibility:visible">Enregistrement…<');
  });

  it("BusyLabel_bothLabels_shareOneGridCell", () => {
    const out = html(false);
    expect(out).toContain("display:inline-grid");
    expect(out.match(/grid-area:1 \/ 1/g)).toHaveLength(2);
  });
});
