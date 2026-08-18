"use client";

import { useCallback, useEffect, useState } from "react";
import { useToast } from "@/components/ui/toast";
import { moveInOrder, type SeedingEntry, type SeedingLockReason } from "@/lib/shared/seeding";

interface SeedingEditorProps {
  tournamentId: number;
  /** Rafraîchit le détail du tournoi après réordonnancement (bracket régénéré). */
  onReordered: () => void;
}

const LOCK_MESSAGES: Record<NonNullable<SeedingLockReason>, string> = {
  FINISHED: "Tournoi terminé — le seeding n'est plus modifiable.",
  SCORES_ENTERED: "Un score a été saisi : le seeding est figé.",
};

/**
 * Réordonnancement du seeding par le staff (permission `tournaments`).
 *
 * Les flèches déplacent une équipe d'un cran ; l'ordre est enregistré à chaque
 * mouvement. La fenêtre d'édition court jusqu'à la première saisie de score —
 * au-delà, le serveur refuse (409) et l'interface n'affiche plus que l'ordre.
 */
export function SeedingEditor({ tournamentId, onReordered }: SeedingEditorProps) {
  const { showError, showSuccess } = useToast();
  const [entries, setEntries] = useState<SeedingEntry[]>([]);
  const [lockReason, setLockReason] = useState<SeedingLockReason>(null);
  const [manualSeeding, setManualSeeding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/admin/tournaments/${tournamentId}/seeding`, { cache: "no-store" });
      if (res.status === 403) return; // Pas de permission : le bloc reste masqué.
      const payload = (await res.json()) as {
        entries?: SeedingEntry[];
        lockReason?: SeedingLockReason;
        manualSeeding?: boolean;
        error?: string;
      };
      if (!res.ok) throw new Error(payload.error || "SEEDING_LOAD_FAILED");
      setEntries(payload.entries ?? []);
      setLockReason(payload.lockReason ?? null);
      setManualSeeding(payload.manualSeeding === true);
      setLoaded(true);
    } catch (e) {
      showError((e as Error).message);
    }
  }, [tournamentId, showError]);

  useEffect(() => {
    load();
  }, [load]);

  const move = async (teamId: number, direction: "up" | "down") => {
    const order = moveInOrder(entries.map((entry) => entry.teamId), teamId, direction);
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/tournaments/${tournamentId}/seeding`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ teamIds: order }),
      });
      const payload = (await res.json()) as {
        entries?: SeedingEntry[];
        lockReason?: SeedingLockReason;
        manualSeeding?: boolean;
        error?: string;
      };
      if (!res.ok) throw new Error(payload.error || "SEEDING_REORDER_FAILED");
      setEntries(payload.entries ?? []);
      setLockReason(payload.lockReason ?? null);
      setManualSeeding(payload.manualSeeding === true);
      showSuccess("Seeding mis à jour.");
      onReordered();
    } catch (e) {
      showError((e as Error).message);
      // L'ordre serveur fait foi : on resynchronise plutôt que de garder un
      // affichage optimiste qui n'a pas été enregistré.
      await load();
    } finally {
      setBusy(false);
    }
  };

  if (!loaded || entries.length === 0) return null;

  const locked = lockReason !== null;

  return (
    <div className="ds-block" style={{ marginBottom: 20 }}>
      <div className="ds-section-title green">
        <h2>Seeding {locked ? "(figé)" : "· ordre des équipes"}</h2>
      </div>

      <p style={{ margin: "0 0 14px", fontSize: 12, color: "var(--text-2)" }}>
        {locked
          ? LOCK_MESSAGES[lockReason]
          : "Cet ordre décide des appariements de la première manche. Modifiable jusqu'à la première saisie de score."}
        {manualSeeding && !locked ? " Ordre défini à la main." : ""}
      </p>

      <div className="table-like">
        {entries.map((entry, index) => (
          <div key={entry.teamId} className="table-row" style={{ alignItems: "center" }}>
            <span className="num" style={{ minWidth: 32 }}>#{entry.seed}</span>
            <span>{entry.teamName}</span>
            <span style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
              <button
                type="button"
                className="btn ghost"
                aria-label={`Monter ${entry.teamName}`}
                disabled={locked || busy || index === 0}
                onClick={() => move(entry.teamId, "up")}
                style={{ padding: "2px 10px", fontSize: 13, opacity: locked || index === 0 ? 0.35 : 1 }}
              >
                ↑
              </button>
              <button
                type="button"
                className="btn ghost"
                aria-label={`Descendre ${entry.teamName}`}
                disabled={locked || busy || index === entries.length - 1}
                onClick={() => move(entry.teamId, "down")}
                style={{
                  padding: "2px 10px",
                  fontSize: 13,
                  opacity: locked || index === entries.length - 1 ? 0.35 : 1,
                }}
              >
                ↓
              </button>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
