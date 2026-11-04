import { describe, expect, it } from "@jest/globals";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

/*
 * Décision du 2026-11-04 (point 1) : un forfait ou un retrait ordinaire
 * n'anonymise **jamais** personne. Seule une demande de suppression de compte
 * pose le masque (`holdAccountIdentity`) ou un pseudo d'emprunt ; le moteur de
 * tournoi, lui, ne touche ni l'un ni l'autre.
 */

const ROOT = path.resolve(__dirname, "../../..");

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return sources(full);
    return /\.(ts|tsx)$/.test(name) ? [full] : [];
  });
}

const relative = (file: string) => path.relative(ROOT, file).split(path.sep).join("/");
const all = [...sources(path.join(ROOT, "lib")), ...sources(path.join(ROOT, "app"))];

describe("forfait et retrait : jamais d'anonymisation", () => {
  it("holdAccountIdentity_callers_onlyTheDeletionRequest", () => {
    const callers = all
      .filter((file) => /holdAccountIdentity\(/.test(readFileSync(file, "utf8")))
      .map(relative)
      .sort();

    expect(callers).toEqual([
      "lib/server/users/account-deletion-hold.ts",
      "lib/server/users/account-deletion-request.ts",
    ]);
  });

  it("tournamentEngine_forfeitAndWithdrawal_neverWriteIdentityNorHold", () => {
    const engine = [
      ...sources(path.join(ROOT, "lib/server/tournaments")),
      path.join(ROOT, "lib/server/tournaments-service.ts"),
      ...sources(path.join(ROOT, "app/api/tournaments")),
    ];
    const offenders = engine
      .filter((file) => {
        const text = readFileSync(file, "utf8");
        return (
          /bg_account_deletion_holds/.test(text) ||
          /pickAnonymousPseudo|anonymizeAccount|holdAccountIdentity/.test(text) ||
          /UPDATE bg_users[^`]*SET[^`]*pseudo\s*=/.test(text)
        );
      })
      .map(relative);

    expect(offenders).toEqual([]);
  });

  it("forfeitTournamentTeamOnce_skipForfeitLog_guardsTheForfeitLine", () => {
    // Une suppression de compte ne dit qu'une ligne Discord par tournoi
    // (point 6) : la ligne du forfait se tait quand la suppression l'écrit.
    const text = readFileSync(path.join(ROOT, "lib/server/tournaments/index.ts"), "utf8");

    expect(text).toMatch(/if \(!skipForfeitLog\) queueBotLog\(/);
  });
});
