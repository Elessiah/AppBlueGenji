/**
 * Textes de `/classement` (`messages/<langue>/ranking.json`) — lot 4 de la
 * traduction, `docs/features/I18N.md` § Classement.
 *
 * Même formateur que la coquille et l'accueil (`scoped-text.ts`), **sans**
 * `next-intl` dans le navigateur. La page et le tableau sont des composants
 * serveur (`messagesFor(locale).ranking`) ; seul « Afficher
 * plus » est client, et ne reçoit **que** l'espace `more`, en prop, dans la
 * langue de la page : aucun dictionnaire n'est inclus dans le paquet.
 */
import type frRanking from "@/messages/fr/ranking.json";
import type { Locale } from "@/lib/shared/locales";
import { scopedText, type Leaves, type ScopedText } from "@/lib/shared/scoped-text";

export type RankingMessages = typeof frRanking;
export type RankingText = ScopedText<Leaves<RankingMessages>>;

/** Ce que lit le composant client « Afficher plus » — rien d'autre ne voyage. */
export type RankingMoreMessages = RankingMessages["more"];
export type RankingMoreText = ScopedText<Leaves<RankingMoreMessages>>;

export function rankingText(locale: Locale, messages: RankingMessages): RankingText {
  return scopedText(locale, messages);
}

export function rankingMoreText(locale: Locale, messages: RankingMoreMessages): RankingMoreText {
  return scopedText(locale, messages);
}
