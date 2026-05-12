"use client";

import Image from "next/image";
import Link from "next/link";
import { ChangeEvent, FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Coche } from "@/components/Coche";
import { LogoWithGlow } from "@/components/logo-with-glow";
import { formatLocalDate } from "@/lib/shared/dates";
import type { PublicUserProfile, TeamDetailResponse, TeamRole } from "@/lib/shared/types";
import { useToast } from "@/components/ui/toast";

const roles: TeamRole[] = ["COACH", "TANK", "DPS", "HEAL", "CAPITAINE", "MANAGER", "OWNER"];
const ACCEPTED_IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"];
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

export default function TeamDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const teamId = Number(params.id);
  const { showError, showSuccess } = useToast();
  const [data, setData] = useState<TeamDetailResponse | null>(null);
  const [memberPseudo, setMemberPseudo] = useState("");
  const [memberRoles, setMemberRoles] = useState<TeamRole[]>(["DPS"]);
  const [name, setName] = useState("");
  const [logoBusy, setLogoBusy] = useState(false);
  const logoFileRef = useRef<HTMLInputElement | null>(null);
  const [availablePlayers, setAvailablePlayers] = useState<PublicUserProfile[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const pseudoInputRef = useRef<HTMLInputElement | null>(null);
  const [viewerUserId, setViewerUserId] = useState<number | null>(null);
  const [rolesDialog, setRolesDialog] = useState<{
    userId: number;
    pseudo: string;
    isOwner: boolean;
    selected: TeamRole[];
  } | null>(null);
  const [transferDialogOpen, setTransferDialogOpen] = useState(false);
  const [transferTargetId, setTransferTargetId] = useState<number | null>(null);
  const [transferConfirmStep, setTransferConfirmStep] = useState(false);
  const [transferPending, setTransferPending] = useState(false);

  const load = useCallback(async () => {
    const response = await fetch(`/api/teams/${teamId}`, { cache: "no-store" });
    const payload = (await response.json()) as TeamDetailResponse & { error?: string };
    if (!response.ok) {
      const errorCode = payload.error || "TEAM_LOAD_FAILED";
      if (errorCode === "TEAM_NOT_FOUND") {
        showError(errorCode);
        setTimeout(() => router.push("/equipes"), 1500);
        return;
      }
      throw new Error(errorCode);
    }
    setData(payload);
    setName(payload.team.name);
  }, [teamId, router, showError]);

  useEffect(() => {
    load().catch((e) => showError((e as Error).message));
  }, [load, showError]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/players", { cache: "no-store" });
        if (!res.ok) return;
        const payload = (await res.json()) as { players: PublicUserProfile[] };
        if (!cancelled) setAvailablePlayers(payload.players);
      } catch {
        // silencieux : la dropdown reste vide en cas d'échec
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/profile", { cache: "no-store" });
        if (!res.ok) return;
        const payload = (await res.json()) as { profile?: { id: number } };
        if (payload.profile?.id) setViewerUserId(payload.profile.id);
      } catch {
        // silencieux
      }
    })();
  }, []);

  useEffect(() => {
    if (!rolesDialog) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setRolesDialog(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [rolesDialog]);

  useEffect(() => {
    if (!transferDialogOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !transferPending) {
        setTransferDialogOpen(false);
        setTransferTargetId(null);
        setTransferConfirmStep(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [transferDialogOpen, transferPending]);

  const toggleRole = (role: TeamRole) => {
    setMemberRoles((prev) => (prev.includes(role) ? prev.filter((r) => r !== role) : [...prev, role]));
  };

  const addMember = async (event: FormEvent) => {
    event.preventDefault();
    try {
      const response = await fetch(`/api/teams/${teamId}/members`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ pseudo: memberPseudo, roles: memberRoles }),
      });
      const payload = (await response.json()) as TeamDetailResponse & { error?: string };
      if (!response.ok) throw new Error(payload.error || "TEAM_MEMBER_ADD_FAILED");
      setData(payload);
      setMemberPseudo("");
      showSuccess("Membre ajouté.");
    } catch (e) {
      showError((e as Error).message);
    }
  };

  const saveMeta = async (event: FormEvent) => {
    event.preventDefault();
    try {
      const response = await fetch(`/api/teams/${teamId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const payload = (await response.json()) as TeamDetailResponse & { error?: string };
      if (!response.ok) throw new Error(payload.error || "TEAM_UPDATE_FAILED");
      setData(payload);
      showSuccess("Équipe mise à jour.");
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
      const response = await fetch(`/api/teams/${teamId}/logo`, {
        method: "POST",
        body: formData,
      });
      const payload = (await response.json()) as { logoUrl?: string | null; error?: string };
      if (!response.ok) throw new Error(payload.error || "LOGO_UPLOAD_FAILED");
      setData((prev) =>
        prev ? { ...prev, team: { ...prev.team, logoUrl: payload.logoUrl ?? null } } : prev,
      );
      showSuccess("Logo mis à jour.");
    } catch (e) {
      showError((e as Error).message);
    } finally {
      setLogoBusy(false);
    }
  };

  const onLogoDelete = async () => {
    setLogoBusy(true);
    try {
      const response = await fetch(`/api/teams/${teamId}/logo`, { method: "DELETE" });
      const payload = (await response.json()) as { logoUrl?: string | null; error?: string };
      if (!response.ok) throw new Error(payload.error || "LOGO_DELETE_FAILED");
      setData((prev) =>
        prev ? { ...prev, team: { ...prev.team, logoUrl: null } } : prev,
      );
      showSuccess("Logo supprimé.");
    } catch (e) {
      showError((e as Error).message);
    } finally {
      setLogoBusy(false);
    }
  };

  const updateMemberRoles = async (userId: number, selectedRoles: TeamRole[]) => {
    try {
      const response = await fetch(`/api/teams/${teamId}/members`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userId, roles: selectedRoles }),
      });
      const payload = (await response.json()) as TeamDetailResponse & { error?: string };
      if (!response.ok) throw new Error(payload.error || "TEAM_MEMBER_UPDATE_FAILED");
      setData(payload);
      showSuccess("Rôles mis à jour.");
    } catch (e) {
      showError((e as Error).message);
    }
  };

  const removeMember = async (userId: number) => {
    try {
      const response = await fetch(`/api/teams/${teamId}/members`, {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userId }),
      });
      const payload = (await response.json()) as TeamDetailResponse & { error?: string };
      if (!response.ok) throw new Error(payload.error || "TEAM_MEMBER_REMOVE_FAILED");
      setData(payload);
      showSuccess("Membre retiré.");
    } catch (e) {
      showError((e as Error).message);
    }
  };

  const transferOwnership = async () => {
    if (!transferTargetId) return;
    setTransferPending(true);
    try {
      const response = await fetch(`/api/teams/${teamId}/transfer-ownership`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ newOwnerUserId: transferTargetId }),
      });
      const payload = (await response.json()) as TeamDetailResponse & { error?: string };
      if (!response.ok) throw new Error(payload.error || "TEAM_OWNERSHIP_TRANSFER_FAILED");
      setData(payload);
      setTransferDialogOpen(false);
      setTransferTargetId(null);
      setTransferConfirmStep(false);
      showSuccess("Propriété transférée.");
    } catch (e) {
      showError((e as Error).message);
    } finally {
      setTransferPending(false);
    }
  };

  const viewerIsOwner = useMemo(() => {
    if (!data || !viewerUserId) return false;
    const m = data.members.find((mb) => mb.userId === viewerUserId);
    return !!m?.roles.includes("OWNER");
  }, [data, viewerUserId]);

  const suggestions = useMemo(() => {
    const q = memberPseudo.trim().toLowerCase();
    if (!q) return [];
    return availablePlayers
      .filter((p) => p.team == null && p.pseudo.toLowerCase().includes(q))
      .slice(0, 8);
  }, [availablePlayers, memberPseudo]);

  if (!data) {
    return (
      <section className="ds-block" style={{ color: "var(--text-2)" }}>
        Chargement de l'équipe…
      </section>
    );
  }

  return (
    <section className="fade-in">
      <div className="ds-header orange">
        <div className="ds-header-body">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
              {data.team.logoUrl ? (
                <LogoWithGlow
                  src={data.team.logoUrl}
                  alt={data.team.name}
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
                  {data.team.name}
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

      {data.canManage && (
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
                  {data.team.logoUrl ? (
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
                  onClick={() => {
                    setTransferDialogOpen(true);
                    setTransferTargetId(null);
                    setTransferConfirmStep(false);
                  }}
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

      <div className="ds-block" style={{ marginBottom: 20 }}>
        <div className="ds-section-title orange">
          <h2>Membres</h2>
        </div>

        <div className="table-like">
          <div className="table-row table-header">
            <span>Joueur</span>
            <span>Roles</span>
            <span>Arrivée</span>
            <span>Actions</span>
          </div>
          {data.members.map((member) => (
            <div className="table-row" key={member.membershipId}>
              <Link href={`/joueurs/${member.userId}`}>{member.pseudo}</Link>
              <span>{member.roles.join(", ")}</span>
              <span>{formatLocalDate(member.joinedAt)}</span>
              <span style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {data.canManage ? (
                  <>
                    {viewerIsOwner && !member.roles.includes("OWNER") && (
                      <button
                        className="btn ghost"
                        type="button"
                        onClick={() => removeMember(member.userId)}
                        style={{ padding: "4px 10px", fontSize: 12 }}
                      >
                        Retirer
                      </button>
                    )}
                    {(!member.roles.includes("OWNER") || viewerUserId === member.userId) && (
                      <button
                        className="btn"
                        type="button"
                        onClick={() =>
                          setRolesDialog({
                            userId: member.userId,
                            pseudo: member.pseudo,
                            isOwner: member.roles.includes("OWNER"),
                            selected: member.roles.filter((r) => r !== "OWNER"),
                          })
                        }
                        style={{ padding: "4px 10px", fontSize: 12 }}
                      >
                        Roles
                      </button>
                    )}
                  </>
                ) : (
                  "-"
                )}
              </span>
            </div>
          ))}
        </div>

        {data.canManage && (
          <form onSubmit={addMember} style={{ marginTop: 20, paddingTop: 20, borderTop: "1px solid var(--line)" }}>
            <p
              style={{
                fontSize: 12,
                textTransform: "uppercase",
                letterSpacing: "0.09em",
                color: "var(--text-2)",
                margin: "0 0 14px",
              }}
            >
              Ajouter un membre
            </p>
            <div className="form-grid">
              <div className="field" style={{ position: "relative" }}>
                <label>Pseudo joueur</label>
                <input
                  ref={pseudoInputRef}
                  value={memberPseudo}
                  onChange={(e) => {
                    setMemberPseudo(e.target.value);
                    setShowSuggestions(true);
                  }}
                  onFocus={() => setShowSuggestions(true)}
                  onBlur={() => {
                    setTimeout(() => setShowSuggestions(false), 120);
                  }}
                  required
                  placeholder="Pseudo exact"
                  autoComplete="off"
                />
                {showSuggestions && suggestions.length > 0 && (
                  <ul
                    style={{
                      position: "absolute",
                      top: "calc(100% + 4px)",
                      left: 0,
                      right: 0,
                      zIndex: 20,
                      listStyle: "none",
                      margin: 0,
                      padding: 4,
                      background: "var(--cyber-bg-2, #14181f)",
                      border: "1px solid rgba(255,157,46,0.28)",
                      borderRadius: "var(--r-cy-sm, 8px)",
                      boxShadow: "0 12px 32px rgba(0,0,0,0.45)",
                      maxHeight: 280,
                      overflowY: "auto",
                    }}
                  >
                    {suggestions.map((player) => (
                      <li key={player.id}>
                        <button
                          type="button"
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => {
                            setMemberPseudo(player.pseudo);
                            setShowSuggestions(false);
                            pseudoInputRef.current?.focus();
                          }}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 10,
                            width: "100%",
                            padding: "6px 8px",
                            background: "transparent",
                            border: "none",
                            borderRadius: 6,
                            color: "var(--ink, #e6e9ef)",
                            cursor: "pointer",
                            textAlign: "left",
                            fontSize: 13,
                          }}
                          onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255,157,46,0.08)")}
                          onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                        >
                          {player.avatarUrl ? (
                            <Image
                              src={player.avatarUrl}
                              alt={player.pseudo}
                              width={24}
                              height={24}
                              unoptimized
                              style={{ borderRadius: "50%", objectFit: "cover" }}
                            />
                          ) : (
                            <span
                              style={{
                                width: 24,
                                height: 24,
                                borderRadius: "50%",
                                background: "rgba(255,157,46,0.15)",
                                display: "inline-flex",
                                alignItems: "center",
                                justifyContent: "center",
                                fontSize: 11,
                                color: "var(--text-2, #9aa4b2)",
                              }}
                            >
                              {player.pseudo.slice(0, 1).toUpperCase()}
                            </span>
                          )}
                          <span>{player.pseudo}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div className="field">
                <label>Roles</label>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8, paddingTop: 4 }}>
                  {roles
                    .filter((r) => r !== "OWNER")
                    .map((role) => (
                      <Coche
                        key={role}
                        label={role}
                        checked={memberRoles.includes(role)}
                        theme="equipe"
                        onChange={() => toggleRole(role)}
                      />
                    ))}
                </div>
              </div>
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 14 }}>
              <button
                type="submit"
                className="btn"
                style={{ padding: "10px 22px", background: "rgba(255,157,46,0.12)", borderColor: "rgba(255,157,46,0.3)" }}
              >
                Ajouter
              </button>
            </div>
          </form>
        )}
      </div>

      <div className="ds-block">
        <div className="ds-section-title orange">
          <h2>Historique tournois</h2>
        </div>
        <div className="table-like">
          <div className="table-row table-header">
            <span>Tournoi</span>
            <span>Statut</span>
            <span>Bilan</span>
            <span>Rank</span>
          </div>
          {data.tournaments.map((entry) => (
            <div className="table-row" key={`${entry.tournamentId}-${entry.playedAt}`}>
              <Link href={`/tournois/${entry.tournamentId}`}>{entry.tournamentName}</Link>
              <span>{entry.state}</span>
              <span>
                {entry.wins}W / {entry.losses}L
              </span>
              <span>{entry.finalRank ?? "-"}</span>
            </div>
          ))}
        </div>
      </div>

      {rolesDialog && (
        <div
          role="dialog"
          aria-modal="true"
          onClick={() => setRolesDialog(null)}
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
              Rôles — {rolesDialog.pseudo}
            </h3>
            {rolesDialog.isOwner && (
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
                    checked={rolesDialog.selected.includes(role)}
                    theme="equipe"
                    onChange={() =>
                      setRolesDialog((prev) =>
                        prev
                          ? {
                              ...prev,
                              selected: prev.selected.includes(role)
                                ? prev.selected.filter((r) => r !== role)
                                : [...prev.selected, role],
                            }
                          : prev,
                      )
                    }
                  />
                ))}
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 22 }}>
              <button
                type="button"
                className="btn ghost"
                onClick={() => setRolesDialog(null)}
                style={{ padding: "8px 18px", fontSize: 13 }}
              >
                Annuler
              </button>
              <button
                type="button"
                className="btn"
                disabled={rolesDialog.selected.length === 0}
                onClick={async () => {
                  const current = rolesDialog;
                  if (!current) return;
                  await updateMemberRoles(current.userId, current.selected);
                  setRolesDialog(null);
                }}
                style={{
                  padding: "8px 20px",
                  fontSize: 13,
                  background: "rgba(255,157,46,0.16)",
                  borderColor: "rgba(255,157,46,0.38)",
                  opacity: rolesDialog.selected.length === 0 ? 0.5 : 1,
                }}
              >
                Enregistrer
              </button>
            </div>
          </div>
        </div>
      )}

      {transferDialogOpen && (
        <div
          role="dialog"
          aria-modal="true"
          onClick={() => {
            if (transferPending) return;
            setTransferDialogOpen(false);
            setTransferTargetId(null);
            setTransferConfirmStep(false);
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
              {data?.members
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
              {(!data || data.members.filter((m) => !m.roles.includes("OWNER")).length === 0) && (
                <p style={{ fontSize: 13, color: "var(--text-2, #9aa4b2)", margin: 0 }}>Aucun autre membre dans l'équipe.</p>
              )}
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 20 }}>
              <button
                type="button"
                className="btn ghost"
                disabled={transferPending}
                onClick={() => {
                  setTransferDialogOpen(false);
                  setTransferTargetId(null);
                  setTransferConfirmStep(false);
                }}
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
      )}
    </section>
  );
}
