import { describe, expect, it } from "@jest/globals";
import { horizontalScrollHint } from "@/lib/shared/scroll-hint";

describe("horizontalScrollHint", () => {
  it("ne dit rien quand le contenu tient", () => {
    expect(horizontalScrollHint({ scrollLeft: 0, clientWidth: 300, scrollWidth: 300 })).toBeNull();
  });

  it("tolère l'arrondi d'un pixel", () => {
    expect(horizontalScrollHint({ scrollLeft: 0, clientWidth: 300, scrollWidth: 301 })).toBeNull();
  });

  it("annonce la fin seulement au départ", () => {
    expect(horizontalScrollHint({ scrollLeft: 0, clientWidth: 300, scrollWidth: 900 })).toBe("end");
  });

  it("annonce les deux bords au milieu", () => {
    expect(horizontalScrollHint({ scrollLeft: 200, clientWidth: 300, scrollWidth: 900 })).toBe("start end");
  });

  it("annonce le début seulement une fois au bout, arrondi compris", () => {
    expect(horizontalScrollHint({ scrollLeft: 600, clientWidth: 300, scrollWidth: 900 })).toBe("start");
    expect(horizontalScrollHint({ scrollLeft: 599.5, clientWidth: 300, scrollWidth: 900 })).toBe("start");
  });
});
