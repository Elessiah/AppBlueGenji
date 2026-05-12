"use client";

import { useState } from "react";
import type { TeamRole } from "@/lib/shared/types";
import { Coche } from "@/components/Coche";

interface RolesDialogProps {
  dialog: {
    userId: number;
    pseudo: string;
    isOwner: boolean;
    selected: TeamRole[];
  };
  onClose: () => void;
  onSave: (selected: TeamRole[]) => Promise<void>;
}

const roles: TeamRole[] = ["COACH", "TANK", "DPS", "HEAL", "CAPITAINE", "MANAGER", "OWNER"];

export function RolesDialog({ dialog, onClose, onSave }: RolesDialogProps) {
  const [selected, setSelected] = useState(dialog.selected);
  const [pending, setPending] = useState(false);

  const toggleRole = (role: TeamRole) => {
    setSelected((prev) => (prev.includes(role) ? prev.filter((r) => r !== role) : [...prev, role]));
  };

  const handleSave = async () => {
    setPending(true);
    try {
      await onSave(selected);
    } finally {
      setPending(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape" && !pending) {
      onClose();
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={onClose}
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
          maxWidth: 420,
          background: "var(--cyber-bg-2, #14181f)",
          border: "1px solid rgba(255,157,46,0.35)",
          borderRadius: "var(--r-cy-md, 12px)",
          boxShadow: "0 24px 64px rgba(0,0,0,0.6)",
          padding: 22,
        }}
      >
        <h3
          style={{
            margin: 0,
            fontSize: 18,
            color: "var(--ink, #e6e9ef)",
            letterSpacing: "0.02em",
          }}
        >
          Rôles — {dialog.pseudo}
        </h3>
        {dialog.isOwner && (
          <p style={{ marginTop: 6, fontSize: 12, color: "var(--text-2, #9aa4b2)" }}>
            Le rôle OWNER ne peut pas être retiré ici — utilisez « Transférer la propriété ».
          </p>
        )}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 16 }}>
          {roles
            .filter((r) => r !== "OWNER")
            .map((role) => (
              <Coche
                key={role}
                label={role}
                checked={selected.includes(role)}
                theme="equipe"
                onChange={() => toggleRole(role)}
              />
            ))}
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 22 }}>
          <button
            type="button"
            className="btn ghost"
            onClick={onClose}
            disabled={pending}
            style={{ padding: "8px 18px", fontSize: 13 }}
          >
            Annuler
          </button>
          <button
            type="button"
            className="btn"
            disabled={selected.length === 0 || pending}
            onClick={handleSave}
            style={{
              padding: "8px 20px",
              fontSize: 13,
              background: "rgba(255,157,46,0.16)",
              borderColor: "rgba(255,157,46,0.38)",
              opacity: selected.length === 0 ? 0.5 : 1,
            }}
          >
            Enregistrer
          </button>
        </div>
      </div>
    </div>
  );
}
