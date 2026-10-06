import { describe, expect, it, jest } from "@jest/globals";
import { existsSync } from "node:fs";
import { join } from "node:path";

let mockLocaleHeader: string | null = null;
jest.mock("next/headers", () => ({
  headers: async () => new Headers(mockLocaleHeader === null ? {} : { "x-bg-locale": mockLocaleHeader }),
}));

import { requestLocale } from "@/lib/server/request-locale";
import { readSource } from "../helpers/read-source";

describe("requestLocale — langue posée par le middleware", () => {
  it("lit x-bg-locale, et retombe sur fr pour une valeur absente ou inconnue", async () => {
    mockLocaleHeader = "en";
    await expect(requestLocale()).resolves.toBe("en");
    mockLocaleHeader = "de";
    await expect(requestLocale()).resolves.toBe("fr");
    mockLocaleHeader = null;
    await expect(requestLocale()).resolves.toBe("fr");
  });
});

describe("raccordement de next-intl, sans son routage", () => {
  it("désigne next-intl/config, pour Turbopack comme pour webpack, vers une configuration qui existe", async () => {
    const { default: nextConfig } = await import("@/next.config");
    const turbo = nextConfig.turbopack?.resolveAlias?.["next-intl/config"];
    expect(turbo).toBe("./lib/server/i18n-request.ts");
    expect(existsSync(join(process.cwd(), String(turbo)))).toBe(true);

    const webpack = nextConfig.webpack as (config: object, context: object) => { resolve: { alias: Record<string, string> } };
    const resolved = webpack({ context: process.cwd(), resolve: { alias: { other: "x" } } }, {});
    expect(resolved.resolve.alias).toEqual({ other: "x", "next-intl/config": join(process.cwd(), "lib/server/i18n-request.ts") });
  });

  it("n'importe pas le greffon de next-intl, qui charge un binaire natif inutile ici", () => {
    expect(readSource("next.config.ts")).not.toMatch(/next-intl\/plugin/);
  });

  it("n'utilise ni le middleware ni le routage de next-intl", () => {
    expect(readSource("middleware.ts")).not.toMatch(/next-intl/);
    for (const file of ["lib/server/i18n-request.ts", "components/i18n/locale-navigation.tsx"]) {
      expect(readSource(file)).not.toMatch(/next-intl\/(routing|middleware|navigation)/);
    }
  });

  it("dérive <html lang> de la langue de la requête", () => {
    const layout = readSource("app/layout.tsx");
    expect(layout).toContain("<html lang={locale}");
    expect(layout).not.toContain('lang="fr"');
  });
});
