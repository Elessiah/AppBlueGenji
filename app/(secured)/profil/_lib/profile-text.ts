/**
 * Les phrases de `/profil` dans la langue de la page (lot 9-2 de la
 * traduction, espace `profile`).
 *
 * Les modules purs partagés (`discord-tag-lock.ts`, `battletag-lock.ts`,
 * `account-deletion.ts`, `account-connections.ts`) gardent leurs phrases
 * françaises — elles servent aussi au serveur et à d'autres écrans — ; l'écran
 * lit ici une **fonction sœur**, qui suit la même règle de choix (les mêmes
 * cas, dans le même ordre) et rédige dans la langue du texte. Le français de
 * chacune égale celui de la fonction d'origine, cas par cas (testé).
 */
import frProfile from "@/messages/fr/profile.json";
import { ACCOUNT_DELETION_JOURNAL_RETENTION_DAYS, BACKUP_RETENTION_DAYS } from "@/lib/shared/account-deletion-journal";
import { SESSION_GONE_CODES, type ConfirmationSubject } from "@/lib/shared/account-deletion";
import type {
  AccountConnection,
  ConnectionUnlinkRefusal,
  DiscordBotNoteCode,
  DiscordBotRowState,
} from "@/lib/shared/account-connections";
import { CONNECTION_LOG_RETENTION_DAYS } from "@/lib/shared/connection-logs";
import { OAUTH_PROVIDER_LABELS, type OAuthProvider } from "@/lib/shared/oauth-providers";
import { messageAt, type Leaves } from "@/lib/shared/scoped-text";
import { visibleText } from "@/lib/shared/visible-text";
import { FR_PROFILE_TEXT, type ProfileText } from "@/components/i18n/profile-text";

export type { ProfileText } from "@/components/i18n/profile-text";

/** Le français du paquet — hors fournisseur, tests ; le même objet que celui du fournisseur. */
export const FR_PROFILE: ProfileText = FR_PROFILE_TEXT;

type Key = Leaves<typeof frProfile>;

// ─── Verrous des champs (Discord, BattleTag) ────────────────────────────────

/** `discordTagLockNotice` dans la langue du texte. */
export function discordTagLockText(
  text: ProfileText,
  state: { tag: string | null; verified: boolean; linked: boolean | null; pending?: boolean },
): string {
  const { t } = text;
  if (state.pending && state.linked !== true) return t("discord.lock.pending");
  if (state.linked !== true) return t("discord.lock.unknown");
  if (!state.tag) return t("discord.lock.noTag");
  const rename = t("discord.lock.rename");
  if (!state.verified) return t("discord.lock.unverified", { audience: t("discord.unverifiedAudience"), rename });
  return t("discord.lock.verified", { audience: t("discord.audience"), rename });
}

/** `battletagLockNotice` dans la langue du texte. */
export function battletagLockText(
  text: ProfileText,
  state: { tag: string | null; linked: boolean | null; pending?: boolean },
): string {
  const { t } = text;
  if (state.pending && state.linked !== true) return t("battletagLock.pending");
  if (state.linked !== true) return t("battletagLock.unknown");
  const change = t("battletagLock.change");
  return state.tag ? t("battletagLock.tagged", { change }) : t("battletagLock.noTag", { change });
}

// ─── Suppression du compte ──────────────────────────────────────────────────

const RETENTION_REASONS = ["TOURNAMENTS", "SOLO_REGISTRATIONS", "ORGANIZED_TOURNAMENTS", "OWNED_TEAMS"] as const;

/** Le cas d'une phrase de suppression : un motif, `NONE` (effacement), ou `UNKNOWN`. */
function deletionCase(subject: ConfirmationSubject): (typeof RETENTION_REASONS)[number] | "NONE" | "UNKNOWN" {
  if (subject === null) return "NONE";
  const reason = RETENTION_REASONS.find((value) => value === subject);
  return reason ?? "UNKNOWN";
}

