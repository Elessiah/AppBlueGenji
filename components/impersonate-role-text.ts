/**
 * Textes de la modale « Incarner un rôle » (`messages/<langue>/impersonate.json`),
 * lus **dans le morceau chargé à l'ouverture** de la modale : ni le paquet
 * commun ni la charge utile des pages (`/en`) ne les portent
 * (`docs/features/ADMIN_ROLE_IMPERSONATION.md`). Seuls les noms de rôles de la
 * bannière restent dans la coquille (`shell.json`, `impersonate.roles.*.label`).
 */
import enImpersonate from "@/messages/en/impersonate.json";
import frImpersonate from "@/messages/fr/impersonate.json";
import type { Locale } from "@/lib/shared/locales";
import { scopedText, type Leaves, type ScopedText } from "@/lib/shared/scoped-text";

export type ImpersonateMessages = typeof frImpersonate;
export type ImpersonateKey = Leaves<ImpersonateMessages>;
export type ImpersonateText = ScopedText<ImpersonateKey>;

const MESSAGES: Readonly<Record<Locale, ImpersonateMessages>> = { fr: frImpersonate, en: enImpersonate };

/** Les textes de la modale dans une langue (français pour toute autre). */
export function impersonateText(locale: Locale): ImpersonateText {
  return scopedText(locale, MESSAGES[locale] ?? frImpersonate);
}
