"use client";

import { FormEvent, ReactNode, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useBackdropDismiss } from "@/lib/shared/hooks/useBackdropDismiss";
import { useDialogBehavior } from "@/lib/shared/hooks/useDialogBehavior";

interface TournamentDialogShellProps {
  /** Identifiant du titre (`aria-labelledby`). */
  titleId: string;
  /**
   * Identifiant du résumé (`aria-describedby`), porté par un paragraphe du
   * corps : il est lu à l'ouverture, avant que le focus n'atteigne les
   * boutons — sans lui, la modale s'annonce sans sa conséquence.
   */
  summaryId: string;
  maxWidth: number;
  title: ReactNode;
  /** Geste en vol : boutons désactivés, Échap et voile sans effet. */
  busy: boolean;
  onClose: () => void;
  onSubmit: (event: FormEvent) => void;
  /** Libellé du bouton de confirmation (attente comprise). */
  submitLabel: ReactNode;
  /** Ce que le geste entraîne, entre le titre et les boutons. */
  children: ReactNode;
}

/**
 * Coquille des confirmations d'un geste staff de la fiche tournoi qui n'est
 * qu'un bouton à valider — avancer le tournoi, retirer un engagé : voile, cadre,
 * titre, corps et boutons « Annuler » / confirmer. Le geste lui-même (requête,
 * notifications) reste au dialogue qui l'utilise.
 *
 * Portail sur `document.body` pour la même raison que les autres dialogues de
 * cette page : `.page-shell` enferme son contenu sous la barre de navigation.
 * Monté après le premier rendu, `document` n'existant pas côté serveur.
 *
 * Distinct de `ConfirmActionDialog`, qui pose un `alertdialog` stylé par sa
 * feuille et ouvre le focus sur « Annuler » : ces deux dialogues gardent leur
 * rendu et leur comportement d'origine.
 */
export function TournamentDialogShell({
  titleId,
  summaryId,
  maxWidth,
  title,
  busy,
  onClose,
  onSubmit,
  submitLabel,
  children,
}: Readonly<TournamentDialogShellProps>) {
  const [mounted, setMounted] = useState(false);
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
        zIndex: 90,
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
        aria-modal="true"
        className="dialog-bounded"
        aria-labelledby={titleId}
        aria-describedby={summaryId}
        tabIndex={-1}
        style={{
          width: "100%",
          maxWidth,
          background: "var(--cyber-bg-2, #14181f)",
          border: "1px solid var(--line-strong-cy, #2a3340)",
          borderRadius: "var(--r-cy-md, 12px)",
          boxShadow: "0 24px 64px rgba(0,0,0,0.6)",
          padding: 22,
        }}
      >
        <h3 id={titleId} style={{ margin: 0, fontSize: 18 }}>
          {title}
        </h3>

        {children}

        <form onSubmit={onSubmit}>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 20 }}>
            <button
              type="button"
              className="btn ghost"
              onClick={onClose}
              disabled={busy}
              style={{ padding: "8px 18px", fontSize: 13 }}
            >
              Annuler
            </button>
            <button
              type="submit"
              className="btn"
              disabled={busy}
              style={{ padding: "8px 20px", fontSize: 13 }}
            >
              {submitLabel}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body,
  );
}
