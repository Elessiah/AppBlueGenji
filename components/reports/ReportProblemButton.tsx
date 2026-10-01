"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import { CyberButton } from "@/components/cyber";
import type { ReportCategory } from "@/lib/shared/content-reports";
import { REPORT_FORM_NAME } from "@/lib/shared/legal-contact";
import { ReportProblemDialog } from "./ReportProblemDialog";

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
  const pathname = usePathname() ?? "/";

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
