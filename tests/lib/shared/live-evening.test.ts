import { describe, expect, it } from "@jest/globals";
import {
  LIVE_ANNOUNCEMENT_MAX_LENGTH,
  LIVE_EVENING_MAX_LINKS,
  LIVE_EVENING_WINDOW_HOURS,
  OFFICIAL_LIVE_CHANNEL_URL,
  formatLiveEvening,
  liveMentionTarget,
  parisClock,
  type LiveEveningStream,
} from "@/lib/shared/live-announcements";

/** Annonce de soirée : public notifié, heures de Paris, blocs, liens et coupe propre. */

const AT_21 = Date.parse("2026-10-14T19:00:00Z");

function stream(patch: Partial<LiveEveningStream> = {}): LiveEveningStream {
  return {
    startsAt: AT_21,
    live: true,
    tournamentName: "Coupe d'hiver",
    team1Name: "Renards",
    team2Name: "Nova",
    url: "https://www.twitch.tv/caster",
    ...patch,
  };
}

describe("liveMentionTarget", () => {
  it("@everyone pour la seule chaîne officielle, sans casse, www, m. ni barre finale", () => {
    expect(OFFICIAL_LIVE_CHANNEL_URL).toBe("https://www.twitch.tv/bluegenjiesport");
    for (const url of [
      OFFICIAL_LIVE_CHANNEL_URL,
      "https://twitch.tv/BlueGenjiEsport",
      "https://m.twitch.tv/bluegenjiesport/",
      "https://www.twitch.tv/bluegenjiesport?ref=x",
    ]) {
      expect(liveMentionTarget(url)).toBe("everyone");
    }
  });

  it("le rôle StreamViewer pour toute autre chaîne, même voisine", () => {
    for (const url of [
      "https://www.twitch.tv/caster",
      "https://www.twitch.tv/bluegenjiesport2",
      "https://www.twitch.tv/bluegenjiesport/videos",
      "https://kick.com/bluegenjiesport",
      "https://www.youtube.com/@bluegenjiesport",
      "pas une adresse",
    ]) {
      expect(liveMentionTarget(url)).toBe("stream-viewer");
    }
  });
});

describe("parisClock", () => {
  it("écrit l'heure de Paris sur 24 h, heure d'été et d'hiver", () => {
    expect(parisClock(AT_21)).toBe("21:00");
    expect(parisClock(Date.parse("2026-12-01T08:05:00Z"))).toBe("09:05");
    expect(parisClock(Date.parse("2026-10-14T22:30:00Z"))).toBe("00:30");
  });
});

describe("formatLiveEvening", () => {
  it("un bloc par match : heure en gras, « En direct », affiche et tournoi, lien seul sur sa ligne", () => {
    const { text, urls } = formatLiveEvening([stream()]);
    expect(text).toBe("🔴 **Les lives de la soirée**\n\n**21:00** · En direct\nRenards contre Nova — Coupe d'hiver\n{{lien:1}}");
    expect(urls).toEqual(["https://www.twitch.tv/caster"]);
  });

  it("les directs d'abord, puis les matchs à venir par heure, séparés par une ligne vide", () => {
    const { text, urls } = formatLiveEvening([
      stream({ startsAt: AT_21 + 2 * 3_600_000, live: false, team1Name: "C", team2Name: "D", url: "https://kick.com/b" }),
      stream({ startsAt: AT_21 + 3_600_000, live: false, team1Name: "E", team2Name: "F" }),
      stream({ startsAt: AT_21 + 30 * 60_000, team1Name: "A", team2Name: "B" }),
    ]);
    expect(text).toBe(
      "🔴 **Les lives de la soirée**" +
        "\n\n**21:30** · En direct\nA contre B — Coupe d'hiver\n{{lien:1}}" +
        "\n\n**22:00**\nE contre F — Coupe d'hiver\n{{lien:1}}" +
        "\n\n**23:00**\nC contre D — Coupe d'hiver\n{{lien:2}}",
    );
    expect(urls).toEqual(["https://www.twitch.tv/caster", "https://kick.com/b"]);
  });

  it("neutralise mentions, balisage et faux jetons de lien dans les noms", () => {
    const { text } = formatLiveEvening([
      stream({ team1Name: "@everyone", team2Name: "[x](https://piege.example) {{lien:2}}", tournamentName: "**Open** <@&1>" }),
    ]);
    expect(text).not.toMatch(/@everyone|\]\(https:|<@&|\{\{lien:2\}\}/);
    expect(text.match(/\{\{lien:\d+\}\}/g)).toEqual(["{{lien:1}}"]);
  });

  it("« un joueur » sans nom publiable", () => {
    expect(formatLiveEvening([stream({ team1Name: null })]).text).toContain("\nun joueur contre Nova — ");
  });

  it("trop long : s'arrête à la fin d'un bloc, liens comptés en entier, et compte le reste", () => {
    const longUrl = `https://www.twitch.tv/${"c".repeat(200)}`;
    const streams = Array.from({ length: 30 }, (_, i) =>
      stream({ startsAt: AT_21 + i * 60_000, team1Name: `Equipe${i}`, url: i % 2 ? longUrl : "https://kick.com/b" }),
    );
    const { text, urls } = formatLiveEvening(streams);
    const filled = text.replace(/\{\{lien:(\d+)\}\}/g, (_t, n: string) => urls[Number(n) - 1]);
    expect(filled.length).toBeLessThanOrEqual(LIVE_ANNOUNCEMENT_MAX_LENGTH);
    const shown = (text.match(/\{\{lien:/g) ?? []).length;
    expect(text.endsWith(`\n\n… et ${30 - shown} autres matchs ce soir`)).toBe(true);
    expect(text).toMatch(/\{\{lien:\d+\}\}\n\n… et/);
  });

  it("au plus dix liens distincts : les matchs d'une onzième chaîne sont comptés", () => {
    const streams = Array.from({ length: LIVE_EVENING_MAX_LINKS + 2 }, (_, i) =>
      stream({ startsAt: AT_21 + i * 60_000, team1Name: `E${i}`, url: `https://kick.com/c${i}` }),
    );
    const { text, urls } = formatLiveEvening(streams);
    expect(urls).toHaveLength(LIVE_EVENING_MAX_LINKS);
    expect(text.endsWith("\n\n… et 2 autres matchs ce soir")).toBe(true);
  });

  it("une soirée dure quatre heures", () => {
    expect(LIVE_EVENING_WINDOW_HOURS).toBe(4);
  });
});
