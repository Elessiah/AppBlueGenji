/**
 * Messages Discord automatisés poussés par le site.
 *
 * Deux usages, une seule mécanique : le site rédige, le bot distribue. Le sens
 * des appels reste app → bot (comme l'auth, les logs et la fréquentation), le
 * bot n'appelant jamais le site en retour.
 *
 * 1. **Rappels de match** — une semaine, 24 h puis 1 h avant le coup d'envoi
 *    d'une manche programmée (`bg_matches.start_at`), en message privé à chaque
 *    joueur des deux engagées. Une date posée tardivement — à trois jours, à
 *    cinq heures — donne d'abord une **annonce** unique portant la date, puis
 *    les paliers qui restent devant.
 * 2. **Signalement d'un problème** — un inscrit alerte le staff depuis la page
 *    du tournoi ou depuis un match ; le bot le relaie au canal de logs et au
 *    rôle arbitre.
 *
 * Module pur : les fenêtres de déclenchement et la rédaction vivent ici, sans
 * base ni réseau, pour que la règle soit testable et que serveur et interface ne
 * puissent pas en avoir deux lectures.
 */

/** Clé d'un palier de rappel. Persistée (`bg_match_reminders.offset_key`). */
export type MatchReminderOffsetKey = "P7D" | "P1D" | "PT1H";

/** Palier de rappel : combien de temps avant le match, et comment le dire. */
export interface MatchReminderOffset {
  key: MatchReminderOffsetKey;
  minutesBefore: number;
  /** Formulation employée dans le message (« dans 24 heures »). */
  label: string;
}

/**
 * Paliers de rappel, du plus lointain au plus proche.
 *
 * L'ordre porte du sens : c'est lui qui découpe le temps en fenêtres
 * (`dueMatchReminders`), chaque palier ne couvrant que l'intervalle qui le
 * sépare du suivant.
 */
export const MATCH_REMINDER_OFFSETS: readonly MatchReminderOffset[] = [
  { key: "P7D", minutesBefore: 7 * 24 * 60, label: "une semaine" },
  { key: "P1D", minutesBefore: 24 * 60, label: "24 heures" },
  { key: "PT1H", minutesBefore: 60, label: "1 heure" },
];

const MINUTE_MS = 60_000;

/**
 * Paliers de rappel dus pour un match, à un instant donné.
 *
 * Chaque palier ne vaut que dans **sa propre fenêtre** : `[début − palier,
 * début − palier suivant)`, le dernier s'arrêtant au coup d'envoi. Sans ce
 * découpage, une manche programmée pour dans trente minutes déclencherait d'un
 * coup les trois rappels — « dans une semaine », « dans 24 heures » et « dans
 * 1 heure » — pour le même match, dans la même seconde. Ici, elle ne déclenche
 * que le rappel d'une heure, le seul qui soit vrai.
 *
 * Rien ne part une fois le match commencé : un rappel en retard n'est plus un
 * rappel, et un match reprogrammé vers le passé (correction d'archive) ne doit
 * réveiller personne.
 *
 * @param startAt Début du match (ISO ou `Date`), `null` si non programmé.
 * @param now Instant de référence.
 * @param alreadySent Paliers déjà envoyés pour ce match.
 * @returns Les paliers à envoyer maintenant (au plus un en pratique).
 */
export function dueMatchReminders(
  startAt: string | Date | null,
  now: Date,
  alreadySent: readonly MatchReminderOffsetKey[] = [],
): MatchReminderOffset[] {
  if (startAt === null) return [];
  const start = startAt instanceof Date ? startAt.getTime() : new Date(startAt).getTime();
  if (!Number.isFinite(start)) return [];

  const nowMs = now.getTime();
  if (nowMs >= start) return [];

  const sent = new Set(alreadySent);
  const due: MatchReminderOffset[] = [];

  MATCH_REMINDER_OFFSETS.forEach((offset, index) => {
    if (sent.has(offset.key)) return;
    const opensAt = start - offset.minutesBefore * MINUTE_MS;
    const next = MATCH_REMINDER_OFFSETS[index + 1];
    const closesAt = next ? start - next.minutesBefore * MINUTE_MS : start;
    if (nowMs >= opensAt && nowMs < closesAt) due.push(offset);
  });

  return due;
}

/**
 * Horizon au-delà duquel aucun match n'a de rappel à envoyer.
 *
 * Sert au balayage serveur à ne charger que les manches concernées plutôt que
 * tout le calendrier : c'est le plus grand palier, donc le premier instant où
 * un match peut devenir « à rappeler ».
 */
