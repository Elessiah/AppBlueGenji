import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  REGISTRATIONS_DISPLAY_LIMIT,
  hiddenRegistrationCount,
  mustExpandToShow,
  visibleRegistrationCount,
} from "@/app/(secured)/tournois/[id]/_lib/registrations-list";

describe("repli de la liste des inscrites", () => {
  it("montre tout sous la limite", () => {
    expect(visibleRegistrationCount(0, false)).toBe(0);
    expect(visibleRegistrationCount(REGISTRATIONS_DISPLAY_LIMIT, false)).toBe(REGISTRATIONS_DISPLAY_LIMIT);
    expect(hiddenRegistrationCount(REGISTRATIONS_DISPLAY_LIMIT)).toBe(0);
  });

  it("borne au-delà, et rend tout une fois dépliée", () => {
    expect(visibleRegistrationCount(128, false)).toBe(16);
    expect(hiddenRegistrationCount(128)).toBe(112);
    expect(visibleRegistrationCount(128, true)).toBe(128);
  });

  it("déplie pour suivre une ligne qui passe sous la dernière visible", () => {
    expect(mustExpandToShow(15, false)).toBe(false);
    expect(mustExpandToShow(16, false)).toBe(true);
    expect(mustExpandToShow(16, true)).toBe(false);
  });

  it("est câblé dans le panneau par un seul bouton réversible", () => {
    const panel = readFileSync(
      join(__dirname, "..", "..", "app/(secured)/tournois/[id]/_components/RegistrationsPanel.tsx"),
      "utf8",
    );
    expect(panel).toContain("visibleRows.map(");
    expect(panel).toContain("aria-expanded={expanded}");
    expect(panel).toContain("mustExpandToShow(");
  });

  it("déplie la liste avant d'écrire quand la flèche ↓ ferait sortir la ligne", () => {
    const panel = readFileSync(
      join(__dirname, "..", "..", "app/(secured)/tournois/[id]/_components/RegistrationsPanel.tsx"),
      "utf8",
    );
    // Le geste vit dans `performMove` (que `move` appelle, ou la confirmation).
    const move = panel.slice(panel.indexOf("const performMove = async"));
    expect(move.indexOf("mustExpandToShow(")).toBeGreaterThan(-1);
    expect(move.indexOf("setExpanded(true)")).toBeLessThan(move.indexOf("await applyOrder("));
    // Plus de glissement : rien ne déplie la liste au pointeur.
    expect(panel).not.toContain("gripProps");
  });
});
