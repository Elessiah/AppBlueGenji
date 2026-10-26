/**
 * Messages Discord automatisés poussés par le site.
 *
 * Deux usages, une seule mécanique : le site rédige, le bot distribue. Le sens
 * des appels reste app → bot (comme l'auth, les logs et la fréquentation), le
 * bot n'appelant jamais le site en retour.
 *
 * 1. **Rappels de match** — 24 h puis 10 h avant le coup d'envoi d'une manche
 *    programmée (`bg_matches.start_at`), en message privé à chaque joueur des
 *    deux engagées ; celui de 10 h porte le lien du serveur Discord où le
 *    salon de check-in ouvre un quart d'heure avant le match (demande de
 *    l'association, 2026-10-09). Poser ou changer la date donne d'abord une **annonce** unique
 *    qui la porte (« Match programmé » / « Match reprogrammé »), puis le rappel
 *    s'il reste devant ; la retirer prévient aussi (« Horaire du match
 *    retiré »). Les rappels « une semaine » et « 1 heure avant » ont été
 *    retirés (demande de l'association, 2026-10 : trop de notifications) — le
 *    départ du match (`MATCH_START`) tient lieu du dernier.
 * 2. **Signalement d'un problème** — un inscrit alerte le staff depuis la page
 *    du tournoi ou depuis un match ; le bot le relaie au canal de logs et au
 *    rôle arbitre.
 *
 * Module pur : les fenêtres de déclenchement et la rédaction vivent ici, sans
 * base ni réseau, pour que la règle soit testable et que serveur et interface ne
 * puissent pas en avoir deux lectures.
 */
import { isEndurancePlayoffRound, PLAYOFF_ROUND_OFFSET } from "./bg-survie/rounds";
import { ANONYMOUS_PLAYER_LABEL, entrantLabel, type LogEntrant } from "./log-privacy";
import { discordInline, discordQuote } from "./discord-text";
import { CHECK_IN_INVITE_URL } from "./discord";
import { localizedSiteUrl } from "./dm-language";
import { INTL_LOCALE, type Locale } from "./locales";

/**
 * Clé d'un palier de rappel. Persistée (`bg_match_reminders.offset_key`).
 *
 * `P7D` (une semaine avant) et `PT1H` (une heure avant) n'existent plus : les
 * lignes déjà posées sous ces clés restent en base, inertes — le balayage ne
 * lit que les clés de {@link MATCH_REMINDER_OFFSETS}.
 */
export type MatchReminderOffsetKey = "P1D" | "PT10H";

/** Palier de rappel : combien de temps avant le match, et comment le dire. */
export interface MatchReminderOffset {
  key: MatchReminderOffsetKey;
  minutesBefore: number;
  /** Délai tel que l'annonce le promet (« Prochain rappel : 24 heures avant »). */
  label: string;
  /**
   * Délai tel que le rappel le dit (« dans moins de 24 heures »). Le balayage
   * n'est entraîné que par le trafic : le rappel peut partir n'importe quand
   * dans sa fenêtre, jusqu'à quelques minutes du coup d'envoi — il ne promet
   * donc pas un délai exact, l'horaire du message le donne.
   */
  dueLabel: string;
}

/**
 * Paliers de rappel, du plus lointain au plus proche.
 *
 * L'ordre porte du sens : c'est lui qui découpe le temps en fenêtres
 * (`dueMatchReminders`), chaque palier ne couvrant que l'intervalle qui le
 * sépare du suivant.
 */
export const MATCH_REMINDER_OFFSETS: readonly MatchReminderOffset[] = [
  { key: "P1D", minutesBefore: 24 * 60, label: "24 heures", dueLabel: "moins de 24 heures" },
  { key: "PT10H", minutesBefore: 10 * 60, label: "10 heures", dueLabel: "moins de 10 heures" },
];

