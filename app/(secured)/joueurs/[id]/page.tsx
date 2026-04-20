"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import type { FullProfileResponse } from "@/lib/shared/types";

export default function PlayerDetailPage() {
  const params = useParams<{ id: string }>();
  const [data, setData] = useState<FullProfileResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/players/${params.id}`, { cache: "no-store" })
      .then(async (response) => {
        const payload = (await response.json()) as FullProfileResponse & { error?: string };
        if (!response.ok) throw new Error(payload.error || "PLAYER_LOAD_FAILED");
        setData(payload);
      })
      .catch((e) => setError((e as Error).message));
  }, [params.id]);

  if (error) return <p className="error">{error}</p>;
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
        Chargement du profil joueur…
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
          border: "1px solid rgba(89,212,255,0.15)",
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
              "radial-gradient(ellipse at 0% 50%, rgba(89,212,255,0.08) 0%, transparent 50%)",
          }}
        />
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            height: 3,
            background: "linear-gradient(90deg, transparent, #59d4ff 40%, transparent)",
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
          <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
            <Image
              className="avatar"
              src={data.profile.avatarUrl || "/vercel.svg"}
              alt={data.profile.pseudo}
              width={64}
              height={64}
              unoptimized
              referrerPolicy="no-referrer"
              style={{
                width: 64,
                height: 64,
                borderRadius: "50%",
                border: "2px solid rgba(89,212,255,0.3)",
              }}
            />
            <div>
              <h1
                style={{
                  fontFamily: "var(--font-title), sans-serif",
                  fontSize: "clamp(26px, 3vw, 40px)",
                  fontWeight: 700,
                  letterSpacing: "0.02em",
                  margin: "0 0 6px",
                  background: "linear-gradient(135deg, #f3f7ff 20%, #59d4ff 100%)",
                  WebkitBackgroundClip: "text",
                  WebkitTextFillColor: "transparent",
                  backgroundClip: "text",
                }}
              >
                {data.profile.pseudo}
              </h1>
              <span
                className="badge"
                style={{ fontSize: 11 }}
              >
                Joueur BlueGenji
              </span>
            </div>
          </div>
          <Link href="/joueurs" className="btn ghost" style={{ padding: "9px 18px", fontSize: 13, flexShrink: 0 }}>
            ← Joueurs
          </Link>
        </div>

        {/* Stats */}
        <div style={{ display: "flex", gap: 24, flexWrap: "wrap", marginTop: 28 }}>
          {[
            { label: "Tournois joués", value: data.stats.tournamentsPlayed },
            { label: "Tournois gagnés", value: data.stats.tournamentsWon },
            { label: "Victoires", value: data.stats.matchesWon },
            { label: "Défaites", value: data.stats.matchesLost },
          ].map((stat) => (
            <div
              key={stat.label}
              style={{ borderLeft: "2px solid rgba(89,212,255,0.35)", paddingLeft: 14 }}
            >
              <div
                style={{
                  fontSize: 10,
                  textTransform: "uppercase",
                  letterSpacing: "0.1em",
                  color: "var(--text-2)",
                }}
              >
                {stat.label}
              </div>
              <div style={{ fontSize: 22, fontWeight: 700, marginTop: 4 }}>{stat.value}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ── PROFILE INFO ───────────────────────────────────────────────── */}
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
              background: "linear-gradient(180deg, #59d4ff, #4fe0a2)",
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
            Informations
          </h2>
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
                data.profile.isAdult === null
                  ? "Masqué"
                  : data.profile.isAdult
                  ? "Oui (18+)"
                  : "Non (mineur)"
              }
              readOnly
            />
          </div>
        </div>
      </div>

      {/* ── TEAMS HISTORY ──────────────────────────────────────────────── */}
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
              background: "linear-gradient(180deg, #ff9d2e, #4fe0a2)",
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
            Historique équipes
          </h2>
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
              <span>{new Date(entry.joinedAt).toLocaleDateString()}</span>
              <span>{entry.leftAt ? new Date(entry.leftAt).toLocaleDateString() : "Actif"}</span>
            </div>
          ))}
        </div>
      </div>

      {/* ── TOURNAMENTS HISTORY ────────────────────────────────────────── */}
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
