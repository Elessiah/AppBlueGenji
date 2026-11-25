/**
 * Message du staff d'un tournoi à ses engagés — règles, sans base ni réseau
 * (`docs/features/TOURNAMENT_STAFF_MESSAGE.md`).
 *
 * Le staff des tournois tape `/message-tournoi` sur Discord : le bot demande au
 * site (seule exception au sens app → bot, `BOT_INTEGRATION.md`) qui recevrait
 * le message, puis de l'envoyer. Ce module porte ce que le bot et la route
 * doivent lire pareil : les catégories de destinataires, les états du tournoi
 * qui l'admettent, les bornes du texte et le message privé lui-même.
 *
 * Module pur, importable partout.
 */
import { discordInline, discordQuote, discordQuoted } from "./discord-text";
import { DM_MAX_LENGTH, localizedSiteUrl, type LocalizedDm } from "./dm-language";
import type { Locale } from "./locales";
import type { TeamRole, TournamentState } from "./types";

/**
 * Catégories de destinataires, dans l'ordre du menu du bot. `ALL` vaut tout
 * le monde, quoi qu'on ait coché d'autre.
 */
export const STAFF_MESSAGE_CATEGORIES = ["PLAYERS", "MANAGERS", "CAPTAINS", "OWNERS", "ALL"] as const;

export type StaffMessageCategory = (typeof STAFF_MESSAGE_CATEGORIES)[number];

/** Rôles d'équipe de jeu : un membre qui en porte un est un joueur (`PLAYERS`). */
const PLAYER_ROLES: readonly TeamRole[] = ["TANK", "DPS", "HEAL"];

/** Rôle d'équipe que chaque catégorie désigne (hors `PLAYERS` et `ALL`). */
const CATEGORY_ROLE: Readonly<Record<"MANAGERS" | "CAPTAINS" | "OWNERS", TeamRole>> = {
  MANAGERS: "MANAGER",
  CAPTAINS: "CAPITAINE",
  OWNERS: "OWNER",
};

/**
 * États qui admettent un message : inscriptions ouvertes (les engagées sont
 * connues) et tournoi en cours. Avant (`UPCOMING`), personne n'est engagé ;
 * après (`FINISHED`), le tournoi ne sollicite plus ses joueurs.
 */
export const STAFF_MESSAGE_STATES: readonly TournamentState[] = ["REGISTRATION", "RUNNING"];

/**
 * Longueur maximale du texte saisi (option Discord `max_length` comprise). Le
 * message privé rendu doit en plus tenir sous {@link DM_MAX_LENGTH} dans chaque
 * langue : la citation et l'échappement l'allongent.
 */
export const STAFF_MESSAGE_MAX_LENGTH = 1200;

/** Envois admis par membre du staff et par tournoi dans la fenêtre. */
export const STAFF_MESSAGE_SENDS_PER_WINDOW = 3;

/** Fenêtre du plafond d'envois, en minutes. */
export const STAFF_MESSAGE_WINDOW_MINUTES = 60;

/** Refus de la route : un code, jamais une phrase (`fail`). */
export const STAFF_MESSAGE_ERRORS = {
  invalidRequest: "INVALID_STAFF_MESSAGE_REQUEST",
  invalidDiscordId: "INVALID_DISCORD_ID",
  invalidTournament: "INVALID_TOURNAMENT_ID",
  invalidCategories: "INVALID_RECIPIENT_CATEGORIES",
  emptyMessage: "STAFF_MESSAGE_EMPTY",
  messageTooLong: "STAFF_MESSAGE_TOO_LONG",
  notLinked: "DISCORD_ACCOUNT_NOT_LINKED",
  forbidden: "FORBIDDEN",
  tournamentNotFound: "TOURNAMENT_NOT_FOUND",
  tournamentClosed: "TOURNAMENT_NOT_OPEN_FOR_MESSAGES",
  noRecipients: "NO_RECIPIENTS",
  quotaExceeded: "STAFF_MESSAGE_QUOTA_EXCEEDED",
  unavailable: "STAFF_MESSAGE_UNAVAILABLE",
} as const;

/** Identifiant Discord (snowflake) : 17 à 20 chiffres. */
const SNOWFLAKE = /^\d{17,20}$/;

