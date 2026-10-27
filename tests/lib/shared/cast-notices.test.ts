import { describe, expect, it } from "@jest/globals";
import { formatCastChangeLog, type CastLogChange } from "@/lib/shared/bot-logs";
import { formatCastReleasedNotice, type CastReleasedMatch, type CastReleaseReason } from "@/lib/shared/cast-notices";
import { castReleasedPush } from "@/lib/shared/push-messages";
import { DM_MAX_LENGTH } from "@/lib/shared/dm-language";
import { PUSH_BODY_MAX, PUSH_TOPICS } from "@/lib/shared/push-notifications";
import enPush from "@/messages/en/push.json";

const REASONS: CastReleaseReason[] = ["STAFF", "REPLACED", "INELIGIBLE", "JOINED_TEAM"];
const CHANGES: CastLogChange[] = ["CLAIMED", "REPLACED", "RELEASED", "RELEASED_BY_STAFF", "INELIGIBLE", "JOINED_TEAM"];

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
    reason: "STAFF",
    ...overrides,
  };
}

const URL = "https://site.test/tournois/7#match-42";

describe("formatCastChangeLog", () => {
  const base = {
    tournament: { id: 7, name: "Coupe d'hiver" },
    matchId: 42,
    bracket: "UPPER",
    roundNumber: 2,
    team1: { name: "Renards", participantType: "TEAM" as const },
    team2: { name: "Nova", participantType: "TEAM" as const },
  };

  it("écrit une ligne par changement, entame commune, sans personne nommée", () => {
    expect(formatCastChangeLog({ ...base, change: "CLAIMED" })).toBe(
      "🎙️ Cast réservé — « Coupe d'hiver » (#7) : Manche 2 — Renards vs Nova (#42), un caster s'inscrit sur le match.",
    );
    const lines = CHANGES.map((change) => formatCastChangeLog({ ...base, change }));
    expect(new Set(lines).size).toBe(CHANGES.length);
    for (const line of lines) {
      expect(line).toMatch(/^🎙️ Cast /);
      expect(line).toContain("(#42)");
      expect(line).not.toContain("\n");
    }
    expect(formatCastChangeLog({ ...base, change: "RELEASED_BY_STAFF" })).toContain("par le staff");
  });

  it("tournoi individuel : « un joueur » ; place vide : « TBD »", () => {
    const line = formatCastChangeLog({
      ...base,
      team1: { name: "PseudoA", participantType: "SOLO" },
      team2: null,
      change: "INELIGIBLE",
    });
    expect(line).toContain("un joueur vs TBD");
    expect(line).not.toContain("PseudoA");
  });

  it("neutralise un nom d'équipe ou de tournoi piégé", () => {
    const line = formatCastChangeLog({
      ...base,
      tournament: { id: 7, name: "@everyone" },
      team1: { name: "<@123>", participantType: "TEAM" },
      change: "CLAIMED",
    });
    expect(line).not.toContain("@everyone");
    expect(line).not.toContain("<@123>");
  });
});

describe("formatCastReleasedNotice", () => {
  it.each(REASONS)("donne le motif %s en français et en anglais", (reason) => {
    const fr = formatCastReleasedNotice(match({ reason }), URL, "fr");
    const en = formatCastReleasedNotice(match({ reason }), URL, "en");
    expect(fr).toMatch(/^🎙️ BlueGenji — Ton inscription comme caster du match « Renards » contre « Nova » \(/);
    expect(fr).toContain(`Fiche du match : ${URL}`);
    expect(en).toMatch(/^🎙️ BlueGenji — Your caster registration for the match “Renards” vs “Nova” \(/);
    expect(en).toContain("Match page: https://site.test/en/tournois/7#match-42");
    expect(fr.length).toBeLessThanOrEqual(DM_MAX_LENGTH);
    expect(en.length).toBeLessThanOrEqual(DM_MAX_LENGTH);
  });

  it("un motif distinct par cas", () => {
    const texts = REASONS.map((reason) => formatCastReleasedNotice(match({ reason }), URL, "fr"));
    expect(new Set(texts).size).toBe(REASONS.length);
    expect(texts[0]).toContain("décision du staff");
    expect(texts[3]).toContain("ton équipe joue désormais ce match");
  });

  it("ne nomme aucun joueur en tournoi individuel", () => {
    const solo = match({ solo: true, team1Name: "PseudoA", team2Name: "PseudoB" });
    const fr = formatCastReleasedNotice(solo, URL, "fr");
    const en = formatCastReleasedNotice(solo, URL, "en");
    expect(fr).toContain("comme caster d'un match (");
    expect(en).toContain("for a match (");
    expect(`${fr}${en}`).not.toMatch(/Pseudo[AB]/);
  });

  it("neutralise les noms piégés", () => {
    const text = formatCastReleasedNotice(match({ team1Name: "@everyone", tournamentName: "<@1>" }), URL, "fr");
    expect(text).not.toContain("@everyone");
    expect(text).not.toContain("<@1>");
  });
});

describe("castReleasedPush", () => {
  it.each(REASONS)("rédige le motif %s dans les deux langues", (reason) => {
    const fr = castReleasedPush(match({ reason }), "fr");
    const en = castReleasedPush(match({ reason }), "en");
    expect(fr.title).toBe("Cast retiré");
    expect(en.title).toBe("Cast removed");
    expect(fr.body).toContain("Renards contre Nova · Coupe d'hiver, Manche 2");
    expect(en.body).toContain("Renards vs Nova · Coupe d'hiver");
    expect(fr.body.length).toBeLessThanOrEqual(PUSH_BODY_MAX);
    expect(fr.url).toBe("/tournois/7#match-42");
    expect(en.url).toBe("/en/tournois/7#match-42");
    expect(fr.tag).toBe("rencontre-42-cast");
  });

  it("dit « Un match » en tournoi individuel, « TBD » pour une place vide", () => {
    expect(castReleasedPush(match({ solo: true, team1Name: "PseudoA" }), "fr").body).toContain("Un match ·");
    expect(castReleasedPush(match({ solo: true }), "en").body).toContain("A match ·");
    expect(castReleasedPush(match({ team2Name: null }), "fr").body).toContain("Renards contre TBD");
  });
});

describe("sujet CAST_RELEASED", () => {
  it("réservé à la permission de diffusion, libellé dans les deux langues", () => {
    expect(PUSH_TOPICS.CAST_RELEASED.audience).toBe("live");
    expect(enPush.topics.CAST_RELEASED.label).toBe("Cast removed");
  });
});
