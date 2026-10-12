"use client";

import enReports from "@/messages/en/reports.json";
import frReports from "@/messages/fr/reports.json";
import { useAppLocale } from "@/components/i18n/locale-context";
import {
  REPORT_DESCRIPTION_MAX_LENGTH,
  REPORT_DESCRIPTION_MIN_LENGTH,
  REPORT_MAX_TARGETS,
  REPORT_RETENTION_DAYS_AFTER_RESOLUTION,
  reportRequiresConsent,
  type ReportCategory,
} from "@/lib/shared/content-reports";
import { LOGO_QUARANTINE_MONTHS } from "@/lib/shared/logo-quarantine";
import type { Locale } from "@/lib/shared/locales";
import { scopedText, type Leaves, type ScopedText } from "@/lib/shared/scoped-text";

/**
 * Textes du formulaire « Signaler un problème » et de la page d'un signalement
 * vu par la personne visée (espace `reports`, lot 9-2).
 *
 * Le formulaire s'ouvre depuis le pied de **chaque** page : il est chargé à la
 * demande (`ReportProblemButton`), et ses **deux** langues voyagent avec son
 * morceau — servies par la mise en page, elles partiraient avec chaque page,
 * formulaire ouvert ou non. La langue vient du contexte de la page.
 *
 * Les phrases engagent l'association (ce qui est collecté, pourquoi, qui le
 * lit, combien de temps) : le français est celui de `content-reports.ts`, mot
 * pour mot (testé) ; la règle qui choisit une phrase (base légale, droits)
 * reste dans ce module pur.
 */
export type ReportsMessages = typeof frReports;
export type ReportsText = ScopedText<Leaves<ReportsMessages>>;

export const FR_REPORTS_TEXT: ReportsText = scopedText("fr", frReports);
const EN_REPORTS_TEXT: ReportsText = scopedText("en", enReports);

export function reportsText(locale: Locale): ReportsText {
  return locale === "en" ? EN_REPORTS_TEXT : FR_REPORTS_TEXT;
}

/** Les textes dans la langue de la page. */
export function useReportsText(): ReportsText {
  return reportsText(useAppLocale());
}

/** `reportErrorMessage` dans la langue du texte : jamais le jeton. */
export function reportErrorText(text: ReportsText, code: string | null | undefined): string {
  if (!code || code === "fallback" || !Object.hasOwn(frReports.errors, code)) return text.t("errors.fallback");
  return text.t(`errors.${code}` as Leaves<ReportsMessages>, {
    min: REPORT_DESCRIPTION_MIN_LENGTH,
    max: code === "REPORT_TOO_MANY_TARGETS" ? REPORT_MAX_TARGETS : REPORT_DESCRIPTION_MAX_LENGTH,
  });
}

/** `reportLegalBasisNotice` dans la langue du texte. */
export function legalBasisText(text: ReportsText, category: ReportCategory): string {
  switch (category) {
    case "RGPD":
      return text.t("privacy.legalBasis.RGPD");
    case "COPYRIGHT":
    case "MODERATION":
      return text.t("privacy.legalBasis.NOTICE");
    case "HOSTING":
      return text.t("privacy.legalBasis.HOSTING");
    case "CONTEST":
      return text.t("privacy.legalBasis.CONTEST");
    default:
      return text.t("privacy.legalBasis.CONSENT");
  }
}

/** `reportRightsNotice` dans la langue du texte. */
export function rightsText(text: ReportsText, category: ReportCategory): string {
  const channel = text.t("privacy.rightsChannel");
  return reportRequiresConsent(category)
    ? text.t("privacy.rightsConsent", { channel })
    : text.t("privacy.rightsNoConsent", { channel });
}

/** `REPORT_PRIVACY_NOTICE.retention` dans la langue du texte. */
export function retentionText(text: ReportsText): string {
  return text.t("privacy.retention", { days: REPORT_RETENTION_DAYS_AFTER_RESOLUTION, months: LOGO_QUARANTINE_MONTHS });
}

/**
 * Précision d'une cible proposée (`ReportTargetOption.detail`). Le serveur la
 * rédige en français (« Équipe fantôme », « Non publié ») — contrat de l'API,
 * inchangé : les deux phrases connues sont rédigées à nouveau ici, un sigle
 * d'équipe passe tel quel.
 */
export function targetDetailText(text: ReportsText, detail: string): string {
  if (detail === frReports.targets.ghostTeam) return text.t("targets.ghostTeam");
  if (detail === frReports.targets.unpublished) return text.t("targets.unpublished");
  return detail;
}
