/**
 * Textes des pages `/bot` et `/bot/docs`, espace de messages `bot` — lot 5a
 * (`docs/features/I18N.md` § Bot).
 *
 * Même mécanique que la connexion (`login-text.ts`) : **pas** de `next-intl`
 * dans le navigateur. Les composants serveur reçoivent `botText(locale,
 * messagesFor(locale).bot)` ; les deux composants client (bande d'état, flux
 * temps réel) ne lisent que {@link BOT_CLIENT_NAMESPACES}, dont le français est
 * inclus dans le paquet (il remplace les chaînes écrites en dur) et l'anglais
 * passé par la page sous `/en` seulement.
 *
 * Hors fournisseur et sans `locale` — tests, écran rendu ailleurs —, tout reste
 * en français : le rendu de `/bot` est inchangé.
 */
import frBot from "@/messages/fr/bot.json";
import { DEFAULT_LOCALE, type Locale } from "@/lib/shared/locales";
import { scopedText, type Leaves, type ScopedText } from "@/lib/shared/scoped-text";

export type BotMessages = typeof frBot;
export type BotKey = Leaves<BotMessages>;
export type BotText = ScopedText<BotKey>;

export const FR_BOT_MESSAGES: BotMessages = frBot;

/** Formateur des pages du bot ; le français du paquet par défaut. */
export function botText(locale: Locale = DEFAULT_LOCALE, messages: BotMessages = FR_BOT_MESSAGES): BotText {
  return scopedText(locale, messages);
}

/** Français, construit une fois : rendu par défaut des composants sans `text`. */
export const FR_BOT_TEXT: BotText = botText(DEFAULT_LOCALE);

/** Les seuls espaces que lisent les composants client de `/bot`. */
export const BOT_CLIENT_NAMESPACES = ["strip", "status", "feed"] as const;
export type BotClientNamespace = (typeof BOT_CLIENT_NAMESPACES)[number];
export type BotClientMessages = Pick<BotMessages, BotClientNamespace>;
export type BotClientText = ScopedText<Leaves<BotClientMessages>>;

/** Ce qui voyage vers le navigateur sous `/en` : trois espaces, pas le registre des permissions. */
export function botClientMessages(messages: BotMessages): BotClientMessages {
  const picked = {} as Record<BotClientNamespace, unknown>;
  for (const namespace of BOT_CLIENT_NAMESPACES) picked[namespace] = messages[namespace];
  return picked as BotClientMessages;
}

export function botClientText(locale: Locale = DEFAULT_LOCALE, messages: BotClientMessages = FR_BOT_MESSAGES): BotClientText {
  return scopedText(locale, messages);
}