/** `label` et `dueLabel` d'un palier, en anglais (messages privés des comptes anglophones). */
const OFFSET_LABELS_EN: Readonly<Record<MatchReminderOffsetKey, { label: string; dueLabel: string }>> = {
  P1D: { label: "24 hours", dueLabel: "less than 24 hours" },
  PT10H: { label: "10 hours", dueLabel: "less than 10 hours" },
};

function offsetLabels(offset: MatchReminderOffset, locale: Locale): { label: string; dueLabel: string } {
  return locale === "en" ? OFFSET_LABELS_EN[offset.key] : offset;
}

/**
 * Palier qui porte le **check-in** : son rappel donne le lien du serveur
 * Discord où le salon de check-in ouvre {@link CHECK_IN_OPENS_MINUTES_BEFORE}
 * minutes avant le coup d'envoi. Une manche annoncée moins de 10 h avant son
 * coup d'envoi consomme ce palier sans message : c'est alors l'annonce qui
 * porte le lien (`MatchReminderContext.checkIn`).
 */
export const CHECK_IN_REMINDER_KEY: MatchReminderOffsetKey = "PT10H";

/**
 * Invitation du serveur où s'ouvre le salon de check-in — écrite une seule
 * fois, avec les autres invitations (`./discord`).
 */
export { CHECK_IN_INVITE_URL };

/** Le salon de check-in ouvre un quart d'heure avant le coup d'envoi. */
export const CHECK_IN_OPENS_MINUTES_BEFORE = 15;

const MINUTE_MS = 60_000;

/**
 * Paliers de rappel dus pour un match, à un instant donné.
 *
 * Chaque palier ne vaut que dans **sa propre fenêtre** : `[début − palier,
 * début − palier suivant)`, le dernier s'arrêtant au coup d'envoi. Sans ce
 * découpage, plusieurs paliers s'ouvriraient d'un coup pour une manche
 * programmée tard, dans la même seconde : le palier « 24 heures » court jusqu'à
 * l'ouverture du palier « 10 heures », qui court jusqu'au coup d'envoi.
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
 * Une manche que le balayage découvre (une engagée manquait quand l'arbitre a
 * posé la date) est annoncée à sa première observation. La marge fait partir
 * cette annonce une journée **avant** l'ouverture du rappel, qui court ensuite
 * normalement — sans elle, l'annonce arriverait au moment même où le rappel
 * s'ouvre, et le remplacerait.
 */
export const MATCH_REMINDER_LOOKAHEAD_MS = MATCH_REMINDER_HORIZON_MS + 24 * 60 * MINUTE_MS;

/**
 * Clé de la ligne posée à la **première observation** d'une manche programmée.
 *
 * Elle ne correspond à aucun message : elle marque que l'annonce de cette date
 * est **prise en charge** — par le balayage qui la pose (et annonce), ou par
 * `setMatchStartAt`, qui la pose pour toute date posée sur deux engagées
 * connues (annoncée aussitôt si elle est devant ; une correction d'archive
 * dans le passé n'annonce rien). Sans elle, un match programmé à cinq heures
 * recevrait un simple rappel au lieu de l'annonce qui porte la date ; c'est
 * aussi le verrou de l'annonce : seule la requête qui pose la marque annonce.
 */
export const MATCH_SEEN_KEY = "SEEN";

/**
 * Marque posée quand un message d'horaire (annonce ou rappel) est **réellement
 * parti** vers au moins une engagée. Ni la marque d'observation (posée aussi
 * en silence) ni celle d'un palier (réservée avant l'envoi, consommée sans
 * message par une annonce) ne le prouvent. C'est elle qui fait dire
 * « reprogrammé » à une nouvelle date et « retiré » à une date effacée.
 * Survit aux changements de date ; tient dans `offset_key` (`VARCHAR(8)`).
 * Seule source : les preuves héritées de l'ancien code des rappels (`P7D`,
 * `PT1H`) y sont recopiées au démarrage (`RECENT_SCHEMA_CHANGES`).
 */
export const MATCH_TOLD_KEY = "TOLD";

