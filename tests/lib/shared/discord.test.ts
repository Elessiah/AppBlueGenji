import { describe, expect, it } from "@jest/globals";
import {
  DISCORD_INVITE_CODE,
  DISCORD_INVITE_URL,
  parseDiscordCommunityStats,
  SUPERSEDED_DISCORD_INVITE_URLS,
} from "@/lib/shared/discord";

describe("invitation Discord", () => {
  it("compose l'URL à partir du code", () => {
    // Le compteur interroge le **code**, les boutons affichent l'**URL** : si
    // les deux cessaient d'être la même chose, le site annoncerait la
    // fréquentation d'un serveur vers lequel il ne mène plus.
    expect(DISCORD_INVITE_URL).toBe(`https://discord.gg/${DISCORD_INVITE_CODE}`);
  });

  it("ne porte qu'un code d'invitation, jamais une URL entière", () => {
    expect(DISCORD_INVITE_CODE).toMatch(/^[A-Za-z0-9-]+$/);
  });
});

describe("invitations périmées", () => {
  it("ne contient pas l'invitation en vigueur", () => {
    // Le rattrapage de `database.ts` remplace ces valeurs par l'actuelle : l'y
    // faire figurer rendrait l'instruction absurde, et surtout dirait qu'on
    // veut réécrire ce qui est déjà juste.
    expect(SUPERSEDED_DISCORD_INVITE_URLS).not.toContain(DISCORD_INVITE_URL);
  });

  it("recense les trois adresses qui ont servi avant elle", () => {
    expect(SUPERSEDED_DISCORD_INVITE_URLS).toEqual([
      "https://discord.gg/bluegenji",
      "https://discord.gg/VPGZ4eBfwN",
      "https://discord.gg/5kG9DDKx",
    ]);
  });
});

describe("parseDiscordCommunityStats", () => {
  it("lit les deux compteurs approximatifs", () => {
    expect(
      parseDiscordCommunityStats({
        code: DISCORD_INVITE_CODE,
        approximate_member_count: 1284,
        approximate_presence_count: 213,
      }),
    ).toEqual({ memberCount: 1284, onlineCount: 213 });
  });

  it("garde le total quand la présence manque", () => {
    // Le champ de présence est le plus fragile des deux ; son absence ne doit
    // pas coûter le chiffre qui intéresse le visiteur.
    expect(parseDiscordCommunityStats({ approximate_member_count: 42 })).toEqual({
      memberCount: 42,
      onlineCount: 0,
    });
  });

  it("tronque un compteur fractionnaire", () => {
    expect(parseDiscordCommunityStats({ approximate_member_count: 12.9 })?.memberCount).toBe(12);
  });

  it("accepte un serveur réellement vide", () => {
    // Zéro **dit** par Discord est une donnée ; zéro **inventé** par nous en
    // serait une autre. Seul le second est proscrit.
    expect(parseDiscordCommunityStats({ approximate_member_count: 0 })).toEqual({
      memberCount: 0,
      onlineCount: 0,
    });
  });

  it.each([
    ["réponse nulle", null],
    ["réponse absente", undefined],
    ["réponse scalaire", "1284"],
    ["compteur absent", { code: "X" }],
    ["compteur textuel", { approximate_member_count: "1284" }],
    ["compteur négatif", { approximate_member_count: -3 }],
    ["compteur non fini", { approximate_member_count: Number.POSITIVE_INFINITY }],
    ["compteur NaN", { approximate_member_count: Number.NaN }],
    ["erreur d'API", { message: "Unknown Invite", code: 10006 }],
  ])("rend null sur %s", (_label, payload) => {
    expect(parseDiscordCommunityStats(payload)).toBeNull();
  });

  it("ignore une présence illisible sans perdre le total", () => {
    expect(
      parseDiscordCommunityStats({
        approximate_member_count: 500,
        approximate_presence_count: "beaucoup",
      }),
    ).toEqual({ memberCount: 500, onlineCount: 0 });
  });
});
