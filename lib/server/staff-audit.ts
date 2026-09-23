import { sendBotLog } from "@/lib/server/bot-integration";
import { staffAuditLine, type StaffActor } from "@/lib/shared/log-privacy";

/**
 * Publie le geste d'un membre du staff : anonyme sur Discord, nominatif dans pm2.
 *
 * La ligne Discord dit « par le staff » (`lib/shared/log-privacy.ts`) ; la même
 * ligne, avec l'auteur, part sur la sortie standard du serveur, que pm2 range
 * dans ses journaux — c'est là que la modération retrouve qui a fait quoi
 * (`pm2 logs bluegenji | grep staff-audit`).
 *
 * L'audit est écrit **avant** l'envoi et sans l'attendre : le bot est optionnel,
 * la trace de modération ne l'est pas. L'envoi Discord reste au meilleur effort.
 */
export function publishStaffAction(discordLine: string, actor: StaffActor): void {
  console.info(staffAuditLine(discordLine, actor));
  void sendBotLog(discordLine).catch(() => undefined);
}
