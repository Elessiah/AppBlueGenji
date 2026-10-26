/**
 * Message privé d'une alerte au staff (rôle arbitre, direction de
 * l'association) — `docs/features/BOT_DM_LANGUAGE.md`.
 *
 * Le bot écrit ces alertes à des comptes Discord qu'il trouve lui-même (membres
 * du rôle arbitre, `OWNER_ID` / `PRESIDENT`) : le site ne sait pas qui les
 * recevra, donc pas dans quelle langue. Le message privé est donc **bilingue** :
 * la ligne française du canal de logs, telle quelle, puis l'anglais de la
 * notification push du même évènement (`push-messages.ts`, une seule rédaction
 * par langue), suivi du lien. Le canal de logs, lui, ne reçoit que le français
 * (`message` de l'appel) : les salons restent en français.
 *
 * Serveur seulement (il lit l'adresse du site).
 */
import { bilingualDm } from "@/lib/shared/dm-language";
import type { PushContent } from "@/lib/shared/push-notifications";
import { siteCanonicalBase } from "@/lib/server/site-url";

/**
 * @param frenchLine La ligne du canal de logs, déjà rédigée (noms neutralisés).
 * @param english Le push anglais du même évènement — ses noms d'équipe ou de
 *   tournoi passés par `discordInline` par l'appelant : il part sur Discord.
 * @returns Le message privé bilingue (français, puis anglais).
 */
export function staffAlertDm(frenchLine: string, english: PushContent): string {
  const link = `${siteCanonicalBase()}${english.url}`;
  return bilingualDm((locale) => (locale === "fr" ? frenchLine : `**${english.title}** — ${english.body} ${link}`));
}
