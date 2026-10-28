import { describe, expect, it } from "@jest/globals";
import { streamChannelName, streamLinkText } from "@/lib/shared/live-streams";

describe("streamChannelName", () => {
  it("lit le nom de la chaîne Twitch ou Kick, et la poignée YouTube", () => {
    expect(streamChannelName("https://twitch.tv/bluegenji")).toBe("bluegenji");
    expect(streamChannelName("https://www.twitch.tv/Blue_Genji")).toBe("Blue_Genji");
    expect(streamChannelName("https://kick.com/blue-genji")).toBe("blue-genji");
    expect(streamChannelName("https://www.youtube.com/@bluegenji")).toBe("@bluegenji");
  });

  it("aux limites : 2 et 25 signes chez Twitch, 3 et 30 après l'arobase chez YouTube", () => {
    expect(streamChannelName("https://twitch.tv/ab")).toBe("ab");
    expect(streamChannelName("https://twitch.tv/a")).toBeNull();
    expect(streamChannelName(`https://twitch.tv/${"a".repeat(25)}`)).toBe("a".repeat(25));
    expect(streamChannelName(`https://twitch.tv/${"a".repeat(26)}`)).toBeNull();
    expect(streamChannelName("https://youtube.com/@abc")).toBe("@abc");
    expect(streamChannelName("https://youtube.com/@ab")).toBeNull();
    expect(streamChannelName(`https://youtube.com/@${"a".repeat(30)}`)).toBe(`@${"a".repeat(30)}`);
    expect(streamChannelName(`https://youtube.com/@${"a".repeat(31)}`)).toBeNull();
  });

  it("ne nomme rien pour une page du site, une vidéo ou un lien court", () => {
    for (const url of [
      "https://www.twitch.tv/videos/123456",
      "https://www.twitch.tv/directory",
      "https://www.twitch.tv/Settings",
      "https://twitch.tv/",
      "https://youtu.be/dQw4w9WgXcQ",
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      "https://www.youtube.com/channel/UC123",
    ]) {
      expect(streamChannelName(url)).toBeNull();
    }
  });

  it("refuse les signes hors du nom d'une chaîne, encodés compris", () => {
    expect(streamChannelName("https://twitch.tv/blue%20genji")).toBeNull();
    expect(streamChannelName("https://twitch.tv/%E2%80%AEevil")).toBeNull();
    expect(streamChannelName("https://twitch.tv/%")).toBeNull();
    expect(streamChannelName("https://youtube.com/@a%3Cb%3Ec")).toBeNull();
  });

  it("rien pour une plateforme inconnue, un lien vide ou invalide", () => {
    expect(streamChannelName("https://exemple.com/bluegenji")).toBeNull();
    expect(streamChannelName(null)).toBeNull();
    expect(streamChannelName(undefined)).toBeNull();
    expect(streamChannelName("")).toBeNull();
    expect(streamChannelName("pas une url")).toBeNull();
  });
});

describe("streamLinkText", () => {
  it("préfère la chaîne, puis la plateforme, puis le repli", () => {
    expect(streamLinkText("https://twitch.tv/bluegenji", "Chaîne")).toBe("bluegenji");
    expect(streamLinkText("https://www.twitch.tv/videos/1", "Chaîne")).toBe("Twitch");
    expect(streamLinkText("https://youtu.be/abc", "Chaîne")).toBe("YouTube");
    expect(streamLinkText("https://exemple.com/live", "Chaîne")).toBe("Chaîne");
    expect(streamLinkText(null, "Channel")).toBe("Channel");
  });
});
