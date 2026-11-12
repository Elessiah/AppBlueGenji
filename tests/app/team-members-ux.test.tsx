import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { RoleTable } from "@/app/(secured)/equipes/[id]/_components/RoleTable";
import { MyRolesBlock } from "@/app/(secured)/equipes/[id]/_components/MyRolesBlock";
import { AppLocaleProvider } from "@/components/i18n/locale-context";
import { TeamPageTextProvider } from "@/components/i18n/team-page-text-provider";
import { messagesFor } from "@/lib/server/i18n-messages";
import { MANAGER_ASSIGNABLE_ROLES } from "@/lib/shared/team-role-display";
import frTeam from "@/messages/fr/team.json";
import enTeam from "@/messages/en/team.json";

/**
 * TEAM-MEMBERS-UX : tableau des rôles (modale des rôles, de l'invitation, et
 * « Ce que fait chaque rôle »), bloc « Mes rôles » — en français et en anglais.
 * Les modales se rendent dans un portail (`document.body`) : leur contenu se lit
 * ici par le tableau qu'elles portent, leur câblage par leur source.
 */

const EN = messagesFor("en");

function render(ui: ReactElement, locale: "fr" | "en" = "fr"): string {
  if (locale === "fr") return renderToStaticMarkup(<AppLocaleProvider locale="fr">{ui}</AppLocaleProvider>);
  return renderToStaticMarkup(
    <AppLocaleProvider locale="en">
      <TeamPageTextProvider locale="en" messages={EN.team}>
        {ui}
      </TeamPageTextProvider>
    </AppLocaleProvider>,
  );
}

const checkboxes = (html: string) => html.match(/type="checkbox"/g)?.length ?? 0;
const checkedBoxes = (html: string) => html.match(/<input[^>]*checked=""[^>]*>/g)?.length ?? 0;
const read = (file: string) => readFileSync(path.join(process.cwd(), file), "utf8");

/** Toutes les clés feuilles d'un objet de messages, en chemins pointés. */
function leafKeys(value: unknown, prefix = ""): string[] {
  if (typeof value !== "object" || value === null) return [prefix];
  return Object.entries(value).flatMap(([key, child]) => leafKeys(child, prefix ? `${prefix}.${key}` : key));
}

describe("RoleTable", () => {
  it("RoleTable_readOnly_listsSevenRolesWithHintsNoCheckbox", () => {
    const html = render(<RoleTable />);

    expect(html).toContain('role="table"');
    expect(html.match(/role="rowheader"/g)).toHaveLength(7);
    for (const label of ["Propriétaire", "Manager", "Capitaine", "Coach", "Tank", "DPS", "Soutien"]) {
      expect(html).toContain(label);
    }
    expect(checkboxes(html)).toBe(0);
    expect(html).toContain(frTeam.roleGuide.roles.CAPITAINE.matches.replaceAll("'", "&#x27;"));
  });

  it("RoleTable_cells_carryTheirColumnLabel", () => {
    const html = render(<RoleTable />);

    expect(html.match(/data-label="Sur l&#x27;équipe"/g)).toHaveLength(7);
    expect(html.match(/data-label="En match"/g)).toHaveLength(7);
    expect(html.match(/data-label="Messages reçus"/g)).toHaveLength(7);
  });

  it("RoleTable_checkable_ownerNeverCheckbox_othersCheckboxes", () => {
    const html = render(<RoleTable selected={[]} onChange={() => undefined} checkable={MANAGER_ASSIGNABLE_ROLES} />);

    expect(checkboxes(html)).toBe(6);
    expect(html).toContain("Se transfère");
  });

  it("RoleTable_selectedRoles_areTheOnlyCheckedBoxes", () => {
    const html = render(
      <RoleTable selected={["CAPITAINE", "TANK"]} onChange={() => undefined} checkable={MANAGER_ASSIGNABLE_ROLES} />,
    );

    expect(checkedBoxes(html)).toBe(2);
  });

  it("RoleTable_english_rendersEnglishRoleGuide", () => {
    const html = render(<RoleTable />, "en");

    expect(html).toContain("Team roles and what they allow");
    expect(html).toContain("Support");
    expect(html).toContain("In matches");
    expect(html).not.toContain("Sur l&#x27;équipe");
  });
});

describe("MyRolesBlock", () => {
  const save = async () => true;

  it("MyRolesBlock_render_showsLeadingRolesAndFourGameCheckboxes", () => {
    const html = render(<MyRolesBlock roles={["CAPITAINE", "TANK"]} onSave={save} />);

    expect(html).toContain("Mes rôles");
    expect(html).toContain("Capitaine");
    expect(checkboxes(html)).toBe(4);
    expect(checkedBoxes(html)).toBe(1);
  });

  it("MyRolesBlock_noLeadingRole_saysNone", () => {
    const html = render(<MyRolesBlock roles={[]} onSave={save} />);

    expect(html).toContain("Aucun");
    expect(checkedBoxes(html)).toBe(0);
  });

  it("MyRolesBlock_unchanged_submitIsAriaDisabledButFocusable", () => {
    const html = render(<MyRolesBlock roles={["DPS"]} onSave={save} />);

    expect(html).toMatch(/<button type="submit"[^>]*aria-disabled="true"/);
    expect(html).not.toMatch(/<button[^>]*\sdisabled=""/);
  });

  it("MyRolesBlock_english_rendersEnglishLabels", () => {
    const html = render(<MyRolesBlock roles={["MANAGER"]} onSave={save} />, "en");

    expect(html).toContain("My roles");
    expect(html).toContain("Save my roles");
    expect(html).toContain("What each role does");
  });
});

