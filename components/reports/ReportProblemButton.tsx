"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import { ReportProblemDialog } from "./ReportProblemDialog";

interface ReportProblemButtonProps {
  /** Visiteur connecté : il peut désigner des cibles par leur nom. */
  authenticated: boolean;
  className?: string;
  /** Pictogramme de drapeau devant le libellé (décoratif). */
  icon?: boolean;
}

/**
 * Déclencheur du formulaire « Signaler un problème », posé dans les pieds de
 * page (vitrine, espace connecté, connexion) — donc présent sur toutes les
 * pages, comme la notification d'un contenu illicite doit l'être.
 *
 * Un `<button>` et non un lien : il n'y a pas de page de signalement, le
 * formulaire s'ouvre là où l'on est — et c'est cette page-là qu'il retient.
 */
export function ReportProblemButton({ authenticated, className, icon = false }: ReportProblemButtonProps) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname() ?? "/";

  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)} aria-haspopup="dialog">
        {icon && <span aria-hidden="true">⚑</span>}
        Signaler un problème
      </button>
      {open && (
        <ReportProblemDialog pathname={pathname} authenticated={authenticated} onClose={() => setOpen(false)} />
      )}
    </>
  );
}
