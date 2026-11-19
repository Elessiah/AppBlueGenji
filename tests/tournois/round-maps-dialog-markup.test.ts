import { describe, expect, it } from "@jest/globals";
import frRoundMaps from "@/messages/fr/roundMaps.json";
import enRoundMaps from "@/messages/en/roundMaps.json";
import { FIRST_BAN_RULES, NEXT_BAN_RULES } from "@/lib/shared/round-maps";
import { readSource } from "../helpers/read-source";

/**
 * Balisage de la fenêtre « Cartes et bans » (`docs/features/ROUND_MAPS.md`,
 * § Fenêtre allégée) : règles en segments radio, état d'une carte dit en texte,
 * liste de cartes dans une zone défilante nommée, contrôles compacts.
 */
const DIALOG = "app/(secured)/tournois/[id]/_components/RoundMapsDialog.tsx";
const STYLES = "app/(secured)/tournois/[id]/_components/RoundMapsDialog.module.css";

describe("ban rules segments", () => {
  it("dialog_banRules_renderedAsRadioGroupsWithStoredValueChecked", () => {
    const source = readSource(DIALOG);

    expect(source).toContain('type="radio"');
    expect(source).toContain("checked={firstBan === rule}");
    expect(source).toContain("checked={nextBan === rule}");
    expect(source).toContain("name={`${ids}-first`}");
    expect(source).toContain("name={`${ids}-next`}");
    expect(source).toContain("<legend className={styles.ruleLegend}>{t(\"dialog.firstBan\")}</legend>");
    expect(source).toContain("<legend className={styles.ruleLegend}>{t(\"dialog.nextBan\")}</legend>");
  });

  it("dialog_banRules_everyOptionHasFrenchAndEnglishLabel", () => {
    for (const dialog of [frRoundMaps.dialog, enRoundMaps.dialog]) {
      for (const rule of FIRST_BAN_RULES) expect(dialog.firstBanOptions[rule]).toBeTruthy();
      for (const rule of NEXT_BAN_RULES) expect(dialog.nextBanOptions[rule]).toBeTruthy();
    }
  });
});

describe("slot state", () => {
  it("slot_state_emptyImposedPool_exposeDataStateAndPillText", () => {
    const source = readSource(DIALOG);

    expect(source).toContain("data-state={slotState(slot.length)}");
    expect(source).toMatch(/if \(count === 0\) return "empty";\s*return count === 1 \? "imposed" : "pool";/);
    expect(source).toContain('t("dialog.slotEmpty")');
    expect(source).toContain('t("dialog.slotImposed")');
    expect(source).toContain('t("dialog.slotPool", { count: slot.length })');
  });

  it("slot_toggleButton_keepsErrorAriaAndAriaControls", () => {
    const source = readSource(DIALOG);

    expect(source).toMatch(/id=\{toggleId\}[\s\S]{0,200}aria-expanded=\{open\}[\s\S]{0,80}aria-controls=\{pickerId\}[\s\S]{0,40}\{\.\.\.errorAria\}/);
    expect(source).toContain("<FieldErrorText fieldId={toggleId} message={errorMessage} />");
  });
});

describe("map list", () => {
  it("mapPicker_mapList_insideScrollAreaWithLabel", () => {
    const source = readSource(DIALOG);
    const css = readSource(STYLES);

    expect(source).toMatch(/<ScrollArea orientation="y" ariaLabel=\{t\("dialog\.mapListLabel", \{ number \}\)\}/);
    expect(css).not.toMatch(/overflow(-y)?:\s*auto/);
  });

  it("roundMaps_mapListLabel_existsInFrAndEnWithNumberPlaceholder", () => {
    const fr = frRoundMaps.dialog.mapListLabel;
    const en = enRoundMaps.dialog.mapListLabel;

    expect(fr).toContain("{number}");
    expect(en).toContain("{number}");
    expect(fr).not.toBe(en);
  });
});

describe("compact controls and chips", () => {
  it("dialog_compactButtons_useCompactClassNotBareBtn", () => {
    const source = readSource(DIALOG);
    const css = readSource(STYLES);

    expect(source).not.toContain('className="btn ghost"');
    expect(source).toContain("styles.compact");
    expect(css).toMatch(/@media \(pointer: coarse\) \{\s*button\.compact \{\s*min-height: 44px;/);
  });

  it("styles_checkedChips_declareFocusVisibleAndSelectedState", () => {
    const css = readSource(STYLES);

    for (const selector of [".segment", ".option"]) {
      expect(css).toContain(`${selector}:has(input:checked)`);
      expect(css).toContain(`${selector}:has(input:focus-visible)`);
    }
  });
});
