import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { MATCH_TOLD_KEY } from "@/lib/shared/discord-notifications";

/**
 * Passage à la marque `TOLD` (PR #441) : les lignes écrites par l'ancien code
 * des rappels sont reprises une fois, au démarrage (`RECENT_SCHEMA_CHANGES`).
 */
const source = readFileSync(join(process.cwd(), "lib/server/database/recent-schema-changes.ts"), "utf8");

describe("reprise des marques de rappel héritées", () => {
  it("recopie en `TOLD` les paliers posés par l'ancien code, toujours avec un message", () => {
    const statement = source.slice(source.indexOf("INSERT IGNORE INTO bg_match_reminders (match_id, offset_key)"));
    expect(statement).toMatch(/^INSERT IGNORE INTO bg_match_reminders \(match_id, offset_key\)\s+SELECT DISTINCT match_id, 'TOLD'/);
    expect(MATCH_TOLD_KEY).toBe("TOLD");
    expect(statement).toMatch(/WHERE offset_key IN \('P7D', 'P1D', 'PT1H'\) AND sent_at < '2026-10-31'/);
  });

  it("efface la marque d'observation posée en silence par l'ancien balayage, pour une manche à venir", () => {
    const statement = source.slice(source.indexOf("DELETE r FROM bg_match_reminders r"));
    expect(statement).toMatch(/LEFT JOIN bg_match_reminders o ON o\.match_id = r\.match_id AND o\.offset_key <> 'SEEN'/);
    expect(statement).toMatch(/WHERE r\.offset_key = 'SEEN' AND o\.id IS NULL/);
    expect(statement).toMatch(/r\.sent_at < '2026-10-31' AND m\.start_at > NOW\(\)/);
  });
});