/**
 * Marque de l'horaire **poussé aux arbitres** (`MATCH_SCHEDULED`) : posée
 * quand l'avis « Match programmé » a atteint au moins un appareil, avec
 * l'horaire poussé. Seul un horaire qu'elle tient se retire chez eux (« Horaire
 * du match retiré ») : une date seulement journalisée (passée, match joué,
 * tournoi clos) n'a rien à remplacer. Indépendante de l'affiche : une
 * correction de score n'efface pas ce que les arbitres ont reçu.
 */
export const MATCH_STAFF_KEY = "STAFF";

/**
 * Marque d'une manche **citée au programme d'arbitrage** (`REFEREE_DIGEST`,
 * `lib/server/tournaments/referee-digest.ts`), datée de l'horaire cité.
 * Comme un palier, elle part avec l'horaire : une manche reprogrammée (ou dont
 * l'affiche change) est citée de nouveau au programme suivant.
 */
export const REFEREE_DIGEST_KEY = "REFS";

/** Le programme d'arbitrage part quand une manche entre dans ses 10 dernières heures. */
export const REFEREE_DIGEST_LEAD_MS = 10 * 60 * MINUTE_MS;

/**
 * Marge de regroupement : le programme cite aussi les manches qui entreront
 * dans la fenêtre dans les 2 heures suivantes — une soirée échelonnée tient
 * ainsi en un message plutôt qu'en un par créneau.
 */
export const REFEREE_DIGEST_GROUPING_MS = 2 * 60 * MINUTE_MS;


/**
 * Paliers dont la fenêtre est **déjà ouverte** à `now`.
 *
 * Ce sont ceux qu'une date posée tardivement fait manquer d'un coup : une
 * manche annoncée cinq heures avant le coup d'envoi laisse derrière elle le
 * palier « 24 heures ». Il est consommé sans message —
 * l'annonce les remplace tous par une seule ligne, qui porte la date — et seuls
 * les paliers encore devant continuent de courir.
 *
 * Rien non plus une fois le match commencé, comme pour `dueMatchReminders` : le
 * balayage ne retient que des manches à venir, mais quelques dizaines de
 * millisecondes séparent sa lecture de sa décision, et une manche qui démarre
 * dans cet intervalle ne doit pas déclencher l'annonce d'un match déjà en
 * cours.
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
  if (nowMs >= start) return [];

  return MATCH_REMINDER_OFFSETS.filter(
    (offset) => nowMs >= start - offset.minutesBefore * MINUTE_MS,
  );
}

/**
 * Formateur des dates de match, construit au premier usage puis gardé : un
 * balayage de rappels en rédige un par engagé (message Discord et push
 * français), et un `Intl.DateTimeFormat` coûte cher à construire.
 */
let matchStartFormat: Intl.DateTimeFormat | null = null;

const MATCH_START_FORMATS_EN = new Map<Locale, Intl.DateTimeFormat>();

/**
 * Date et heure d'un match dans une langue, fuseau de Paris (24 h dans les
 * deux) : le français est {@link formatMatchStart}, inchangé.
 */
export function formatMatchStartIn(startAt: string | Date, locale: Locale): string {
  if (locale === "fr") return formatMatchStart(startAt);
  const date = startAt instanceof Date ? startAt : new Date(startAt);
  let format = MATCH_START_FORMATS_EN.get(locale);
  if (!format) {
    format = new Intl.DateTimeFormat(INTL_LOCALE[locale], {
      weekday: "long",
      day: "numeric",
      month: "long",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
      timeZone: "Europe/Paris",
    });
    MATCH_START_FORMATS_EN.set(locale, format);
  }
  return format.format(date);
}

/** Date et heure d'un match, en français, fuseau de Paris. */
export function formatMatchStart(startAt: string | Date): string {
  const date = startAt instanceof Date ? startAt : new Date(startAt);
  matchStartFormat ??= new Intl.DateTimeFormat("fr-FR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Paris",
  });
  return matchStartFormat.format(date);
}