/** L'identifiant Discord reçu, s'il en a la forme. */
export function parseDiscordUserId(value: unknown): string | null {
  return typeof value === "string" && SNOWFLAKE.test(value) ? value : null;
}

/** Numéro de tournoi : entier strictement positif (nombre ou chaîne de chiffres). */
export function parseTournamentId(value: unknown): number | null {
  const id = typeof value === "string" && /^\d{1,15}$/.test(value) ? Number(value) : value;
  return typeof id === "number" && Number.isSafeInteger(id) && id > 0 ? id : null;
}

/**
 * Catégories reçues : connues, sans doublon, au moins une ; `ALL` emporte le
 * reste (rendu seul). `null` si la liste est vide ou porte une inconnue.
 */
export function parseStaffMessageCategories(value: unknown): StaffMessageCategory[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > STAFF_MESSAGE_CATEGORIES.length * 2) return null;
  const picked = new Set<StaffMessageCategory>();
  for (const item of value) {
    if (typeof item !== "string" || !(STAFF_MESSAGE_CATEGORIES as readonly string[]).includes(item)) return null;
    picked.add(item as StaffMessageCategory);
  }
  if (picked.has("ALL")) return ["ALL"];
  return STAFF_MESSAGE_CATEGORIES.filter((category) => picked.has(category));
}

/** Un engagé, tel que le service le lit : membre d'une équipe (ses rôles), ou joueur d'une entrée solo. */
export type StaffMessageEntrant = { roles: readonly TeamRole[]; solo: boolean };

/**
 * Le membre relève-t-il d'une des catégories ? Le joueur d'une entrée solo est
 * un joueur (`PLAYERS`, `ALL`), sans rôle d'équipe ; un membre d'équipe est un
 * joueur s'il porte un rôle de jeu (`TANK`, `DPS`, `HEAL`).
 */
export function matchesStaffMessageCategories(
  entrant: StaffMessageEntrant,
  categories: readonly StaffMessageCategory[],
): boolean {
  return categories.some((category) => {
    if (category === "ALL") return true;
    if (category === "PLAYERS") return entrant.solo || entrant.roles.some((role) => PLAYER_ROLES.includes(role));
    return !entrant.solo && entrant.roles.includes(CATEGORY_ROLE[category]);
  });
}

/** Texte du staff normalisé : fins de ligne unifiées, bords rognés ; la validation est à part. */
export function normalizeStaffMessage(value: unknown): string | null {
  if (typeof value !== "string") return null;
  return value.replace(/\r\n?/g, "\n").trim();
}

/** Les deux temps d'un message : l'aperçu compté, puis l'envoi. */
export type StaffMessageMode = "preview" | "send";

/** Ce que les deux portes (bot, fiche du site) reçoivent en commun. */
export type StaffMessageDraft = {
  mode: StaffMessageMode;
  categories: StaffMessageCategory[];
  message: string;
};

/**
 * Lit le temps, les catégories et le texte d'un corps de requête ; rend le
 * code du refus sinon. Le texte vide est refusé ici, sa longueur par le
 * service (elle se juge sur le message privé rendu).
 */
export function parseStaffMessageDraft(body: Readonly<Record<string, unknown>>): StaffMessageDraft | string {
  const mode = body.mode;
  if (mode !== "preview" && mode !== "send") return STAFF_MESSAGE_ERRORS.invalidRequest;
  const categories = parseStaffMessageCategories(body.categories);
  if (!categories) return STAFF_MESSAGE_ERRORS.invalidCategories;
  const message = normalizeStaffMessage(body.message);
  if (message === null) return STAFF_MESSAGE_ERRORS.invalidRequest;
  if (message.length === 0) return STAFF_MESSAGE_ERRORS.emptyMessage;
  return { mode, categories, message };
}

/** Ce que le message privé nomme. */
export type StaffMessageDmInput = {
  tournamentName: string;
  message: string;
  /** Adresse absolue de la fiche du tournoi, en français ; `null` sans `APP_URL`. */
  tournamentUrl: string | null;
  /** Adresse absolue des réglages de notifications, en français ; `null` sans `APP_URL`. */
  settingsUrl: string | null;
};

