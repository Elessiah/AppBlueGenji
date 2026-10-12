"use client";

import type { ComponentType } from "react";
import { englishReports as englishLoader } from "@/components/i18n/english-loaders";
import { onceLoader, quietPreload } from "@/lib/shared/lazy-component";
import type { Locale } from "@/lib/shared/locales";
import type { ReportProblemDialogProps } from "./ReportProblemDialog";

/**
 * Le formulaire « Signaler un problème » et son anglais, chargés à la demande
 * (revue de performance du lot 9-2) par le bouton du pied de chaque page.
 * Module sans texte : le bouton l'importe sans rien ajouter au premier
 * chargement.
 */
export type ReportDialog = ComponentType<ReportProblemDialogProps>;

/** Le formulaire, une fois ; un échec se retente (`onceLoader`). */
const dialogLoader = onceLoader<ReportDialog>(() => import("./ReportProblemDialog").then((module) => module.ReportProblemDialog));

/**
 * Une page qui importe déjà le formulaire (`/signalements/[id]`, formulaire de
 * contestation) le remet au chargeur : le pied de page ne le télécharge pas
 * une seconde fois.
 */
export function primeReportDialog(dialog: ReportDialog): void {
  dialogLoader.prime(dialog);
}

/** Le formulaire et, sous `/en`, son anglais. */
export function loadReportForm(locale: Locale): Promise<ReportDialog> {
  if (locale !== "en") return dialogLoader.load();
  return Promise.all([dialogLoader.load(), englishLoader.load()]).then(([dialog]) => dialog);
}

/** Le formulaire déjà là, dans la langue de la page ; `null` sinon. */
export function loadedReportForm(locale: Locale): ReportDialog | null {
  return locale === "en" && !englishLoader.loaded() ? null : dialogLoader.loaded();
}

const preloadFrench = quietPreload(() => loadReportForm("fr"));
const preloadEnglish = quietPreload(() => loadReportForm("en"));

/** Précharge au survol ou au focus ; rien si tout est déjà là (aucune promesse créée). */
export function preloadReportForm(locale: Locale): void {
  if (loadedReportForm(locale)) return;
  (locale === "en" ? preloadEnglish : preloadFrench)();
}
