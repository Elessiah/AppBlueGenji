"use client";

import { FormEvent, ReactNode } from "react";
import { BusyButton } from "@/components/ui/busy-button";
import { BusyLabel } from "@/components/ui/busy-label";
import { TournamentDialogFrame } from "./TournamentDialogFrame";
import { useActionsText } from "../_lib/actions-text";

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
  /**
   * Geste en vol : boutons indisponibles mais focalisables (`BusyButton`,
   * `docs/features/BUSY_BUTTONS.md`), Échap et voile sans effet.
   */
  busy: boolean;
  /** Garde synchrone du dialogue (`useBusyGuard().isBusy`) : « Annuler » parti avant le rendu. */
  isBusy: () => boolean;
  onClose: () => void;
  onSubmit: (event: FormEvent) => void;
  /** Libellé du bouton de confirmation… */
  submitLabel: string;
  /** … et pendant l'envoi (`BusyLabel` : le bouton garde sa largeur). */
  pendingLabel: string;
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
  isBusy,
  onClose,
  onSubmit,
  submitLabel,
  pendingLabel,
  children,
}: Readonly<TournamentDialogShellProps>) {
  const { t } = useActionsText();
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
          <BusyButton
            busy={busy}
            className="btn ghost"
            onClick={() => {
              if (!isBusy()) onClose();
            }}
            style={{ padding: "8px 18px", fontSize: 13 }}
          >
            {t("common.cancel")}
          </BusyButton>
          <BusyButton busy={busy} type="submit" className="btn" style={{ padding: "8px 20px", fontSize: 13 }}>
            <BusyLabel busy={busy} idle={submitLabel} pending={pendingLabel} />
          </BusyButton>
        </div>
      </form>
    </TournamentDialogFrame>
  );
}