/** Ce qu'un rappel doit dire d'un match. */
export interface MatchReminderContext {
  tournamentName: string;
  /** URL publique de la page du tournoi (`null` si `APP_URL` n'est pas réglée). */
  tournamentUrl: string | null;
  /**
   * URL de la section Notifications de « Mon profil », où le joueur coupe ces
   * messages ({@link matchDmOptOutLine}) — absente ou `null` sans `APP_URL`.
   */
  matchDmSettingsUrl?: string | null;
  /** Engagée du destinataire. */
  teamName: string;
  /** Adversaire. Toujours connue : un rappel sans adversaire n'a rien à dire. */
  opponentName: string;
  roundLabel: string;
  /**
   * La manche en anglais (`pushRoundLabel(…, "en")`), pour un compte
   * anglophone ; à défaut, `roundLabel`.
   */
  roundLabelEn?: string;
  startAt: string | Date;
  /**
   * Tournoi individuel : les deux noms sont des pseudos, que le message
   * privé ne porte pas (aucun pseudo de joueur sur Discord) — il dit « Ton
   * match », comme le push.
   */
  solo?: boolean;
  /**
   * Le message porte le check-in ({@link CHECK_IN_INVITE_URL}) : rappel de
   * 10 h, ou annonce qui l'a consommé (manche programmée moins de 10 h avant).
   */
  checkIn?: boolean;
  /**
   * Le salon de check-in est **déjà ouvert** : la manche part dans moins de
   * {@link CHECK_IN_OPENS_MINUTES_BEFORE} minutes (programmée au dernier
   * moment, ou balayage tardif). « Ouvre 15 minutes avant » désignerait un
   * instant passé.
   */
  checkInOpen?: boolean;
}

/** Ligne du check-in : où et quand (texte fixe, aucun nom). */
export function checkInLine(open = false, locale: Locale = "fr"): string {
  if (locale === "en") {
    return open
      ? `Check-in: the check-in channel is already open on Discord — ${CHECK_IN_INVITE_URL}`
      : `Check-in: the check-in channel opens ${CHECK_IN_OPENS_MINUTES_BEFORE} minutes before kickoff on Discord — ${CHECK_IN_INVITE_URL}`;
  }
  if (open) return `Check-in : le salon de check-in est déjà ouvert sur Discord — ${CHECK_IN_INVITE_URL}`;
  return (
    `Check-in : le salon de check-in ouvre ${CHECK_IN_OPENS_MINUTES_BEFORE} minutes avant le coup d'envoi ` +
    `sur Discord — ${CHECK_IN_INVITE_URL}`
  );
}

/** Le salon de check-in est-il déjà ouvert à `now` pour un coup d'envoi à `startAt` ? */
export function isCheckInOpen(startAt: string | Date, now: Date): boolean {
  return new Date(startAt).getTime() - now.getTime() <= CHECK_IN_OPENS_MINUTES_BEFORE * MINUTE_MS;
}

/**
 * Ce qu'une annonce d'horaire dit du changement : « reprogrammé » quand la date
 * en remplace une que les joueurs connaissaient, et l'ancienne date quand elle
 * est connue (une date effacée puis reposée n'en a plus).
 */
export type ScheduleAnnouncement = {
  rescheduled: boolean;
  previousStartAt?: string | Date | null;
};

/** Chemin de la section de « Mon profil » qui porte l'interrupteur des messages privés de match. */
export const MATCH_DM_SETTINGS_PATH = "/profil#notifications";

/**
 * Dernière ligne de **tout** message privé de match d'un joueur (annonce,
 * rappels, horaire retiré, « Match retiré ») : où couper ces messages — le
 * droit d'opposition rappelé là où il s'exerce (registre T04). Dans la langue
 * du message ; jamais dans un message au staff.
 */
