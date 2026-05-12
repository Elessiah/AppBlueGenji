"use client";

import { ChangeEvent, FormEvent, useRef, useState } from "react";
import Link from "next/link";
import { LogoWithGlow } from "@/components/logo-with-glow";
import type { TeamDetailResponse } from "@/lib/shared/types";
import { useToast } from "@/components/ui/toast";
import { TransferOwnershipDialog } from "./TransferOwnershipDialog";

interface TeamHeaderProps {
  team: TeamDetailResponse;
  onChanged: () => void;
  canManage: boolean;
  viewerIsOwner: boolean;
}

const ACCEPTED_IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"];
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

export function TeamHeader({ team, onChanged, canManage, viewerIsOwner }: TeamHeaderProps) {
  const { showError, showSuccess } = useToast();
  const [name, setName] = useState(team.team.name);
  const [logoBusy, setLogoBusy] = useState(false);
  const logoFileRef = useRef<HTMLInputElement | null>(null);
  const [transferOpen, setTransferOpen] = useState(false);

  const saveMeta = async (event: FormEvent) => {
    event.preventDefault();
    try {
      const response = await fetch(`/api/teams/${team.team.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const payload = (await response.json()) as TeamDetailResponse & { error?: string };
      if (!response.ok) throw new Error(payload.error || "TEAM_UPDATE_FAILED");
      showSuccess("Équipe mise à jour.");
      onChanged();
    } catch (e) {
      showError((e as Error).message);
    }
  };

  const onLogoChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    if (!ACCEPTED_IMAGE_TYPES.includes(file.type) || file.size > MAX_IMAGE_BYTES) {
      showError("Image trop lourde ou format non supporté");
      return;
    }

    setLogoBusy(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const response = await fetch(`/api/teams/${team.team.id}/logo`, {
        method: "POST",
        body: formData,
      });
      const payload = (await response.json()) as { logoUrl?: string | null; error?: string };
      if (!response.ok) throw new Error(payload.error || "LOGO_UPLOAD_FAILED");
      showSuccess("Logo mis à jour.");
      onChanged();
    } catch (e) {
      showError((e as Error).message);
    } finally {
      setLogoBusy(false);
    }
  };

  const onLogoDelete = async () => {
    setLogoBusy(true);
    try {
      const response = await fetch(`/api/teams/${team.team.id}/logo`, { method: "DELETE" });
      const payload = (await response.json()) as { logoUrl?: string | null; error?: string };
      if (!response.ok) throw new Error(payload.error || "LOGO_DELETE_FAILED");
      showSuccess("Logo supprimé.");
      onChanged();
    } catch (e) {
      showError((e as Error).message);
    } finally {
      setLogoBusy(false);
    }
  };

  return (
    <>
      <div className="ds-header orange">
        <div className="ds-header-body">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
              {team.team.logoUrl ? (
                <LogoWithGlow
                  src={team.team.logoUrl}
                  alt={team.team.name}
                  width={56}
                  height={56}
                  size="sm"
                  borderRadius={12}
                  borderColor="rgba(255,157,46,0.3)"
                  unoptimized
                />
              ) : (
                <div
                  style={{
                    width: 56,
                    height: 56,
                    borderRadius: 12,
                    border: "1.5px dashed rgba(255,157,46,0.3)",
                    background: "rgba(255,157,46,0.07)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 22,
                  }}
                >
                  🛡
                </div>
              )}
              <div>
                <h1 className="ds-title orange" style={{ fontSize: "clamp(26px, 3vw, 40px)", marginBottom: 6 }}>
                  {team.team.name}
                </h1>
                <p style={{ color: "var(--text-2)", margin: 0, fontSize: 14 }}>
                  Historique compétitif et gestion du roster
                </p>
              </div>
            </div>
            <Link href="/equipes" className="btn ghost" style={{ padding: "9px 18px", fontSize: 13, flexShrink: 0 }}>
              ← Équipes
            </Link>
          </div>
        </div>
      </div>

      {canManage && (
        <div className="ds-block" style={{ marginBottom: 20, borderColor: "rgba(255,157,46,0.18)" }}>
          <div className="ds-section-title orange">
            <h2>Paramètres de l'équipe</h2>
          </div>
          <form onSubmit={saveMeta}>
            <div className="form-grid">
              <div className="field">
                <label>Nom de l'équipe</label>
                <input value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <div className="field">
                <label>Logo</label>
                <input
                  ref={logoFileRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  onChange={onLogoChange}
                  style={{ display: "none" }}
                />
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button
                    type="button"
                    className="btn"
                    disabled={logoBusy}
                    onClick={() => logoFileRef.current?.click()}
                    style={{
                      padding: "9px 18px",
                      fontSize: 13,
                      opacity: logoBusy ? 0.6 : 1,
                      cursor: logoBusy ? "not-allowed" : "pointer",
                    }}
                  >
                    {logoBusy ? "Envoi…" : "Changer le logo"}
                  </button>
                  {team.team.logoUrl ? (
                    <button
                      type="button"
                      className="btn ghost"
                      disabled={logoBusy}
                      onClick={onLogoDelete}
                      style={{
                        padding: "9px 18px",
                        fontSize: 13,
                        opacity: logoBusy ? 0.6 : 1,
                        cursor: logoBusy ? "not-allowed" : "pointer",
                      }}
                    >
                      Supprimer
                    </button>
                  ) : null}
                </div>
                <p style={{ fontSize: 11, color: "var(--text-2)", margin: "6px 0 0" }}>
                  PNG, JPEG ou WebP — 5 Mo max
                </p>
              </div>
            </div>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginTop: 16,
                gap: 12,
                flexWrap: "wrap",
              }}
            >
              {viewerIsOwner ? (
                <button
                  type="button"
                  className="btn ghost"
                  onClick={() => setTransferOpen(true)}
                  style={{ padding: "10px 18px", fontSize: 12, borderColor: "rgba(255,157,46,0.35)" }}
                >
                  Transférer la propriété
                </button>
              ) : (
                <span />
              )}
              <button
                type="submit"
                className="btn"
                style={{ padding: "10px 24px", background: "rgba(255,157,46,0.14)", borderColor: "rgba(255,157,46,0.35)" }}
              >
                Mettre à jour
              </button>
            </div>
          </form>
        </div>
      )}

      {transferOpen && (
        <TransferOwnershipDialog
          teamId={team.team.id}
          members={team.members}
          onClose={() => setTransferOpen(false)}
          onChanged={onChanged}
        />
      )}
    </>
  );
}
