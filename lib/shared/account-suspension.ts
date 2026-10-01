/**
 * Suspension d'un compte par la modération — module pur.
 *
 * Les conditions d'utilisation annonçaient la suspension d'un compte sans que
 * le site ait ni l'outil ni la procédure pour la prononcer. Elle est désormais
 * une **décision de modération** comme le retrait d'une image : prise par une
 * personne détenant la permission `moderation`, jamais par un automate, et
 * motivée à la personne visée (DSA, art. 17.3) — ce qui est décidé et pour
 * combien de temps, les faits retenus, la clause des conditions invoquée, et
 * les voies de recours, internes **puis** judiciaires.
 *
 * **Effets** (`lib/server/account-suspensions.ts`) : les sessions du compte
 * sont effacées au prononcé, et toute ouverture de session est refusée tant
 * que la suspension court — par les quatre portes, qui passent toutes par
 * `createSession`. La lecture de session (`getCurrentUser`) écarte en outre un
 * compte suspendu : c'est elle qui tranche la course d'une connexion ouverte
 * pendant le prononcé, le refus lisible n'étant donné que par le contrôle
 * préalable.
 *
 * **Contester** : le compte ne peut plus ouvrir de session, donc ni la page
 * d'un signalement ni la catégorie « Contestation » (qui exige d'être
 * connecté) ne lui sont ouvertes. La voie est l'équivalent sans compte : le
 * formulaire « Signaler un problème », catégorie « Autre », en citant la
 * référence de la décision (`suspensionReference`) — l'association réexamine
 * alors sa décision, avant tout recours au juge.
 *
 * Module pur, importable partout.
 */
import { discordInline } from "./discord-text";
import { ANONYMOUS_PLAYER_LABEL } from "./log-privacy";

/**
 * Clause des conditions d'utilisation qui fonde une suspension — chacune est
 * une section de `TERMS_SECTIONS`, dont elle reprend l'ancre.
 */
export type SuspensionGround = "ACCOUNT" | "BEHAVIOR" | "CONTENT";

export const SUSPENSION_GROUNDS: readonly SuspensionGround[] = ["BEHAVIOR", "CONTENT", "ACCOUNT"];

export const SUSPENSION_GROUND_DEFINITIONS: Record<
  SuspensionGround,
  { anchor: string; clause: string; label: string }
> = {
  BEHAVIOR: {
    anchor: "comportement",
    clause: "Comportement",
    label: "Comportement — harcèlement, propos haineux, triche, contournement des protections",
  },
  CONTENT: {
    anchor: "contenus",
    clause: "Contenus publiés par les utilisateurs",
    label: "Contenus publiés — atteinte aux droits d'un tiers, contenu illicite",
  },
  ACCOUNT: {
    anchor: "compte",
    clause: "Compte",
    label: "Compte — usurpation, compte prêté ou partagé, pseudo contraire aux règles",
  },
};

export function isSuspensionGround(value: unknown): value is SuspensionGround {
  return typeof value === "string" && (SUSPENSION_GROUNDS as readonly string[]).includes(value);
}

/**
 * Bornes du motif. Le minimum refuse un motif de convenance (« abus ») qui ne
 * dirait aucun fait ; le maximum tient le message privé sous la limite d'un
 * message Discord, le reste de l'exposé des motifs compris.
 */
export const SUSPENSION_REASON_MIN_LENGTH = 10;
export const SUSPENSION_REASON_MAX_LENGTH = 500;

/** Durées proposées par le formulaire, en jours ; `null` = durée indéterminée. */
export const SUSPENSION_DURATION_PRESETS: readonly (number | null)[] = [1, 3, 7, 14, 30, 90, 365, null];

/** Durée maximale d'une suspension à terme ; au-delà, elle se prononce indéterminée. */
export const SUSPENSION_MAX_DAYS = 365;

/**
 * Délai de conservation d'une suspension terminée (levée ou échue), en mois :
 * celui de la contestation d'une décision de modération (DSA, art. 20.1), que
 * l'association applique aussi aux images (`LOGO_QUARANTINE_MONTHS`).
 */
export const SUSPENSION_RETENTION_MONTHS = 6;

export type SuspensionErrorCode =
  | "SUSPENSION_REASON_REQUIRED"
  | "SUSPENSION_REASON_TOO_LONG"
  | "SUSPENSION_INVALID_GROUND"
  | "SUSPENSION_DURATION_REQUIRED"
  | "SUSPENSION_INVALID_DURATION";

export interface SuspensionInput {
  reason: string;
  ground: SuspensionGround;
  /** Durée en jours ; `null` = indéterminée. */
  durationDays: number | null;
}