export const MATCH_REMINDER_HORIZON_MS =
  Math.max(...MATCH_REMINDER_OFFSETS.map((o) => o.minutesBefore)) * MINUTE_MS;

/**
 * Fenêtre de **lecture** du balayage : l'horizon, plus une journée de marge.
 *
 * La marge n'est pas décorative, elle est ce qui rend le premier palier
 * atteignable. Le balayage ne voit une manche que si elle est dans sa fenêtre
 * de lecture ; si celle-ci valait exactement l'horizon, toute manche serait
 * découverte **au moment même** où le palier « une semaine » s'ouvre, donc
 * toujours par le régime d'annonce — et ce palier ne partirait jamais. Une
 * journée d'avance laisse le site observer la manche avant que quoi que ce soit
 * ne soit dû, et les trois paliers courent alors normalement.
 */
export const MATCH_REMINDER_LOOKAHEAD_MS = MATCH_REMINDER_HORIZON_MS + 24 * 60 * MINUTE_MS;

/**
 * Clé de la ligne posée à la **première observation** d'une manche programmée.
 *
 * Elle ne correspond à aucun message : elle marque que le site a vu cette date,
 * et sépare donc « le match vient d'être programmé » de « le temps a passé
 * depuis ». Sans elle, un match programmé à trois jours recevrait le rappel
 * « dans une semaine », puisqu'à J-3 la fenêtre de ce palier est bel et bien
 * ouverte.
 */
export const MATCH_SEEN_KEY = "SEEN";

/**
 * Paliers dont la fenêtre est **déjà ouverte** à `now`.
 *
 * Ce sont ceux qu'une date posée tardivement fait manquer d'un coup : une
 * manche annoncée cinq heures avant le coup d'envoi laisse derrière elle les
 * paliers « une semaine » et « 24 heures ». Ils sont consommés sans message —
 * l'annonce les remplace tous par une seule ligne, qui porte la date — et seuls
 * les paliers encore devant continuent de courir.
 *
 * @param startAt Début du match.
 * @param now Instant de référence.
 * @returns Les paliers déjà dépassés ou en cours, du plus lointain au plus proche.
 */
export function openedMatchReminders(
  startAt: string | Date | null,
  now: Date,
): MatchReminderOffset[] {
  if (startAt === null) return [];
  const start = startAt instanceof Date ? startAt.getTime() : new Date(startAt).getTime();
  if (!Number.isFinite(start)) return [];

  const nowMs = now.getTime();
  return MATCH_REMINDER_OFFSETS.filter(
    (offset) => nowMs >= start - offset.minutesBefore * MINUTE_MS,
  );
}

/** Date et heure d'un match, en français, fuseau de Paris. */
export function formatMatchStart(startAt: string | Date): string {
  const date = startAt instanceof Date ? startAt : new Date(startAt);
  return new Intl.DateTimeFormat("fr-FR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Paris",
  }).format(date);
}

/** Ce qu'un rappel doit dire d'un match. */
export interface MatchReminderContext {
  tournamentName: string;
  /** URL publique de la page du tournoi (`null` si `APP_URL` n'est pas réglée). */
  tournamentUrl: string | null;
  /** Engagée du destinataire. */
  teamName: string;
  /** Adversaire. Toujours connue : un rappel sans adversaire n'a rien à dire. */
  opponentName: string;
  roundLabel: string;
  startAt: string | Date;
}

/**
 * Rédige un rappel de match.
 *
 * Écrit ici, pas côté bot : le tournoi, la manche et l'adversaire sont du
 * domaine du site — le bot ne connaît que des comptes Discord.
 *
 * @param offset Palier qui déclenche ce rappel.
 * @param context Ce qu'il y a à dire du match.
 * @returns Le message privé à envoyer, en français.
 */
export function buildMatchReminderMessage(
  offset: MatchReminderOffset,
  context: MatchReminderContext,
): string {
  const lines = [
    `**Rappel de match — dans ${offset.label}**`,
    `${context.tournamentName} · ${context.roundLabel}`,
    `**${context.teamName}** contre **${context.opponentName}**`,
    `Coup d'envoi : ${formatMatchStart(context.startAt)} (heure de Paris)`,
  ];
  if (context.tournamentUrl) lines.push(context.tournamentUrl);
  return lines.join("\n");
}

