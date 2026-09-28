/**
 * Quarantaine des images signalées (logo d'équipe, avatar de joueur) — module
 * pur.
 *
 * Retirer tout de suite une image signalée pour droit d'auteur, c'est parfois
 * retirer à tort le logo d'une équipe — ou l'avatar d'un joueur — qui en
 * détient les droits. Le panneau propose donc de le **masquer** : le fichier
 * quitte ce que le site sert (il n'est plus en ligne, ce qui éteint la
 * responsabilité d'hébergeur), mais il est gardé à part le temps que la
 * personne concernée puisse contester. Sans contestation, il est supprimé
 * définitivement à l'échéance ; si la contestation aboutit, il est rétabli
 * tel quel.
 *
 * **Six mois**, et pas moins : c'est la durée pendant laquelle le règlement
 * européen sur les services numériques impose de pouvoir contester une
 * décision de modération (art. 20.1, « au moins six mois »). Rien n'oblige à
 * supprimer plus tôt un logo d'équipe ou un avatar ; les garder plus
 * longtemps n'aurait plus d'objet.
 *
 * **Une image contestée n'est jamais supprimée d'office** : l'échéance
 * passée, elle attend que l'association tranche (archivage du signalement, ou
 * rétablissement).
 *
 * Une même ligne désigne **soit** une équipe, **soit** un joueur (§ cible dans
 * `lib/server/logo-quarantine.ts`) : les deux domaines partagent le cycle et la
 * table, mais leurs gestes serveur (fichier partagé, entrée solo à
 * resynchroniser…) restent des implémentations séparées.
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

/** Ce qu'une ligne de quarantaine désigne : le logo d'une équipe, ou l'avatar d'un joueur. */
export type QuarantineTargetType = "TEAM" | "USER";

/** Une image en quarantaine, tel que le panneau la montre. */
export interface LogoQuarantineView {
  id: number;
  targetType: QuarantineTargetType;
  targetId: number;
  /** Nom de l'équipe, ou pseudo du joueur. */
  targetName: string;
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

/**
 * Le logo a-t-il été supprimé **sans délai**, sans passer par la quarantaine ?
 *
 * Une suppression immédiate s'écrit comme une quarantaine close à l'instant de
 * son ouverture (`hiddenAt === closedAt`) : c'est la même trace, rattachée au
 * même signalement, et elle se lit ainsi partout où une quarantaine se lit.
 */
export function isImmediateLogoRemoval(view: Pick<LogoQuarantineView, "status" | "hiddenAt" | "closedAt">): boolean {
  return view.status === "PURGED" && view.closedAt !== null && view.closedAt === view.hiddenAt;
}

/**
 * Message privé aux membres d'une équipe dont le logo vient d'être supprimé
 * sans délai (contenu manifestement illicite).
 *
 * Même règle que le masquage : l'équipe apprend la décision et le moyen d'y
 * répondre (DSA art. 17 et 20). Le lien mène au signalement quand la
 * suppression en découle ; retiré depuis la fiche de l'équipe, hors de tout
 * signalement, le logo n'a pas de page à contester — le message renvoie alors
 * vers l'association.
 */
export function formatLogoRemovedNotice(input: { teamName: string; url: string | null }): string {
  const answer = input.url
    ? `Si vous en détenez les droits, contestez ici : ${input.url}`
    : "Si vous en détenez les droits, écrivez à l'association (« Signaler un problème », en bas de chaque page).";
  return (
    `🗑️ BlueGenji — Le logo de ton équipe « ${input.teamName} » a été supprimé par la modération du site` +
    `${input.url ? " à la suite d'un signalement" : ""}. ${answer}`
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

// ─────────────────────────────────────────────────────────────────────────────
// Avatars — même cycle, un seul destinataire.
//
// Un logo d'équipe s'adresse à un roster (« ton équipe », mais « vous » pour le
// geste collectif de contester) ; un avatar n'a qu'un titulaire, tout se dit au
// singulier. Les messages sont donc réécrits plutôt que partagés : les
// généraliser aurait produit un « vous » incongru pour un joueur seul, ou un
// gabarit à paramètres qui masque la différence au lieu de la dire.
// ─────────────────────────────────────────────────────────────────────────────

/** Message privé au joueur dont l'avatar vient d'être masqué. */
export function formatAvatarHiddenNotice(input: { purgeAfter: Date; url: string }): string {
  return (
    `🙈 BlueGenji — Ton avatar a été masqué à la suite d'un signalement. ` +
    `Sans contestation de ta part, il sera supprimé définitivement le ${formatQuarantineDate(input.purgeAfter)}. ` +
    `Si tu en détiens les droits, conteste-le ici : ${input.url}`
  );
}

/**
 * Message privé au joueur dont l'avatar vient d'être supprimé sans délai
 * (contenu manifestement illicite) — ou par la modération, hors de tout
 * signalement (`url` alors `null`, comme `formatLogoRemovedNotice`).
 */
export function formatAvatarRemovedNotice(input: { url: string | null }): string {
  const answer = input.url
    ? `Si tu en détiens les droits, conteste-le ici : ${input.url}`
    : "Si tu en détiens les droits, écris à l'association (« Signaler un problème », en bas de chaque page).";
  return (
    `🗑️ BlueGenji — Ton avatar a été supprimé par la modération du site` +
    `${input.url ? " à la suite d'un signalement" : ""}. ${answer}`
  );
}

/** Message privé au joueur dont l'avatar est rétabli. */
export function formatAvatarRestoredNotice(): string {
  return `✅ BlueGenji — Ton avatar a été rétabli : la contestation a été acceptée.`;
}

/** Ligne du journal (canal de logs) d'un avatar masqué — pseudo seul. */
export function formatAvatarHiddenLog(input: { pseudo: string; reportId: number; purgeAfter: Date }): string {
  return (
    `🙈 Avatar de ${input.pseudo} masqué par le staff (signalement #${input.reportId}), ` +
    `suppression définitive le ${formatQuarantineDate(input.purgeAfter)} sans contestation.`
  );
}