/** `accountDeletionConsequences` (corps de la modale, sans la question) dans la langue du texte. */
export function deletionConsequencesText(text: ProfileText, subject: ConfirmationSubject): string {
  const { t } = text;
  const residual = t("deletion.residual", {
    backupDays: BACKUP_RETENTION_DAYS,
    journalDays: ACCOUNT_DELETION_JOURNAL_RETENTION_DAYS,
    logDays: CONNECTION_LOG_RETENTION_DAYS,
  });
  const consequence = t(`deletion.consequences.${deletionCase(subject)}`);
  return [consequence, residual, t("deletion.irreversible")].join(" ");
}

/** `accountDeletionOutcome` dans la langue du texte. */
export function deletionOutcomeText(text: ProfileText, subject: ConfirmationSubject): string {
  return text.t(`deletion.outcome.${deletionCase(subject)}`);
}

/** `accountDeletionErrorMessage` dans la langue du texte. */
export function deletionErrorText(text: ProfileText, code: string | undefined): string {
  if (code === "ACCOUNT_STILL_REFERENCED") return text.t("deletion.errors.ACCOUNT_STILL_REFERENCED");
  // Session ou compte déjà partis (une suppression faite dont la réponse s'est
  // perdue) : la page se recharge — cas propre à l'écran, sans sœur française.
  if (code !== undefined && SESSION_GONE_CODES.has(code)) return text.t("deletion.errors.sessionGone");
  return text.t("deletion.errors.fallback");
}

// ─── Applications connectées ────────────────────────────────────────────────

/** Une phrase d'une table du texte par son code, ou `null` (`code in` remonterait les prototypes). */
export function lookupCode(
  text: ProfileText,
  table: "errors.write" | "errors.shared" | "verification.errors" | "handleUpdate.errors" | "connections.errors",
  code: string | null | undefined,
  values?: Record<string, string | number>,
): string | null {
  if (!code) return null;
  const key = `${table}.${code}`;
  // `messageAt` ne rend qu'une phrase : `constructor`, `__proto__` ou une
  // sous-table ne passent pas pour un code connu.
  if (messageAt(frProfile, key) === undefined) return null;
  return text.t(key as Key, values);
}

/** `connectionUnlinkRefusalMessage` dans la langue du texte. */
export function connectionRefusalText(text: ProfileText, refusal: ConnectionUnlinkRefusal, provider: OAuthProvider): string {
  return text.t(`connections.refusal.${refusal}`, { label: OAUTH_PROVIDER_LABELS[provider] });
}

/** `connectionMethodLabel` dans la langue du texte (`null` : rien à dire). */
export function connectionMethodText(text: ProfileText, connection: AccountConnection): string | null {
  if (!connection.linked || connection.method === null) return null;
  if (connection.provider !== "DISCORD") return null;
  return text.t(connection.method === "OAUTH" ? "connections.method.OAUTH" : "connections.method.DM_CODE");
}

/** Ce que la ligne du bot dit, dans la langue du texte : la traduction des codes de `discordBotRowState`. */
export function discordBotRowText(
  text: ProfileText,
  row: Pick<DiscordBotRowState, "noteCode" | "handle" | "refusalCode">,
): { note: string; refusal: string | null } {
  const { t } = text;
  return {
    note: discordBotNote(text, row.noteCode, row.handle),
    // Le seul refus de la ligne : le dernier moyen de connexion.
    refusal: row.refusalCode === "LAST_CONNECTION" ? t("connections.bot.lastConnection") : null,
  };
}

/** La note de la ligne du bot, par son code (exhaustif : un code ajouté ne compile pas sans sa phrase). */
function discordBotNote(text: ProfileText, code: DiscordBotNoteCode, handle: string | null): string {
  switch (code) {
    case "HANDLE":
      return text.t("connections.bot.handleNote", { handle: visibleText(handle ?? "") });
    case "LINKED_BY_CODE":
      return text.t("connections.bot.linkedByCode");
    case "LINKED_BY_BUTTON":
      return text.t("connections.bot.linkedByButton");
    case "LINKED_ELSEWHERE":
      return text.t("connections.bot.linkedElsewhere");
    case "NOT_LINKED":
      return text.t("connections.bot.notLinked");
  }
}

/** Libellés du badge « tag certifié » (`VerifiedBadge`), communs au profil et au dialogue de certification. */
export function verifiedBadgeLabels(text: ProfileText): { alt: string; title: string } {
  return { alt: text.t("discord.verifiedAlt"), title: text.t("discord.verifiedTitle") };
}
