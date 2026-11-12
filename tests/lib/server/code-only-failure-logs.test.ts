import { describe, expect, it } from "@jest/globals";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

/**
 * Une ligne d'échec de pm2 ne porte **qu'un code** (`failureReason`), jamais
 * l'objet d'erreur entier : mysql2 y met la requête et un `sqlMessage` qui cite
 * la valeur en double d'un `ER_DUP_ENTRY` (un pseudo, un courriel), alors que le
 * registre (T05) et /rgpd décrivent ces lignes comme le geste et le numéro.
 *
 * Balayage des sources déjà passées à la règle. Restent hors balayage : le
 * moteur de tournoi (`lib/server/tournaments/`, entrée d'ERREUR.txt), le seed
 * et les scripts d'exploitation lancés à la main, dont la sortie va au
 * terminal de l'exploitant.
 */

const ROOT = join(__dirname, "..", "..", "..");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

const NOT_YET_SWEPT = [
  `lib${sep}server${sep}tournaments${sep}`,
  `lib${sep}server${sep}seed`,
  `lib${sep}server${sep}database${sep}schema${sep}`,
  `lib${sep}server${sep}backfill-avatars.ts`,
  `lib${sep}server${sep}replay-account-deletions.ts`,
  `lib${sep}server${sep}rotate-hidden-avatars.ts`,
];

const sources = [join(ROOT, "lib", "server"), join(ROOT, "app", "api")]
  .flatMap((dir) => walk(dir))
  .filter((path) => path.endsWith(".ts"))
  .map((path) => relative(ROOT, path))
  .filter((path) => !NOT_YET_SWEPT.some((prefix) => path.startsWith(prefix)));

/** `console.error("…", error);` — l'objet d'erreur passé tel quel en dernier argument. */
const RAW_ERROR_LOG = /console\.(?:error|warn)\([^;]*,\s*(?:error|err|e)\s*\);/;

describe("journaux d'échec : un code, jamais l'objet d'erreur", () => {
  it("sources_sweptFolders_found", () => {
    expect(sources.length).toBeGreaterThan(100);
    expect(sources).toContain(join("app", "api", "profile", "route.ts"));
  });

  it("sources_noRawErrorObjectLogged", () => {
    const offenders = sources.filter((path) => RAW_ERROR_LOG.test(readFileSync(join(ROOT, path), "utf8")));

    expect(offenders).toEqual([]);
  });

  it("rawErrorLogPattern_matchesRawAndIgnoresCodeOnly", () => {
    expect(RAW_ERROR_LOG.test(`console.error("[x] échec", error);`)).toBe(true);
    expect(RAW_ERROR_LOG.test(`console.warn("[x] échec", err);`)).toBe(true);
    expect(RAW_ERROR_LOG.test(`console.error("[x] échec", failureReason(error));`)).toBe(false);
  });
});
