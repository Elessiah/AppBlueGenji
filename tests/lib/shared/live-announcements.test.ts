import { describe, expect, it } from "@jest/globals";
import {
  LIVE_ANNOUNCEMENT_MAX_LENGTH,
  formatLiveAnnouncementGroup,
  liveAnnouncementUrl,
} from "@/lib/shared/live-announcements";
import type { ParticipantType } from "@/lib/shared/participants";

/** L'annonce d'un seul match. */
function formatLiveAnnouncement(match: {
  tournamentName: string;
  participantType: ParticipantType;
  team1Name: string;
  team2Name: string;
}): string {
  return formatLiveAnnouncementGroup({
    tournamentName: match.tournamentName,
    participantType: match.participantType,
    pairings: [{ team1Name: match.team1Name, team2Name: match.team2Name }],
  });
}

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

  it("une équipe nommée d'après une adresse ne devient ni lien ni aperçu sous l'@everyone", () => {
    const text = formatLiveAnnouncement({
      tournamentName: "Coupe www.piege.example",
      participantType: "TEAM",
      team1Name: "https://fauxnitro.gg",
      team2Name: "fauxnitro.gg/cadeau",
    });
    // Le seul lien de l'annonce est celui que le bot ajoute sur sa ligne.
    expect(text).not.toMatch(/https?:\/\//);
    expect(text).not.toMatch(/\.[a-z]/);
    expect(text.replace(/\u200B/g, "")).toBe(
      "🔴 En direct : https://fauxnitro.gg contre fauxnitro.gg/cadeau — Coupe www.piege.example",
    );
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

  it("énumère les affiches d'une même diffusion, une par ligne, le tournoi en tête", () => {
    expect(formatLiveAnnouncementGroup({ tournamentName: "Coupe d'hiver", participantType: "TEAM", pairings })).toBe(
      "🔴 En direct — Coupe d'hiver :\n• Renards contre Nova\n• Orques contre Lynx\n• Givre contre Ombre",
    );
  });

  it("reste lisible quand un nom d'équipe contient « et », une virgule ou un saut de ligne", () => {
    const text = formatLiveAnnouncementGroup({
      tournamentName: "Coupe",
      participantType: "TEAM",
      pairings: [
        { team1Name: "Ordre et Chaos", team2Name: "Lumière" },
        { team1Name: "Nord,\nSud", team2Name: "Est" },
      ],
    });
    expect(text.split("\n")).toEqual(["🔴 En direct — Coupe :", "• Ordre et Chaos contre Lumière", "• Nord, Sud contre Est"]);
  });

  it("une longue ronde compte le reste au lieu d'être coupée par le bot", () => {
    const many = Array.from({ length: 40 }, (_, i) => ({ team1Name: `${"A".repeat(58)}${i}`, team2Name: `${"B".repeat(58)}${i}` }));
    const text = formatLiveAnnouncementGroup({ tournamentName: "T".repeat(120), participantType: "TEAM", pairings: many });
    expect(text.length).toBeLessThanOrEqual(LIVE_ANNOUNCEMENT_MAX_LENGTH);
    expect(text.startsWith(`🔴 En direct — ${"T".repeat(120)} :`)).toBe(true);
    const lines = text.split("\n");
    const shown = lines.length - 2;
    expect(lines[lines.length - 1]).toBe(`• et ${40 - shown} autres matchs`);
    expect(lines.slice(1, -1).every((line) => /^• A+\d+ contre B+\d+$/.test(line))).toBe(true);
  });

  it("ne cache aucune affiche quand toute la liste tient", () => {
    // Taillée pour finir pile à la limite : aucune place gardée pour « et N autres ».
    const header = "🔴 En direct — T :";
    const line = (name: string) => `\n• ${name} contre ${name}`;
    const pairs: { team1Name: string; team2Name: string }[] = [];
    let length = header.length;
    while (length + line("x".repeat(60)).length <= LIVE_ANNOUNCEMENT_MAX_LENGTH - 40) {
      pairs.push({ team1Name: "x".repeat(60), team2Name: "x".repeat(60) });
      length += line("x".repeat(60)).length;
    }
    const filler = Math.floor((LIVE_ANNOUNCEMENT_MAX_LENGTH - length - "\n•  contre ".length) / 2);
    pairs.push({ team1Name: "y".repeat(filler), team2Name: "y".repeat(filler) });
    const text = formatLiveAnnouncementGroup({ tournamentName: "T", participantType: "TEAM", pairings: pairs });
    expect(text.length).toBeLessThanOrEqual(LIVE_ANNOUNCEMENT_MAX_LENGTH);
    expect(text).not.toContain("autre");
    expect(text.split("\n")).toHaveLength(pairs.length + 1);
  });

  it("au singulier : « et 1 autre match », et le compte juste", () => {
    const pairs = Array.from({ length: 3 }, () => ({ team1Name: "z".repeat(60), team2Name: "z".repeat(60) }));
    pairs.push({ team1Name: "w".repeat(700), team2Name: "w".repeat(700) });
    const text = formatLiveAnnouncementGroup({ tournamentName: "T", participantType: "TEAM", pairings: pairs });
    expect(text.split("\n")).toEqual([
      "🔴 En direct — T :",
      ...Array.from({ length: 3 }, () => `• ${"z".repeat(60)} contre ${"z".repeat(60)}`),
      "• et 1 autre match",
    ]);
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

describe("liveAnnouncementUrl — redirections", () => {
  it("refuse une page de redirection ou une adresse glissée dans le lien, même sur un hôte autorisé", () => {
    for (const url of [
      "https://www.youtube.com/redirect?q=https://piege.example",
      "https://www.youtube.com/redirect?q=https%3A%2F%2Fpiege.example",
      "https://www.youtube.com/attribution_link?u=/watch%3Fv%3Dabc",
      "https://www.twitch.tv/bluegenji?r=https://piege.example",
      // Page de redirection encodée ou derrière une barre doublée.
      "https://www.youtube.com/%72edirect?q=piege.example",
      "https://www.youtube.com//redirect?q=piege.example",
      // Adresse sans schéma, à barres inverses, ou encodée deux fois.
      "https://www.twitch.tv/bluegenji?next=https:%5C%5Cpiege.example",
      "https://www.twitch.tv/bluegenji?continue=%2F%2Fpiege.example",
      "https://www.twitch.tv/bluegenji?next=https%253A%252F%252Fpiege.example",
      // Tabulation ou saut de ligne entre deux barres : retirés par le navigateur.
      "https://www.youtube.com/logout?continue=/%09/piege.example",
      "https://www.youtube.com/logout?continue=/%0A/piege.example",
    ]) {
      expect(liveAnnouncementUrl(url, null)).toBeNull();
    }
  });

  it("se replie sur la chaîne officielle quand le lien du match est refusé", () => {
    expect(
      liveAnnouncementUrl("https://www.youtube.com/redirect?q=https://piege.example", "https://www.twitch.tv/bluegenji"),
    ).toBe("https://www.twitch.tv/bluegenji");
  });

  it("garde une diffusion ordinaire, requête comprise", () => {
    expect(liveAnnouncementUrl("https://www.youtube.com/watch?v=abc&t=60", null)).toBe("https://www.youtube.com/watch?v=abc&t=60");
    expect(liveAnnouncementUrl("https://www.twitch.tv/videos/123?t=1h2m3s", null)).toBe("https://www.twitch.tv/videos/123?t=1h2m3s");
    expect(liveAnnouncementUrl("https://www.youtube.com/@BlueGenji/live", null)).toBe("https://www.youtube.com/@BlueGenji/live");
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
