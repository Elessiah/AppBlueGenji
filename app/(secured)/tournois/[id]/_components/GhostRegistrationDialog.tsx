"use client";

import { FormEvent, useEffect, useState } from "react";
import { useToast } from "@/components/ui/toast";

type GhostTeamOption = { id: number; name: string; logoUrl: string | null };

interface GhostRegistrationDialogProps {
  tournamentId: number;
  onClose: () => void;
  onRegistered: () => void;
}

/**
 * Inscription d'une équipe fantôme à un tournoi par le staff (`tournaments`).
 *
 * Deux chemins : choisir une fantôme existante, ou en créer une à la volée —
 * le cas courant quand il faut compléter un bracket juste avant le départ.
 */
export function GhostRegistrationDialog({
  tournamentId,
  onClose,
  onRegistered,
}: GhostRegistrationDialogProps) {
  const { showError, showSuccess } = useToast();
  const [teams, setTeams] = useState<GhostTeamOption[]>([]);
  const [mode, setMode] = useState<"existing" | "new">("existing");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`/api/admin/tournaments/${tournamentId}/ghost-registrations`, {
          cache: "no-store",
        });
        const payload = (await res.json()) as { teams?: GhostTeamOption[]; error?: string };
        if (!res.ok) throw new Error(payload.error || "GHOST_TEAMS_LOAD_FAILED");
        setTeams(payload.teams ?? []);
        // Aucune fantôme en stock : la création est le seul chemin utile.
        if ((payload.teams ?? []).length === 0) setMode("new");
        else setSelectedId(payload.teams![0].id);
      } catch (e) {
        showError((e as Error).message);
      }
    })();
  }, [tournamentId, showError]);

  const register = async (teamId: number) => {
    const res = await fetch(`/api/admin/tournaments/${tournamentId}/ghost-registrations`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ teamId }),
    });
    const payload = (await res.json()) as { error?: string };
    if (!res.ok) throw new Error(payload.error || "GHOST_REGISTRATION_FAILED");
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try {
      let teamId = selectedId;

      if (mode === "new") {
        const res = await fetch("/api/teams", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name: newName.trim(), ghost: true }),
        });
        const payload = (await res.json()) as { teamId?: number; error?: string };
        if (!res.ok || !payload.teamId) throw new Error(payload.error || "GHOST_TEAM_CREATE_FAILED");
        teamId = payload.teamId;
      }

      if (!teamId) throw new Error("INVALID_TEAM_ID");

      await register(teamId);
      showSuccess("Équipe fantôme inscrite.");
      onRegistered();
      onClose();
    } catch (e) {
      showError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="ghost-registration-title"
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
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={submit}
        style={{
          width: "100%",
          maxWidth: 460,
          background: "var(--cyber-bg-2, #14181f)",
          border: "1px solid var(--line-strong-cy, var(--line-soft))",
          borderRadius: "var(--r-cy-md, 12px)",
          boxShadow: "0 24px 64px rgba(0,0,0,0.6)",
          padding: 22,
        }}
      >
        <h3 id="ghost-registration-title" style={{ margin: 0, fontSize: 18, color: "var(--ink)" }}>
          Inscrire une équipe fantôme
        </h3>
        <p style={{ marginTop: 6, fontSize: 13, color: "var(--text-2, #9aa4b2)" }}>
          Réservé aux équipes fantômes : une équipe de joueurs s&apos;inscrit toujours elle-même.
        </p>

        <div style={{ display: "flex", gap: 8, margin: "16px 0" }}>
          <button
            type="button"
            className={mode === "existing" ? "btn" : "btn ghost"}
            onClick={() => setMode("existing")}
            disabled={teams.length === 0}
            style={{ padding: "6px 14px", fontSize: 12, opacity: teams.length === 0 ? 0.5 : 1 }}
          >
            Existante
          </button>
          <button
            type="button"
            className={mode === "new" ? "btn" : "btn ghost"}
            onClick={() => setMode("new")}
            style={{ padding: "6px 14px", fontSize: 12 }}
          >
            Nouvelle
          </button>
        </div>

        {mode === "existing" ? (
          <div className="field">
            <label htmlFor="ghost-team-select">Équipe fantôme</label>
            <select
              id="ghost-team-select"
              value={selectedId ?? ""}
              onChange={(e) => setSelectedId(Number(e.target.value))}
              required
            >
              {teams.map((team) => (
                <option key={team.id} value={team.id}>
                  {team.name}
                </option>
              ))}
            </select>
          </div>
        ) : (
          <div className="field">
            <label htmlFor="ghost-team-new-name">Nom de la nouvelle équipe</label>
            <input
              id="ghost-team-new-name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              minLength={3}
              maxLength={60}
              required
              autoFocus
            />
          </div>
        )}

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
            disabled={busy || (mode === "existing" ? !selectedId : newName.trim().length < 3)}
            style={{ padding: "8px 20px", fontSize: 13 }}
          >
            {busy ? "Inscription…" : "Inscrire"}
          </button>
        </div>
      </form>
    </div>
  );
}
