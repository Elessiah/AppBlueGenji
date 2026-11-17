import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Association, bénévoles, recrutement (EF-69, `docs/features/BUSY_BUTTONS.md`) :
 * pendant une requête, les boutons du bureau, des bénévoles et des annonces de
 * recrutement restaient `disabled` — le focus clavier tombait sur le `<body>`.
 * Ils passent par `BusyButton` (`aria-disabled` + `aria-busy`, activation
 * annulée par le même état) et la garde partagée `useBusyGuard`.
 */
const BUREAU = "app/association/BureauSection.tsx";
const BENEVOLES = "app/benevoles/BenevolesSection.tsx";
const RECRUITMENT = "app/recrutement/RecruitmentSection.tsx";
const EDITOR = "app/recrutement/RecruitmentAdEditor.tsx";

const SCREENS = [BUREAU, BENEVOLES, RECRUITMENT, EDITOR];
/** Écrans qui envoient eux-mêmes (l'éditeur d'annonce reçoit l'état). */
const SENDERS = [BUREAU, BENEVOLES, RECRUITMENT];

const BUSY = String.raw`busy|loading|pending|saving|submitting|uploading`;
// Fins de ligne ramenées à LF : un dépôt extrait sous Windows (CRLF) lit le même code.
const source = (path: string) => readFileSync(join(process.cwd(), path), "utf8").replace(/\r\n/g, "\n");
const buttonsOf = (code: string) =>
  code.match(/<(?:button|BusyButton|CyberButton)\b[\s\S]*?<\/(?:button|BusyButton|CyberButton)>/g) ?? [];
