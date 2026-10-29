/**
 * ADMIN-SELF-ROLES — « Mes rôles » de `/profil` : un administrateur règle ses
 * rôles cumulables, la case « Administrateur » reste cochée et focalisable.
 */
import { describe, expect, it, jest } from "@jest/globals";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { join } from "node:path";

jest.mock("next/navigation", () => ({
  usePathname: () => "/profil",
  useParams: () => ({}),
  useSearchParams: () => new URLSearchParams(""),
  useRouter: () => ({ push: () => undefined, replace: () => undefined, refresh: () => undefined, prefetch: () => undefined }),
}));
jest.mock("@/components/ui/toast", () => ({
  useToast: () => ({ showError: () => undefined, showSuccess: () => undefined }),
  ToastProvider: ({ children }: { children: ReactNode }) => children,
}));

import { SelfRolesField, SelfRolesSection, selfRolesErrorMessage } from "@/app/(secured)/profil/_components/SelfRolesField";
import { Coche, pillColors } from "@/components/Coche";
import { FR_PROFILE_TEXT, ProfileTextProvider } from "@/components/i18n/profile-text";
import { AppLocaleProvider } from "@/components/i18n/locale-context";
import { ShellTextProvider } from "@/components/i18n/shell-text";
import { messagesFor } from "@/lib/server/i18n-messages";
import { flagFromCode, SELF_ROLES_FIELD_ERRORS } from "@/lib/shared/field-errors";
import { scopedText } from "@/lib/shared/scoped-text";

const EN = messagesFor("en");
const EN_PROFILE = scopedText("en", EN.profile);

function inFrench(): string {
  return renderToStaticMarkup(<SelfRolesField userId={1} roles={["ADMIN", "ARBITRE"]} onSaved={() => undefined} />);
}

function inEnglish(): string {
  return renderToStaticMarkup(
    <AppLocaleProvider locale="en">
      <ShellTextProvider locale="en" messages={EN.shell}>
        <ProfileTextProvider locale="en" messages={EN.profile}>
          <SelfRolesField userId={1} roles={["ADMIN", "ARBITRE"]} onSaved={() => undefined} />
        </ProfileTextProvider>
      </ShellTextProvider>
    </AppLocaleProvider>,
  );
}

describe("selfRolesErrorMessage", () => {
  it("selfRolesErrorMessage_knownCodes_returnsFrAndEnSentences", () => {
    expect(selfRolesErrorMessage("CANNOT_REMOVE_OWN_ADMIN", FR_PROFILE_TEXT)).toBe(
      "Tu ne peux pas retirer ton propre rôle d'administrateur.",
    );
    expect(selfRolesErrorMessage("FORBIDDEN", FR_PROFILE_TEXT)).toBe(
      "Tu n'es plus administrateur : tes rôles n'ont pas été modifiés.",
    );
    expect(selfRolesErrorMessage("CANNOT_REMOVE_OWN_ADMIN", EN_PROFILE)).toBe("You can't remove your own administrator role.");
  });

  it("selfRolesErrorMessage_unknownCode_returnsFallbackNeverRawCode", () => {
    expect(selfRolesErrorMessage("ROLES_UPDATE_FAILED", FR_PROFILE_TEXT)).toBe("La mise à jour de tes rôles a échoué.");
    expect(selfRolesErrorMessage("constructor", EN_PROFILE)).toBe("Updating your roles failed.");
  });
});

describe("SELF_ROLES_FIELD_ERRORS", () => {
  it("selfRolesFieldErrors_cannotRemoveOwnAdmin_flagsAdminField", () => {
    expect(flagFromCode("CANNOT_REMOVE_OWN_ADMIN", "x", SELF_ROLES_FIELD_ERRORS)).toEqual({ field: "admin", message: "x" });
    expect(flagFromCode("FORBIDDEN", "x", SELF_ROLES_FIELD_ERRORS)).toBeNull();
  });
});

