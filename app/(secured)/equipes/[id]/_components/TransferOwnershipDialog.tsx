"use client";

import { useState } from "react";
import type { TeamMember } from "@/lib/shared/types";
import { useToast } from "@/components/ui/toast";

interface TransferOwnershipDialogProps {
  teamId: number;
  members: TeamMember[];
  onClose: () => void;
  onChanged: () => void;
}

export function TransferOwnershipDialog({ teamId, members, onClose, onChanged }: TransferOwnershipDialogProps) {
  const [transferTargetId, setTransferTargetId] = useState<number | null>(null);
  const [transferConfirmStep, setTransferConfirmStep] = useState(false);
  const [transferPending, setTransferPending] = useState(false);
  const { showError, showSuccess } = useToast();

  const transferOwnership = async () => {
    if (!transferTargetId) return;
    setTransferPending(true);
    try {
      const response = await fetch(`/api/teams/${teamId}/transfer-ownership`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ newOwnerUserId: transferTargetId }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(payload.error || "TEAM_OWNERSHIP_TRANSFER_FAILED");
      showSuccess("Propriété transférée.");
      onClose();
      onChanged();
    } catch (e) {
      showError((e as Error).message);
    } finally {
      setTransferPending(false);
    }
  };

  const handleBackdropClick = () => {
    if (!transferPending) {
      onClose();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape" && !transferPending) {
      onClose();
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={handleBackdropClick}
      onKeyDown={handleKeyDown}
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
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%",
          maxWidth: 460,
          background: "var(--cyber-bg-2, #14181f)",
          border: "1px solid rgba(255,157,46,0.4)",
          borderRadius: "var(--r-cy-md, 12px)",
          boxShadow: "0 24px 64px rgba(0,0,0,0.6)",
          padding: 22,
        }}
      >
        <h3 style={{ margin: 0, fontSize: 18, color: "var(--ink, #e6e9ef)" }}>Transférer la propriété</h3>
        <p style={{ marginTop: 6, fontSize: 13, color: "var(--text-2, #9aa4b2)" }}>
          Le nouveau propriétaire aura tous les droits sur l'équipe. Vous perdrez votre rôle OWNER.
        </p>

        <div style={{ marginTop: 16, maxHeight: 280, overflowY: "auto", display: "flex", flexDirection: "column", gap: 6 }}>
          {members
            .filter((m) => !m.roles.includes("OWNER"))
            .map((m) => (
              <label
                key={m.userId}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "8px 10px",
                  borderRadius: 8,
                  border: "1px solid var(--line-soft, rgba(255,255,255,0.06))",
                  cursor: "pointer",
                  background: transferTargetId === m.userId ? "rgba(255,157,46,0.10)" : "transparent",
                }}
              >
                <input
                  type="radio"
                  name="transfer-target"
                  checked={transferTargetId === m.userId}
                  onChange={() => {
                    setTransferTargetId(m.userId);
                    setTransferConfirmStep(false);
                  }}
                />
                <span style={{ fontSize: 13, color: "var(--ink, #e6e9ef)" }}>{m.pseudo}</span>
                <span style={{ fontSize: 11, color: "var(--text-2, #9aa4b2)", marginLeft: "auto" }}>
                  {m.roles.join(", ")}
                </span>
              </label>
            ))}
          {members.filter((m) => !m.roles.includes("OWNER")).length === 0 && (
            <p style={{ fontSize: 13, color: "var(--text-2, #9aa4b2)", margin: 0 }}>Aucun autre membre dans l'équipe.</p>
          )}
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 20 }}>
          <button
            type="button"
            className="btn ghost"
            disabled={transferPending}
            onClick={onClose}
            style={{ padding: "8px 18px", fontSize: 13 }}
          >
            Annuler
          </button>
          <button
            type="button"
            className="btn"
            disabled={!transferTargetId || transferPending}
            onClick={() => {
              if (!transferConfirmStep) {
                setTransferConfirmStep(true);
                return;
              }
              void transferOwnership();
            }}
            style={{
              padding: "8px 20px",
              fontSize: 13,
              background: transferConfirmStep ? "rgba(255, 92, 92, 0.18)" : "rgba(255,157,46,0.16)",
              borderColor: transferConfirmStep ? "rgba(255, 92, 92, 0.5)" : "rgba(255,157,46,0.38)",
              color: transferConfirmStep ? "var(--red-live, #ff6e6e)" : undefined,
              opacity: !transferTargetId || transferPending ? 0.5 : 1,
            }}
          >
            {transferPending ? "Transfert..." : transferConfirmStep ? "Confirmer définitivement" : "Confirmer le transfert"}
          </button>
        </div>
      </div>
    </div>
  );
}
