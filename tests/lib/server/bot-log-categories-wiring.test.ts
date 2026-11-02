import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { BOT_LOG_CATEGORIES, type BotLogCategory } from "@/lib/shared/bot-log-category";

/**
 * Balayage des sources : chaque appelant du journal Discord range sa ligne dans
 * sa catégorie (`docs/features/LOG_BATCHING.md`). Un appel sans catégorie
 * retomberait dans `general` (ou `admin` pour `publishStaffAction`) et se
 * mêlerait à d'autres types de ligne.
 */
const ROOT = process.cwd();
const read = (file: string) => readFileSync(join(ROOT, file), "utf8");

const SEND_BOT_LOG: Record<string, BotLogCategory[]> = {
  "lib/server/tournaments/referee-digest.ts": ["referee-digest"],
  "lib/server/tournaments/round-maps-notice.ts": ["maps"],
  "lib/server/tournaments/round-maps.ts": ["maps"],
  "lib/server/tournaments/staff-action-logs.ts": ["admin"],
  "lib/server/users/sign-in.ts": ["signups"],
};

/** Retraits d'arbitre ou de caster : la catégorie se décide par `…LogCategory(change)` (alerte `staff-removal`). */
const REMOVAL_ROUTED: Record<string, string> = {
  "lib/server/tournaments/cast-notices.ts": "category: castLogCategory(change)",
  "lib/server/tournaments/referee-notices.ts": "category: refereeLogCategory(change)",
};

const PUBLISH_STAFF_ACTION: Record<string, BotLogCategory> = {
  "app/api/admin/referees/[userId]/objection/route.ts": "referees",
  "app/api/admin/tournaments/[id]/referee-scheduling/route.ts": "referees",
  "lib/server/tournaments/dispute-self-resolution.ts": "referee-self-action",
  "app/api/admin/tournaments/[id]/forfeits/[teamId]/route.ts": "registrations",
  "app/api/admin/tournaments/[id]/registrations/[teamId]/route.ts": "registrations",
  "lib/server/tournaments/schedule-notices.ts": "schedule",
  "app/api/admin/teams/[id]/logo/route.ts": "moderation",
  "app/api/admin/users/[id]/avatar/route.ts": "moderation",
  "lib/server/account-suspensions.ts": "moderation",
  "lib/server/content-reports.ts": "moderation",
  "lib/server/logo-quarantine.ts": "moderation",
};

describe("catégories des appelants du journal", () => {
  it.each(Object.entries(SEND_BOT_LOG))("%s range ses lignes dans sa catégorie", (file, categories) => {
    const source = read(file);
    for (const category of categories) expect(source).toContain(`category: "${category}"`);
    const others = BOT_LOG_CATEGORIES.filter((category) => !categories.includes(category));
    for (const category of others) expect(source).not.toContain(`category: "${category}"`);
  });

  it.each(Object.entries(PUBLISH_STAFF_ACTION))("%s publie ses gestes dans sa catégorie", (file, category) => {
    const source = read(file);
    const calls = source.split("publishStaffAction(").length - 1;
    const tagged = source.split(`"${category}"`).length - 1;
    expect(calls).toBeGreaterThan(0);
    expect(tagged).toBeGreaterThanOrEqual(calls);
  });

  it.each(Object.entries(REMOVAL_ROUTED))("%s route ses lignes par la catégorie du changement", (file, call) => {
    const source = read(file);
    expect(source).toContain(call);
    expect(source).not.toContain('category: "casts"');
    expect(source).not.toContain('category: "referees"');
  });

  it("match-launch classe en staff-removal la ligne d'une manche qui écarte un arbitre", () => {
    expect(read("lib/server/tournaments/match-launch.ts")).toContain('removedReferee ? "staff-removal" : "referees"');
  });

  it("la route d'opposition publie en staff-removal quand l'opposition est retenue", () => {
    expect(read("app/api/admin/referees/[userId]/objection/route.ts")).toContain('upheld && result.released > 0 ? "staff-removal" : "referees"');
  });

  it("bot-logs range chaque évènement du journal par sa table de catégories", () => {
    expect(read("lib/server/tournaments/bot-logs.ts")).toContain("category: BOT_EVENT_LOG_CATEGORIES[entry.kind]");
  });
});
