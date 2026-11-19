import { describe, expect, it } from "@jest/globals";
import { readSource } from "../helpers/read-source";

/**
 * Chargement à la demande de la modale « Incarner un rôle »
 * (`components/impersonate-role-loader.ts`, `account-menu.tsx`) : un échec
 * se dit au menu au lieu de faire tomber la page, la modale part dès
 * l'ouverture du menu, rien n'ajoute son code au paquet commun.
 */
describe("impersonate-role-loader", () => {
  it("loadImpersonateRoleDialog_resolvesTheDialogComponent_andKeepsIt", async () => {
    const loader = await import("@/components/impersonate-role-loader");
    expect(loader.loadedImpersonateRoleDialog()).toBeNull();

    const dialog = await loader.loadImpersonateRoleDialog();

    expect(typeof dialog).toBe("function");
    expect(loader.loadedImpersonateRoleDialog()).toBe(dialog);
    await expect(loader.loadImpersonateRoleDialog()).resolves.toBe(dialog);
  });

  it("loader_usesOnceLoaderAndNoNextDynamic", () => {
    const source = readSource("components/impersonate-role-loader.ts");

    expect(source).toContain("onceLoader");
    expect(source).not.toContain('from "next/dynamic"');
  });
});

describe("account-menu — entrée « Incarner un rôle »", () => {
  const source = readSource("components/account-menu.tsx");

  it("menu_neverImportsTheDialogStaticallyNorByNextDynamic", () => {
    expect(source).not.toContain("next/dynamic");
    expect(source).not.toMatch(/from "\.\/impersonate-role-dialog"/);
  });

  it("menu_preloadsTheDialogWhenOpenedForAnAdminEntry", () => {
    expect(source).toMatch(/if \(open && playerViewEntry === "enter"\) preloadImpersonateRoleDialog\(\)/);
  });

  it("menu_loadFailure_saysItByToastAndClearsPending", () => {
    expect(source).toContain('showError(t("account.impersonateFailed"))');
    expect(source).toContain("setLoadingDialog(false)");
  });

  it("menu_secondClickWhileLoading_isIgnored", () => {
    expect(source).toContain("if (loadingDialog) return;");
  });

  it("menu_keepsTheMenuOpenUntilTheDialogIsLoaded", () => {
    const loading = source.slice(source.indexOf("setLoadingDialog(true)"));
    expect(loading.indexOf("setOpen(false)")).toBeGreaterThan(loading.indexOf("loadImpersonateRoleDialog()"));
  });
});