const css = (path: string) => source(path).replace(/\/\*[\s\S]*?\*\//g, "");

describe("association, bénévoles, recrutement — boutons pendant une requête", () => {
  it.each(SCREENS.map((file) => [file]))("%s_controls_neverNativeDisabledByRequest", (file) => {
    expect(source(file)).not.toMatch(new RegExp(String.raw`\sdisabled=\{[^}]*(?:${BUSY})`, "i"));
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
    expect(code).not.toMatch(/\bsetBusy\(/);
  });

  it.each(SCREENS.map((file) => [file]))("%s_label_neverReducedToEllipsis", (file) => {
    expect(source(file)).not.toMatch(/busy \? "…"/);
  });

  it.each([[BUREAU], [BENEVOLES], [EDITOR]])("%s_swappedLabel_goesThroughBusyLabel", (file) => {
    expect(source(file)).toMatch(/<BusyLabel busy=\{[^}]+\} idle=\{submitLabel\} pending=\{pendingLabel\}/);
  });

  it.each(SENDERS.map((file) => [file]))("%s_removeRefusedByGuard_showsInfoToast", (file) => {
    const code = source(file);
    expect(code).toContain("if (done === undefined) showInfo(BUSY_REFUSED_MESSAGE);");
    expect(code).toContain("if (!isBusy()) setPendingRemoval(");
  });

  it.each(SENDERS.map((file) => [file]))("%s_dialogClosedAfterSuccess_withoutGuardCheck", (file) => {
    // `close()` interroge la garde, encore tenue dans `run` : le succès ferme par `closeDialog()`.
    const code = source(file);
    expect(code).toContain("if (!isBusy()) closeDialog();");
    expect(code.match(/\n\s+closeDialog\(\);/g)).toHaveLength(1);
  });
});

describe("association, bénévoles, recrutement — champs figés pendant l'envoi", () => {
  it("BureauSection_fields_readOnlyAndEditsIgnoredWhileSending", () => {
    const code = source(BUREAU);
    expect(code.match(/readOnly=\{busy\}/g)).toHaveLength(3);
    expect(code).toContain("if (!isBusy()) setForm(change);");
    expect(code).not.toMatch(/onChange=\{[^}]*setForm\(/);
  });

  it("BureauSection_randomColour_blockedWhileSending", () => {
    expect(source(BUREAU)).toMatch(/blocked=\{busy\}\s+className=\{styles\.bureauAction\}\s+onClick=\{\(\) => edit\(/);
  });

  it("BenevolesSection_fields_readOnlyAndEditsIgnoredWhileSending", () => {
    const code = source(BENEVOLES);
    expect(code.match(/readOnly=\{busy\}/g)).toHaveLength(6);
    expect(code).toContain("if (!isBusy()) setForm((f) => ({ ...f, [field]: value }));");
    expect(code).toMatch(/function setCategory\([^)]*\) \{\s+if \(isBusy\(\)\) return;/);
  });

  it("BenevolesSection_photoUpload_sharesGuardWithSave", () => {
    // « Ajouter » pendant l'envoi de la photo partait sans elle.
    const code = source(BENEVOLES);
    expect(code).toContain("if (!file || isBusy()) return;");
    // Garde prise dès le recadrage (`cropThenUpload`, comportement testé dans busy-guard.test.ts).
    expect(code).toMatch(/await cropThenUpload\(\{\s+run,\s+setUploading: setPhotoBusy,\s+crop: \(\) => cropImage\(/);
    expect(code).not.toMatch(/const image = await cropImage\(/);
    expect(code).toContain('if (!started) showInfo("Photo non importée');
    expect(code).not.toContain("ariaBusy=");
  });

  it("RecruitmentSection_edits_ignoredWhileSending", () => {
    expect(source(RECRUITMENT)).toContain("if (!isBusy()) setForm((f) => ({ ...f, [field]: value }));");
  });

  it("RecruitmentAdEditor_fields_readOnlyWhileSending", () => {
    const code = source(EDITOR);
    expect(code.match(/readOnly=\{busy\}/g)).toHaveLength(3);
    expect(code).toContain("readOnly: busy,");
  });

  it("RecruitmentAdEditor_selectsAndCheckbox_ariaReadonlyWhileSending", () => {
    expect(source(EDITOR).match(/aria-readonly=\{frozen\}/g)).toHaveLength(4);
  });
});

describe("association, bénévoles, recrutement — flèches d'ordre", () => {
  it.each([
    [BUREAU, "bureau"],
    [RECRUITMENT, "recruitment"],
  ])("%s_arrows_refocusedAfterMoveAndRollback", (file, list) => {
    const code = source(file);
    expect(code).toContain(`useArrowRefocus("${list}")`);
    expect(code).toContain(`data-arrow={arrowKey("${list}"`);
    expect(code.match(/data-edge=\{/g)).toHaveLength(2);
    // Aperçu optimiste, puis retour à l'ordre d'avant (refus, réseau).
    expect(code.match(/refocusArrow\(id, arrow\);/g)).toHaveLength(3);
  });

  it("BenevolesSection_categoryArrows_refocusedByFirstMemberId", () => {
    // Le nom libre d'une catégorie n'entre pas dans un sélecteur : son premier bénévole la désigne.
    const code = source(BENEVOLES);
    expect(code).toContain('useArrowRefocus("benevole-category")');
    expect(code.match(/data-arrow=\{arrowKey\("benevole-category", members\[0\]\.id,/g)).toHaveLength(2);
    expect(code.match(/data-edge=\{/g)).toHaveLength(2);
    expect(code.match(/refocusArrow\(moved, arrow\);/g)).toHaveLength(3);
  });
});

describe("association, bénévoles, recrutement — ajout sans doublon", () => {
  it.each(SENDERS.map((file) => [file]))("%s_create_keyForgottenAtOpeningAndTiedToBody", (file) => {
    const code = source(file);
    expect(code).toMatch(/if \(isBusy\(\)\) return;\s+createKey\.current = null;/);
    expect(code).toContain("JSON.stringify(editing ? payload : withRequestKey(createKey, payload))");
    expect(code).not.toContain("newRequestKey");
  });

  it.each([
    ["app/api/benevoles/route.ts", "benevole-create", "findBenevole"],
    ["app/api/association/bureau/route.ts", "bureau-create", "findBureauMember"],
    ["app/api/recruitment/route.ts", "recruitment-create", "findRecruitmentAd"],
  ])("%s_create_runsOncePerUserAndRereadsOnReplay", (file, scope, find) => {
    const code = source(file);
    expect(code).toContain(`runOnceForBody(\`${scope}:\${user.id}\`, body,`);
    expect(code).toContain(`{ fresh: (created) => ${find}(created.id) }`);
  });
});

describe("association, bénévoles, recrutement — apparence désarmée", () => {
  it.each([
    ["app/association/page.module.css", "bureauAction"],
    ["app/benevoles/page.module.css", "categoryMove"],
    ["app/benevoles/page.module.css", "action"],
    ["app/benevoles/page.module.css", "photoUploadBtn"],
    ["app/recrutement/page.module.css", "move"],
    ["app/recrutement/page.module.css", "action"],
  ])("%s_%s_disarmedInColoursAndBusyDashed", (file, cls) => {
    const code = css(file);
    expect(code).toMatch(new RegExp(String.raw`\.${cls} \{
  composes: busyLook from "\.\./busy-look\.module\.css";`));
    expect(code).not.toContain(`.${cls}[aria-disabled="true"]`);
  });

  it("busyLook_sharedRule_disarmedInColoursAndBusyDashed", () => {
    const code = css("app/busy-look.module.css");
    expect(code).toContain('.busyLook[aria-disabled="true"],');
    expect(code).toContain('.busyLook[aria-disabled="true"][aria-busy="true"],');
    expect(code).toContain("border-style: dashed;");
    expect(code).toContain("cursor: progress;");
    expect(code).not.toContain("opacity");
  });

  it("benevoles_photoUrlInput_namedByItsVisibleLabel", () => {
    const code = source("app/benevoles/BenevolesSection.tsx");
    expect(code).toMatch(/<label htmlFor="benevole-photo-url"[^>]*>\s*Photo \(optionnel\)\s*<\/label>/);
    expect(code).toContain('id="benevole-photo-url"');
    expect(code).not.toContain('aria-label="URL de la photo"');
  });

  it.each([["app/association/page.module.css"], ["app/benevoles/page.module.css"], ["app/recrutement/page.module.css"]])(
    "%s_noNativeDisabledRuleNorOpacity",
    (file) => {
      const code = css(file);
      expect(code).not.toContain(":disabled");
      expect(code).toContain(".modalInput[readonly]");
    },
  );
});