/**
 * Rédige l'annonce d'une manche programmée tardivement.
 *
 * Un seul message, qui porte la date, là où les paliers manqués en auraient
 * envoyé deux ou trois d'affilée — et de travers : « ton match est dans une
 * semaine » pour une manche qui se joue dans trois jours n'informe pas, il
 * désinforme. Le joueur reçoit la date, et les rappels qui restent devant
 * suivent leur cours.
 *
 * @param context Ce qu'il y a à dire du match.
 * @param remaining Paliers encore à venir, pour annoncer la suite.
 * @returns Le message privé à envoyer, en français.
 */
export function buildMatchScheduleAnnouncement(
  context: MatchReminderContext,
  remaining: readonly MatchReminderOffset[] = [],
): string {
  const lines = [
    "**Match programmé**",
    `${context.tournamentName} · ${context.roundLabel}`,
    `**${context.teamName}** contre **${context.opponentName}**`,
    `Coup d'envoi : ${formatMatchStart(context.startAt)} (heure de Paris)`,
  ];
  if (remaining.length > 0) {
    // Le prochain rappel est le palier restant le plus **lointain** : la liste
    // est ordonnée du plus lointain au plus proche, c'est donc le premier.
    lines.push(`Prochain rappel : ${remaining[0].label} avant le coup d'envoi.`);
  }
  if (context.tournamentUrl) lines.push(context.tournamentUrl);
  return lines.join("\n");
}

/**
 * Libellé lisible d'une manche : « Manche 3 », « Loser bracket · manche 2 ».
 *
 * Partagé par les rappels et les signalements — les deux désignent la même
 * manche au même staff, et deux formulations différentes pour un seul match
 * rendraient un signalement plus difficile à rapprocher de son rappel.
 *
 * @param bracket Partie de plateau (`UPPER`, `LOWER`, `GRAND`, `THIRD_PLACE`).
 * @param roundNumber Numéro de manche.
 * @returns Le libellé en français.
 */
export function matchRoundLabel(bracket: string, roundNumber: number): string {
  const round = `manche ${roundNumber}`;
  switch (bracket) {
    case "LOWER":
      return `Loser bracket · ${round}`;
    case "GRAND":
      return "Grande finale";
    case "THIRD_PLACE":
      return "Petite finale";
    default:
      return `Manche ${roundNumber}`;
  }
}

/**
 * Longueur minimale d'un signalement.
 *
 * Assez pour écarter le « ??? » qui fait sonner le téléphone d'un arbitre sans
 * rien lui apprendre, assez court pour ne pas décourager un signalement pressé
 * en pleine manche.
 */
export const ISSUE_REPORT_MIN_LENGTH = 10;

/** Longueur maximale d'un signalement (le bot tronque au-delà de 1800). */
export const ISSUE_REPORT_MAX_LENGTH = 1000;

/**
 * Valide et normalise le texte d'un signalement.
 *
 * @param raw Texte saisi.
 * @returns Le texte nettoyé, ou `null` s'il est hors bornes.
 */
export function normalizeIssueReportMessage(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (trimmed.length < ISSUE_REPORT_MIN_LENGTH) return null;
  if (trimmed.length > ISSUE_REPORT_MAX_LENGTH) return null;
  return trimmed;
}

/** Ce qu'un signalement doit dire de son contexte. */
export interface IssueReportContext {
  tournamentName: string;
  tournamentUrl: string | null;
  /** Pseudo de l'auteur, tel qu'il apparaît sur le site. */
  reporterPseudo: string;
  /** Engagée de l'auteur (son équipe, ou son propre pseudo en tournoi solo). */
  entrantName: string;
  /** Manche visée, `null` pour un signalement portant sur tout le tournoi. */
  matchLabel: string | null;
  message: string;
}

/**
 * Rédige un signalement de problème pour le staff.
 *
 * @param context Le tournoi, l'auteur et, le cas échéant, la manche visée.
 * @returns Le message à poster dans les logs et à envoyer aux arbitres.
 */
export function buildIssueReportMessage(context: IssueReportContext): string {
  const lines = [
    "**Signalement de problème**",
    `Tournoi : ${context.tournamentName}`,
    context.matchLabel ? `Match : ${context.matchLabel}` : "Portée : tournoi entier",
    `Auteur : ${context.reporterPseudo} (${context.entrantName})`,
    "",
    context.message,
  ];
  if (context.tournamentUrl) lines.push("", context.tournamentUrl);
  return lines.join("\n");
}
