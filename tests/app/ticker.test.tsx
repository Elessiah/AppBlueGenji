import { describe, expect, it } from "@jest/globals";
import { renderToStaticMarkup } from "react-dom/server";
import { Ticker } from "@/components/cyber/Ticker";

describe("Ticker — bandeau défilant", () => {
  const html = renderToStaticMarkup(<Ticker items={["Alpha", "Bravo"]} />);

  it("est un défilant nommé", () => {
    expect(html).toMatch(/role="marquee" aria-label="Fil d&#x27;actualité"/);
  });

  it("double sa piste pour boucler, mais ne fait lire chaque élément qu'une fois", () => {
    expect(html.match(/Alpha/g)).toHaveLength(2);
    const copies = html.match(/<div class="copy"[^>]*>/g) ?? [];
    expect(copies).toHaveLength(2);
    expect(copies[0]).not.toContain("aria-hidden");
    expect(copies[1]).toContain('aria-hidden="true"');
  });

  it("masque les séparateurs décoratifs", () => {
    expect(html).toMatch(/<i class="sep" aria-hidden="true">◆<\/i>/);
  });

  it("porte un bouton pause nommé, et démarre en défilement", () => {
    expect(html).toMatch(/<button type="button" class="pause" aria-label="Mettre en pause le défilement du bandeau"/);
    expect(html).not.toContain("data-paused");
  });

  it("rend un bandeau vide sans planter", () => {
    expect(renderToStaticMarkup(<Ticker items={[]} />)).toContain('role="marquee"');
  });
});