export function matchDmOptOutLine(settingsUrl?: string | null, locale: Locale = "fr"): string {
  if (locale === "en") {
    return settingsUrl
      ? `You can turn off these direct messages in your profile, Notifications section: <${localizedSiteUrl(settingsUrl, locale)}>`
      : "You can turn off these direct messages in “My profile”, Notifications section, on the site.";
  }
  // `<…>` : Discord garde le lien cliquable sans en déplier l'aperçu — une
  // seconde carte (celle de « Mon profil ») sous celle du tournoi, à chaque
  // message, repousserait l'horaire hors de l'écran d'un téléphone.
  return settingsUrl
    ? `Tu peux couper ces messages privés dans ton profil, section Notifications : <${settingsUrl}>`
    : "Tu peux couper ces messages privés dans « Mon profil », section Notifications, sur le site.";
}

/** Première annonce d'un horaire : rien à remplacer. */
export const FIRST_SCHEDULE: ScheduleAnnouncement = { rescheduled: false };

/** Ligne « qui contre qui » d'un message privé de match. */
function pairingLine(context: MatchReminderContext, locale: Locale): string {
  if (context.solo) return locale === "en" ? "**Your match**" : "**Ton match**";
  const versus = locale === "en" ? "vs" : "contre";
  return `**${discordInline(context.teamName)}** ${versus} **${discordInline(context.opponentName)}**`;
}

/** Ligne « tournoi · manche » d'un message privé de match. */
function tournamentLine(context: MatchReminderContext, locale: Locale): string {
  const round = locale === "en" ? (context.roundLabelEn ?? context.roundLabel) : context.roundLabel;
  return `${discordInline(context.tournamentName)} · ${round}`;
}

/** Dernières lignes communes : la page du tournoi, puis où couper ces messages. */
function closingLines(context: MatchReminderContext, locale: Locale): string[] {
  const link = localizedSiteUrl(context.tournamentUrl, locale);
  return [...(link ? [link] : []), matchDmOptOutLine(context.matchDmSettingsUrl, locale)];
}

/**
 * Rédige un rappel de match.
 *
 * Écrit ici, pas côté bot : le tournoi, la manche et l'adversaire sont du
 * domaine du site — le bot ne connaît que des comptes Discord.
 *
 * @param offset Palier qui déclenche ce rappel.
 * @param context Ce qu'il y a à dire du match.
 * @param locale Langue du compte destinataire (français par défaut, texte inchangé).
 * @returns Le message privé à envoyer.
 */
export function buildMatchReminderMessage(
  offset: MatchReminderOffset,
  context: MatchReminderContext,
  locale: Locale = "fr",
): string {
  const en = locale === "en";
  const { dueLabel } = offsetLabels(offset, locale);
  const start = formatMatchStartIn(context.startAt, locale);
  const lines = [
    en ? `**Match reminder — in ${dueLabel}**` : `**Rappel de match — dans ${dueLabel}**`,
    tournamentLine(context, locale),
    pairingLine(context, locale),
    en ? `Kickoff: ${start} (Paris time)` : `Coup d'envoi : ${start} (heure de Paris)`,
  ];
  if (context.checkIn ?? offset.key === CHECK_IN_REMINDER_KEY) lines.push(checkInLine(context.checkInOpen, locale));
  lines.push(...closingLines(context, locale));
  return lines.join("\n");
}

/**
 * Rédige l'annonce de l'horaire d'une manche : date posée ou changée par
 * l'arbitrage (`rescheduled` quand elle en remplace une), ou découverte
 * tardivement par le balayage.
 *
 * Un seul message, qui porte la date, là où les paliers manqués en auraient
 * envoyé deux ou trois d'affilée — et de travers : « ton match est dans une
 * semaine » pour une manche qui se joue dans trois jours n'informe pas, il
 * désinforme. Le joueur reçoit la date, et les rappels qui restent devant
 * suivent leur cours.
 *
 * @param context Ce qu'il y a à dire du match.
 * @param remaining Paliers encore à venir, pour annoncer la suite.
 * @param announcement Date qui en remplace une autre (« Match reprogrammé »),
 *                     et l'ancienne quand elle est connue.
 * @param locale Langue du compte destinataire (français par défaut, texte inchangé).
 * @returns Le message privé à envoyer.
 */
