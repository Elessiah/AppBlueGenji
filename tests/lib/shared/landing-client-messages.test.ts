/**
 * Sous `/en`, seuls les espaces lus par les composants clients de l'accueil
 * voyagent jusqu'au navigateur (`landingClientMessages`). Un composant client
 * qui lirait un autre espace recevrait le français du paquet : ce balayage
 * l'interdit.
 */
import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { LANDING_CLIENT_NAMESPACES, landingClientMessages, type LandingMessages } from "@/lib/shared/landing-text";

const ROOT = join(__dirname, "..", "..", "..");
const en = JSON.parse(readFileSync(join(ROOT, "messages", "en", "landing.json"), "utf8")) as LandingMessages;

const CLIENT_FILES = [
  "components/cyber/CountdownStrip.tsx",
  "components/cyber/Ticker.tsx",
  "components/cyber/landing/DiscordCommunity.tsx",
  "components/cyber/landing/Hero.tsx",
  "components/cyber/landing/Leaderboard.tsx",
  "components/cyber/landing/LiveCard.tsx",
  "components/cyber/landing/SponsorsGrid.tsx",
];

describe("landingClientMessages", () => {
  it("ne garde que les espaces clients, intacts", () => {
    const picked = landingClientMessages(en);
    expect(Object.keys(picked).sort()).toEqual([...LANDING_CLIENT_NAMESPACES].sort());
    expect(picked.hero).toBe(en.hero);
    expect(picked).not.toHaveProperty("meta");
    expect(picked).not.toHaveProperty("board");
  });

  it("allège réellement ce qui voyage", () => {
    expect(JSON.stringify(landingClientMessages(en)).length).toBeLessThan(JSON.stringify(en).length);
  });

  it.each(CLIENT_FILES.map((file) => [file]))("%s ne lit que des espaces clients", (file) => {
    const source = readFileSync(join(ROOT, file), "utf8");
    expect(source).toContain("useLandingText");
    const used = new Set([...source.matchAll(/\bt\(\s*[`"]([a-zA-Z]+)\./g)].map((m) => m[1]));
    expect(used.size).toBeGreaterThan(0);
    for (const ns of used) expect(LANDING_CLIENT_NAMESPACES).toContain(ns);
  });
});
