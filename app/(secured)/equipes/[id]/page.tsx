"use client";

import Image from "next/image";
import Link from "next/link";
import { FormEvent, useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import type { TeamDetailResponse, TeamRole } from "@/lib/shared/types";

const roles: TeamRole[] = ["COACH", "TANK", "DPS", "HEAL", "CAPITAINE", "MANAGER", "OWNER"];

export default function TeamDetailPage() {
  const params = useParams<{ id: string }>();
  const teamId = Number(params.id);
  const [data, setData] = useState<TeamDetailResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [memberPseudo, setMemberPseudo] = useState("");
  const [memberRoles, setMemberRoles] = useState<TeamRole[]>(["DPS"]);
  const [name, setName] = useState("");
  const [logoUrl, setLogoUrl] = useState("");

  const load = useCallback(async () => {
    const response = await fetch(`/api/teams/${teamId}`, { cache: "no-store" });
    const payload = (await response.json()) as TeamDetailResponse & { error?: string };
    if (!response.ok) throw new Error(payload.error || "TEAM_LOAD_FAILED");
    setData(payload);
    setName(payload.team.name);
    setLogoUrl(payload.team.logoUrl || "");
  }, [teamId]);

  useEffect(() => {
    load().catch((e) => setError((e as Error).message));
  }, [load]);

  const toggleRole = (role: TeamRole) => {
    setMemberRoles((prev) =>
      prev.includes(role) ? prev.filter((r) => r !== role) : [...prev, role],
    );
  };

  const addMember = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setStatus(null);
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
      setStatus("Membre ajouté.");
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const saveMeta = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setStatus(null);
    try {
      const response = await fetch(`/api/teams/${teamId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, logoUrl: logoUrl.trim() ? logoUrl.trim() : null }),
      });
      const payload = (await response.json()) as TeamDetailResponse & { error?: string };
      if (!response.ok) throw new Error(payload.error || "TEAM_UPDATE_FAILED");
      setData(payload);
      setStatus("Équipe mise à jour.");
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const updateMemberRoles = async (userId: number, selectedRoles: TeamRole[]) => {
    setError(null);
    try {
      const response = await fetch(`/api/teams/${teamId}/members`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userId, roles: selectedRoles }),
      });
      const payload = (await response.json()) as TeamDetailResponse & { error?: string };
      if (!response.ok) throw new Error(payload.error || "TEAM_MEMBER_UPDATE_FAILED");
      setData(payload);
      setStatus("Rôles mis à jour.");
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const removeMember = async (userId: number) => {
    setError(null);
    try {
      const response = await fetch(`/api/teams/${teamId}/members`, {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userId }),
      });
      const payload = (await response.json()) as TeamDetailResponse & { error?: string };
      if (!response.ok) throw new Error(payload.error || "TEAM_MEMBER_REMOVE_FAILED");
      setData(payload);
      setStatus("Membre retiré.");
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const editMemberRoles = async (userId: number, currentRoles: TeamRole[]) => {
    const raw = window.prompt(
      "Rôles (séparés par virgule) parmi : COACH, TANK, DPS, HEAL, CAPITAINE, MANAGER",
      currentRoles.filter((r) => r !== "OWNER").join(", "),
    );
    if (raw === null) return;
    const parsed = raw
      .split(",")
      .map((v) => v.trim().toUpperCase())
      .filter((v): v is TeamRole => roles.includes(v as TeamRole) && v !== "OWNER");
    if (parsed.length === 0) { setError("MISSING_ROLE"); return; }
    await updateMemberRoles(userId, parsed);
  };

  if (!data) {
    return (
      <section
        style={{
          borderRadius: 16,
          border: "1px solid var(--line)",
          background: "rgba(13,18,30,0.8)",
          padding: "28px 32px",
          color: "var(--text-2)",
        }}
      >
        Chargement de l'équipe…
      </section>
    );
  }

  return (
    <section className="fade-in">
      {/* ── HEADER ─────────────────────────────────────────────────────── */}
      <div
        style={{
          position: "relative",
          borderRadius: 22,
          border: "1px solid rgba(255,157,46,0.15)",
          background:
            "linear-gradient(135deg, rgba(11,16,27,0.97) 0%, rgba(18,26,44,0.95) 100%)",
          overflow: "hidden",
          padding: "40px 40px 36px",
          marginBottom: 24,
        }}
      >
        <div
          style={{
            position: "absolute",
            inset: 0,
            pointerEvents: "none",
            background:
              "radial-gradient(ellipse at 0% 50%, rgba(255,157,46,0.07) 0%, transparent 50%)",
          }}
        />
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            height: 3,
            background: "linear-gradient(90deg, transparent, #ff9d2e 40%, transparent)",
          }}
        />
        <div
          style={{
            position: "relative",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            gap: 16,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            {data.team.logoUrl ? (
              <Image
                src={data.team.logoUrl}
                alt={data.team.name}
                width={56}
                height={56}
                unoptimized
                style={{
                  width: 56,
                  height: 56,
                  borderRadius: 12,
                  border: "1px solid rgba(255,157,46,0.3)",
                  objectFit: "cover",
                }}
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
              <h1
                style={{
                  fontFamily: "var(--font-title), sans-serif",
                  fontSize: "clamp(26px, 3vw, 40px)",
                  fontWeight: 700,
                  letterSpacing: "0.02em",
                  margin: "0 0 6px",
                  background: "linear-gradient(135deg, #f3f7ff 20%, #ff9d2e 100%)",
                  WebkitBackgroundClip: "text",
                  WebkitTextFillColor: "transparent",
                  backgroundClip: "text",
                }}
              >
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

      {error && <p className="error" style={{ marginBottom: 16 }}>{error}</p>}
      {status && <p className="success" style={{ marginBottom: 16 }}>{status}</p>}

      {/* ── MANAGE FORM (managers only) ────────────────────────────────── */}
      {data.canManage && (
        <div
          style={{
            border: "1px solid rgba(255,157,46,0.15)",
            borderRadius: 20,
            background: "rgba(13,18,30,0.85)",
            padding: "28px 32px",
            marginBottom: 20,
          }}
        >
          <div style={{ display: "flex", alignItems: "flex-start", gap: 12, marginBottom: 20 }}>
            <span
              style={{
                flexShrink: 0,
                width: 4,
                height: 28,
                background: "linear-gradient(180deg, #ff9d2e, #59d4ff)",
                borderRadius: 2,
                marginTop: 2,
              }}
            />
            <h2
              style={{
                fontFamily: "var(--font-title), sans-serif",
                fontSize: 20,
                margin: 0,
                letterSpacing: "0.02em",
              }}
            >
              Paramètres de l'équipe
            </h2>
          </div>
          <form onSubmit={saveMeta}>
            <div className="form-grid">
              <div className="field">
                <label>Nom équipe</label>
                <input value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <div className="field">
                <label>Logo URL</label>
                <input value={logoUrl} onChange={(e) => setLogoUrl(e.target.value)} placeholder="https://…" />
              </div>
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 16 }}>
              <button
                type="submit"
                style={{
                  padding: "10px 24px",
                  borderRadius: 999,
                  border: "1px solid rgba(255,157,46,0.35)",
                  background: "rgba(255,157,46,0.14)",
                  color: "var(--text-0)",
                  fontSize: 14,
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                Mettre à jour
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ── MEMBERS ────────────────────────────────────────────────────── */}
      <div
        style={{
          border: "1px solid var(--line)",
          borderRadius: 20,
          background: "rgba(13,18,30,0.85)",
          padding: "28px 32px",
          marginBottom: 20,
        }}
      >
        <div style={{ display: "flex", alignItems: "flex-start", gap: 12, marginBottom: 20 }}>
          <span
            style={{
              flexShrink: 0,
              width: 4,
              height: 28,
              background: "linear-gradient(180deg, #4fe0a2, #59d4ff)",
              borderRadius: 2,
              marginTop: 2,
            }}
          />
          <h2
            style={{
              fontFamily: "var(--font-title), sans-serif",
              fontSize: 20,
              margin: 0,
              letterSpacing: "0.02em",
            }}
          >
            Membres
          </h2>
        </div>

        <div className="table-like">
          <div className="table-row table-header">
            <span>Joueur</span>
            <span>Rôles</span>
            <span>Arrivée</span>
            <span>Actions</span>
          </div>
          {data.members.map((member) => (
            <div className="table-row" key={member.membershipId}>
              <Link href={`/joueurs/${member.userId}`}>{member.pseudo}</Link>
              <span>{member.roles.join(", ")}</span>
              <span>{new Date(member.joinedAt).toLocaleDateString()}</span>
              <span style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {data.canManage ? (
                  <>
                    <button
                      className="btn ghost"
                      type="button"
                      onClick={() => removeMember(member.userId)}
                      style={{ padding: "4px 10px", fontSize: 12 }}
                    >
                      Retirer
                    </button>
                    <button
                      className="btn"
                      type="button"
                      onClick={() => editMemberRoles(member.userId, member.roles)}
                      style={{ padding: "4px 10px", fontSize: 12 }}
                    >
                      Rôles
                    </button>
                  </>
                ) : (
                  "—"
                )}
              </span>
            </div>
          ))}
        </div>

        {/* Add member form */}
        {data.canManage && (
          <form
            onSubmit={addMember}
            style={{
              marginTop: 20,
              paddingTop: 20,
              borderTop: "1px solid var(--line)",
            }}
          >
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
              <div className="field">
                <label>Pseudo joueur</label>
                <input
                  value={memberPseudo}
                  onChange={(e) => setMemberPseudo(e.target.value)}
                  required
                  placeholder="Pseudo exact"
                />
              </div>
              <div className="field">
                <label>Rôles</label>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8, paddingTop: 4 }}>
                  {roles
                    .filter((r) => r !== "OWNER")
                    .map((role) => (
                      <label
                        key={role}
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 6,
                          padding: "5px 10px",
                          borderRadius: 999,
                          border: `1px solid ${memberRoles.includes(role) ? "rgba(89,212,255,0.35)" : "var(--line)"}`,
                          background: memberRoles.includes(role)
                            ? "rgba(89,212,255,0.1)"
                            : "transparent",
                          cursor: "pointer",
                          fontSize: 13,
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={memberRoles.includes(role)}
                          onChange={() => toggleRole(role)}
                          style={{ accentColor: "var(--accent-blue)" }}
                        />
                        {role}
                      </label>
                    ))}
                </div>
              </div>
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 14 }}>
              <button
                type="submit"
                style={{
                  padding: "10px 22px",
                  borderRadius: 999,
                  border: "1px solid rgba(89,212,255,0.3)",
                  background: "rgba(89,212,255,0.12)",
                  color: "var(--text-0)",
                  fontSize: 14,
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                Ajouter
              </button>
            </div>
          </form>
        )}
      </div>

      {/* ── TOURNAMENT HISTORY ─────────────────────────────────────────── */}
      <div
        style={{
          border: "1px solid var(--line)",
          borderRadius: 20,
          background: "rgba(13,18,30,0.85)",
          padding: "28px 32px",
        }}
      >
        <div style={{ display: "flex", alignItems: "flex-start", gap: 12, marginBottom: 20 }}>
          <span
            style={{
              flexShrink: 0,
              width: 4,
              height: 28,
              background: "linear-gradient(180deg, #59d4ff, #ff9d2e)",
              borderRadius: 2,
              marginTop: 2,
            }}
          />
          <h2
            style={{
              fontFamily: "var(--font-title), sans-serif",
              fontSize: 20,
              margin: 0,
              letterSpacing: "0.02em",
            }}
          >
            Historique tournois
          </h2>
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
              <span>{entry.finalRank ?? "—"}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
