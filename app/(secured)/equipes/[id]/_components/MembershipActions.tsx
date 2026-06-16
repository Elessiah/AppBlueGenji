"use client";

import { useCallback, useEffect, useState } from "react";
import type { TeamDetailResponse } from "@/lib/shared/types";
import { useToast } from "@/components/ui/toast";

interface MembershipActionsProps {
  team: TeamDetailResponse;
  onChanged: () => void;
}

type JoinRequest = { id: number; userId: number; pseudo: string; createdAt: string };

export function MembershipActions({ team, onChanged }: MembershipActionsProps) {
  const { showError, showSuccess } = useToast();
  const teamId = team.team.id;
  const [busy, setBusy] = useState(false);
  const [requests, setRequests] = useState<JoinRequest[]>([]);

  const loadRequests = useCallback(async () => {
    if (!team.canManage) return;
    try {
      const res = await fetch(`/api/teams/${teamId}/invitations`, { cache: "no-store" });
      if (!res.ok) return;
      const payload = (await res.json()) as { requests?: JoinRequest[] };
      setRequests(payload.requests ?? []);
    } catch {
      // silencieux
    }
  }, [teamId, team.canManage]);

  useEffect(() => {
    loadRequests();
  }, [loadRequests]);

  const join = async () => {
    setBusy(true);
    try {
      const res = await fetch(`/api/teams/${teamId}/join`, { method: "POST" });
      const payload = (await res.json()) as { error?: string; result?: "REQUESTED" | "JOINED" };
      if (!res.ok) throw new Error(payload.error || "TEAM_JOIN_FAILED");
      showSuccess(
        payload.result === "JOINED" ? "Tu as rejoint l'équipe !" : "Demande envoyée à l'équipe.",
      );
      onChanged();
    } catch (e) {
      showError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const leave = async () => {
    if (!window.confirm("Quitter cette équipe ?")) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/teams/${teamId}/leave`, { method: "POST" });
      const payload = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(payload.error || "TEAM_LEAVE_FAILED");
      showSuccess("Tu as quitté l'équipe.");
      onChanged();
    } catch (e) {
      showError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const respondRequest = async (invitationId: number, accept: boolean) => {
    setBusy(true);
    try {
      const res = await fetch(`/api/invitations/${invitationId}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ accept }),
      });
      const payload = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(payload.error || "INVITATION_RESPOND_FAILED");
      showSuccess(accept ? "Joueur accepté dans l'équipe." : "Demande refusée.");
      await loadRequests();
      onChanged();
    } catch (e) {
      showError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const btnStyle = {
    padding: "10px 22px",
    fontSize: 13,
    background: "rgba(255,157,46,0.12)",
    borderColor: "rgba(255,157,46,0.3)",
    opacity: busy ? 0.6 : 1,
    cursor: busy ? "not-allowed" : "pointer",
  } as const;

  if (team.team.deletedAt) {
    return (
      <div className="ds-block" style={{ marginBottom: 20 }}>
        <p style={{ margin: 0, color: "var(--text-2)", fontSize: 14 }}>
          🛑 Équipe dissoute — ses statistiques et son historique restent consultables, mais elle
          ne peut plus être rejointe ni administrée.
        </p>
      </div>
    );
  }

  return (
    <>
      {team.viewerMembership === "NONE" && (
        <div className="ds-block" style={{ marginBottom: 20 }}>
          {team.viewerInvitation === "REQUESTED" ? (
            <p style={{ margin: 0, color: "var(--text-2)", fontSize: 14 }}>
              Demande envoyée — en attente de validation par la gestion de l'équipe.
            </p>
          ) : team.viewerInvitation === "INVITED" ? (
            <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
              <p style={{ margin: 0, color: "var(--text-2)", fontSize: 14 }}>
                Tu as reçu une invitation pour cette équipe.
              </p>
              <button type="button" className="btn" onClick={join} disabled={busy} style={btnStyle}>
                Rejoindre
              </button>
            </div>
          ) : (
            <button type="button" className="btn" onClick={join} disabled={busy} style={btnStyle}>
              Rejoindre cette équipe
            </button>
          )}
        </div>
      )}

      {team.viewerMembership === "MEMBER" && (
        <div className="ds-block" style={{ marginBottom: 20, display: "flex", justifyContent: "flex-end" }}>
          <button
            type="button"
            className="btn ghost"
            onClick={leave}
            disabled={busy}
            style={{ padding: "10px 18px", fontSize: 13, opacity: busy ? 0.6 : 1 }}
          >
            Quitter l'équipe
          </button>
        </div>
      )}

      {team.canManage && requests.length > 0 && (
        <div className="ds-block" style={{ marginBottom: 20 }}>
          <div className="ds-section-title orange">
            <h2>Demandes d'adhésion ({requests.length})</h2>
          </div>
          <div className="table-like">
            {requests.map((r) => (
              <div className="table-row" key={r.id} style={{ alignItems: "center" }}>
                <span>{r.pseudo}</span>
                <span style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                  <button
                    type="button"
                    className="btn"
                    onClick={() => respondRequest(r.id, true)}
                    disabled={busy}
                    style={{ padding: "4px 12px", fontSize: 12 }}
                  >
                    Accepter
                  </button>
                  <button
                    type="button"
                    className="btn ghost"
                    onClick={() => respondRequest(r.id, false)}
                    disabled={busy}
                    style={{ padding: "4px 12px", fontSize: 12 }}
                  >
                    Refuser
                  </button>
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
