import { describe, expect, it } from "@jest/globals";
import {
  formatLiveAnnouncement,
  formatLiveAnnouncementGroup,
  liveAnnouncementUrl,
} from "@/lib/shared/live-announcements";

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

describe("formatLiveAnnouncementGroup", () => {
  const pairings = [
    { team1Name: "Renards", team2Name: "Nova" },
    { team1Name: "Orques", team2Name: "Lynx" },
    { team1Name: "Givre", team2Name: "Ombre" },
  ];

  it("énumère les affiches d'une même diffusion en une ligne", () => {
    expect(
      formatLiveAnnouncementGroup({ tournamentName: "Coupe d'hiver", participantType: "TEAM", pairings: pairings.slice(0, 2) }),
    ).toBe("🔴 En direct : Renards contre Nova et Orques contre Lynx — Coupe d'hiver");
    expect(formatLiveAnnouncementGroup({ tournamentName: "Coupe d'hiver", participantType: "TEAM", pairings })).toBe(
      "🔴 En direct : Renards contre Nova, Orques contre Lynx et Givre contre Ombre — Coupe d'hiver",
    );
  });

  it("compte les matchs d'un tournoi individuel au lieu d'aligner des « un joueur »", () => {
    const text = formatLiveAnnouncementGroup({ tournamentName: "Solo Cup", participantType: "SOLO", pairings });
    expect(text).toBe("🔴 En direct : 3 matchs — Solo Cup");
    expect(text).not.toMatch(/Renards|Nova/);
  });

  it("une seule affiche : le texte d'un match", () => {
    expect(
      formatLiveAnnouncementGroup({ tournamentName: "Solo Cup", participantType: "SOLO", pairings: pairings.slice(0, 1) }),
    ).toBe("🔴 En direct : un joueur contre un joueur — Solo Cup");
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
