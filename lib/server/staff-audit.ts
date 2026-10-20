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
 * `auditLine`, quand il est donné, remplace la ligne côté pm2 seulement : un
 * geste dont le détail (manche, issue) n'a pas sa place sur Discord y reste
 * vague, et le détail ne vit que dans pm2.
 *
 * L'audit est écrit **avant** l'envoi et sans l'attendre : le bot est optionnel,
 * la trace de modération ne l'est pas. L'envoi Discord reste au meilleur effort.
 */
export function publishStaffAction(discordLine: string, actor: StaffActor, auditLine: string = discordLine): void {
  console.info(staffAuditLine(auditLine, actor));
  void sendBotLog(discordLine).catch(() => undefined);
}

/**
 * La moitié pm2 de {@link publishStaffAction}, seule : pour un geste dont la
 * ligne détaillée ne peut s'écrire qu'après une lecture (noms à relire). Une
 * trace courte part **avant** cette lecture — un arrêt du serveur entre le
 * commit et elle ne doit pas laisser un geste sans auteur ; la ligne détaillée
 * suit par `publishStaffAction`, comme pour tout geste.
 */
export function auditStaffAction(text: string, actor: StaffActor): void {
  console.info(staffAuditLine(text, actor));
}
