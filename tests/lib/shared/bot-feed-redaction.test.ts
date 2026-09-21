import { describe, expect, it } from "@jest/globals";

import {
  REDACTED_DISCORD_ID,
  isDiscordSnowflake,
  redactFeedPayload,
  redactSnowflakes,
  redactSseChunk,
  redactSseLine,
} from "@/lib/shared/bot-feed-redaction";

const ID = "390973051367587850";

describe("isDiscordSnowflake", () => {
  it("reconnaît un identifiant de 17 à 20 chiffres", () => {
    expect(isDiscordSnowflake(ID)).toBe(true);
    expect(isDiscordSnowflake("12345678901234567")).toBe(true);
    expect(isDiscordSnowflake("12345678901234567890")).toBe(true);
  });

  it("refuse ce qui n'en est pas un", () => {
    expect(isDiscordSnowflake("1234567890123456")).toBe(false); // 16 chiffres
    expect(isDiscordSnowflake("123456789012345678901")).toBe(false); // 21
    expect(isDiscordSnowflake("")).toBe(false);
    expect(isDiscordSnowflake("lfs vers 6 salon(s)")).toBe(false);
    expect(isDiscordSnowflake(`a ${ID}`)).toBe(false);
  });

  it("tolère les espaces autour", () => {
    expect(isDiscordSnowflake(` ${ID} `)).toBe(true);
  });
});

describe("redactSnowflakes", () => {
  it("efface l'identifiant du message d'authentification", () => {
    expect(redactSnowflakes(`Code DM envoye a ${ID}`)).toBe(
      `Code DM envoye a ${REDACTED_DISCORD_ID}`,
    );
  });

  it("efface plusieurs identifiants dans la même phrase", () => {
    const out = redactSnowflakes(`${ID} a invite 812647086159036488`);
    expect(out).toBe(`${REDACTED_DISCORD_ID} a invite ${REDACTED_DISCORD_ID}`);
    expect(out).not.toMatch(/\d{17}/);
  });

  it("laisse intacts les nombres courts du flux", () => {
    expect(redactSnowflakes("lfs vers 6 salon(s)")).toBe("lfs vers 6 salon(s)");
    expect(redactSnowflakes("2026-09-21 08:21:14")).toBe("2026-09-21 08:21:14");
    // `Date.now()` : 13 chiffres, sous la borne.
    expect(redactSnowflakes(": heartbeat 1758441674000")).toBe(": heartbeat 1758441674000");
  });

  it("ne rogne pas un nombre plus long qu'un identifiant", () => {
    const long = "1".repeat(24);
    expect(redactSnowflakes(long)).toBe(long);
  });
});

describe("redactFeedPayload", () => {
  it("retire un champ qui n'est qu'un identifiant et nettoie le résumé", () => {
    const out = redactFeedPayload({
      id: 42,
      ts: "2026-09-21 08:21:14",
      type: "auth",
      source: null,
      target: ID,
      summary: `Code DM envoye a ${ID}`,
    }) as Record<string, unknown>;

    expect(out).toEqual({
      id: 42,
      ts: "2026-09-21 08:21:14",
      type: "auth",
      source: null,
      summary: `Code DM envoye a ${REDACTED_DISCORD_ID}`,
    });
    expect("target" in out).toBe(false);
  });

  it("couvre les champs qu'un évènement futur ajouterait", () => {
    const out = redactFeedPayload({ userId: ID, guildId: "1234567890123456789" });
    expect(out).toEqual({});
  });

  it("descend dans les objets et les tableaux imbriqués", () => {
    const out = redactFeedPayload({
      meta: { actor: ID, note: `via ${ID}` },
      cibles: [ID, `et ${ID}`],
    });
    expect(out).toEqual({
      meta: { note: `via ${REDACTED_DISCORD_ID}` },
      cibles: [REDACTED_DISCORD_ID, `et ${REDACTED_DISCORD_ID}`],
    });
  });

  it("laisse passer ce qui n'est pas une chaîne", () => {
    expect(redactFeedPayload(7)).toBe(7);
    expect(redactFeedPayload(null)).toBeNull();
    expect(redactFeedPayload(true)).toBe(true);
  });
});

describe("redactSseLine", () => {
  it("réécrit une ligne de données JSON", () => {
    const line = `data: ${JSON.stringify({ id: 9, target: ID, summary: `Code DM envoye a ${ID}` })}`;
    expect(JSON.parse(redactSseLine(line).slice("data: ".length))).toEqual({
      id: 9,
      summary: `Code DM envoye a ${REDACTED_DISCORD_ID}`,
    });
  });

  it("efface une charge utile qui n'est pas du JSON", () => {
    expect(redactSseLine(`data: brut ${ID}`)).toBe(`data: brut ${REDACTED_DISCORD_ID}`);
  });

  it("efface un JSON tronqué plutôt que de le laisser passer", () => {
    const out = redactSseLine(`data: {"target":"${ID}"`);
    expect(out).not.toContain(ID);
    expect(out).toContain(REDACTED_DISCORD_ID);
  });

  it("laisse la clé de reprise intacte", () => {
    // `Last-Event-ID` : la rogner casserait la reconnexion.
    expect(redactSseLine(`id: ${ID}`)).toBe(`id: ${ID}`);
    expect(redactSseLine("id: 128")).toBe("id: 128");
  });

  it("laisse les autres lignes du protocole inchangées", () => {
    expect(redactSseLine("event: feed")).toBe("event: feed");
    expect(redactSseLine("")).toBe("");
  });
});

describe("redactSseChunk", () => {
  it("préserve la structure du protocole", () => {
    const chunk = `id: 9\nevent: feed\ndata: {"target":"${ID}","summary":"Code DM envoye a ${ID}"}\n\n`;
    const out = redactSseChunk(chunk);
    expect(out).not.toContain(ID);
    expect(out.startsWith("id: 9\nevent: feed\ndata: ")).toBe(true);
    expect(out.endsWith("\n\n")).toBe(true);
  });
});
