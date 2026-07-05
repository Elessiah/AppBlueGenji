"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { LogoWithGlow } from "@/components/logo-with-glow";
import { formatLocalDate } from "@/lib/shared/dates";
import type { FullProfileResponse } from "@/lib/shared/types";
import {
  PLATFORM_ROLES,
  ROLE_DESCRIPTIONS,
  ROLE_LABELS,
  type PlatformRole,
} from "@/lib/shared/permissions";
import { useToast } from "@/components/ui/toast";
import { useResourceLoader } from "@/lib/shared/hooks/useResourceLoader";

export default function PlayerDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { showError, showSuccess } = useToast();
  const { status, data, error, refresh } = useResourceLoader<FullProfileResponse>(
    `/api/players/${params.id}`,
    {
      onNotFoundRedirect: () => {
        showError("PLAYER_NOT_FOUND");
        setTimeout(() => router.push("/joueurs"), 1500);
      },
    },
  );
  const [rolesBusy, setRolesBusy] = useState(false);
  const [selectedRoles, setSelectedRoles] = useState<PlatformRole[]>([]);

  // Resynchronise la sélection locale à chaque (re)chargement du profil.
  useEffect(() => {
    if (data?.roles) setSelectedRoles(data.roles);
  }, [data?.roles]);

  const toggleRole = (role: PlatformRole) => {
    setSelectedRoles((prev) =>
      prev.includes(role) ? prev.filter((r) => r !== role) : [...prev, role],
    );
  };

  const saveRoles = async () => {
    setRolesBusy(true);
    try {
      const res = await fetch(`/api/admin/users/${params.id}/roles`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ roles: selectedRoles }),
      });
      const payload = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(payload.error || "ROLES_UPDATE_FAILED");
      showSuccess("Rôles mis à jour.");
      await refresh();
    } catch (e) {
      showError((e as Error).message);
    } finally {
      setRolesBusy(false);
    }
  };

  if (status === "loading")
    return <section className="ds-block" style={{ color: "var(--text-2)" }}>Chargement du profil joueur...</section>;

  if (status === "not-found")
    return (
      <section className="ds-block" style={{ color: "var(--text-2)" }}>
        Joueur non trouvé.{" "}
        <Link href="/joueurs" style={{ color: "var(--blue-100)" }}>
          Retour aux joueurs
        </Link>
      </section>
    );

  if (status === "error") {
    showError(error ?? "PLAYER_LOAD_FAILED");
    return (
      <section className="ds-block" style={{ color: "var(--text-2)" }}>
        Erreur lors du chargement du joueur.{" "}
        <Link href="/joueurs" style={{ color: "var(--blue-100)" }}>
          Retour aux joueurs
        </Link>
      </section>
    );
  }

  if (!data) return null;

  return (
    <section className="fade-in">
      <div className="ds-header">
        <div className="ds-header-body">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
              <LogoWithGlow
                src={data.profile.avatarUrl || "/vercel.svg"}
                alt={data.profile.pseudo}
                width={64}
                height={64}
                size="sm"
                borderRadius={999}
                borderColor="rgba(89,212,255,0.3)"
                unoptimized
              />
              <div>
                <h1 className="ds-title blue" style={{ fontSize: "clamp(26px, 3vw, 40px)", marginBottom: 6 }}>
                  {data.profile.pseudo}
                </h1>
                <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
                  <span className="badge" style={{ fontSize: 11 }}>
                    Joueur BlueGenji
                  </span>
                  {data.displayRoles.map((role) => (
                    <span
                      key={role}
                      className="pill pill-blue"
                      style={{ fontSize: 11 }}
                      title={ROLE_DESCRIPTIONS[role]}
                    >
                      {ROLE_LABELS[role]}
                    </span>
                  ))}
                </div>
              </div>
            </div>
            <Link href="/joueurs" className="btn ghost" style={{ padding: "9px 18px", fontSize: 13, flexShrink: 0 }}>
              ← Joueurs
            </Link>
          </div>

          <div className="ds-stats" style={{ marginTop: 28 }}>
            {[
              { label: "Tournois joués", value: data.stats.tournamentsPlayed },
              { label: "Tournois gagnés", value: data.stats.tournamentsWon },
              { label: "Victoires", value: data.stats.matchesWon },
              { label: "Défaites", value: data.stats.matchesLost },
            ].map((stat) => (
              <div key={stat.label} className="ds-stat">
                <div className="ds-stat-label">{stat.label}</div>
                <div className="ds-stat-value">{stat.value}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="ds-block" style={{ marginBottom: 20 }}>
        <div className="ds-section-title blue">
          <h2>Informations</h2>
        </div>
        <div className="form-grid">
          <div className="field">
            <label>BattleTag Overwatch</label>
            <input value={data.profile.overwatchBattletag || "Masqué"} readOnly />
          </div>
          <div className="field">
            <label>Tag Marvel Rivals</label>
            <input value={data.profile.marvelRivalsTag || "Masqué"} readOnly />
          </div>
          <div className="field">
            <label>Majorité</label>
            <input
              value={
                data.profile.isAdult === null ? "Masqué" : data.profile.isAdult ? "Oui (18+)" : "Non (mineur)"
              }
              readOnly
            />
          </div>
        </div>
      </div>

      {data.viewerIsAdmin && !data.isSelf && (
        <div className="ds-block" style={{ marginBottom: 20 }}>
          <div className="ds-section-title blue">
            <h2>Rôles &amp; permissions</h2>
          </div>
          <p style={{ color: "var(--text-2)", fontSize: 13, marginBottom: 16 }}>
            Les rôles sont cumulables. Un administrateur dispose de tous les droits, dont l&apos;attribution des rôles.
          </p>
          <div role="group" aria-label="Rôles de permission" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {PLATFORM_ROLES.map((role) => {
              const checked = selectedRoles.includes(role);
              return (
                <label
                  key={role}
                  style={{ display: "flex", alignItems: "flex-start", gap: 12, cursor: rolesBusy ? "default" : "pointer" }}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={rolesBusy}
                    onChange={() => toggleRole(role)}
                    style={{ marginTop: 3 }}
                  />
                  <span>
                    <span style={{ display: "block", fontSize: 14, color: "var(--text-0)" }}>{ROLE_LABELS[role]}</span>
                    <span style={{ display: "block", fontSize: 12, color: "var(--text-2)" }}>{ROLE_DESCRIPTIONS[role]}</span>
                  </span>
                </label>
              );
            })}
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 18 }}>
            <button
              type="button"
              className="btn"
              style={{ padding: "9px 18px", fontSize: 13 }}
              disabled={rolesBusy}
              aria-busy={rolesBusy}
              aria-label={`Enregistrer les rôles de ${data.profile.pseudo}`}
              onClick={saveRoles}
            >
              {rolesBusy ? "Enregistrement…" : "Enregistrer les rôles"}
            </button>
          </div>
        </div>
      )}

      <div className="ds-block" style={{ marginBottom: 20 }}>
        <div className="ds-section-title blue">
          <h2>Historique équipes</h2>
        </div>
        <div className="table-like">
          <div className="table-row table-header">
            <span>Équipe</span>
            <span>Rôles</span>
            <span>Début</span>
            <span>Fin</span>
          </div>
          {data.teamsTimeline.map((entry) => (
            <div className="table-row" key={`${entry.teamId}-${entry.joinedAt}`}>
              <Link href={`/equipes/${entry.teamId}`}>{entry.teamName}</Link>
              <span>{entry.roles.join(", ")}</span>
              <span>{formatLocalDate(entry.joinedAt)}</span>
              <span>{entry.leftAt ? formatLocalDate(entry.leftAt) : "Actif"}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="ds-block">
        <div className="ds-section-title blue">
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
