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

/** `source` à longueur égale, le contenu de ses chaînes effacé : leurs virgules et parenthèses ne comptent pas. */
function maskStrings(source: string): string {
  return source.replace(/"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`/g, (literal) =>
    literal[0] + " ".repeat(literal.length - 2) + literal[0],
  );
}

/**
 * Les arguments (texte d'origine) d'un appel `console.error(` / `console.warn(`
 * dont la parenthèse ouvrante est à `open`, coupés aux virgules de premier
 * niveau. Un appel sur plusieurs lignes, ou passé dans une flèche
 * (`.catch((error) => console.error("…", error))`), se lit comme les autres.
 */
function callArguments(source: string, masked: string, open: number): string[] {
  const args: string[] = [];
  let depth = 0;
  let start = open + 1;
  for (let index = open; index < masked.length; index += 1) {
    const char = masked[index];
    if (char === "(") depth += 1;
    else if (char === ")") depth -= 1;
    const closes = depth === 0;
    if (closes || (char === "," && depth === 1)) {
      args.push(source.slice(start, index));
      start = index + 1;
    }
    if (closes) return args;
  }
  return args;
}

/**
 * Un argument qui livre l'erreur elle-même : la variable d'erreur nue, son
 * `.message` ou sa `.stack` (texte du pilote, valeur en double citée), ou sa
 * conversion en texte.
 */
const RAW_ERROR_ARGUMENT = /^\s*(?:error|err|e|reason|cause)\s*$|\.(?:message|stack)\b|String\(\s*(?:error|err|e|reason)\s*\)/;

/** Les appels d'échec de `source` qui passent l'erreur brute (après leur étiquette). */
function rawErrorLogs(source: string): string[] {
  const offenders: string[] = [];
  const masked = maskStrings(source);
  for (const match of source.matchAll(/console\.(?:error|warn)\(/g)) {
    const args = callArguments(source, masked, (match.index ?? 0) + match[0].length - 1);
    const interpolated = /\$\{\s*(?:error|err|e)\s*\}|\$\{[^}]*\.message\b/.test(args[0] ?? "");
    if (interpolated || args.slice(1).some((arg) => RAW_ERROR_ARGUMENT.test(arg))) offenders.push(args.join(",").trim());
  }
  return offenders;
}

describe("journaux d'échec : un code, jamais l'objet d'erreur", () => {
  it("sources_sweptFolders_found", () => {
    expect(sources.length).toBeGreaterThan(100);
    expect(sources).toContain(join("app", "api", "profile", "route.ts"));
  });

  it("sources_noRawErrorObjectLogged", () => {
    const offenders = sources.filter((path) => rawErrorLogs(readFileSync(join(ROOT, path), "utf8")).length > 0);

    expect(offenders).toEqual([]);
  });

  it("rawErrorLogs_rawForms_detected", () => {
    expect(rawErrorLogs(`console.error("[x] échec", error);`)).toHaveLength(1);
    expect(rawErrorLogs(`console.warn("[x] échec", err);`)).toHaveLength(1);
    expect(rawErrorLogs(`p.catch((error) => console.error("[x] échec", error));`)).toHaveLength(1);
    expect(rawErrorLogs(`console.error(
  "[x] échec",
  error,
);`)).toHaveLength(1);
    expect(rawErrorLogs(`console.error("[x]", error instanceof Error ? error.message : error);`)).toHaveLength(1);
    expect(rawErrorLogs(`console.error("[x]", (error as Error).message);`)).toHaveLength(1);
    expect(rawErrorLogs("console.error(`[x] ${error}`);")).toHaveLength(1);
  });

  it("rawErrorLogs_codeOnly_ignored", () => {
    expect(rawErrorLogs(`console.error("[x] échec", failureReason(error));`)).toEqual([]);
    expect(rawErrorLogs("console.error(`[x] échec : ${failureReason(error)}`);")).toEqual([]);
    expect(rawErrorLogs(`console.error("[x] « (a, b) » échec, code", failureReason(e));`)).toEqual([]);
    expect(rawErrorLogs(`console.warn("[x] reporté", tournamentId);`)).toEqual([]);
  });
});
