import { describe, expect, it } from "@jest/globals";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { stripLineComments } from "../../helpers/strip-comments";

/**
 * La production tourne sous **MariaDB** (11.8), pas MySQL 8.
 *
 * Les deux dialectes se recouvrent presque partout, et les tests simulent la
 * base : une syntaxe propre à MySQL passe donc le CI, la base de développement
 * si elle est MySQL, puis casse en production — c'est ainsi que le lancement
 * anticipé d'un tournoi a échoué (`FOR UPDATE OF m`, erreur de syntaxe 1064),
 * et que l'acceptation d'une invitation d'équipe l'aurait fait (`FOR SHARE`).
 * Seul un balayage des sources peut tenir cette panne-là.
 *
 * Chaque motif refusé porte son équivalent accepté des deux côtés.
 */

const ROOT = join(__dirname, "..", "..", "..");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

const sources = ["app", "components", "lib"]
  .flatMap((dir) => walk(join(ROOT, dir)))
  .filter((path) => /\.(ts|tsx)$/.test(path))
  .map((path) => ({ path: relative(ROOT, path), text: stripLineComments(readFileSync(path, "utf8")) }));

const FORBIDDEN: { pattern: RegExp; why: string }[] = [
  {
    // `FOR UPDATE OF <table>` — MariaDB ne connaît pas la clause : verrouiller
    // la seule ligne voulue par une requête sans jointure.
    pattern: /FOR\s+UPDATE\s+OF\b/i,
    why: "FOR UPDATE OF : inconnu de MariaDB",
  },
  {
    // `FOR SHARE` — MariaDB n'accepte que `LOCK IN SHARE MODE`, que MySQL 8
    // accepte aussi.
    pattern: /\bFOR\s+SHARE\b/i,
    why: "FOR SHARE : écrire LOCK IN SHARE MODE",
  },
  {
    // Alias de ligne d'insertion (MySQL 8.0.19) — MariaDB veut `VALUES(col)`.
    pattern: /\)\s+AS\s+\w+\s+ON\s+DUPLICATE\s+KEY/i,
    why: "INSERT … AS alias ON DUPLICATE KEY : écrire VALUES(col)",
  },
];

/**
 * `ER_AUTOINC_READ_FAILED` en production (MariaDB, `innodb_autoinc_lock_mode
 * = 1`) : une insertion **nue** dans `bg_match_reminders` suppose qu'une
 * lecture verrouillante a d'abord établi l'absence de la ligne — et c'est ce
 * verrou d'intervalle qui s'interbloque avec le verrou AUTO-INC d'un
 * `INSERT … SELECT` concurrent. Toute insertion y est donc `INSERT IGNORE` ou
 * `ON DUPLICATE KEY UPDATE`, qui se passent de lecture préalable.
 */
function bareReminderInserts(text: string): string[] {
  return (text.match(/INSERT\s+INTO\s+bg_match_reminders\b[^`]*/gi) ?? []).filter(
    (statement) => !/ON\s+DUPLICATE\s+KEY\s+UPDATE/i.test(statement),
  );
}

describe("SQL compatible MariaDB", () => {
  it("refuse une insertion nue dans bg_match_reminders (ni IGNORE ni ON DUPLICATE KEY)", () => {
    const offenders = sources.filter(({ text }) => bareReminderInserts(text).length > 0).map(({ path }) => path);
    expect(offenders).toEqual([]);
  });

  it("reconnaît une insertion nue, et laisse passer les deux formes sûres", () => {
    expect(bareReminderInserts("`INSERT INTO bg_match_reminders (match_id, offset_key) VALUES (?, ?)`")).toHaveLength(1);
    expect(
      bareReminderInserts("`INSERT INTO bg_match_reminders (match_id) VALUES (?)\n ON DUPLICATE KEY UPDATE start_at = ?`"),
    ).toEqual([]);
    expect(bareReminderInserts("`INSERT IGNORE INTO bg_match_reminders (match_id) VALUES (?)`")).toEqual([]);
  });

  it("a bien des sources à balayer", () => {
    expect(sources.length).toBeGreaterThan(100);
  });

  it.each(FORBIDDEN.map((rule) => [rule.why, rule] as const))("refuse %s", (_why, rule) => {
    const offenders = sources.filter(({ text }) => rule.pattern.test(text)).map(({ path }) => path);
    expect(offenders).toEqual([]);
  });
});
