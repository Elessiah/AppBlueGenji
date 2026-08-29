"use client";

import { FormEvent, useState } from "react";
import { useToast } from "@/components/ui/toast";
import { isDeletionConfirmed } from "@/lib/shared/tournament-deletion";
import { mapError } from "../_lib/error-map";

interface DeleteTournamentDialogProps {
  tournamentId: number;
  tournamentName: string;
  onClose: () => void;
  onDeleted: (tournamentName: string) => void;
}

/**
 * Confirmation de la suppression définitive d'un tournoi.
 *
 * Le bouton ne s'arme qu'une fois le nom du tournoi recopié à l'identique
 * (`lib/shared/tournament-deletion.ts`) : l'action détruit les matchs, les
 * inscriptions et les classements, elle ne doit pas pouvoir se déclencher d'un
 * clic distrait. Le dialogue liste explicitement ce qui part et ce qui reste.
 */
export function DeleteTournamentDialog({
  tournamentId,
  tournamentName,
  onClose,
  onDeleted,
}: DeleteTournamentDialogProps) {
  const { showError } = useToast();
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);

  const armed = isDeletionConfirmed(tournamentName, confirmation);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!armed || busy) return;

    setBusy(true);
    try {
      const res = await fetch(`/api/admin/tournaments/${tournamentId}`, { method: "DELETE" });
      const payload = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(payload.error || "TOURNAMENT_DELETE_FAILED");
      onDeleted(tournamentName);
    } catch (e) {
      showError(mapError((e as Error).message));
      setBusy(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="delete-tournament-title"
      onClick={() => {
        if (!busy) onClose();
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape" && !busy) onClose();
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
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={submit}
        style={{
          width: "100%",
          maxWidth: 480,
          background: "var(--cyber-bg-2, #14181f)",
          border: "1px solid var(--red-live, #ff4d4d)",
          borderRadius: "var(--r-cy-md, 12px)",
          boxShadow: "0 24px 64px rgba(0,0,0,0.6)",
          padding: 22,
        }}
      >
        <h3
          id="delete-tournament-title"
          style={{ margin: 0, fontSize: 18, color: "var(--red-live, #ff4d4d)" }}
        >
          Supprimer définitivement ce tournoi
        </h3>

        <p style={{ marginTop: 10, fontSize: 13, color: "var(--text-2, #9aa4b2)", lineHeight: 1.55 }}>
          Cette action est irréversible. Le tournoi{" "}
          <strong style={{ color: "var(--ink)" }}>{tournamentName}</strong> disparaîtra du site avec
          tous ses matchs, ses inscriptions et ses classements — y compris des palmarès et des
          statistiques de ses participants.
        </p>
        <p style={{ marginTop: 8, fontSize: 13, color: "var(--text-2, #9aa4b2)", lineHeight: 1.55 }}>
          Aucune équipe ni aucun joueur n&apos;est supprimé : seuls les résultats de ce tournoi le
          sont.
        </p>

        <div className="field" style={{ marginTop: 18 }}>
          <label htmlFor="delete-tournament-confirmation">
            Recopie le nom du tournoi pour confirmer
          </label>
          <input
            id="delete-tournament-confirmation"
            value={confirmation}
            onChange={(e) => setConfirmation(e.target.value)}
            placeholder={tournamentName}
            autoComplete="off"
            autoFocus
            disabled={busy}
            aria-describedby="delete-tournament-hint"
          />
          <p
            id="delete-tournament-hint"
            style={{ marginTop: 6, fontSize: 12, color: "var(--ink-dim, #6b7480)" }}
          >
            {armed ? "Nom confirmé." : "La suppression restera bloquée tant que le nom ne correspond pas."}
          </p>
        </div>

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
            disabled={!armed || busy}
            style={{
              padding: "8px 20px",
              fontSize: 13,
              borderColor: "var(--red-live, #ff4d4d)",
              color: armed && !busy ? "var(--red-live, #ff4d4d)" : undefined,
            }}
          >
            {busy ? "Suppression…" : "Supprimer définitivement"}
          </button>
        </div>
      </form>
    </div>
  );
}