export function buildMatchScheduleAnnouncement(
  context: MatchReminderContext,
  remaining: readonly MatchReminderOffset[] = [],
  announcement: ScheduleAnnouncement = FIRST_SCHEDULE,
  locale: Locale = "fr",
): string {
  const en = locale === "en";
  const previous = announcement.rescheduled ? announcement.previousStartAt : null;
  const start = formatMatchStartIn(context.startAt, locale);
  const lines = [
    scheduleTitle(announcement.rescheduled, en),
    tournamentLine(context, locale),
    pairingLine(context, locale),
    scheduleKickoff(start, previous ? formatMatchStartIn(previous, locale) : null, en),
  ];
  if (remaining.length > 0) {
    // Le prochain rappel est le palier restant le plus **lointain** : la liste
    // est ordonnée du plus lointain au plus proche, c'est donc le premier.
    const { label } = offsetLabels(remaining[0], locale);
    lines.push(en ? `Next reminder: ${label} before kickoff.` : `Prochain rappel : ${label} avant le coup d'envoi.`);
  }
  if (context.checkIn) lines.push(checkInLine(context.checkInOpen, locale));
  lines.push(...closingLines(context, locale));
  return lines.join("\n");
}

/** Titre d'une annonce d'horaire. */
function scheduleTitle(rescheduled: boolean, en: boolean): string {
  if (en) return rescheduled ? "**Match rescheduled**" : "**Match scheduled**";
  return rescheduled ? "**Match reprogrammé**" : "**Match programmé**";
}

/** Ligne du coup d'envoi d'une annonce, avec l'ancien quand il est remplacé. */
function scheduleKickoff(start: string, previous: string | null, en: boolean): string {
  if (en) return previous ? `New kickoff: ${start} (Paris time), instead of ${previous}` : `Kickoff: ${start} (Paris time)`;
  return previous
    ? `Nouveau coup d'envoi : ${start} (heure de Paris), au lieu du ${previous}`
    : `Coup d'envoi : ${start} (heure de Paris)`;
}

/**
 * Rédige l'avis d'un horaire **retiré** par l'arbitrage : `context.startAt`
 * porte l'horaire qui ne vaut plus. Mêmes lignes que l'annonce, pour que le
 * joueur rapproche les deux messages.
 *
 * @param locale Langue du compte destinataire (français par défaut, texte inchangé).
 * @returns Le message privé à envoyer.
 */
export function buildMatchScheduleClearedNotice(context: MatchReminderContext, locale: Locale = "fr"): string {
  const en = locale === "en";
  const start = formatMatchStartIn(context.startAt, locale);
  return [
    en ? "**Match time removed**" : "**Horaire du match retiré**",
    tournamentLine(context, locale),
    pairingLine(context, locale),
    en
      ? `The time set for ${start} (Paris time) has been removed: a new time will be announced.`
      : `L'horaire du ${start} (heure de Paris) est retiré : un nouvel horaire te sera annoncé.`,
    ...closingLines(context, locale),
  ].join("\n");
}

/**
 * Rédige l'avis à une engagée **retirée** d'une manche par un changement du
 * tournoi (correction, retour en arrière, ronde réappariée) : l'horaire qu'elle avait reçu (`context.startAt`) ne la concerne plus.
 * Mêmes lignes que l'annonce, pour que le joueur rapproche les deux messages.
 *
 * @param locale Langue du compte destinataire (français par défaut, texte inchangé).
 * @returns Le message privé à envoyer.
 */
export function buildMatchWithdrawnNotice(context: MatchReminderContext, locale: Locale = "fr"): string {
  const en = locale === "en";
  const start = formatMatchStartIn(context.startAt, locale);
  return [
    en ? "**Match removed from your schedule**" : "**Match retiré de ton programme**",
    tournamentLine(context, locale),
    pairingLine(context, locale),
    en
      ? `The tournament has been updated and you no longer play this match: the time set for ${start} (Paris time) no longer applies to you.`
      : `Le tournoi a été mis à jour et tu ne joues plus ce match : l'horaire du ${start} (heure de Paris) ne te concerne plus.`,
    ...closingLines(context, locale),
  ].join("\n");
}