export type SuspensionValidation = { ok: true; value: SuspensionInput } | { ok: false; error: SuspensionErrorCode };

/**
 * Motif d'une décision de modération, nettoyé : une ligne (les retours à la
 * ligne deviennent des espaces — le motif est cité dans un message d'une
 * ligne), espaces en tête et en fin retirés. Partagé avec le motif exigé au
 * retrait d'une image hors signalement.
 */
export function cleanModerationReason(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim();
}

/**
 * Valide la demande de suspension. L'ordre des refus suit le formulaire : le
 * motif, la clause, la durée.
 *
 * La durée est **exigée** : un champ absent ne vaut pas « indéterminée » —
 * c'est la sanction la plus lourde, elle se choisit (`durationDays: null`).
 */
export function validateSuspensionInput(input: unknown): SuspensionValidation {
  const raw = (typeof input === "object" && input !== null ? input : {}) as Record<string, unknown>;

  const reason = cleanModerationReason(raw.reason);
  if (reason.length < SUSPENSION_REASON_MIN_LENGTH) return { ok: false, error: "SUSPENSION_REASON_REQUIRED" };
  if (reason.length > SUSPENSION_REASON_MAX_LENGTH) return { ok: false, error: "SUSPENSION_REASON_TOO_LONG" };

  if (!isSuspensionGround(raw.ground)) return { ok: false, error: "SUSPENSION_INVALID_GROUND" };

  if (!("durationDays" in raw) || raw.durationDays === undefined) {
    return { ok: false, error: "SUSPENSION_DURATION_REQUIRED" };
  }
  const duration = raw.durationDays;
  if (duration !== null) {
    if (typeof duration !== "number" || !Number.isInteger(duration) || duration < 1 || duration > SUSPENSION_MAX_DAYS) {
      return { ok: false, error: "SUSPENSION_INVALID_DURATION" };
    }
  }

  return { ok: true, value: { reason, ground: raw.ground, durationDays: duration } };
}

/** Une suspension, telle que la modération la lit et que l'export la rend. */
export interface AccountSuspensionView {
  id: number;
  reason: string;
  ground: SuspensionGround;
  startsAt: string;
  /** `null` = durée indéterminée. */
  endsAt: string | null;
  liftedAt: string | null;
}

/**
 * La suspension court-elle à `now` ? Ni levée, commencée, et sans échéance ou
 * avant elle. Même règle que la condition SQL de
 * `lib/server/account-suspensions.ts` (`ACTIVE_SUSPENSION_SQL`).
 */
export function isSuspensionActive(
  suspension: Pick<AccountSuspensionView, "startsAt" | "endsAt" | "liftedAt">,
  now: Date,
): boolean {
  if (suspension.liftedAt !== null) return false;
  if (new Date(suspension.startsAt).getTime() > now.getTime()) return false;
  return suspension.endsAt === null || new Date(suspension.endsAt).getTime() > now.getTime();
}

/** Référence publique d'une décision, à citer pour la contester. */
export function suspensionReference(id: number): string {
  return `S-${id}`;
}

/**
 * Échéance lisible, **en heure de Paris** : le message part d'un serveur pour
 * un lecteur dont on ne connaît pas le fuseau.
 */
export function formatSuspensionEnd(endsAt: Date | string): string {
  const date = typeof endsAt === "string" ? new Date(endsAt) : endsAt;
  const day = date.toLocaleDateString("fr-FR", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Europe/Paris",
  });
  const time = date.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Paris" });
  return `${day} à ${time} (heure de Paris)`;
}

/** Échéance d'une suspension : `null` pour une durée indéterminée. */
export type SuspensionEndsAt = Date | string | null;

/** « jusqu'au … » ou « pour une durée indéterminée ». */
export function suspensionSpan(endsAt: SuspensionEndsAt): string {
  return endsAt === null ? "pour une durée indéterminée" : `jusqu'au ${formatSuspensionEnd(endsAt)}`;
}

/** Le moyen de contester, sans compte — la même phrase partout où elle se lit. */
export function suspensionContestText(reference: string | null): string {
  const cite = reference ? `en citant la décision ${reference}` : "en citant la décision reçue";
  return (
    `« Signaler un problème », en bas de chaque page du site, catégorie « Autre » (sans connexion), ${cite} ` +
    `et en laissant un moyen de te répondre : l'association réexamine sa décision`
  );
}

/**
 * Message privé au titulaire d'un compte suspendu — l'exposé des motifs
 * (DSA, art. 17.3) : décision et durée, faits retenus (le motif saisi),
 * absence de traitement automatisé, clause invoquée, recours internes puis
 * judiciaires. Il ne nomme **personne** d'autre que son destinataire : le
 * motif est saisi par la modération, invitée par le formulaire à ne citer
 * aucun autre joueur.
 */
