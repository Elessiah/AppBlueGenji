import { describe, expect, it, jest } from "@jest/globals";
import { focusOnMount } from "@/lib/shared/focus-on-mount";

describe("focusOnMount", () => {
  it("donne le focus à l'élément monté", () => {
    const element = { focus: jest.fn<() => void>() };
    focusOnMount(element as unknown as HTMLElement);
    expect(element.focus).toHaveBeenCalledTimes(1);
  });

  it("ne fait rien au démontage (null)", () => {
    expect(() => focusOnMount(null)).not.toThrow();
  });
});
