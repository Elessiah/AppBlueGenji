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
import type { ConfirmationSubject } from "@/lib/shared/account-deletion";
import {
  checkConnectionUnlink,
  discordBotLinked,
  type AccountConnection,
  type ConnectionUnlinkRefusal,
} from "@/lib/shared/account-connections";
import { CONNECTION_LOG_RETENTION_DAYS } from "@/lib/shared/connection-logs";
import { OAUTH_PROVIDER_LABELS, type OAuthProvider } from "@/lib/shared/oauth-providers";
import { scopedText, type Leaves, type ScopedText } from "@/lib/shared/scoped-text";

export type ProfileText = ScopedText<Leaves<typeof frProfile>>;

/** Le français du paquet — hors fournisseur, tests. */
export const FR_PROFILE: ProfileText = scopedText("fr", frProfile);

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
  return text.t(code === "ACCOUNT_STILL_REFERENCED" ? "deletion.errors.ACCOUNT_STILL_REFERENCED" : "deletion.errors.fallback");
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
  const node = table.split(".").reduce<unknown>((tree, segment) => (tree as Record<string, unknown>)[segment], frProfile);
  if (!Object.hasOwn(node as object, code)) return null;
  return text.t(`${table}.${code}` as Key, values);
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

/** Ce que la ligne du bot dit (`discordBotRowState().note` / `.refusal`), dans la langue du texte. */
export function discordBotRowText(
  text: ProfileText,
  connections: readonly AccountConnection[],
): { note: string; refusal: string | null } {
  const { t } = text;
  const discord = connections.find((connection) => connection.provider === "DISCORD");
  const anyLinked = Boolean(discord?.linked);
  const linked = discordBotLinked(discord);
  const unlinkRefusal = linked ? checkConnectionUnlink(connections, "DISCORD") : null;
  let note: string;
  if (linked) {
    note = discord?.handle ? t("connections.bot.handleNote", { handle: discord.handle }) : t("connections.bot.linkedByCode");
  } else if (anyLinked) {
    note = discord?.method === "OAUTH" ? t("connections.bot.linkedByButton") : t("connections.bot.linkedElsewhere");
  } else {
    note = t("connections.bot.notLinked");
  }
  return {
    note,
    refusal: unlinkRefusal === "LAST_CONNECTION" ? t("connections.bot.lastConnection") : null,
  };
}
