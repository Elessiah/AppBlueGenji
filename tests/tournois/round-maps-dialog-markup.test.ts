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
  it("dialog_banRules_bothGroupsUseBanRuleSegmentsWithStoredValue", () => {
    const source = readSource(DIALOG);

    // Chaque groupe lu dans son propre bloc JSX : l'ordre des props est libre, un échange de setter ne passe pas.
    const blocks = source.match(/<BanRuleSegments\b[\s\S]*?\/>/g) ?? [];
    const first = blocks.find((block) => block.includes('t("dialog.firstBan")'));
    const next = blocks.find((block) => block.includes('t("dialog.nextBan")'));

    expect(blocks).toHaveLength(2);
    for (const prop of ["rules={FIRST_BAN_RULES}", "value={firstBan}", "onChange={setFirstBan}", "busy={busy}", "isBusy={isBusy}"]) {
      expect(first).toContain(prop);
    }
    for (const prop of ["rules={NEXT_BAN_RULES}", "value={nextBan}", "onChange={setNextBan}", "busy={busy}", "isBusy={isBusy}"]) {
      expect(next).toContain(prop);
    }
  });

  it("dialog_saveRules_sendsMapRulesPayload", () => {
    // Le corps lui-même est vérifié sur `mapRulesPayload` (round-maps-editor-guards.test.ts).
    expect(readSource(DIALOG)).toContain("mapRulesPayload({ firstBan, nextBan }, rules)");
  });

  it("dialog_banRules_everyOptionHasFrenchAndEnglishLabel", () => {
    for (const dialog of [frRoundMaps.dialog, enRoundMaps.dialog]) {
      for (const rule of FIRST_BAN_RULES) expect(dialog.firstBanOptions[rule]).toBeTruthy();
      for (const rule of NEXT_BAN_RULES) expect(dialog.nextBanOptions[rule]).toBeTruthy();
    }
  });
});

