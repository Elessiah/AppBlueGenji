import { describe, expect, it } from "@jest/globals";
import { BOT_CLIENT_NAMESPACES, botClientMessages, botClientText } from "@/lib/shared/bot-client-text";
import { messagesFor } from "@/lib/server/i18n-messages";
import { readSource } from "../../helpers/read-source";

/**
 * Le paquet navigateur de `/bot` ne doit porter que trois espaces du français
 * (`strip`, `status`, `feed`), pas tout `messages/fr/bot.json` : les modules
 * client passent par `bot-client-text.ts`, qui lit le JSON propriété par
 * propriété.
 */
describe("bot-client-text — ce que le navigateur embarque", () => {
  it("les modules client n'importent pas le module complet", () => {
    for (const path of ["components/i18n/bot-text.tsx", "lib/shared/bot-status-summary.ts"]) {
      const source = readSource(path);
      expect(source).toContain('from "@/lib/shared/bot-client-text"');
      expect(source).not.toContain('from "@/lib/shared/bot-text"');
    }
  });

  it("ne lit le JSON français que par ses trois espaces", () => {
    const source = readSource("lib/shared/bot-client-text.ts");
    const uses = source.match(/\bfrBot\b(\.\w+)?/g) ?? [];
    // L'import, le `typeof` du type, puis une lecture par espace.
    expect(uses.filter((use) => use.includes("."))).toEqual(BOT_CLIENT_NAMESPACES.map((ns) => `frBot.${ns}`));
  });

  it("ne garde que les trois espaces, quelle que soit la charge", () => {
    const picked = botClientMessages(messagesFor("en").bot);
    expect(Object.keys(picked).sort((a, b) => a.localeCompare(b))).toEqual([...BOT_CLIENT_NAMESPACES].sort((a, b) => a.localeCompare(b)));
    expect(picked.feed).toBe(messagesFor("en").bot.feed);
  });

  it("parle français par défaut, anglais avec les messages anglais", () => {
    expect(botClientText().t("feed.title")).toBe(messagesFor("fr").bot.feed.title);
    expect(botClientText("en", botClientMessages(messagesFor("en").bot)).t("feed.title")).toBe("Real-time feed");
  });
});
