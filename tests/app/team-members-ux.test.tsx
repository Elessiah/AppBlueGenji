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

    expect(src).toContain("useState<TeamRole[]>([])");
    expect(src).toContain("checkable={MANAGER_ASSIGNABLE_ROLES}");
  });

  it("InviteRolesDialog_dialog_usesThePortalTeamDialog", () => {
    const src = read("app/(secured)/equipes/[id]/_components/InviteRolesDialog.tsx");

    expect(src).toContain("<TeamDialog");
    expect(read("app/(secured)/equipes/[id]/_components/TeamDialog.tsx")).toMatch(/createPortal\(/);
  });
});

describe("textes de la fiche", () => {
  it("teamJson_newNamespaces_sameKeysInFrAndEn", () => {
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