describe("InviteRolesDialog", () => {
  it("InviteRolesDialog_render_noRolePreChecked", () => {
    const src = read("app/(secured)/equipes/[id]/_components/InviteRolesDialog.tsx");

    expect(src).toContain("useState<TeamRole[]>([...initialRoles])");
    expect(src).toContain("initialRoles = []");
    expect(src).toContain("checkable={MANAGER_ASSIGNABLE_ROLES}");
  });

  it("InviteRolesDialog_dialog_usesThePortalTeamDialog", () => {
    const src = read("app/(secured)/equipes/[id]/_components/InviteRolesDialog.tsx");

    expect(src).toContain("<TeamDialog");
    expect(read("app/(secured)/equipes/[id]/_components/TeamDialog.tsx")).toMatch(/createPortal\(/);
  });
});

describe("RoleTable — mode à cocher", () => {
  it("RoleTable_tickMode_ownerIsMutedLabelNotPill", () => {
    const html = render(<RoleTable selected={[]} onChange={() => undefined} checkable={MANAGER_ASSIGNABLE_ROLES} />);

    expect(checkboxes(html)).toBe(6);
    expect(html).toContain("roleTableStatic");
    expect(html).toContain("Se transfère");
  });

  it("RoleTable_readOnly_noStaticLabel", () => {
    expect(render(<RoleTable />)).not.toContain("roleTableStatic");
  });

  it("RoleTable_body_isATapZone", () => {
    expect(render(<RoleTable />)).toContain("data-tap-zone");
  });

  it("RoleTable_noticesLine_onlyInsideTheHint", () => {
    const html = render(<RoleTable />);

    expect(html).toMatch(/class="panel" hidden=""><p>Tout membre reçoit/);
    expect(html).not.toContain('class="help"');
  });
});

describe("câblage des modales de rôles", () => {
  it("MembersSection_myRolesBlock_isNotRemountedByAKey", () => {
    const src = read("app/(secured)/equipes/[id]/_components/MembersSection.tsx");

    expect(src).toMatch(/<MyRolesBlock roles={viewerMember.roles}/);
    expect(src).not.toMatch(/key={viewerMember/);
  });

  it("MyRolesBlock_savedRolesChange_resyncsDraftWithoutRemount", () => {
    const src = read("app/(secured)/equipes/[id]/_components/MyRolesBlock.tsx");

    expect(src).toContain("setSyncedKey(savedKey)");
    expect(src).toContain("isCheckboxEnter");
  });

  it("MembersSection_refusedPseudo_keepsTickedRoles", () => {
    const src = read("app/(secured)/equipes/[id]/_components/MembersSection.tsx");

    expect(src).toContain("setKeptRoles(outcome.keepRoles ? roles : [])");
    expect(src).toContain("initialRoles={keptRoles}");
  });

  it("MyRolesBlock_dirtyDraft_notOverwrittenByAnExternalChange", () => {
    const src = read("app/(secured)/equipes/[id]/_components/MyRolesBlock.tsx");

    expect(src).toContain("if (ownGameRolesToSave(previous, selected) === null) setSelected(saved)");
  });

  it("RoleTable_rows_areMemoizedWithAStableToggle", () => {
    const src = read("app/(secured)/equipes/[id]/_components/RoleTable.tsx");

    expect(src).toContain("const RoleTableRow = memo(");
    expect(src).toContain("useCallback((role: TeamRole)");
  });

  it("MembersSection_roster_memoizedAndDialogsLazy", () => {
    const src = read("app/(secured)/equipes/[id]/_components/MembersSection.tsx");

    expect(src).toContain("const roster = useMemo(");
    expect(src).toMatch(/const RolesDialog = dynamic\(/);
    expect(src).toMatch(/const InviteRolesDialog = dynamic\(/);
    expect(read("app/(secured)/equipes/[id]/_components/MyRolesBlock.tsx")).toMatch(/const RoleGuideDialog = dynamic\(/);
  });

  it("TeamDialog_form_guardsEnterOnCheckbox", () => {
    expect(read("app/(secured)/equipes/[id]/_components/TeamDialog.tsx")).toContain("isCheckboxEnter(event.key");
  });

  it("teamCss_roleTable_foldsOnItsOwnWidthWithClassHook", () => {
    const css = read("app/(secured)/equipes/[id]/team.module.css");

    expect(css).toContain("@container roleTable (max-width: 700px)");
    expect(css).toContain(".roleTableBody > .roleTableRow:first-child");
    expect(css).not.toMatch(/@media (max-width: 680px)[^}]*roleTable/);
  });
});

describe("textes de la fiche", () => {
  it("teamJson_newNamespaces_sameKeysInFrAndEn", () => {
    expect(frTeam.inviteDialog.lead).toBeTruthy();
    expect(enTeam.inviteDialog.lead).toBeTruthy();
    for (const ns of ["inviteDialog", "myRoles", "roleGuide"] as const) {
      expect(leafKeys(enTeam[ns]).sort()).toEqual(leafKeys(frTeam[ns]).sort());
    }
  });

  it("teamJson_roleHints_areOneOrTwoSentences", () => {
    for (const messages of [frTeam, enTeam]) {
      for (const role of Object.values(messages.roleGuide.roles)) {
        const sentences = role.hint.split(/[.!?](?:\s|$)/).filter((part) => part.trim().length > 0);
        expect(sentences.length).toBeLessThanOrEqual(2);
      }
    }
  });
});
