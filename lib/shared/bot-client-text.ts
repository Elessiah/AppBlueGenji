/**
 * Textes des deux composants client de `/bot` (bande d'état, flux temps réel)
 * — module à part de `bot-text.ts` pour que le paquet navigateur n'embarque
 * que trois espaces du français, pas tout `messages/fr/bot.json` (registre des
 * permissions, sections de la doc…) : les propriétés du JSON sont lues une à
 * une, ce qui laisse le bundler écarter les autres.
 */
import frBot from "@/messages/fr/bot.json";
import { DEFAULT_LOCALE, type Locale } from "@/lib/shared/locales";
import { scopedText, type Leaves, type ScopedText } from "@/lib/shared/scoped-text";

type FrBotMessages = typeof frBot;

/** Les seuls espaces que lisent les composants client de `/bot`. */
export const BOT_CLIENT_NAMESPACES = ["strip", "status", "feed"] as const;
export type BotClientNamespace = (typeof BOT_CLIENT_NAMESPACES)[number];
export type BotClientMessages = Pick<FrBotMessages, BotClientNamespace>;
export type BotClientText = ScopedText<Leaves<BotClientMessages>>;

const FR_BOT_CLIENT_MESSAGES: BotClientMessages = {
  strip: frBot.strip,
  status: frBot.status,
  feed: frBot.feed,
};

/** Ce qui voyage vers le navigateur sous `/en` : trois espaces, pas le registre des permissions. */
export function botClientMessages(messages: BotClientMessages): BotClientMessages {
  return { strip: messages.strip, status: messages.status, feed: messages.feed };
}

export function botClientText(
  locale: Locale = DEFAULT_LOCALE,
  messages: BotClientMessages = FR_BOT_CLIENT_MESSAGES,
): BotClientText {
  return scopedText(locale, messages);
}
