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
    expect(MATCH_TOLD_KEY).toBe("TOLD");
    expect(source).toMatch(/SELECT DISTINCT match_id, 'TOLD' FROM bg_match_reminders\s+WHERE offset_key IN \('P7D', 'PT1H'\)`/);
  });

  it("ne recopie `P1D` (réservé avant l'envoi par le nouveau code) qu'avant toute marque `TOLD`", () => {
    expect(source).toMatch(
      /SELECT DISTINCT r\.match_id, 'TOLD' FROM bg_match_reminders r\s+WHERE r\.offset_key = 'P1D'\s+AND NOT EXISTS \(SELECT 1 FROM bg_match_reminders t WHERE t\.offset_key = 'TOLD'\)`/,
    );
  });

  it("efface la marque d'observation posée en silence par l'ancien balayage, pour une manche à venir", () => {
    const statement = source.slice(source.indexOf("DELETE r FROM bg_match_reminders r"));
    expect(statement).toMatch(/LEFT JOIN bg_match_reminders o ON o\.match_id = r\.match_id AND o\.offset_key <> 'SEEN'/);
    expect(statement).toMatch(/WHERE r\.offset_key = 'SEEN' AND o\.id IS NULL/);
    expect(statement).toMatch(/r\.sent_at < '2026-10-31' AND m\.start_at > NOW\(\)/);
  });
});
