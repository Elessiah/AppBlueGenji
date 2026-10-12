"use client";

import dynamic from "next/dynamic";
import { useState } from "react";
import { useLocalePathname } from "@/components/i18n/locale-navigation";
import { CyberButton } from "@/components/cyber";
import type { ReportCategory } from "@/lib/shared/content-reports";
import { REPORT_FORM_NAME } from "@/lib/shared/legal-contact";
import { orReload } from "@/lib/shared/lazy-component";

/**
 * Le formulaire, chargé **au clic** (lot 9-2) : le bouton est au pied de chaque
 * page, et le formulaire porte ses deux langues (`reports-text.ts`) — les
 * importer ici les aurait mises dans le premier chargement de tout le site.
 * Un morceau disparu (déploiement entre la page et le clic) recharge la page
 * quand c'est sûr (`orReload`).
 */
const ReportProblemDialog = dynamic(
  () => orReload(import("./ReportProblemDialog").then((module) => module.ReportProblemDialog)),
  { ssr: false },
);

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
  // Route sans préfixe de langue : la cible se reconnaît sous `/en/equipes/5`
  // comme sous `/equipes/5`, et le journal retient une seule adresse par page.
  const { path: pathname } = useLocalePathname();

  return (
    <>
      {cyber ? (
        <CyberButton
          type="button"
          variant="ghost"
          className={className}
          onClick={() => setOpen(true)}
          aria-haspopup="dialog"
        >
          {icon && <span aria-hidden="true">⚑</span>}
          {label}
        </CyberButton>
      ) : (
        <button type="button" className={className} onClick={() => setOpen(true)} aria-haspopup="dialog">
          {icon && <span aria-hidden="true">⚑</span>}
          {label}
        </button>
      )}
      {open && (
        <ReportProblemDialog
          pathname={pathname}
          authenticated={authenticated}
          initialCategory={initialCategory}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
