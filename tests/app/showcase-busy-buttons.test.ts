import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Pages vitrine éditables (EF-68, `docs/features/BUSY_BUTTONS.md`) : pendant
 * une requête, les boutons des partenaires, des piliers et des chiffres de
 * « L'association », des textes éditables et du contact du pied de page
 * restaient `disabled` — le focus clavier tombait sur le `<body>`. Ils passent
 * par `BusyButton` (`aria-disabled` + `aria-busy`, activation annulée par le
 * même état) et la garde partagée `useBusyGuard`.
 */
const DIR = "components/cyber/landing/";

const SCREENS = [
  "SponsorsGrid.tsx",
  "AboutPillars.tsx",
  "AboutStats.tsx",
  "AboutStatEditor.tsx",
  "EditableCopy.tsx",
  "FooterContact.tsx",
  "LandingDialog.tsx",
].map((file) => DIR + file);

/** Écrans qui envoient eux-mêmes (la modale commune reçoit l'état). */
const SENDERS = SCREENS.filter((file) => !file.endsWith("LandingDialog.tsx"));

const BUSY = String.raw`busy|loading|pending|saving|uploading`;
// Fins de ligne ramenées à LF : un dépôt extrait sous Windows (CRLF) lit le même code.
const source = (path: string) => readFileSync(join(process.cwd(), path), "utf8").replace(/\r\n/g, "\n");
const buttonsOf = (code: string) =>
  code.match(/<(?:button|BusyButton|CyberButton)\b[\s\S]*?<\/(?:button|BusyButton|CyberButton)>/g) ?? [];
