"use client";

import { useTournamentPageText } from "@/components/i18n/tournament-page-text";
import { frenchBlockLang } from "@/lib/shared/tournament-page-text";
import { ReactNode, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useBackdropDismiss } from "@/lib/shared/hooks/useBackdropDismiss";
import { useDialogBehavior } from "@/lib/shared/hooks/useDialogBehavior";

/** Bordure ordinaire du cadre ; une confirmation destructive passe la sienne. */
export const DIALOG_FRAME_BORDER = "1px solid var(--line-strong-cy, var(--line-soft))";

interface TournamentDialogFrameProps {
  /** Identifiant du titre (`aria-labelledby`), posé par le contenu. */
  titleId: string;
  /** Identifiant d'un résumé lu à l'ouverture (`aria-describedby`), s'il y en a un. */
  describedBy?: string;
  maxWidth: number;
  /** Bordure du cadre (`DIALOG_FRAME_BORDER` par défaut). */
  border?: string;
  /** Couche du voile (`z-index`). */
  zIndex: number;
  /**
   * Attendre le montage avant de rendre : pour un dialogue qui peut être rendu
   * dès le premier rendu de la page, où `document` n'existe pas encore côté
   * serveur. Le comportement modal ne s'arme qu'une fois le contenu présent,
   * sans quoi il ne trouverait rien à focaliser.
   */
  deferMount?: boolean;
  /** Geste en vol : Échap et voile sans effet. */
  busy: boolean;
  onClose: () => void;
  children: ReactNode;
}

/**
 * Voile et cadre des dialogues de la fiche tournoi (`docs/features/MODAL_DIALOGS.md`) :
 * portail sur `document.body`, comportement modal (`useDialogBehavior` :
 * Échap, piège à focus, arrière-plan figé, focus rendu au déclencheur) et
 * fermeture au clic sur le voile (`useBackdropDismiss`). Le contenu — titre,
 * formulaire, boutons — reste au dialogue.
 *
 * Portail parce que la page vit dans `.page-shell`, qui pose
 * `position: relative; z-index: 1` et **enferme** donc tout ce qu'elle
 * contient sous la barre de navigation (`z-index: 50`) — quelle que soit la
 * valeur déclarée ici. Sans le portail, l'en-tête recouvre le titre du dialogue.
 */
export function TournamentDialogFrame({
  titleId,
  describedBy,
  maxWidth,
  border = DIALOG_FRAME_BORDER,
  zIndex,
  deferMount = false,
  busy,
  onClose,
  children,
}: Readonly<TournamentDialogFrameProps>) {
  // Dialogue du lot 8b (actions) ou du staff : resté français, annoncé comme tel sous `/en`.
  const dialogLang = frenchBlockLang(useTournamentPageText());
  const [mounted, setMounted] = useState(!deferMount);
  useEffect(() => setMounted(true), []);
  const dialogRef = useDialogBehavior({ open: mounted, onClose, locked: busy });
  const backdrop = useBackdropDismiss(onClose, busy);

  if (!mounted) return null;

  return createPortal(
    <div /* NOSONAR S6819 — voile de modale, sans équivalent natif */
      role="presentation"
      {...backdrop}
      style={{
        position: "fixed",
        inset: 0,
        zIndex,
        background: "rgba(6, 8, 12, 0.72)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
      }}
    >
      <div /* NOSONAR S6819 — modale portée dans body (useDialogBehavior) : `<dialog>` changerait couche, Échap et ::backdrop */
        ref={dialogRef}
        role="dialog"
        lang={dialogLang}
        aria-modal="true"
        className="dialog-bounded"
        aria-labelledby={titleId}
        aria-describedby={describedBy}
        tabIndex={-1}
        style={{
          width: "100%",
          maxWidth,
          background: "var(--cyber-bg-2, #14181f)",
          border,
          borderRadius: "var(--r-cy-md, 12px)",
          boxShadow: "0 24px 64px rgba(0,0,0,0.6)",
          padding: 22,
        }}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}
