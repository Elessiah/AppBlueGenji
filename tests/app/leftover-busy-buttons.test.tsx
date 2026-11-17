import { describe, expect, it } from "@jest/globals";
import { readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { RoleTable } from "@/app/(secured)/equipes/[id]/_components/RoleTable";
import { PlayerPseudoCombobox } from "@/app/(secured)/equipes/[id]/_components/PlayerPseudoCombobox";
import { AppLocaleProvider } from "@/components/i18n/locale-context";
import { MANAGER_ASSIGNABLE_ROLES } from "@/lib/shared/team-role-display";
import { readSource } from "../helpers/read-source";

/**
 * EF-71 — derniers boutons grisés (« reliquats ») : modales légales et écrans
 * d'équipe passent à `BusyButton` / `useBusyGuard` ; le focus d'un bouton qui
 * disparaît est rendu (`useFocusRescue`).
 */

const ROOT = process.cwd();
const TEAM = "app/(secured)/equipes/[id]/_components";

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(name) ? [path] : [];
  });
}

const fr = (ui: ReactElement) => renderToStaticMarkup(<AppLocaleProvider locale="fr">{ui}</AppLocaleProvider>);

describe("méthode de l'entrée « boutons grisés restants »", () => {
  it("entryCountMethod_appAndComponents_findsOnlyTheDocumentedDialogFields", () => {
    const hits = [...sourceFiles(join(ROOT, "app")), ...sourceFiles(join(ROOT, "components"))].flatMap((file) =>
      readSource(file)
        .split("\n")
        .filter((line) => /(^|[^-])disabled=\{[^}]*(busy|pending|saving|loading|submitting)/i.test(line))
        .map(() => relative(ROOT, file).replace(/\\/g, "/")),
    );
    // Champs (pas des boutons) gardés `disabled` en EF-66, justifiés dans BUSY_BUTTONS.md.
    expect([...new Set(hits)].sort()).toEqual([
      "app/(secured)/tournois/[id]/_components/AdminScoreDialog.tsx",
      "app/(secured)/tournois/[id]/_components/MatchScheduleDialog.tsx",
      "app/(secured)/tournois/[id]/_components/PlayerScoreDialog.tsx",
      "app/(secured)/tournois/[id]/_components/RefereeDialog.tsx",
    ]);
    expect(hits).toHaveLength(7);
  });

  it("busyButtonsDoc_keptDisabledFields_areJustifiedAndNoRemainderIsPointedTo", () => {
    const doc = readSource("docs/features/BUSY_BUTTONS.md");
    expect(doc).toContain("Reliquats (EF-71)");
    expect(doc).not.toContain("Reste à convertir");
  });
});

describe("modales légales", () => {
  it("PrivacyChangesModal_acknowledge_runsThroughSynchronousGuard", () => {
    const code = readSource("components/privacy/PrivacyChangesModal.tsx");
    expect(code).toContain("const { busy, isBusy, run } = useBusyGuard();");
    expect(code).toMatch(/if \(detailsPending\) return;\s*void run\(async \(\) => \{/);
    expect(code).toMatch(/<BusyButton busy=\{busy\} blocked=\{detailsPending\} onClick=\{acknowledge\}>/);
    expect(code).not.toMatch(/(?:^|[^-])disabled=\{/m);
  });

  it("TermsAcceptanceModal_accept_onlyFromTheButtonAndOnlyOnceAtATime", () => {
    const code = readSource("components/legal/TermsAcceptanceModal.tsx");
    // Une seule requête d'acceptation, déclenchée par le seul bouton : jamais d'acceptation implicite.
    expect(code.match(/fetch\("\/api\/profile\/terms"/g)).toHaveLength(1);
    expect(code.match(/onClick=\{accept\}/g)).toHaveLength(1);
    expect(code).toContain("if (leaving || deletionOpen || !checked) return;");
    expect(code).toMatch(/void run\(async \(\) => \{\s*try \{\s*const response = await fetch\("\/api\/profile\/terms"/);
  });
});

describe("écrans d'équipe", () => {
  it("MembershipActions_gestures_markOnlyThePressedButtonBusy", () => {
    const code = readSource(`${TEAM}/MembershipActions.tsx`);
    expect(code).toContain("busy: pendingGesture === name");
    expect(code).toContain("blocked: busy && pendingGesture !== name");
  });

  it("CreateTeamForm_success_holdsUntilTheTeamPage", () => {
    const code = readSource("app/(secured)/equipes/creer/CreateTeamForm.tsx");
    expect(code).toMatch(/hold\(\);\s*router\.push\(`\/equipes\/\$\{payload\.teamId\}`\);/);
  });

  it("TeamSettings_claimWithdrawAndLogoSend_rescueFocus", () => {
    const code = readSource(`${TEAM}/TeamSettings.tsx`);
    expect(code).toContain(`rescueFocus(['[data-focus-rescue="claim"]'])`);
    expect(code).toContain(`rescueFocus(['[data-focus-rescue="logo"]'])`);
  });

  it("MembersSection_withdraw_rescuesFocusToNextInvitationThenPseudoField", () => {
    const code = readSource(`${TEAM}/MembersSection.tsx`);
    expect(code).toContain("if (ok) rescueFocus(['[data-focus-rescue=\"invitation\"]', `#${INVITE_FIELD_IDS.pseudo}`]);");
  });
});

describe("champs figés pendant un envoi", () => {
  it("RoleTable_readOnly_cochesCarryAriaReadonlyAndAriaBusy", () => {
    const html = fr(<RoleTable selected={["DPS"]} onChange={() => {}} checkable={MANAGER_ASSIGNABLE_ROLES} readOnly />);
    const boxes = html.match(/<input[^>]*type="checkbox"[^>]*>/g) ?? [];

    expect(boxes.length).toBeGreaterThan(0);
    for (const box of boxes) {
      expect(box).toContain('aria-readonly="true"');
      expect(box).toContain('aria-busy="true"');
      expect(box).not.toMatch(/\sdisabled=""/);
    }
  });

  it("RoleTable_default_cochesAreNotReadonly", () => {
    const html = fr(<RoleTable selected={["DPS"]} onChange={() => {}} checkable={MANAGER_ASSIGNABLE_ROLES} />);

    expect(html).not.toContain("aria-readonly");
  });

  it("PlayerPseudoCombobox_readOnly_inputIsReadOnlyAndCollapsed", () => {
    const html = fr(<PlayerPseudoCombobox id="claim-pseudo" value="Nova" onChange={() => {}} readOnly />);

    expect(html).toMatch(/<input[^>]*id="claim-pseudo"[^>]*readonly=""/);
    expect(html).toContain('aria-expanded="false"');
  });

  it("PlayerPseudoCombobox_default_inputIsEditable", () => {
    const html = fr(<PlayerPseudoCombobox id="claim-pseudo" value="Nova" onChange={() => {}} />);

    expect(html).not.toContain("readonly");
  });
});
