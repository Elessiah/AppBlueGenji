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

  it("déplie la liste avant que le glissement ne mesure les lignes, et au lâcher", () => {
    const panel = readFileSync(
      join(__dirname, "..", "..", "app/(secured)/tournois/[id]/_components/RegistrationsPanel.tsx"),
      "utf8",
    );
    const grip = panel.slice(panel.indexOf("const gripProps"));
    // Dépliée de façon synchrone **avant** l'appel du geste, qui relève les emplacements.
    expect(grip.indexOf("flushSync(() => setExpanded(true))")).toBeGreaterThan(-1);
    expect(grip.indexOf("flushSync(")).toBeLessThan(grip.indexOf("onPointerDown(event)"));
    expect(panel).toContain("{...gripProps(reg.teamId)}");
    expect(panel).not.toContain("{...drag.handleProps(reg.teamId)}");
    const onDrop = panel.slice(panel.indexOf("const onDrop"), panel.indexOf("const drag ="));
    expect(onDrop).toContain("mustExpandToShow(");
  });
});