/**
 * Le message privé dans une langue. Le staff n'est jamais nommé (« le staff du
 * tournoi ») ; le nom du tournoi par `discordQuoted`, le texte du staff cité
 * ligne à ligne par `discordQuote` (balisage, mentions et liens masqués
 * neutralisés). Les liens du site entre chevrons : pas d'aperçu.
 */
export function formatStaffMessageDm(input: StaffMessageDmInput, locale: Locale): string {
  const name = discordQuoted(input.tournamentName, locale);
  const quoted = discordQuote(input.message);
  const tournamentUrl = input.tournamentUrl ? localizedSiteUrl(input.tournamentUrl, locale) : null;
  const settingsUrl = input.settingsUrl ? localizedSiteUrl(input.settingsUrl, locale) : null;
  if (locale === "en") {
    return [
      `📣 **BlueGenji — Message from the staff of the tournament ${name}**`,
      quoted,
      tournamentUrl ? `Tournament: <${tournamentUrl}>` : null,
      settingsUrl
        ? `You get this message because you take part in this tournament. You can turn off tournament staff messages in your profile, Notifications section: <${settingsUrl}>`
        : "You get this message because you take part in this tournament. You can turn off tournament staff messages in “My profile”, Notifications section, on the site.",
    ]
      .filter((line): line is string => line !== null)
      .join("\n");
  }
  return [
    `📣 **BlueGenji — Message du staff du tournoi ${name}**`,
    quoted,
    tournamentUrl ? `Tournoi : <${tournamentUrl}>` : null,
    settingsUrl
      ? `Tu reçois ce message parce que tu participes à ce tournoi. Tu peux couper les messages du staff des tournois dans ton profil, section Notifications : <${settingsUrl}>`
      : "Tu reçois ce message parce que tu participes à ce tournoi. Tu peux couper les messages du staff des tournois dans « Mon profil », section Notifications, sur le site.",
  ]
    .filter((line): line is string => line !== null)
    .join("\n");
}

/** Le message privé, rédigé dans la langue de chaque destinataire (`notifyUsers`). */
export function staffMessageDm(input: StaffMessageDmInput): LocalizedDm {
  return (locale) => formatStaffMessageDm(input, locale);
}

/**
 * Le texte du staff peut-il partir ? `null` si oui, sinon le code du refus :
 * vide (ou rien de visible une fois neutralisé), trop long, ou message privé
 * rendu qui dépasserait le plafond du bot dans l'une des deux langues — le bot
 * le couperait au milieu d'une phrase.
 */
export function staffMessageRefusal(input: StaffMessageDmInput): string | null {
  if (discordQuote(input.message).length === 0 || discordInline(input.message).trim().length === 0) {
    return STAFF_MESSAGE_ERRORS.emptyMessage;
  }
  if ([...input.message].length > STAFF_MESSAGE_MAX_LENGTH) return STAFF_MESSAGE_ERRORS.messageTooLong;
  const tooLong = (["fr", "en"] as const).some((locale) => formatStaffMessageDm(input, locale).length > DM_MAX_LENGTH);
  return tooLong ? STAFF_MESSAGE_ERRORS.messageTooLong : null;
}

/** Destinataires, comptés : jamais un nom ni un identifiant. */
export type StaffMessageRecipientCounts = {
  /** Comptes distincts visés par les catégories. */
  total: number;
  /** Joignables en message privé (Discord prouvé), sujet non coupé. */
  reachable: number;
  /** Sans Discord rattaché ni tag certifié : la notification push seule. */
  withoutDiscord: number;
  /** Ont coupé le sujet dans « Mon profil » : ni message privé, ni push. */
  optedOut: number;
};

/** Bilan d'un envoi, compté. */
export type StaffMessageDelivery = {
  /** Messages privés remis. */
  sent: number;
  /** Messages privés non remis (absents des serveurs, messages privés fermés, bot injoignable). */
  failed: number;
  /** Non tentés : sujet coupé ou sans Discord. */
  skipped: number;
  /** Appareils atteints en push. */
  pushed: number;
  /** Le bot n'a pas répondu (aucun message privé n'a pu être confirmé). */
  botUnreachable: boolean;
};
