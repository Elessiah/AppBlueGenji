/**
 * Textes de la page de connexion (`/connexion`, `/en/connexion`), espace de
 * messages `login` — lot 6 (`docs/features/I18N.md` § Connexion).
 *
 * Même mécanique que l'accueil (`landing-text.ts`) : **pas** de `next-intl`
 * dans le navigateur. Le français est inclus dans le paquet (il remplace les
 * chaînes écrites en dur, rien de plus) ; l'anglais ne voyage que sous `/en`,
 * passé par la page au fournisseur `LoginTextProvider`.
 *
 * Les tables françaises partagées avec d'autres écrans ou avec Discord
 * (`suspendedLoginMessage`, `DISCORD_TAG_AUDIENCE`, `TERMS_CHECKBOX_LABEL`…)
 * restent en place ; un test vérifie que les messages français les égalent.
 */
import frLogin from "@/messages/fr/login.json";
import { DEFAULT_LOCALE, INTL_LOCALE, SITE_TIME_ZONE, type Locale } from "@/lib/shared/locales";
import { scopedText, type Leaves, type ScopedText } from "@/lib/shared/scoped-text";

export type LoginMessages = typeof frLogin;
export type LoginKey = Leaves<LoginMessages>;
export type LoginText = ScopedText<LoginKey>;

export const FR_LOGIN_MESSAGES: LoginMessages = frLogin;

/** Formateur de la page de connexion ; le français du paquet hors fournisseur. */
export function loginText(locale: Locale = DEFAULT_LOCALE, messages: LoginMessages = FR_LOGIN_MESSAGES): LoginText {
  return scopedText(locale, messages);
}

/** Français par défaut, construit une fois : les registres d'erreurs l'emploient sans fournisseur. */
export const FR_LOGIN_TEXT: LoginText = loginText(DEFAULT_LOCALE);

/**
 * Fin d'une suspension, à l'heure de Paris dans les deux langues — « 6 octobre
 * 2026 à 21:00 (heure de Paris) » / « October 6, 2026 at 21:00 (Paris time) ».
 * Le français reprend `formatSuspensionEnd` (journal et message Discord), égalité testée.
 */
export function suspensionEndText(text: LoginText, endsAt: Date | string): string {
  const date = typeof endsAt === "string" ? new Date(endsAt) : endsAt;
  const intl = INTL_LOCALE[text.locale];
  const day = date.toLocaleDateString(intl, { day: "numeric", month: "long", year: "numeric", timeZone: SITE_TIME_ZONE });
  const time = date.toLocaleTimeString(intl, { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: SITE_TIME_ZONE });
  return text.t("suspension.end", { day, time });
}

/** Date valide, ou `null` (absente, illisible). */
function validDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  const date = typeof value === "string" ? new Date(value) : value;
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Phrase d'une connexion refusée à un compte suspendu, quand l'exposé complet
 * n'a pas voyagé (toast) — équivalent de `suspendedLoginMessage`.
 */
export function suspendedLoginText(text: LoginText, endsAt: string | null | undefined): string {
  const date = validDate(endsAt);
  return date ? text.t("suspension.loginUntil", { end: suspensionEndText(text, date) }) : text.t("suspension.loginIndefinite");
}

/** Première phrase de l'exposé d'une suspension (`SuspensionNoticeDialog`). */
export function suspensionSpanText(text: LoginText, endsAt: string | null, reference: string): string {
  const date = validDate(endsAt);
  return date
    ? text.t("suspension.spanUntil", { end: suspensionEndText(text, date), reference })
    : text.t("suspension.spanIndefinite", { reference });
}

/**
 * Heure d'expiration du code Discord, sur 24 h dans le fuseau du visiteur
 * (c'est sa montre qu'il compare), dans la langue de la page.
 */
export function codeExpiryTime(locale: Locale, expiresAt: string | undefined): string {
  const date = validDate(expiresAt ?? null);
  if (!date) return "—";
  return date.toLocaleTimeString(INTL_LOCALE[locale], { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
}
