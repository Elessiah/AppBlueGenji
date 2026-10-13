import { describe, expect, it } from "@jest/globals";
import { formatLiveAnnouncement, liveAnnouncementUrl } from "@/lib/shared/live-announcements";

describe("formatLiveAnnouncement", () => {
  it("nomme les deux équipes et le tournoi", () => {
    expect(
      formatLiveAnnouncement({ tournamentName: "Coupe d'hiver", participantType: "TEAM", team1Name: "Renards", team2Name: "Nova" }),
    ).toBe("🔴 En direct : Renards contre Nova — Coupe d'hiver");
  });

  it("neutralise mentions et balisage dans les noms saisis", () => {
    const text = formatLiveAnnouncement({
      tournamentName: "Open **gras**\n@here",
      participantType: "TEAM",
      team1Name: "@everyone",
      team2Name: "<@&123>",
    });
    // Une seule mention notifie, celle que le bot ajoute en tête.
    expect(text).not.toMatch(/@everyone|@here/);
    expect(text).toContain("\\<@\u200B&123\\>");
    expect(text).not.toContain("\n");
    expect(text).toContain("\\*\\*gras\\*\\*");
  });

  it("ne nomme jamais un joueur : une entrée individuelle s'écrit « un joueur »", () => {
    const text = formatLiveAnnouncement({
      tournamentName: "Solo Cup",
      participantType: "SOLO",
      team1Name: "PseudoA",
      team2Name: "PseudoB",
    });
    expect(text).toBe("🔴 En direct : un joueur contre un joueur — Solo Cup");
    expect(text).not.toMatch(/Pseudo/);
  });
});

describe("liveAnnouncementUrl", () => {
  it("préfère la diffusion du match", () => {
    expect(liveAnnouncementUrl("https://twitch.tv/caster", "https://twitch.tv/bluegenji")).toBe("https://twitch.tv/caster");
  });

  it("se replie sur la chaîne officielle du tournoi", () => {
    expect(liveAnnouncementUrl(null, "twitch.tv/bluegenji")).toBe("https://twitch.tv/bluegenji");
  });

  it("revalide chaque lien par la liste blanche", () => {
    expect(liveAnnouncementUrl("https://evil.example/x", "https://kick.com/bg")).toBe("https://kick.com/bg");
    expect(liveAnnouncementUrl("http://twitch.tv/bg", null)).toBe("https://twitch.tv/bg");
    expect(liveAnnouncementUrl("https://user:pw@twitch.tv/bg", null)).toBeNull();
    expect(liveAnnouncementUrl("javascript:alert(1)", "https://twitch.tv.exemple.com")).toBeNull();
  });

  it("rend null sans aucun lien", () => {
    expect(liveAnnouncementUrl(null, null)).toBeNull();
    expect(liveAnnouncementUrl("", "  ")).toBeNull();
  });
});
