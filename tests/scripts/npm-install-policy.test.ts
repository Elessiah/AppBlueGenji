import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Ce que `npm ci` affiche en production, gardé depuis le lockfile.
 *
 * Le serveur tourne sous npm 12, qui bloque les scripts d'installation non
 * couverts par `allowScripts` et le signale à chaque déploiement. Le CI, lui,
 * tourne sous npm 10 : il ignore le champ, exécute tous les scripts et
 * n'affiche rien — une dépendance à script ajoutée demain passerait au vert et
 * ne se verrait qu'au `./update.sh`. D'où une lecture du lockfile, qui porte
 * déjà tout ce qu'il faut (`hasInstallScript`, `os`, les versions résolues).
 * Voir `docs/DEPLOYMENT.md`.
 */
type LockPackage = {
  version?: string;
  hasInstallScript?: boolean;
  os?: string[];
};

function readJson<T>(name: string): T {
  return JSON.parse(readFileSync(join(process.cwd(), name), "utf8")) as T;
}

const lockPackages = readJson<{ packages: Record<string, LockPackage> }>("package-lock.json").packages;
const allowScripts = readJson<{ allowScripts?: Record<string, boolean> }>("package.json").allowScripts ?? {};

function packageName(lockPath: string): string {
  return lockPath.split("node_modules/").pop() ?? lockPath;
}

/** La production est un Linux : un paquet réservé à un autre système n'y est jamais installé. */
function installsOnLinux(pkg: LockPackage): boolean {
  if (!pkg.os) return true;
  const allowed = pkg.os.filter((os) => !os.startsWith("!"));
  if (allowed.length > 0) return allowed.includes("linux");
  return !pkg.os.includes("!linux");
}

/** Une entrée `allowScripts` s'écrit `nom` ou `nom@version` ; le nom peut porter une portée (`@scope/nom`). */
function allowScriptsName(key: string): string {
  const at = key.lastIndexOf("@");
  return at > 0 ? key.slice(0, at) : key;
}

const scriptedOnLinux = Object.entries(lockPackages)
  .filter(([path, pkg]) => path !== "" && pkg.hasInstallScript && installsOnLinux(pkg))
  .map(([path]) => packageName(path));

describe("scripts d'installation — tous tranchés par allowScripts", () => {
  it("le lockfile en déclare bien (sinon ce garde ne garderait rien)", () => {
    expect(scriptedOnLinux.length).toBeGreaterThan(0);
  });

  it("chaque paquet à script installé sur Linux a une entrée", () => {
    const covered = new Set(Object.keys(allowScripts).map(allowScriptsName));
    const uncovered = [...new Set(scriptedOnLinux)].filter((name) => !covered.has(name));
    expect(uncovered).toEqual([]);
  });

  it("aucune entrée ne vise un paquet disparu ou sans script", () => {
    const scripted = new Set(Object.entries(lockPackages)
      .filter(([path, pkg]) => path !== "" && pkg.hasInstallScript)
      .map(([path]) => packageName(path)));
    const stale = Object.keys(allowScripts).filter((key) => !scripted.has(allowScriptsName(key)));
    expect(stale).toEqual([]);
  });
});

describe("paquets dépréciés signalés par npm ci", () => {
  const resolved = Object.entries(lockPackages)
    .filter(([path]) => path !== "")
    .map(([path, pkg]) => ({ name: packageName(path), version: pkg.version ?? "" }));

  it("aucun inflight (fuite mémoire, retiré du registre)", () => {
    expect(resolved.filter((p) => p.name === "inflight")).toEqual([]);
  });

  it("aucun glob antérieur à la 11 (7 et 10 sont annoncés dépréciés)", () => {
    const old = resolved.filter((p) => p.name === "glob" && Number(p.version.split(".")[0]) < 11);
    expect(old).toEqual([]);
  });
});
