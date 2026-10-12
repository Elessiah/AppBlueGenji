"use client";

import { useState } from "react";
import { useAppLocale } from "@/components/i18n/locale-context";
import { useLocalePathname } from "@/components/i18n/locale-navigation";
import { useShellText } from "@/components/i18n/shell-text";
import { CyberButton } from "@/components/cyber";
import { useOptionalToast } from "@/components/ui/toast";
import type { ReportCategory } from "@/lib/shared/content-reports";
import { REPORT_FORM_NAME } from "@/lib/shared/legal-contact";
import { isChunkLoadError } from "@/lib/shared/lazy-component";
import { englishReports } from "@/components/i18n/english-loaders";
import { loadedReportForm, loadReportForm, preloadReportForm } from "./report-form-loader";
import s from "./ReportProblemButton.module.css";

/**
 * Le formulaire, chargé **au clic** (lot 9-2) : le bouton est au pied de chaque
 * page, et le formulaire porte son français (`reports-text.ts`) — l'importer
 * ici l'aurait mis dans le premier chargement de tout le site. Sous `/en`, son
 * anglais part avec lui, dans un morceau à part : un lecteur français ne le
 * télécharge jamais.
 *
 * Chargement à la main plutôt que `next/dynamic` : un échec ne doit pas rester
 * en mémoire sous la forme d'un composant vide (le bouton ne ferait plus rien).
 * Le morceau part dès le survol ou le focus du bouton ; le bouton se dit occupé
 * (`aria-busy`, couleurs, région d'état — libellé inchangé) tant qu'il n'est
 * pas arrivé ; un échec
 * le dit (toast) et se retente au clic suivant. Un morceau disparu (déploiement
 * entre la page et le clic) invite à recharger la page, sans la recharger
 * d'office : une saisie en cours ailleurs sur la page serait perdue.
 */
interface ReportProblemButtonProps {
  /** Visiteur connecté : il peut désigner des cibles par leur nom. */
  authenticated: boolean;
  className?: string;
  /** Pictogramme de drapeau devant le libellé (décoratif). */
  icon?: boolean;
  /** Catégorie ouverte d'office (voir `ReportProblemDialog`). */
  initialCategory?: Exclude<ReportCategory, "CONTEST">;
  /** Libellé du bouton, « Signaler un problème » par défaut. */
  label?: string;
  /** Bouton du système de design (`CyberButton` fantôme) plutôt que le lien discret des pieds de page. */
  cyber?: boolean;
}

/**
 * Déclencheur du formulaire « Signaler un problème », posé dans les pieds de
 * page (vitrine, espace connecté, connexion) — donc présent sur toutes les
 * pages, comme la notification d'un contenu illicite doit l'être.
 *
 * Un `<button>` et non un lien : il n'y a pas de page de signalement, le
 * formulaire s'ouvre là où l'on est — et c'est cette page-là qu'il retient.
 */
export function ReportProblemButton({
  authenticated,
  className,
  icon = false,
  initialCategory,
  label = REPORT_FORM_NAME,
  cyber = false,
}: Readonly<ReportProblemButtonProps>) {
  const [open, setOpen] = useState(false);
  const locale = useAppLocale();
  const [pending, setPending] = useState(false);
  // Ce que la région d'état annonce : l'attente, et l'échec quand aucun toast ne le dit.
  const [status, setStatus] = useState("");
  const { t } = useShellText();
  // Toujours posé par la mise en page racine ; `null` seulement pour un pied de
  // page rendu seul (tests) : l'échec reste alors dit par la région d'état.
  const toast = useOptionalToast();
  // Route sans préfixe de langue : la cible se reconnaît sous `/en/equipes/5`
  // comme sous `/equipes/5`, et le journal retient une seule adresse par page.
  const { path: pathname } = useLocalePathname();

  const openDialog = () => {
    // Déjà là : chargé par un autre bouton, ou préchargé au survol.
    if (loadedReportForm(locale)) {
      setOpen(true);
      return;
    }
    if (pending) return;
    setPending(true);
    // Un nouvel essai efface l'échec précédent de la région d'état.
    setStatus(t("footer.reportLoading"));
    loadReportForm(locale)
      .then(() => {
        setStatus("");
        // Ouvert même si le lecteur a changé de page entre-temps : c'est la
        // suite attendue de son clic, et le formulaire retient la page affichée.
        setOpen(true);
      })
      .catch((error: unknown) => {
        const message = t(isChunkLoadError(error) ? "footer.reportReloading" : "footer.reportLoadFailed");
        // Dit une fois : par le toast (sa propre région d'annonce), sinon par la région d'état.
        if (toast) {
          setStatus("");
          toast.showError(message);
        } else {
          setStatus(message);
        }
      })
      .finally(() => setPending(false));
  };
  const triggerProps = {
    type: "button" as const,
    className: pending ? [className, s.pending].filter(Boolean).join(" ") : className,
    onClick: openDialog,
    onPointerEnter: () => preloadReportForm(locale),
    onFocus: () => preloadReportForm(locale),
    "aria-haspopup": "dialog" as const,
    "aria-busy": pending || undefined,
    // Clic ignoré pendant l'attente ; écarte aussi le survol du bouton du système de design.
    "aria-disabled": pending || undefined,
  };

  // Lu du chargeur à chaque rendu : `setOpen(true)` suit toujours son arrivée.
  const ReportProblemDialog = open ? loadedReportForm(locale) : null;

  return (
    <>
      {cyber ? (
        <CyberButton variant="ghost" {...triggerProps}>
          {icon && <span aria-hidden="true">⚑</span>}
          {label}
        </CyberButton>
      ) : (
        <button {...triggerProps}>
          {icon && <span aria-hidden="true">⚑</span>}
          {label}
        </button>
      )}
      <output className="sr-only">{status}</output>
      {ReportProblemDialog && (
        <ReportProblemDialog
          pathname={pathname}
          authenticated={authenticated}
          initialCategory={initialCategory}
          onClose={() => setOpen(false)}
          englishMessages={locale === "en" ? (englishReports.loaded() ?? undefined) : undefined}
        />
      )}
    </>
  );
}
