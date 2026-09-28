"use client";

import { createPortal } from "react-dom";
import { useEffect, useState } from "react";
import { useToast } from "@/components/ui/toast";
import { useBackdropDismiss } from "@/lib/shared/hooks/useBackdropDismiss";
import { useDialogBehavior } from "@/lib/shared/hooks/useDialogBehavior";
import type { FullProfileResponse } from "@/lib/shared/types";
import styles from "../player.module.css";

/**
 * Retrait de l'avatar par la modération (permission `moderation`), sans lien
 * avec ce compte — même geste, même bouton que `ModerationLogoBar` sur la
 * fiche d'équipe (`app/(secured)/equipes/[id]/_components/ModerationLogoBar.tsx`) :
 * le geste qui suit un signalement de droit d'auteur.
 *
 * Rendu seulement si le joueur **a** un avatar et n'est pas un compte
 * supprimé (déjà sans avatar — `deleted` couvre ce cas, mais l'écarter
 * explicitement évite de dépendre de cet ordre). La route de modération ne
 * demande ni lien avec le compte ni conditions acceptées, et laisse une trace
 * dans le journal du staff.
 */
export function ModerationAvatarBar({
  profile,
  deleted,
  onChanged,
}: {
  profile: FullProfileResponse;
  deleted: boolean;
  onChanged: () => void;
}) {
  const { showError, showSuccess } = useToast();
  const [confirming, setConfirming] = useState(false);

  if (deleted || !profile.moderationAvatarPresent) return null;

  const remove = async () => {
    try {
      const res = await fetch(`/api/admin/users/${profile.profile.id}/avatar`, { method: "DELETE" });
      const payload = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(payload.error || "USER_AVATAR_REMOVE_FAILED");
      showSuccess("Avatar retiré. Le joueur s'affiche désormais avec l'initiale de son pseudo.");
      setConfirming(false);
      onChanged();
    } catch (error) {
      showError(moderationAvatarErrorMessage((error as Error).message));
    }
  };

  return (
    <div className={styles.moderationBar} role="group" aria-label="Modération">
      <span className={styles.moderationLabel}>MODÉRATION</span>
      <button type="button" className="btn ghost" onClick={() => setConfirming(true)}>
        Retirer l&apos;avatar
      </button>
      {confirming && (
        <ModerationAvatarConfirm
          pseudo={profile.profile.pseudo}
          onClose={() => setConfirming(false)}
          onConfirm={remove}
        />
      )}
    </div>
  );
}

function moderationAvatarErrorMessage(code: string): string {
  switch (code) {
    case "USER_NOT_FOUND":
      return "Ce compte n'existe plus.";
    case "USER_HAS_NO_AVATAR":
      return "Ce joueur n'a déjà plus d'avatar.";
    default:
      return "L'avatar n'a pas pu être retiré. Réessaie dans un instant.";
  }
}

function ModerationAvatarConfirm({
  pseudo,
  onClose,
  onConfirm,
}: {
  pseudo: string;
  onClose: () => void;
  onConfirm: () => Promise<void>;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const [pending, setPending] = useState(false);

  const confirm = async () => {
    if (pending) return;
    setPending(true);
    await onConfirm();
    setPending(false);
  };

  const dialogRef = useDialogBehavior({ open: mounted, onClose, locked: pending });
  const backdrop = useBackdropDismiss(onClose, pending);

  if (!mounted) return null;

  return createPortal(
    <div
      role="presentation"
      {...backdrop}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 100,
        display: "grid",
        placeItems: "center",
        padding: 16,
        background: "rgba(4, 8, 14, 0.78)",
        backdropFilter: "blur(4px)",
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="moderation-avatar-title"
        tabIndex={-1}
        style={{
          width: "min(420px, calc(100vw - 32px))",
          background: "var(--cyber-bg-1)",
          border: "1px solid var(--line-strong-cy)",
          borderRadius: "var(--r-cy-lg)",
          padding: 24,
        }}
      >
        <h2 id="moderation-avatar-title" className="display" style={{ fontSize: 18, margin: "0 0 10px" }}>
          Retirer l&apos;avatar de {pseudo} ?
        </h2>
        <p style={{ color: "var(--ink-mute)", fontSize: 13.5, lineHeight: 1.7, margin: "0 0 20px" }}>
          L&apos;avatar de « {pseudo} » est effacé du site et de la sauvegarde des images. Le joueur garde tout le
          reste ; il pourra en envoyer un autre.
        </p>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
          <button type="button" className="btn ghost" onClick={onClose} disabled={pending}>
            Annuler
          </button>
          <button type="button" className="btn danger" disabled={pending} onClick={() => void confirm()}>
            {pending ? "Retrait…" : "Retirer l'avatar"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