describe("slot state", () => {
  it("slot_state_dataStateAndPillComeFromSlotState", () => {
    const source = readSource(DIALOG);

    expect(source).toContain("const state = slotState(slot.length);");
    expect(source).toContain("data-state={state}");
    expect(source).toContain("SLOT_STATE_PILL[state]");
    expect(source).toContain('t("dialog.slotEmpty")');
    expect(source).toContain('t("dialog.slotImposed")');
    expect(source).toContain('t("dialog.slotPool", { count })');
    expect(source).toContain("slotStateText(state, slot.length, t)");
  });

  it("slot_toggleButton_sitsNextToItsErrorText", () => {
    const source = readSource(DIALOG);

    expect(source).toMatch(
      /<div className=\{styles\.slotFoot\}>\s*<button[\s\S]{0,120}id=\{toggleId\}[\s\S]{0,120}aria-expanded=\{open\}\s*aria-controls=\{pickerId\}\s*\{\.\.\.errorAria\}[\s\S]{0,200}<\/button>\s*<FieldErrorText fieldId=\{toggleId\} message=\{errorMessage\} \/>/,
    );
  });

  it("styles_slotStates_differByPatternNotOnlyOpacity", () => {
    const css = readSource(STYLES);

    expect(css).toMatch(/\.slot\[data-state="pool"\] \{\s*border-left: 4px double/);
    expect(css).toMatch(/\.slot\[data-state="empty"\] \{\s*border-left-style: dashed/);
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
  it("dialog_compactButtons_useSharedCompactClass", () => {
    const source = readSource(DIALOG);
    const globals = readSource("app/globals.css");

    expect(source).not.toContain('className="btn ghost"');
    expect(source).not.toContain("styles.compact");
    expect(source).toContain('className="btn ghost compact"');
    expect(globals).toMatch(/@media \(pointer: coarse\) \{\s*\.btn\.compact \{\s*min-height: 44px;/);
  });

  it("globals_radioSegments_touchTargetAndCheckedState", () => {
    const globals = readSource("app/globals.css");

    expect(globals).toContain(".radio-segment:has(input:checked)");
    expect(globals).toMatch(/@media \(pointer: coarse\) \{[^}]*\}\s*\.radio-segment \{\s*min-height: 44px;/);
  });

  it("styles_chips_checkedStateWithoutSecondFocusRing", () => {
    const css = readSource(STYLES);
    const globals = readSource("app/globals.css");

    expect(css).toContain(".option:has(input:checked)");
    expect(css).not.toContain(":has(input:focus-visible)");
    // Un seul repère de focus : le contour de la pastille, pas l'anneau de la radio en plus.
    expect(globals).toContain(".radio-segment:has(input:focus-visible)");
    expect(globals).toMatch(/\.radio-segment input\[type="radio"\]:focus-visible \{\s*box-shadow: none;/);
  });

  it("globals_radioSegments_busyCheckedPillIsDimmed", () => {
    const globals = readSource("app/globals.css");

    expect(globals).toContain('.radio-segment:has(input[aria-disabled="true"]:checked)');
  });
});

describe("lighter dialog details", () => {
  it("dialog_slotHead_noDuplicateNumberBadge", () => {
    expect(readSource(DIALOG)).not.toContain("slotNumber");
    expect(readSource(STYLES)).not.toContain(".slotNumber");
  });

  it("styles_iconButton_beatsCompactPaddingAndHasNoDeadSegmentsRule", () => {
    const css = readSource(STYLES);

    expect(css).toMatch(/\.slotHead button\.iconButton \{\s*min-width: 32px;\s*padding: 4px 8px;/);
    expect(css).not.toContain(".segments");
  });

  it("styles_separators_oneRulePerBarAndNoRuleOnLoneCustomRow", () => {
    const css = readSource(STYLES);

    expect(css).toMatch(/\.customRow:not\(:first-child\),\s*\.actionsBar \{/);
    expect(css).not.toMatch(/\.copyRow,\s*\.actionsBar/);
  });

  it("dialog_saveButtons_allSolidAndEachBarSeparated", () => {
    const source = readSource(DIALOG);

    expect(source.match(/type="submit" className="btn compact"/g)).toHaveLength(4);
    expect(source.match(/styles\.actionsBar/g)).toHaveLength(4);
  });

  it("styles_mapList_shortScreensKeepMinimumHeightAndNarrowDropsBox", () => {
    const css = readSource(STYLES);

    expect(css).toContain("max-height: max(180px, min(280px, 40dvh));");
    expect(css).toMatch(/@media \(max-width: 480px\) \{[\s\S]*\.mapList \{\s*padding: 6px 0;\s*border: 0;/);
  });

  it("styles_mapList_narrowKeepsTopAndBottomRule", () => {
    expect(readSource(STYLES)).toMatch(/\.mapList \{\s*padding: 6px 0;\s*border: 0;\s*border-block: 1px solid/);
  });

  it("dialog_staleTiebreaks_legendIsTextOnlyAndHintOutside", () => {
    expect(readSource(DIALOG)).toMatch(
      /<legend className="sr-only">\{t\("dialog\.staleTiebreakTitle"\)\}<\/legend>\s*<InfoHintRow>[\s\S]*?<InfoHint id=\{`\$\{ids\}-hint`\}/,
    );
  });

  it("dialog_pointsPerMap_legendIsTextOnlyAndHintOutside", () => {
    expect(readSource(DIALOG)).toMatch(
      /<legend className="sr-only">\{t\("dialog\.pointsPerMapTitle"\)\}<\/legend>\s*<div className=\{styles\.labelRow\}>[\s\S]*?<InfoHint id=\{`\$\{ids\}-points-maps-hint`\}/,
    );
  });

  it("dialog_noLegendContainsInfoHint", () => {
    expect(readSource(DIALOG)).not.toMatch(/<legend\b(?:(?!<\/legend>)[\s\S])*<InfoHint\b/);
  });

  it("mapPicker_latestEdit_updatedInLayoutEffectNotDuringRender", () => {
    const source = readSource(DIALOG);

    expect(source).toMatch(/useLayoutEffect\(\(\) => \{\s*latestEdit\.current = onEdit;\s*\}, \[onEdit\]\);/);
    expect(source.match(/latestEdit\.current = onEdit;/g)).toHaveLength(1);
  });
});

describe("map list rendering cost", () => {
  it("dialog_mapList_optionsAreMemoisedWithStableToggle", () => {
    const source = readSource(DIALOG);

    expect(source).toContain("const MapOption = memo(function MapOption(");
    expect(source).toMatch(/<MapOption key=\{map\}[^>]*onToggle=\{toggleMap\}/);
    expect(source).toContain("latestEdit.current = onEdit;");
    expect(source).not.toMatch(/\{\s*empty: \(\) =>/);
  });

  it("dialog_overwatchBranch_searchAndListShareOneCondition", () => {
    const source = readSource(DIALOG);

    expect(source.match(/\{overwatch && \(/g)).toHaveLength(1);
  });
});
