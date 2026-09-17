"use client";

import { FormEvent, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useToast } from "@/components/ui/toast";
import { useDialogBehavior } from "@/lib/shared/hooks/useDialogBehavior";
import { mapError } from "../_lib/error-map";

interface RemoveEntrantDialogProps {
  tournamentId: number;
  teamId: number;
  entrantName: string;
  onClose: () => void;
  onRemoved: () => void;
}

/**
 * Confirmation du retrait d'un engagé, avant le coup d'envoi.
 *
 * Pas de recopie du nom, contrairement à la suppression d'un tournoi : rien
 * n'est détruit ici, et l'engagé peut se réinscrire — ou être réinscrit —
 * l'instant d'après, le tournoi étant par construction encore ouvert. Mais le
 * bouton voisine des flèches de réordonnancement, à trente-deux pixels d'un
 * geste anodin : une confirmation nommant l'engagé est ce qui distingue les
 * deux, et c'est tout ce qu'elle a à faire.
 *
 * Elle dit malgré tout les deux choses qu'on ne devine pas : que l'inscription
 * est **effacée** (l'engagé n'apparaîtra nulle part comme ayant participé, à la
 * différence d'un abandon) et que la place est **rendue** au plateau — la
 * seconde étant souvent la raison même du geste, sur un tournoi complet dont on
 * attend un désistement.
 *
 * Portail sur `document.body` pour la même raison que les autres dialogues de
 * cette page : `.page-shell` enferme son contenu sous la barre de navigation.
 */
export function RemoveEntrantDialog({
  tournamentId,
  teamId,
  entrantName,
  onClose,
  onRemoved,
}: RemoveEntrantDialogProps) {
  const { showError, showSuccess } = useToast();
  const [busy, setBusy] = useState(false);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const dialogRef = useDialogBehavior({ open: mounted, onClose, locked: busy });

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;

    setBusy(true);
    try {
      const res = await fetch(`/api/admin/tournaments/${tournamentId}/registrations/${teamId}`, {
        method: "DELETE",
      });
      const payload = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(payload.error || "ENTRANT_REMOVAL_FAILED");
      // Tournure neutre : le genre de « équipe » et de « joueur » diverge.
      showSuccess(`${entrantName} ne figure plus parmi les engagés.`);
      onRemoved();
    } catch (e) {
      showError(mapError((e as Error).message));
      setBusy(false);
    }
  };

  if (!mounted) return null;

  return createPortal(
    <div
      role="presentation"
      onClick={() => {
        if (!busy) onClose();
      }}
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
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="remove-entrant-title"
        // Le résumé est lu à l'ouverture, avant que le focus n'atteigne les
        // boutons : le titre nomme l'engagé, le corps dit ce que « retirer »
        // veut dire — sans lui, la modale s'annonce sans sa conséquence.
        aria-describedby="remove-entrant-summary"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%",
          maxWidth: 440,
          maxHeight: "90vh",
          overflow: "auto",
          background: "var(--cyber-bg-2, #14181f)",
          border: "1px solid var(--line-strong-cy, #2a3340)",
          borderRadius: "var(--r-cy-md, 12px)",
          boxShadow: "0 24px 64px rgba(0,0,0,0.6)",
          padding: 22,
        }}
      >
        <h3 id="remove-entrant-title" style={{ margin: 0, fontSize: 18 }}>
          Retirer {entrantName} du tournoi
        </h3>

        <p
          id="remove-entrant-summary"
          style={{ marginTop: 10, fontSize: 13, color: "var(--text-2, #9aa4b2)", lineHeight: 1.55 }}
        >
          L&apos;inscription est <strong style={{ color: "var(--ink)" }}>effacée</strong> : rien
          n&apos;indiquera que cet engagé a pris part au tournoi, à la différence d&apos;un abandon.
          La place est rendue, et il pourra se réinscrire tant que les inscriptions sont ouvertes.
        </p>

        <p style={{ marginTop: 12, fontSize: 13, color: "var(--text-2, #9aa4b2)", lineHeight: 1.55 }}>
          Une fois le tournoi commencé, ce geste ne sera plus possible : le tirage sera fait, et
          seul un abandon sortira un engagé du plateau.
        </p>

        <form onSubmit={submit}>
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
              {busy ? "Retrait…" : "Retirer"}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body,
  );
}