export function formatSuspensionNotice(input: {
  id: number;
  reason: string;
  ground: SuspensionGround;
  endsAt: SuspensionEndsAt;
  termsUrl: string;
}): string {
  const reference = suspensionReference(input.id);
  const clause = SUSPENSION_GROUND_DEFINITIONS[input.ground].clause;
  return (
    `⛔ BlueGenji — Ton compte sur le site a été suspendu ${suspensionSpan(input.endsAt)} (décision ${reference}). ` +
    `Tes sessions ont été fermées et tu ne peux plus te connecter tant que la suspension court. ` +
    `Faits retenus : ${discordInline(input.reason)}. ` +
    `Décision prise par un membre de la modération, sans traitement automatisé. ` +
    `Fondement : conditions d'utilisation, « ${clause} » — ${input.termsUrl}. ` +
    `Recours : ${suspensionContestText(reference)}. Tu peux ensuite porter la décision devant le juge compétent.`
  );
}

/** Message privé au titulaire d'un compte dont la suspension est levée. */
export function formatSuspensionLiftedNotice(id: number): string {
  return `✅ BlueGenji — La suspension de ton compte (décision ${suspensionReference(id)}) a été levée : tu peux de nouveau te connecter au site.`;
}

/**
 * Ligne du journal du staff sur Discord — **jamais** le pseudo du joueur
 * (`lib/shared/log-privacy.ts`), ni le motif, qui en nommerait peut-être un.
 */
export function formatSuspensionLog(input: { id: number; ground: SuspensionGround; endsAt: SuspensionEndsAt }): string {
  return (
    `⛔ Compte d'${ANONYMOUS_PLAYER_LABEL} suspendu par le staff ${suspensionSpan(input.endsAt)} ` +
    `(décision ${suspensionReference(input.id)}, clause « ${SUSPENSION_GROUND_DEFINITIONS[input.ground].clause} »).`
  );
}

/** Ligne du journal du staff pour une suspension levée. */
export function formatSuspensionLiftedLog(id: number): string {
  return `✅ Suspension ${suspensionReference(id)} levée par le staff.`;
}

/**
 * Refus lisible d'une connexion, sur la page de connexion. `endsAt` vient du
 * serveur (ISO) ; illisible ou absent, la suspension est dite indéterminée
 * plutôt qu'inventée à une date.
 */
export function suspendedLoginMessage(endsAt: string | null | undefined): string {
  const date = endsAt ? new Date(endsAt) : null;
  const span = date && !Number.isNaN(date.getTime()) ? suspensionSpan(date) : "pour une durée indéterminée";
  return (
    `Ce compte est suspendu ${span}. Le motif t'a été envoyé en message privé Discord si ton compte y est rattaché. ` +
    `Pour contester : ${suspensionContestText(null)} — puis, le cas échéant, le juge compétent.`
  );
}

/** Code d'erreur des portes d'entrée pour un compte suspendu. */
export const ACCOUNT_SUSPENDED = "ACCOUNT_SUSPENDED";

/**
 * L'exposé d'une suspension montré à la tentative de connexion refusée.
 *
 * C'est le seul moment où le lecteur a **prouvé** être le titulaire (il vient
 * de passer une porte d'entrée), et le seul canal qui atteigne un compte sans
 * Discord : le message privé ne joint que les comptes rattachés. L'exposé y est
 * donc donné en entier — motif compris —, jamais dans une URL (historique,
 * journaux des relais) : par le corps de la réponse pour le code Discord, par
 * un cookie `httpOnly` de courte durée pour un retour OAuth, qui n'a qu'une
 * redirection pour parler.
 */
export interface SuspensionNotice {
  reference: string;
  reason: string;
  ground: SuspensionGround;
  endsAt: string | null;
}

/** Cookie qui porte l'exposé jusqu'à la page de connexion après un retour OAuth. */
export const SUSPENSION_NOTICE_COOKIE = "bg_suspension_notice";

/** Durée de vie de ce cookie : le temps d'une redirection et d'une lecture. */
export const SUSPENSION_NOTICE_COOKIE_MAX_AGE_SECONDS = 10 * 60;

/**
 * En-tête de **requête** par lequel le middleware remet l'exposé à la page de
 * connexion, le cookie étant effacé dans la même réponse (`middleware.ts`).
 */
export const SUSPENSION_NOTICE_HEADER = "x-bg-suspension-notice";

export function toSuspensionNotice(suspension: Pick<AccountSuspensionView, "id" | "reason" | "ground" | "endsAt">): SuspensionNotice {
  return {
    reference: suspensionReference(suspension.id),
    reason: suspension.reason,
    ground: suspension.ground,
    endsAt: suspension.endsAt,
  };
}

