"use client";

import { FormEvent, useState } from "react";
import { CyberButton } from "@/components/cyber";
import { useToast } from "@/components/ui/toast";
import { useDialogBehavior } from "@/lib/shared/hooks/useDialogBehavior";
import type { TournamentImage } from "@/lib/shared/tournament-image";
import { TournamentImagePicker } from "../../_components/TournamentImagePicker";
import {
  applyImageChange,
  imageChangeSuccessMessage,
  imagePickerChange,
  initialImagePickerValue,
  type ImagePickerValue,
} from "../../_lib/image-picker";

interface TournamentImageDialogProps {
  tournamentId: number;
  /** Image enregistrée, relue à chaque instantané du flux. */
  image: TournamentImage | null;
  onClose: () => void;
  onSaved: () => void;
}

/**
 * Réglage de l'illustration ou du logo d'un tournoi, depuis sa fiche.
 *
 * C'est la porte de toute image d'un tournoi **existant**, dans tous les états :
 * le formulaire d'édition se ferme au coup d'envoi, alors qu'habiller une
 * archive ou poser le logo d'un tournoi en cours reste légitime — l'image est
 * décorative, elle ne touche à aucune règle du moteur.
 *
 * La requête envoyée est décidée par `imagePickerChange` contre l'image
 * **courante** (prop relue à chaque instantané), jamais contre celle de
 * l'ouverture : une image retirée entre-temps par un autre membre du staff
 * donne un refus lisible plutôt qu'un cadrage appliqué à rien.
 */
export function TournamentImageDialog({ tournamentId, image, onClose, onSaved }: TournamentImageDialogProps) {
  const { showError, showSuccess } = useToast();
  const [value, setValue] = useState<ImagePickerValue>(() => initialImagePickerValue(image));
  const [busy, setBusy] = useState(false);
  const dialogRef = useDialogBehavior({ open: true, onClose, locked: busy });

  const change = imagePickerChange(image, value);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (change.kind === "NONE") {
      onClose();
      return;
    }
    setBusy(true);
    try {
      await applyImageChange(tournamentId, change, value.file);
      const message = imageChangeSuccessMessage(change);
      if (message) showSuccess(message);
      onSaved();
      onClose();
    } catch (error) {
      showError((error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      role="presentation"
      onClick={() => {
        if (!busy) onClose();
      }}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 80,
        background: "rgba(6, 8, 12, 0.72)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="tournament-image-title"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%",
          maxWidth: 760,
          maxHeight: "calc(100vh - 32px)",
          overflowY: "auto",
          background: "var(--cyber-bg-2, #14181f)",
          border: "1px solid var(--line-strong-cy, var(--line-soft))",
          borderRadius: "var(--r-cy-md, 12px)",
          boxShadow: "0 24px 64px rgba(0,0,0,0.6)",
          padding: 22,
        }}
      >
        <form onSubmit={submit}>
          <h3 id="tournament-image-title" style={{ margin: 0, fontSize: 18, color: "var(--ink)" }}>
            Image du tournoi
          </h3>
          <p style={{ margin: "6px 0 18px", fontSize: 13, color: "var(--ink-mute)", lineHeight: 1.5 }}>
            Facultative. Elle habille la fiche, les cartes de la liste et l&apos;accueil — un tournoi
            sans image garde son apparence habituelle.
          </p>

          <TournamentImagePicker existing={image} value={value} onChange={setValue} disabled={busy} />

          <div
            style={{
              display: "flex",
              justifyContent: "flex-end",
              flexWrap: "wrap",
              gap: 10,
              marginTop: 22,
              paddingTop: 16,
              borderTop: "1px solid var(--line-soft)",
            }}
          >
            <CyberButton type="button" variant="ghost" onClick={onClose} disabled={busy}>
              Annuler
            </CyberButton>
            <CyberButton type="submit" variant="primary" disabled={busy || change.kind === "NONE"}>
              {busy ? "Enregistrement…" : "Enregistrer"}
            </CyberButton>
          </div>
        </form>
      </div>
    </div>
  );
}
