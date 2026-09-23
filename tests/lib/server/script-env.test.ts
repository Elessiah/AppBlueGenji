import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("dotenv", () => ({ config: jest.fn() }));
jest.mock("node:fs", () => ({ existsSync: jest.fn(() => false) }));

import { existsSync } from "node:fs";
import { config } from "dotenv";
import { loadScriptEnv } from "@/lib/server/script-env";

const existsMock = existsSync as unknown as jest.Mock<(path: string) => boolean>;
const configMock = config as unknown as jest.Mock;

/** Simule un disque qui ne porte que ces fichiers. */
function onDisk(...files: string[]) {
  existsMock.mockImplementation((path: string) => files.includes(path));
}

describe("loadScriptEnv", () => {
  let warn: jest.SpiedFunction<typeof console.warn>;
  const lifecycle = process.env.npm_lifecycle_event;
  const nodeEnv = process.env.NODE_ENV;
  const dbHost = process.env.DB_HOST;

  beforeEach(() => {
    // Le module s'est déjà chargé une fois à l'import : on repart d'un compte nul.
    configMock.mockClear();
    existsMock.mockReset();
    warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
    process.env.npm_lifecycle_event = "backfill:avatars";
    // Le shell du serveur : aucun NODE_ENV exporté. (Jest pose `test`.)
    delete (process.env as Record<string, string | undefined>).NODE_ENV;
    delete process.env.DB_HOST;
  });

  afterEach(() => {
    warn.mockRestore();
    if (lifecycle === undefined) delete process.env.npm_lifecycle_event;
    else process.env.npm_lifecycle_event = lifecycle;
    (process.env as Record<string, string | undefined>).NODE_ENV = nodeEnv;
    if (dbHost === undefined) delete process.env.DB_HOST;
    else process.env.DB_HOST = dbHost;
  });

  it("lit les fichiers de développement quand NODE_ENV est absent", () => {
    onDisk(".env");
    loadScriptEnv();

    const paths = configMock.mock.calls.map(([options]) => (options as { path: string }).path);
    expect(paths).toEqual([".env.development.local", ".env.local", ".env.development", ".env"]);
    expect(warn).not.toHaveBeenCalled();
  });

  it("prévient, commande à l'appui, quand seul `.env.production` existe", () => {
    // Le serveur : pas de `.env`, pas de NODE_ENV dans le shell.
    onDisk(".env.production");
    loadScriptEnv();

    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain("NODE_ENV=production npm run backfill:avatars");
  });

  it("ne se rabat jamais seul sur la production", () => {
    // Un poste de développement peut garder un `.env.production` : le lire
    // sans qu'on l'ait demandé brancherait le script sur la mauvaise base.
    onDisk(".env.production");
    loadScriptEnv();

    const paths = configMock.mock.calls.map(([options]) => (options as { path: string }).path);
    expect(paths).not.toContain(".env.production");
  });

  it("lit `.env.production` sans rien dire quand NODE_ENV=production", () => {
    onDisk(".env.production");
    loadScriptEnv("production");

    const paths = configMock.mock.calls.map(([options]) => (options as { path: string }).path);
    expect(paths).toContain(".env.production");
    expect(warn).not.toHaveBeenCalled();
  });

  it("se tait quand le shell exporte déjà la base", () => {
    onDisk(".env.production");
    process.env.DB_HOST = "127.0.0.1";
    loadScriptEnv();

    expect(warn).not.toHaveBeenCalled();
  });
});