describe("SelfRolesField", () => {
  it("selfRolesField_render_adminBoxCheckedAriaDisabledWithHint", () => {
    const html = inFrench();
    const admin = /<input[^>]*id="profile-role-ADMIN"[^>]*>/.exec(html)?.[0] ?? "";

    expect(admin).toContain("checked");
    expect(admin).toContain('aria-disabled="true"');
    expect(admin).not.toMatch(/\sdisabled=""/);
    expect(admin).toContain("profile-role-admin-hint");
    expect(html).toContain("Mes rôles de plateforme");
    expect(html).toContain("Enregistrer mes rôles");
  });

  it("selfRolesField_render_scopedBoxesFollowSavedRoles", () => {
    const html = inFrench();
    const arbitre = /<input[^>]*id="profile-role-ARBITRE"[^>]*>/.exec(html)?.[0] ?? "";
    const caster = /<input[^>]*id="profile-role-CASTER"[^>]*>/.exec(html)?.[0] ?? "";

    expect(arbitre).toContain("checked");
    expect(arbitre).not.toContain("aria-disabled");
    expect(caster).not.toContain("checked");
  });

  it("selfRolesField_noChange_saveButtonAriaDisabled", () => {
    const button = /<button[^>]*class="btn"[^>]*>/.exec(inFrench())?.[0] ?? "";

    expect(button).toContain('aria-disabled="true"');
  });

  it("selfRolesField_englishPage_rendersEnglishLabels", () => {
    const html = inEnglish();

    expect(html).toContain("My platform roles");
    expect(html).toContain("Administrator");
    expect(html).toContain("Referee");
    expect(html).toContain("Save my roles");
    expect(html).not.toContain("Arbitre");
  });
});

describe("SelfRolesSection", () => {
  const section = { id: "roles", title: "Mes rôles", lead: "x", tone: "violet" } as const;

  it("selfRolesSection_notAdmin_rendersNothing", () => {
    const html = renderToStaticMarkup(
      <SelfRolesSection section={section} isAdmin={false} userId={2} roles={[]} onSaved={() => undefined} />,
    );
    expect(html).toBe("");
  });

  it("selfRolesSection_admin_rendersSectionWithField", () => {
    const html = renderToStaticMarkup(
      <SelfRolesSection section={section} isAdmin userId={1} roles={["ADMIN"]} onSaved={() => undefined} />,
    );
    expect(html).toContain('id="roles"');
    expect(html).toContain('id="profile-role-ADMIN"');
  });
});

describe("SelfRolesField — resync", () => {
  it("selfRolesField_source_resyncsOnSavedContentNotArrayIdentity", () => {
    // Un PATCH du pseudo recrée le tableau des rôles : resynchroniser sur son
    // identité effaçait une case cochée mais pas encore enregistrée.
    const source = readFileSync(
      join(process.cwd(), "app", "(secured)", "profil", "_components", "SelfRolesField.tsx"),
      "utf8",
    );
    expect(source).toContain("}, [savedKey]);");
    expect(source).not.toContain("}, [roles]);");
  });
});

describe("Coche — aria-disabled", () => {
  it("pillColors_inert_mutesBorderAndLabel", () => {
    expect(pillColors("89,212,255", true, true)).toEqual({
      pillBorder: "rgba(89,212,255,0.22)",
      markBorder: "rgba(89,212,255,0.45)",
      labelColor: "var(--ink-mute)",
    });
    expect(pillColors("89,212,255", false, true).pillBorder).toBe("rgba(255,255,255,0.12)");
  });

  it("pillColors_active_keepsThemeColours", () => {
    expect(pillColors("89,212,255", true, false)).toEqual({
      pillBorder: "rgba(89,212,255,0.4)",
      markBorder: "rgba(89,212,255,0.8)",
      labelColor: "var(--ink)",
    });
  });

  it("coche_ariaDisabled_showsNotAllowedCursorWithoutOpacity", () => {
    const html = renderToStaticMarkup(
      <Coche id="x" label="Administrateur" checked aria-disabled onChange={() => undefined} />,
    );
    const label = /<label[^>]*>/.exec(html)?.[0] ?? "";
    expect(label).toContain("cursor:not-allowed");
    expect(html).toContain("color:var(--ink-mute)");
    expect(html).not.toMatch(/opacity:0\.\d/);
  });

  it("coche_enabled_keepsPointerCursor", () => {
    const html = renderToStaticMarkup(<Coche id="y" label="Arbitre" checked={false} onChange={() => undefined} />);
    expect(/<label[^>]*>/.exec(html)?.[0]).toContain("cursor:pointer");
  });
});