/**
 * Libellé lisible d'une manche : « Manche 3 », « Tableau perdants · manche 2 »
 * (le nom du tableau sur le site, `tournament.json` → `bracketLabels.LOWER`),
 * « Ronde 2 » en ronde suisse — le mot du site (`tournamentViews.json` →
 * `swiss.roundNoun`), tournoi `SWISS` ou phase suisse d'un `MULTI`.
 *
 * Partagé par les rappels et les signalements — les deux désignent la même
 * manche au même staff, et deux formulations différentes pour un seul match
 * rendraient un signalement plus difficile à rapprocher de son rappel.
 *
 * @param bracket Partie de plateau (`UPPER`, `LOWER`, `GRAND`, `THIRD_PLACE`).
 * @param roundNumber Numéro de manche.
 * @param swiss La manche est une ronde suisse (`swissRoundSql`).
 * @returns Le libellé en français.
 */
export function matchRoundLabel(bracket: string, roundNumber: number, swiss = false): string {
  // L'arbre final de BlueGenji Survie numérote ses tours à partir de
  // `PLAYOFF_ROUND_OFFSET` : affiché tel quel, le journal passait de
  // « Manche 5 » à « Manche 1000 ». Même libellé que le retour en arrière.
  if (isEndurancePlayoffRound(roundNumber) && bracket !== "THIRD_PLACE") {
    return `Play-offs · tour ${roundNumber - PLAYOFF_ROUND_OFFSET + 1}`;
  }
  const round = `manche ${roundNumber}`;
  switch (bracket) {
    case "LOWER":
      return `Tableau perdants · ${round}`;
    case "GRAND":
      return "Grande finale";
    case "THIRD_PLACE":
      return "Petite finale";
    default:
      return swiss ? `Ronde ${roundNumber}` : `Manche ${roundNumber}`;
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
  /**
   * Engagée de l'auteur. L'auteur lui-même n'est **pas** nommé : le message part
   * sur Discord, qui ne reçoit aucun pseudo de joueur (`lib/shared/log-privacy.ts`).
   * L'arbitre répond par l'équipe, ou par la page du tournoi.
   */
  entrant: LogEntrant;
  /**
   * Manche visée, `null` pour un signalement portant sur tout le tournoi. Ses
   * engagées passent elles aussi par `entrantLabel`.
   */
  match: { round: string; team1: LogEntrant | null; team2: LogEntrant | null; id: number } | null;
  message: string;
}

/** « un joueur de l'équipe X », ou « un joueur » en tournoi individuel. */
function reporterLabel(entrant: LogEntrant): string {
  return entrant.participantType === "SOLO"
    ? ANONYMOUS_PLAYER_LABEL
    : `${ANONYMOUS_PLAYER_LABEL} de l'équipe ${discordInline(entrant.name)}`;
}

/** Ligne de portée d'un signalement : la manche visée, ou le tournoi entier. */
function issueReportScope(match: IssueReportContext["match"]): string {
  if (!match) return "Portée : tournoi entier";
  const team1 = match.team1 ? entrantLabel(match.team1) : "TBD";
  const team2 = match.team2 ? entrantLabel(match.team2) : "TBD";
  return `Match : ${match.round} — ${team1} vs ${team2} (#${match.id})`;
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
    `Tournoi : ${discordInline(context.tournamentName)}`,
    issueReportScope(context.match),
    `Auteur : ${reporterLabel(context.entrant)}`,
    "",
    // Texte libre de l'auteur : cité ligne à ligne, balisage et mentions
    // désamorcés — aucune de ses lignes ne passe pour une ligne du site.
    discordQuote(context.message),
  ];
  if (context.tournamentUrl) lines.push("", context.tournamentUrl);
  return lines.join("\n");
}
