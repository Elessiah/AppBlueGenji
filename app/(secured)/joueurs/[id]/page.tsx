"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { LogoWithGlow } from "@/components/logo-with-glow";
import { formatLocalDate } from "@/lib/shared/dates";
import type { FullProfileResponse } from "@/lib/shared/types";
import { useToast } from "@/components/ui/toast";

export default function PlayerDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { showError } = useToast();
  const [data, setData] = useState<FullProfileResponse | null>(null);

  useEffect(() => {
    fetch(`/api/players/${params.id}`, { cache: "no-store" })
      .then(async (response) => {
        const payload = (await response.json()) as FullProfileResponse & { error?: string };
        if (!response.ok) {
          const errorCode = payload.error || "PLAYER_LOAD_FAILED";
          if (errorCode === "PLAYER_NOT_FOUND") {
            showError(errorCode);
            setTimeout(() => router.push("/joueurs"), 1500);
            return;
          }
          throw new Error(errorCode);
        }
        setData(payload);
      })
      .catch((e) => showError((e as Error).message));
  }, [params.id, router, showError]);

  if (!data) return <section className="ds-block" style={{ color: "var(--text-2)" }}>Chargement du profil joueur...</section>;

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
                <span className="badge" style={{ fontSize: 11 }}>
                  Joueur BlueGenji
                </span>
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
