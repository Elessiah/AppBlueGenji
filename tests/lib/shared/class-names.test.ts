import { describe, expect, it } from "@jest/globals";
import { joinClasses } from "@/lib/shared/class-names";

describe("joinClasses", () => {
  it("concatène les classes présentes dans l'ordre", () => {
    expect(joinClasses("entity-link", "entity-truncate", "badge")).toBe("entity-link entity-truncate badge");
  });

  it("omet les absentes : false, null, undefined, chaîne vide", () => {
    expect(joinClasses("a", false, null, undefined, "", "b")).toBe("a b");
  });

  it("rend une chaîne vide sans aucune classe", () => {
    expect(joinClasses()).toBe("");
    expect(joinClasses(false, undefined)).toBe("");
  });
});
