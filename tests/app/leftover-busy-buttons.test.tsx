import { describe, expect, it } from "@jest/globals";
import { readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { RoleTable } from "@/app/(secured)/equipes/[id]/_components/RoleTable";
import { PlayerPseudoCombobox } from "@/app/(secured)/equipes/[id]/_components/PlayerPseudoCombobox";
import { AppLocaleProvider } from "@/components/i18n/locale-context";
import { MANAGER_ASSIGNABLE_ROLES } from "@/lib/shared/team-role-display";
import enShell from "@/messages/en/shell.json";
import frShell from "@/messages/fr/shell.json";
import enTeam from "@/messages/en/team.json";
import frTeam from "@/messages/fr/team.json";
import { readSource } from "../helpers/read-source";

/**
 * EF-71 — derniers boutons grisés (« reliquats ») : modales légales et écrans
 * d'équipe passent à `BusyButton` / `useBusyGuard` ; le focus d'un bouton qui
 * disparaît est rendu (`useFocusRescue`). Le comportement des modales légales
 * et de la création d'équipe est joué dans `leftover-busy-behaviour.test.tsx`.
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

/**
 * Relevé de l'entrée : chaque `disabled={…}` natif (pas `aria-disabled`) dont
 * l'expression, **sur une ou plusieurs lignes**, nomme un état de requête.
 */
const DISABLED_EXPRESSION = /(?:^|[^-\w])disabled=\{((?:[^{}]|\{[^{}]*\})*)\}/g;
const REQUEST_STATE = /busy|pending|saving|loading|submitting/i;

function disabledByRequest(code: string): string[] {
  return [...code.matchAll(DISABLED_EXPRESSION)]
    .map((match) => match[1])
    .filter((expression) => REQUEST_STATE.test(expression));
}

describe("méthode de l'entrée « boutons grisés restants »", () => {
  it("disabledByRequest_expressionWrappedOnSeveralLines_isCounted", () => {
    expect(disabledByRequest("<button\n  disabled={\n    saving ||\n    other\n  }\n>")).toHaveLength(1);
  });

  it("disabledByRequest_ariaDisabledDataDisabledOrUnrelatedState_notCounted", () => {
    expect(disabledByRequest("<b aria-disabled={busy} /><b disabled={!ready} /><b data-disabled={busy} />")).toEqual([]);
  });

  it("disabledByRequest_nestedBraces_readsTheWholeExpression", () => {
    expect(disabledByRequest("<b disabled={rows.some((r) => { return r.id; }) || pending} />")).toHaveLength(1);
  });

  it("entryCountMethod_appAndComponents_findsOnlyTheDocumentedDialogFields", () => {
    const hits = [...sourceFiles(join(ROOT, "app")), ...sourceFiles(join(ROOT, "components"))].flatMap((file) =>
      disabledByRequest(readSource(file)).map(() => relative(ROOT, file).replace(/\\/g, "/")),
    );
    // Champs (pas des boutons) gardés `disabled` en EF-66, justifiés dans BUSY_BUTTONS.md.
    expect([...new Set(hits)].sort()).toEqual([
      "app/(secured)/tournois/[id]/_components/AdminScoreDialog.tsx",
      "app/(secured)/tournois/[id]/_components/MatchScheduleDialog.tsx",
      "app/(secured)/tournois/[id]/_components/PlayerScoreDialog.tsx",
      "app/(secured)/tournois/[id]/_components/ProdDialog.tsx",
      "app/(secured)/tournois/[id]/_components/RefereeDialog.tsx",
    ]);
    expect(hits).toHaveLength(8);
  });

  it("busyButtonsDoc_keptDisabledFields_areJustifiedAndNoRemainderIsPointedTo", () => {
    const doc = readSource("docs/features/BUSY_BUTTONS.md");
    expect(doc).toContain("Reliquats (EF-71)");
    expect(doc).not.toContain("Reste à convertir");
    expect(doc).toContain("plusieurs lignes, nomme");
  });
});

describe("modales légales", () => {
  it("PrivacyChangesModal_acknowledge_runsThroughSynchronousGuard", () => {
    const code = readSource("components/privacy/PrivacyChangesModal.tsx");
    expect(code).toContain("const { busy, isBusy, run } = useBusyGuard();");
    expect(code).toMatch(/if \(detailsPending\) return;\s*void run\(async \(\) => \{/);
    expect(code).toMatch(/<BusyButton\s+busy=\{busy\}\s+blocked=\{detailsPending\}\s+onBlockedClick={.*}\s+onClick=\{acknowledge\}\s+>/);
    expect(disabledByRequest(code)).toEqual([]);
  });

  it("TermsAcceptanceModal_accept_onlyFromTheButton", () => {
    const code = readSource("components/legal/TermsAcceptanceModal.tsx");
    // Une seule requête d'acceptation, déclenchée par le seul bouton : jamais d'acceptation implicite.
    expect(code.match(/fetch\("\/api\/profile\/terms"/g)).toHaveLength(1);
    expect(code.match(/onClick=\{accept\}/g)).toHaveLength(1);
  });

  it("TermsAcceptanceModal_blockedUnchecked_explainsWithoutAccepting", () => {
    const code = readSource("components/legal/TermsAcceptanceModal.tsx");
    expect(code).toContain(
      'onBlockedClick={checked || leaving || deletionOpen ? undefined : () => showError(t("termsModal.checkFirst"), { once: true })}',
    );
    expect(frShell.termsModal.checkFirst).toBe("Coche d'abord la case pour accepter les conditions d'utilisation.");
    expect(enShell.termsModal.checkFirst).toBe("Tick the box to accept the terms of use first.");
  });
});

describe("écrans d'équipe", () => {
  it("MembershipActions_gestures_shareGestureStateWithReports", () => {
    const code = readSource(`${TEAM}/MembershipActions.tsx`);
    const reports = readSource("app/(secured)/admin/signalements/_components/ReportDetail.tsx");
    const shared = 'import { gestureState } from "@/lib/shared/gesture-state";';
    expect(code).toContain(shared);
    expect(reports).toContain(shared);
    expect(code).toContain("const gesture = (name: string) => gestureState(pendingGesture, name);");
  });

  it("MembershipActions_rescue_targetsArmedGesturesThenNeighbourRequest", () => {
    const code = readSource(`${TEAM}/MembershipActions.tsx`);
    expect(code).not.toContain('rescueFocus(["button", "a[href]"])');
    expect(code).toContain(
      `const MEMBERSHIP_RESCUE = [armedRescueSelector("membership"), '[data-focus-rescue="membership"]'] as const;`,
    );
    expect(code).toContain('[...neighbourRescueSelectors(accept ? "request-accept" : "request-refuse", keys, request.id), ...MEMBERSHIP_RESCUE]');
    expect(code).toContain("data-focus-rescue-key={r.id}");
  });

  it("CreateTeamForm_success_holdsUntilTheTeamPage", () => {
    const code = readSource("app/(secured)/equipes/creer/CreateTeamForm.tsx");
    expect(code).toMatch(/hold\(\);\s*router\.push\(`\/equipes\/\$\{teamId\}`\);\s*router\.refresh\(\);/);
  });

  it("TeamSettings_claimWithdraw_rescuesToNeighbourClaim", () => {
    const code = readSource(`${TEAM}/TeamSettings.tsx`);
    expect(code).toContain('rescueFocus(neighbourRescueSelectors("claim", claimKeys, invitationId));');
    expect(code).toContain("data-focus-rescue-key={claim.id}");
    expect(code).toContain(`rescueFocus(['[data-focus-rescue="logo"]'])`);
  });

  it("MembersSection_withdraw_rescuesToNeighbourInvitationThenPseudoField", () => {
    const code = readSource(`${TEAM}/MembersSection.tsx`);
    expect(code).toContain(
      'rescueFocus([...neighbourRescueSelectors("invitation", keys, invitation.id), `#${INVITE_FIELD_IDS.pseudo}`]);',
    );
    expect(code).toContain("data-focus-rescue-key={invitation.id}");
  });

  it("PlayerModerationBar_reusesUseFocusRescue", () => {
    const code = readSource("app/(secured)/joueurs/[id]/_components/PlayerModerationBar.tsx");
    expect(code).toContain("const rescueFocus = useFocusRescue(barRef, [profile]);");
    expect(code).toContain('rescueFocus(["button"]);');
    expect(code).not.toContain("isFocusLost");
  });

  it("teamDialogs_blockedSubmit_explainTheRefusal", () => {
    expect(readSource(`${TEAM}/RolesDialog.tsx`)).toContain('onBlockedClick={() => showError(t("roles.unchanged"), { once: true })}');
    expect(readSource(`${TEAM}/MyRolesBlock.tsx`)).toContain('onBlockedClick={() => showError(t("roles.unchanged"), { once: true })}');
    expect(readSource(`${TEAM}/TransferOwnershipDialog.tsx`)).toContain(
      'onBlockedClick={() => showError(t("transfer.chooseFirst"), { once: true })}',
    );
    expect(readSource(`${TEAM}/ClaimGhostTeamDialog.tsx`)).toContain(
      'onBlockedClick={() => showError(t("claim.pseudoFirst"), { once: true })}',
    );
    expect(readSource(`${TEAM}/TeamSettings.tsx`)).toContain("onBlockedClick={explainRefusedSave}");
  });

  it("teamMessages_refusalExplanations_existInFrenchAndEnglish", () => {
    for (const messages of [frTeam, enTeam]) {
      expect(messages.roles.unchanged).toBeTruthy();
      expect(messages.transfer.chooseFirst).toBeTruthy();
      expect(messages.claim.pseudoFirst).toBeTruthy();
      expect(messages.settings.unchanged).toBeTruthy();
    }
    expect(enTeam.roles.unchanged).toBe("Tick or untick a role first.");
  });

  it("withdrawButtons_refusedWhileAnotherPending_explainWithAnInfoToast", () => {
    for (const file of ["MembersSection.tsx", "TeamSettings.tsx"]) {
      expect(readSource(`${TEAM}/${file}`)).toContain('onBlockedClick={() => showInfo(t("members.otherWithdrawing"), { once: true })}');
    }
    expect(frTeam.members.otherWithdrawing).toBe("Un autre retrait est en cours, réessaie.");
    expect(enTeam.members.otherWithdrawing).toBe("Another withdrawal is in progress, try again.");
  });

  it("PrivacyChangesModal_acknowledgeWhileDetailsLoad_explainsTheWait", () => {
    expect(readSource("components/privacy/PrivacyChangesModal.tsx")).toContain(
      'onBlockedClick={() => showInfo(t("privacyModal.detailsLoading"), { once: true })}',
    );
  });

  it("refusalToasts_enEnglish_allEndWithFirst", () => {
    const sentences = [
      enTeam.roles.unchanged,
      enTeam.settings.unchanged,
      enTeam.transfer.chooseFirst,
      enTeam.claim.pseudoFirst,
      enShell.termsModal.checkFirst,
    ];
    for (const sentence of sentences) expect(sentence).toMatch(/ first\.$/);
  });

  it("CreateTeamForm_createdTeam_secondSubmitOpensItBeforeAnyCheck", () => {
    const code = readSource("app/(secured)/equipes/creer/CreateTeamForm.tsx");
    expect(code).toContain("created.current = { id: teamId, name };");
    // Avant la validation : un nom effacé ou modifié depuis ne bloque ni ne recrée rien.
    expect(code.indexOf("if (created.current !== null)")).toBeLessThan(code.indexOf("const nameCheck = checkTeamName(name);"));
    expect(code).toMatch(/showInfo\(t\("create\.alreadyCreated", \{ name: created\.current\.name \}\), \{ once: true \}\);\s+openCreatedTeam\(created\.current\.id\);/);
  });

  it("MembershipActions_requestButtons_rescueToTheSameActionOfTheNeighbour", () => {
    const code = readSource(`${TEAM}/MembershipActions.tsx`);
    expect(code).toContain('data-focus-rescue="request-accept"');
    expect(code).toContain('data-focus-rescue="request-refuse"');
    expect(code).toContain("useFocusRescue(rootRef, [team, requests])");
  });

  it("PlayerModerationBar_rescue_waitsForProfileAndDropsOnReloadFailure", () => {
    const code = readSource("app/(secured)/joueurs/[id]/_components/PlayerModerationBar.tsx");
    expect(code).toContain("useFocusRescue(barRef, [profile])");
    expect(code).toMatch(/if \(reloaded\) return;[\s\S]*?rescueFocus\(null\);/);
  });

  it("TermsAcceptanceModal_logout_ignoredOnceDeletionStarted", () => {
    const code = readSource("components/legal/TermsAcceptanceModal.tsx");
    expect(code).toContain("if (!isBusy() && !deletionStarted.current) void logout();");
    expect(code).toContain("if (leaving || deletionStarted.current || !checked) return;");
  });

  it("Coche_ariaReadonly_takesTheWaitingLook", () => {
    const code = readSource("components/Coche.tsx");
    expect(code).toMatch(/props\["aria-readonly"\] === true \|\|\s+props\["aria-readonly"\] === "true";/);
  });

  it("teamPage_disarmedColours_comeFromGlobalDimDisabled", () => {
    const css = readSource("app/(secured)/equipes/[id]/team.module.css");
    expect(css).not.toContain("rgba(180, 210, 230, 0.2)");
    expect(readSource("app/(secured)/equipes/[id]/page.tsx").match(/\$\{styles\.page\} dim-disabled`/g)).toHaveLength(3);
    expect(readSource(`${TEAM}/TeamDialog.tsx`)).toContain("${styles.backdrop} ${styles.page} dim-disabled");
  });
});

describe("champs figés pendant un envoi", () => {
  it("RoleTable_readOnly_cochesCarryAriaReadonlyNotAriaBusy", () => {
    const html = fr(<RoleTable selected={["DPS"]} onChange={() => {}} checkable={MANAGER_ASSIGNABLE_ROLES} readOnly />);
    const boxes = html.match(/<input[^>]*type="checkbox"[^>]*>/g) ?? [];

    expect(boxes.length).toBeGreaterThan(0);
    for (const box of boxes) {
      expect(box).toContain('aria-readonly="true"');
      // Seul le bouton pressé s'annonce occupé : la case est figée, pas « en attente ».
      expect(box).not.toContain("aria-busy");
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
