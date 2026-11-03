/**
 * Refus d'identité d'un caster ou d'un arbitre, décliné par jeu : un joueur
 * Marvel Rivals n'y lit jamais Battle.net (MATCH-REFEREE-FINISH, revue UI #545).
 */
import { describe, expect, it } from "@jest/globals";
import { castReleaseReasonKey, type CastReleasedMatch } from "@/lib/shared/cast-notices";
import { formatCastReleasedNotice } from "@/lib/server/tournaments/cast-release-message";
import { castReleasedPush } from "@/lib/shared/push-messages";
import { castBlockReason, LAUNCH_ERROR_MESSAGES } from "@/lib/shared/match-launch";
import { REFEREE_INELIGIBILITIES, refereeBlockReason } from "@/lib/shared/match-referee";
import frErrors from "@/messages/fr/tournamentErrors.json";
import enErrors from "@/messages/en/tournamentErrors.json";
import frLaunch from "@/messages/fr/launchModal.json";
import enLaunch from "@/messages/en/launchModal.json";
import frActions from "@/messages/fr/tournamentActions.json";
import enActions from "@/messages/en/tournamentActions.json";
import frPush from "@/messages/fr/pushMessages.json";
import enPush from "@/messages/en/pushMessages.json";

const NO_DISCORD = { discordVerified: false, blizzardLinked: true };
const NOTHING = { discordVerified: false, blizzardLinked: false };
const NO_BATTLENET = { discordVerified: true, blizzardLinked: false };
const URL = "https://site.test/tournois/7#match-42";

function match(overrides: Partial<CastReleasedMatch> = {}): CastReleasedMatch {
  return {
    tournamentId: 7,
    tournamentName: "Coupe d'hiver",
    matchId: 42,
    bracket: "UPPER",
    roundNumber: 2,
    team1Name: "Renards",
    team2Name: "Nova",
    solo: false,
    reason: "INELIGIBLE",
    ...overrides,
  };
}

/** Le texte de la première clé `key` trouvée dans l'arbre des messages. */
function textOf(messages: unknown, key: string): unknown {
  if (typeof messages !== "object" || messages === null) return undefined;
  const record = messages as Record<string, unknown>;
  if (key in record) return record[key];
  for (const value of Object.values(record)) {
    const found = textOf(value, key);
    if (found !== undefined) return found;
  }
  return undefined;
}

const DISCORD_CODES = ["CASTER_DISCORD_REQUIRED", "REFEREE_DISCORD_REQUIRED"];
const IDENTITY_CODES = ["CASTER_IDENTITY_REQUIRED", "REFEREE_IDENTITY_REQUIRED"];
const TABLES: [string, unknown][] = [
  ["fr-errors", frErrors],
  ["en-errors", enErrors],
  ["fr-launch", frLaunch],
  ["en-launch", enLaunch],
];

describe("castBlockReason / refereeBlockReason — code par jeu", () => {
  it("castBlockReason_marvelRivalsWithoutAnything_discordCode", () => {
    expect(castBlockReason(true, NOTHING, "MR")).toBe("CASTER_DISCORD_REQUIRED");
  });

  it("castBlockReason_overwatchWithoutDiscord_identityCode", () => {
    expect(castBlockReason(true, NO_DISCORD, "OW")).toBe("CASTER_IDENTITY_REQUIRED");
  });

  it("castBlockReason_noPermission_permissionFirstWhateverTheGame", () => {
    expect(castBlockReason(false, NOTHING, "MR")).toBe("NOT_CASTER");
  });

  it("refereeBlockReason_marvelRivalsWithoutAnything_discordCode", () => {
    expect(refereeBlockReason(true, NOTHING, "MR")).toBe("REFEREE_DISCORD_REQUIRED");
  });

  it("refereeBlockReason_overwatchWithoutBattlenet_identityCode", () => {
    expect(refereeBlockReason(true, NO_BATTLENET, "OW")).toBe("REFEREE_IDENTITY_REQUIRED");
  });

  it("refereeIneligibilities_listDiscordCode", () => {
    expect(REFEREE_INELIGIBILITIES).toContain("REFEREE_DISCORD_REQUIRED");
  });
});

describe("textes des refus — Battle.net en Overwatch seulement, FR et EN", () => {
  it.each(TABLES)("discordCodes_%s_neverMentionBattlenet", (_name, messages) => {
    for (const code of DISCORD_CODES) {
      const text = textOf(messages, code);
      expect(typeof text).toBe("string");
      expect(text).not.toMatch(/Battle\.net|Overwatch/);
      expect(text).toMatch(/Marvel Rivals/);
      expect(text).toMatch(/Discord/);
    }
  });

  it.each(TABLES)("identityCodes_%s_sayOverwatchAndBattlenet", (_name, messages) => {
    for (const code of IDENTITY_CODES) {
      const text = textOf(messages, code);
      expect(text).toMatch(/Overwatch/);
      expect(text).toMatch(/Battle\.net/);
      expect(text).not.toMatch(/Marvel Rivals/);
    }
  });

  it("launchErrorMessages_frenchMatchesTranslationTable", () => {
    for (const code of [...DISCORD_CODES, ...IDENTITY_CODES]) {
      expect(LAUNCH_ERROR_MESSAGES[code]).toBe(textOf(frErrors, code));
    }
  });

  it("refereePanelLabel_discordCode_existsInFrAndEn", () => {
    expect(textOf(frActions, "REFEREE_DISCORD_REQUIRED")).toBe("tag Discord à certifier");
    expect(textOf(enActions, "REFEREE_DISCORD_REQUIRED")).toBe("Discord tag to certify");
  });
});

describe("retrait d'un cast Marvel Rivals — motif sans Battle.net", () => {
  const released = match({ block: "CASTER_DISCORD_REQUIRED" });

  it("castReleaseReasonKey_discordBlock_ineligibleDiscord", () => {
    expect(castReleaseReasonKey(released)).toBe("INELIGIBLE_DISCORD");
  });

  it.each(["fr", "en"] as ("fr" | "en")[])("castReleasedNotice_%s_discordBlock_noBattlenet", (locale) => {
    const dm = formatCastReleasedNotice(released, URL, locale);
    expect(dm).not.toMatch(/Battle\.net/);
    expect(dm).toMatch(locale === "fr" ? /tag Discord n'est plus certifié/ : /Discord tag is no longer certified/);
    const push = castReleasedPush(released, locale).body;
    expect(push).not.toMatch(/Battle\.net/);
    expect(push).toMatch(/Discord/);
  });

  it.each(["fr", "en"] as ("fr" | "en")[])("castReleasedNotice_%s_identityBlock_saysBattlenet", (locale) => {
    const owBlock = match({ block: "CASTER_IDENTITY_REQUIRED" });
    expect(formatCastReleasedNotice(owBlock, URL, locale)).toMatch(/Battle\.net/);
    expect(castReleasedPush(owBlock, locale).body).toMatch(/Battle\.net/);
  });

  it("pushReasons_discordKey_presentInBothLanguages", () => {
    expect(frPush.castReleased.reason.INELIGIBLE_DISCORD).toEqual(expect.any(String));
    expect(enPush.castReleased.reason.INELIGIBLE_DISCORD).toEqual(expect.any(String));
  });
});
