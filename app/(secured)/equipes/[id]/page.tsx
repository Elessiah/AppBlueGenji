"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Coche } from "@/components/Coche";
import { LogoWithGlow } from "@/components/logo-with-glow";
import { formatLocalDate } from "@/lib/shared/dates";
import type { TeamDetailResponse, TeamRole } from "@/lib/shared/types";
import { useToast } from "@/components/ui/toast";

const roles: TeamRole[] = ["COACH", "TANK", "DPS", "HEAL", "CAPITAINE", "MANAGER", "OWNER"];

export default function TeamDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const teamId = Number(params.id);
  const { showError, showSuccess } = useToast();
  const [data, setData] = useState<TeamDetailResponse | null>(null);
  const [memberPseudo, setMemberPseudo] = useState("");
  const [memberRoles, setMemberRoles] = useState<TeamRole[]>(["DPS"]);
  const [name, setName] = useState("");
  const [logoUrl, setLogoUrl] = useState("");

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
    setLogoUrl(payload.team.logoUrl || "");
  }, [teamId, router, showError]);

  useEffect(() => {
    load().catch((e) => showError((e as Error).message));
  }, [load, showError]);

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
        body: JSON.stringify({ name, logoUrl: logoUrl.trim() ? logoUrl.trim() : null }),
      });
      const payload = (await response.json()) as TeamDetailResponse & { error?: string };
      if (!response.ok) throw new Error(payload.error || "TEAM_UPDATE_FAILED");
      setData(payload);
      showSuccess("Équipe mise à jour.");
    } catch (e) {
      showError((e as Error).message);
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
    if (!parsed.length) {
      showError("MISSING_ROLE");
      return;
    }
    await updateMemberRoles(userId, parsed);
  };

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
                <label>Logo URL</label>
                <input value={logoUrl} onChange={(e) => setLogoUrl(e.target.value)} placeholder="https://..." />
              </div>
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 16 }}>
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
                      Roles
                    </button>
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
    </section>
  );
}