const css = (file: string) => source(DIR + file).replace(/\/\*[\s\S]*?\*\//g, "");

describe("pages vitrine — boutons pendant une requête", () => {
  it.each(SCREENS.map((file) => [file]))("%s_buttons_neverNativeDisabledByRequest", (file) => {
    for (const button of buttonsOf(source(file))) {
      expect(button).not.toMatch(new RegExp(String.raw`\sdisabled=\{[^}]*(?:${BUSY})`, "i"));
    }
  });

  it.each(SCREENS.map((file) => [file]))("%s_wait_announcedThroughBusyButton", (file) => {
    const code = source(file);
    expect(code).toMatch(/<BusyButton\s+busy=\{busy\}/);
    expect(code).toContain('import { BusyButton } from "@/components/ui/busy-button";');
  });

  it.each(SCREENS.map((file) => [file]))("%s_buttons_noHandWrittenAriaState", (file) => {
    for (const button of buttonsOf(source(file))) {
      expect(button).not.toMatch(/^<button\b[^>]*aria-(?:disabled|busy)=/);
    }
  });

  it.each(SENDERS.map((file) => [file]))("%s_sends_throughSharedBusyGuard", (file) => {
    const code = source(file);
    expect(code).toMatch(/= useBusyGuard\(\);/);
    expect(code).not.toMatch(/\bset(?:Busy|LogoBusy|BannerBusy)\(/);
  });

  it.each(SENDERS.map((file) => [file]))("%s_label_neverReducedToEllipsis", (file) => {
    expect(source(file)).not.toMatch(/busy \? "…"/);
  });

  it.each([
    ["SponsorsGrid.tsx"],
    ["AboutPillars.tsx"],
    ["AboutStatEditor.tsx"],
    ["EditableCopy.tsx"],
    ["FooterContact.tsx"],
  ])("%s_swappedLabel_goesThroughBusyLabel", (file) => {
    expect(source(DIR + file)).toMatch(/<BusyLabel busy=\{[^}]+\} idle=/);
  });
});

describe("EditableCopy — coût pour le visiteur et refus dit", () => {
  const code = () => source(DIR + "EditableCopy.tsx");

  it("EditableCopy_visitor_mountsNoHook", () => {
    const wrapper = /export function EditableCopy\([\s\S]*?\n\}\n/.exec(code())?.[0] ?? "";
    expect(wrapper).toContain("if (!canEdit) return <>{children}</>;");
    expect(wrapper).not.toMatch(/\buse[A-Z]\w*\(/);
  });

  it("EditableCopy_editorHooks_liveInEditorComponent", () => {
    expect(code()).toMatch(/function EditableCopyEditor\([\s\S]*?useBusyGuard\(\)/);
  });

  it("EditableCopy_saveAndReset_refusedByGuardShowInfoToast", () => {
    const body = code();
    expect(body.match(/if \(done === undefined\) refusedBusy\(\);/g)).toHaveLength(2);
    expect(body).toContain("showInfo(BUSY_REFUSED_MESSAGE");
  });
});

describe("pages vitrine — champs figés pendant l'envoi", () => {
  it("FooterContact_fields_readOnlyWhileSending", () => {
    expect(source(DIR + "FooterContact.tsx").match(/readOnly=\{busy\}/g)).toHaveLength(3);
  });

  it("EditableCopy_fields_readOnlyWhileSending", () => {
    expect(source(DIR + "EditableCopy.tsx")).toContain("readOnly: busy,");
  });

  it("AboutPillars_bilingualFields_readOnlyWhileSending", () => {
    expect(source(DIR + "AboutPillars.tsx").match(/readOnly=\{busy\}/g)).toHaveLength(2);
  });

  it("SponsorsGrid_fields_readOnlyAndEditsIgnoredWhileSending", () => {
    const code = source(DIR + "SponsorsGrid.tsx");
    expect(code.match(/readOnly=\{busy\}/g)).toHaveLength(4);
    expect(code).toContain("if (!isBusy()) setForm(change);");
    expect(code).toContain("aria-readonly={busy || undefined}");
  });

  it("SponsorsGrid_upload_sharesGuardWithSave", () => {
    // « Enregistrer » pendant l'envoi d'un logo partait sans lui.
    const code = source(DIR + "SponsorsGrid.tsx");
    expect(code).toContain("if (!file || isBusy()) return;");
    expect(code).toMatch(/await run\(async \(\) => \{\s+setUploadKind\(kind\);/);
    expect(code).not.toContain("uploading");
  });
});

describe("pages vitrine — flèches d'ordre", () => {
  it.each([
    ["SponsorsGrid.tsx", "sponsor"],
    ["AboutPillars.tsx", "pillar"],
    ["AboutStats.tsx", "stat"],
  ])("%s_arrows_refocusedAfterMoveAndRollback", (file, list) => {
    const code = source(DIR + file);
    expect(code).toContain(`useArrowRefocus("${list}")`);
    expect(code).toContain(`data-arrow={arrowKey("${list}"`);
    expect(code.match(/data-edge=\{/g)).toHaveLength(2);
    // Aperçu optimiste, puis retour à l'ordre d'avant (refus, réseau).
    expect(code.match(/refocusArrow\(id, arrow\);/g)).toHaveLength(3);
  });
});

describe("pages vitrine — ajout sans doublon", () => {
  it.each([["SponsorsGrid.tsx"], ["AboutPillars.tsx"]])("%s_create_keyForgottenAtOpeningAndTiedToBody", (file) => {
    const code = source(DIR + file);
    expect(code).toMatch(/if \(isBusy\(\)\) return;\s+createKey\.current = null;/);
    // Formulaire corrigé après un échec : clé neuve (`keyForBody`), sinon le
    // serveur rendrait l'ajout précédent et la correction serait perdue.
    expect(code).toContain("JSON.stringify(editing ? payload : withRequestKey(createKey, payload))");
    expect(code).not.toContain("newRequestKey");
  });

  it("AboutStatEditor_create_keyTiedToBody", () => {
    const code = source(DIR + "AboutStatEditor.tsx");
    expect(code).toContain("const createKey = useRef<KeyedBody | null>(null);");
    expect(code).toContain("JSON.stringify(editing ? payload : withRequestKey(createKey, payload))");
  });
});

describe("pages vitrine — saisie figée avant le rendu", () => {
  it.each([
    ["AboutPillars.tsx", /const edit = \(change: \(f: FormState\) => FormState\) => \{\s+if \(!isBusy\(\)\) setForm\(change\);/],
    ["SponsorsGrid.tsx", /const edit = \(change: \(f: FormState\) => FormState\) => \{\s+if \(!isBusy\(\)\) setForm\(change\);/],
    ["FooterContact.tsx", /const editField = \(field: keyof ContactInfo, value: string\) => \{\s+if \(!isBusy\(\)\) setForm/],
    ["EditableCopy.tsx", /const onChange = \(next: string\) => \{[\s\S]{0,120}if \(isBusy\(\)\) return;/],
  ])("%s_fields_ignoreInputWhileBusy", (file, guard) => {
    expect(source(DIR + file)).toMatch(guard);
  });

  it("AboutPillars_fields_allGoThroughEdit", () => {
    expect(source(DIR + "AboutPillars.tsx")).not.toMatch(/onChange=\{\(lang, value\) => setForm/);
  });

  it("SponsorsGrid_websiteField_goesThroughEdit", () => {
    expect(source(DIR + "SponsorsGrid.tsx")).toContain("edit((f) => ({ ...f, websiteUrl }));");
  });

  it("AboutStatEditor_fields_ignoreInputWhileBusy", () => {
    const code = source(DIR + "AboutStatEditor.tsx");
    expect(code.match(/if \(isBusy\(\)\) return;\s+fieldErrors\.clear\("value(?:En)?"\);/g)).toHaveLength(2);
    expect(code).toContain("if (!isBusy()) setForm((f) => (lang === \"fr\" ? { ...f, label: value } : { ...f, labelEn: value }));");
  });
});

describe("partenaires — ajout et import", () => {
  it("SponsorsGrid_addButton_isBusyButton", () => {
    expect(source(DIR + "SponsorsGrid.tsx")).toMatch(
      /<CyberButton variant="primary" asChild>[\s\S]{0,200}<BusyButton busy=\{busy\} onClick=\{openCreate\} lang=\{staffLang\}>\s+\+ Ajouter/,
    );
  });

  it("SponsorsGrid_uploadRefusedByGuard_saysSo", () => {
    const code = source(DIR + "SponsorsGrid.tsx");
    expect(code).toContain("const started = await run(async () => {");
    expect(code).toMatch(/if \(!started\) showInfo\(/);
  });
});

describe("pages vitrine — apparence désarmée", () => {
  it.each([
    ["AboutPillars.module.css", "action"],
    ["AboutPillars.module.css", "actionPrimary"],
    ["AboutPillars.module.css", "addBtn"],
    ["AboutStats.module.css", "action"],
    ["AboutStats.module.css", "actionPrimary"],
    ["AboutStats.module.css", "addBtn"],
    ["SponsorsGrid.module.css", "slotAction"],
    ["SponsorsGrid.module.css", "logoUploadBtn"],
    ["LandingDialog.module.css", "close"],
  ])("%s_%s_disarmedLookInColoursNotOpacity", (file, cls) => {
    const rules = css(file);
    expect(rules).toContain(`.${cls}[aria-disabled="true"]`);
    expect(rules).not.toMatch(new RegExp(String.raw`\.${cls}(?::disabled|\[aria-disabled="true"\])[^{]*\{[^}]*opacity`));
  });
});

describe("pages vitrine — attente lisible (UI/UX cycle 1)", () => {
  it.each([["AboutPillars.module.css"], ["AboutStats.module.css"], ["SponsorsGrid.module.css"]])(
    "%s_busyOutline_usesVisibleAccentNotHairline",
    (file) => {
      const rules = css(file);
      expect(rules).toContain("border-style: dashed");
      expect(rules).not.toMatch(/\[aria-busy="true"\][^{]*\{[^}]*--line-strong-cy/);
    },
  );

  it.each([
    ["AboutPillars.module.css", ".modalInput[readonly]"],
    ["AboutStats.module.css", ".modalInput[readonly]"],
    ["SponsorsGrid.module.css", ".modalInput[readonly]"],
    ["SponsorsGrid.module.css", 'select.modalInput[aria-readonly="true"]'],
    ["FooterContact.module.css", ".input[readonly]"],
    ["EditableCopy.module.css", ".input[readonly]"],
  ])("%s_%s_readOnlyFieldLooksFrozen", (file, selector) => {
    const rules = css(file);
    expect(rules).toContain(selector);
    expect(rules).not.toMatch(/\[readonly\][^{]*\{[^}]*opacity/);
  });

  it("EditableCopy_blockedButtons_dimmedByColours", () => {
    expect(source(DIR + "EditableCopy.tsx")).toContain("`${styles.actions} dim-disabled`");
  });

  it("LandingDialog_closeBusy_dashedOutline", () => {
    expect(css("LandingDialog.module.css")).toMatch(/\.close\[aria-disabled="true"\]\[aria-busy="true"\]\s*\{[^}]*border-style:\s*dashed/);
  });

  it("CyberButton_busy_dashedOutlineThroughSlot", () => {
    const rules = css("../CyberButton.module.css");
    expect(rules).toMatch(/\.root\[aria-disabled="true"\]\[aria-busy="true"\]\s*\{[^}]*border-style:\s*dashed/);
    expect(rules).toContain('.ghost[aria-disabled="true"][aria-busy="true"]');
  });

  it("SponsorsGrid_onlyThePendingControl_isBusy", () => {
    const code = source(DIR + "SponsorsGrid.tsx");
    expect(code).toContain('busy={uploadKind === "banner"}');
    expect(code).toContain('busy={uploadKind === "logo"}');
    expect(code).toMatch(/<BusyButton busy=\{false\} blocked=\{busy\} onClick=\{close\}>/);
    expect(code).toMatch(/busy=\{busy && uploadKind === null\} blocked=\{busy\}/);
  });

  it.each([["AboutPillars.tsx"], ["AboutStatEditor.tsx"], ["FooterContact.tsx"]])(
    "%s_cancel_isBlockedNotBusy",
    (file) => {
      expect(source(DIR + file)).toMatch(/<BusyButton busy=\{false\} blocked=\{busy\}/);
    },
  );

  it.each([["AboutPillars.tsx"], ["AboutStats.tsx"], ["SponsorsGrid.tsx"]])(
    "%s_removeRefusedByGuard_saysSo",
    (file) => {
      const code = source(DIR + file);
      expect(code).toContain("const done = await run(async () => {");
      expect(code).toContain("if (done === undefined) showInfo(BUSY_REFUSED_MESSAGE);");
    },
  );

  it("showcaseMessages_busyRefused_isNeutralFrench", () => {
    expect(source("lib/shared/busy-refused-message.ts")).toContain('"Un autre envoi est en cours, réessaye."');
  });
});
