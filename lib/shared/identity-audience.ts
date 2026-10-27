/**
 * Les listes « qui le voit » (`identity-sharing.ts`) dans la langue d'une page.
 *
 * Chaque espace de messages qui les montre (`profile`, `login`, `players`)
 * porte la même forme sous `audience.*` ; ces deux fonctions les assemblent
 * depuis n'importe lequel d'entre eux. Le français de chaque espace égale les
 * listes du module pur, et l'anglais est le même d'un espace à l'autre (testé).
 */
import type { IdentityAudience } from "@/lib/shared/identity-sharing";

const DISCORD_ITEMS = ["admins", "referees", "match", "asCaster", "players"] as const;
const BATTLETAG_ITEMS = ["match", "asCaster", "asReferee", "launch"] as const;

export type DiscordAudienceKey = `audience.discord.${"title" | "footer" | (typeof DISCORD_ITEMS)[number]}`;
export type BattletagAudienceKey = `audience.battletag.${"title" | "footer" | (typeof BATTLETAG_ITEMS)[number]}`;

/** Qui voit un tag Discord certifié (`DISCORD_TAG_AUDIENCE`). */
export function discordAudienceLines(t: (key: DiscordAudienceKey) => string): IdentityAudience {
  return {
    title: t("audience.discord.title"),
    items: DISCORD_ITEMS.map((item) => t(`audience.discord.${item}`)),
    footer: t("audience.discord.footer"),
  };
}

/** Qui lit encore un BattleTag masqué (`HIDDEN_BATTLETAG_AUDIENCE`). */
export function hiddenBattletagAudienceLines(t: (key: BattletagAudienceKey) => string): IdentityAudience {
  return {
    title: t("audience.battletag.title"),
    items: BATTLETAG_ITEMS.map((item) => t(`audience.battletag.${item}`)),
    footer: t("audience.battletag.footer"),
  };
}
