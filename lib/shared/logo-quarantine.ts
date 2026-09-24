/**
 * Quarantaine des logos d'équipe signalés — module pur.
 *
 * Retirer tout de suite un logo signalé pour droit d'auteur, c'est parfois
 * retirer à tort le logo d'une équipe qui en détient les droits. Le panneau
 * propose donc de le **masquer** : le fichier quitte ce que le site sert (il
 * n'est plus en ligne, ce qui éteint la responsabilité d'hébergeur), mais il est
 * gardé à part le temps que l'équipe puisse contester. Sans contestation, il est
 * supprimé définitivement à l'échéance ; si la contestation aboutit, il est
 * rétabli tel quel.
 *
 * **Six mois**, et pas moins : c'est la durée pendant laquelle le règlement
 * européen sur les services numériques impose de pouvoir contester une décision
 * de modération (art. 20.1, « au moins six mois »). Rien n'oblige à supprimer
 * plus tôt un logo d'équipe, qui n'est en règle générale pas une donnée
 * personnelle ; le garder plus longtemps n'aurait plus d'objet.
 *
 * **Un logo contesté n'est jamais supprimé d'office** : l'échéance passée, il
 * attend que l'association tranche (archivage du signalement, ou rétablissement).
 */

/** Durée de la quarantaine avant suppression définitive, en jours. */
export const LOGO_QUARANTINE_DAYS = 180;

/** État d'un logo mis en quarantaine. */
export type LogoQuarantineStatus = "HIDDEN" | "RESTORED" | "PURGED";

export const LOGO_QUARANTINE_STATUS_LABELS: Record<LogoQuarantineStatus, string> = {
  HIDDEN: "Masqué",
  RESTORED: "Rétabli",
  PURGED: "Supprimé définitivement",
};

/** Un logo en quarantaine, tel que le panneau le montre. */
export interface LogoQuarantineView {
  id: number;
  teamId: number;
  teamName: string;
  reportId: number | null;
  status: LogoQuarantineStatus;
  hiddenAt: string;
  /** Échéance de la suppression définitive sans contestation. */
  purgeAfter: string;
  closedAt: string | null;
}

/** Échéance de la suppression définitive d'un logo masqué à `hiddenAt`. */
export function logoQuarantinePurgeDate(hiddenAt: Date): Date {
  return new Date(hiddenAt.getTime() + LOGO_QUARANTINE_DAYS * 24 * 60 * 60 * 1000);
}

/**
 * Le logo peut-il être supprimé d'office ?
 *
 * Oui une fois l'échéance passée, **sauf** s'il a été contesté et que
 * l'association n'a pas encore tranché — un signalement contesté encore ouvert
 * garde son logo en attente, quelle que soit la date.
 */
export function canAutoPurgeLogo(input: {
  purgeAfter: Date;
  now: Date;
  contested: boolean;
  /** Le signalement d'origine est archivé, ou n'existe plus. */
  reportSettled: boolean;
}): boolean {
  if (input.purgeAfter.getTime() > input.now.getTime()) return false;
  return !input.contested || input.reportSettled;
}

/**
 * Date lisible d'une échéance, **en heure de Paris** : le message part d'un
 * serveur pour des lecteurs dont on ne connaît pas le fuseau, il est rédigé une
 * fois pour tous.
 */
export function formatQuarantineDate(date: Date): string {
  return date.toLocaleDateString("fr-FR", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Europe/Paris",
  });
}

/**
 * Message privé aux membres d'une équipe dont le logo vient d'être masqué.
 *
 * Il nomme **leur** équipe (c'est à ses membres qu'il s'adresse), dit la
 * conséquence, l'échéance et le moyen de l'empêcher — et rien de l'auteur du
 * signalement.
 */
export function formatLogoHiddenNotice(input: { teamName: string; purgeAfter: Date; url: string }): string {
  return (
    `🙈 BlueGenji — Le logo de ton équipe « ${input.teamName} » a été masqué à la suite d'un signalement. ` +
    `Sans contestation de votre part, il sera supprimé définitivement le ${formatQuarantineDate(input.purgeAfter)}. ` +
    `Si vous en détenez les droits, contestez ici : ${input.url}`
  );
}

/** Message privé aux membres d'une équipe dont le logo est rétabli. */
export function formatLogoRestoredNotice(input: { teamName: string }): string {
  return `✅ BlueGenji — Le logo de ton équipe « ${input.teamName} » a été rétabli : la contestation a été acceptée.`;
}

/** Ligne du journal (canal de logs) d'un logo masqué — nom d'équipe seul. */
export function formatLogoHiddenLog(input: { teamName: string; reportId: number; purgeAfter: Date }): string {
  return (
    `🙈 Logo de l'équipe « ${input.teamName} » masqué par le staff (signalement #${input.reportId}), ` +
    `suppression définitive le ${formatQuarantineDate(input.purgeAfter)} sans contestation.`
  );
}