/**
 * Encode l'exposé pour le cookie, en **base64url** des octets UTF-8 du JSON.
 *
 * Pas en `encodeURIComponent` : Next réencode la valeur d'un cookie, si bien
 * qu'un octet non ASCII prenait neuf caractères, et un motif de 500 caractères
 * accentués ou cyrilliques dépassait les 4 096 octets qu'un navigateur accepte —
 * le cookie était ignoré sans bruit, et le compte sans Discord, pour qui ce
 * canal existe, ne lisait que la phrase générique. En base64url, qu'aucun
 * encodage ne touche plus, 500 unités UTF-16 font au plus 1 500 octets, soit
 * 2 000 caractères.
 */
export function encodeSuspensionNotice(notice: SuspensionNotice): string {
  const bytes = new TextEncoder().encode(JSON.stringify(notice));
  let binary = "";
  for (const byte of bytes) binary += String.fromCodePoint(byte);
  const base64 = btoa(binary);
  // Le bourrage « = » n'apparaît qu'en fin de chaîne : on coupe au premier.
  const padding = base64.indexOf("=");
  const unpadded = padding === -1 ? base64 : base64.slice(0, padding);
  return unpadded.replace(/\+/g, "-").replace(/\//g, "_");
}

function decodeBase64Url(value: string): string {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(base64 + "=".repeat((4 - (base64.length % 4)) % 4));
  const bytes = Uint8Array.from(binary, (char) => char.codePointAt(0) ?? 0);
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

/**
 * Relit un exposé reçu (cookie, corps de réponse). Tout ce qui n'a pas la
 * forme attendue rend `null` : la page retombe alors sur le refus générique
 * plutôt que d'afficher une valeur illisible. Le cookie n'est pas signé et
 * n'a pas à l'être — il ne sert qu'à afficher, à son propre navigateur, ce
 * que le serveur y a écrit ; le contrefaire ne montrerait que sa contrefaçon.
 */
export function parseSuspensionNotice(value: unknown): SuspensionNotice | null {
  let raw: unknown = value;
  if (typeof value === "string") {
    try {
      raw = JSON.parse(decodeBase64Url(value));
    } catch {
      return null;
    }
  }
  if (typeof raw !== "object" || raw === null) return null;
  const candidate = raw as Record<string, unknown>;
  if (typeof candidate.reference !== "string" || !/^S-\d+$/.test(candidate.reference)) return null;
  if (typeof candidate.reason !== "string" || candidate.reason.length > SUSPENSION_REASON_MAX_LENGTH) return null;
  if (!isSuspensionGround(candidate.ground)) return null;
  if (candidate.endsAt !== null) {
    if (typeof candidate.endsAt !== "string" || Number.isNaN(new Date(candidate.endsAt).getTime())) return null;
  }
  return {
    reference: candidate.reference,
    reason: candidate.reason,
    ground: candidate.ground,
    endsAt: candidate.endsAt as string | null,
  };
}

/** Les refus des routes de suspension, dits en français (toasts du panneau). */
export function suspensionErrorMessage(code: string): string {
  switch (code) {
    case "SUSPENSION_REASON_REQUIRED":
      return `Décris les faits retenus (${SUSPENSION_REASON_MIN_LENGTH} caractères au moins) : ils sont envoyés au joueur.`;
    case "SUSPENSION_REASON_TOO_LONG":
      return `Le motif ne peut pas dépasser ${SUSPENSION_REASON_MAX_LENGTH} caractères.`;
    case "SUSPENSION_INVALID_GROUND":
      return "Choisis la clause des conditions d'utilisation qui fonde la suspension.";
    case "SUSPENSION_DURATION_REQUIRED":
    case "SUSPENSION_INVALID_DURATION":
      return "Choisis une durée, ou « durée indéterminée ».";
    case "ACCOUNT_ALREADY_SUSPENDED":
      return "Ce compte est déjà suspendu : lève la suspension en cours avant d'en prononcer une autre.";
    case "NO_ACTIVE_SUSPENSION":
      return "Ce compte n'a pas de suspension en cours.";
    case "CANNOT_SUSPEND_SELF":
      return "Tu ne peux pas suspendre ton propre compte.";
    case "CANNOT_SUSPEND_ADMIN":
      return "Un compte administrateur ne se suspend pas : retire-lui d'abord ce rôle.";
    case "USER_NOT_FOUND":
      return "Ce compte n'existe plus.";
    default:
      return "La décision n'a pas pu être enregistrée. Réessaie dans un instant.";
  }
}
