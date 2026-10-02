"use client";

import { FormEvent, ReactNode } from "react";
import { TournamentDialogFrame } from "./TournamentDialogFrame";

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
 * Voile, cadre et portail : `TournamentDialogFrame`, monté après le premier
 * rendu (`document` n'existant pas côté serveur).
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
  return (
    <TournamentDialogFrame
      titleId={titleId}
      describedBy={summaryId}
      maxWidth={maxWidth}
      border="1px solid var(--line-strong-cy, #2a3340)"
      zIndex={90}
      deferMount
      busy={busy}
      onClose={onClose}
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
    </TournamentDialogFrame>
  );
}
