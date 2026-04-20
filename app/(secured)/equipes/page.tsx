"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { TeamListItem } from "@/lib/shared/types";
import { SearchBar } from "@/components/SearchBar";

export default function TeamsPage() {
  const [teams, setTeams] = useState<TeamListItem[]>([]);
  const [activeTeam, setActiveTeam] = useState<{ teamId: number; teamName: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  useEffect(() => {
    fetch("/api/teams", { cache: "no-store" })
      .then(async (response) => {
        const payload = (await response.json()) as {
          error?: string;
          teams?: TeamListItem[];
          activeTeam?: { teamId: number; teamName: string } | null;
        };
        if (!response.ok || !payload.teams) {
          throw new Error(payload.error || "TEAMS_LOAD_FAILED");
        }
        setTeams(payload.teams);
        setActiveTeam(payload.activeTeam || null);
      })
      .catch((e) => setError((e as Error).message));
  }, []);

  const sorted = useMemo(() => {
    const term = search.trim().toLowerCase();
    return [...teams]
      .filter((t) => !term || t.name.toLowerCase().includes(term))
      .sort((a, b) => a.name.localeCompare(b.name, "fr"));
  }, [teams, search]);

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
          marginBottom: 28,
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
            background:
              "linear-gradient(90deg, transparent, #ff9d2e 40%, transparent)",
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
          <div>
            <h1
              style={{
                fontFamily: "var(--font-title), sans-serif",
                fontSize: "clamp(32px, 3.5vw, 48px)",
                fontWeight: 700,
                letterSpacing: "0.02em",
                margin: "0 0 10px",
                background: "linear-gradient(135deg, #f3f7ff 20%, #ff9d2e 100%)",
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
                backgroundClip: "text",
              }}
            >
              Équipes
            </h1>
            <p style={{ color: "var(--text-1)", margin: 0, fontSize: 15, lineHeight: 1.6 }}>
              Annuaire des équipes avec accès au profil team, roster et performances.
            </p>
          </div>
          {!activeTeam && (
            <Link
              href="/equipes/creer"
              className="btn"
              style={{
                padding: "11px 22px",
                fontSize: 14,
                background: "rgba(255,157,46,0.15)",
                borderColor: "rgba(255,157,46,0.3)",
                flexShrink: 0,
                marginTop: 4,
              }}
            >
              + Créer mon équipe
            </Link>
          )}
        </div>

        <div style={{ marginTop: 20 }}>
          <SearchBar
            value={search}
            onChange={setSearch}
            onSearch={() => {}}
            placeholder="Rechercher une équipe…"
            rgb="255, 157, 46"
          />
        </div>
        {activeTeam && (
          <p className="success" style={{ marginTop: 16, marginBottom: 0 }}>
            Équipe active :{" "}
            <Link href={`/equipes/${activeTeam.teamId}`} style={{ fontWeight: 700 }}>
              {activeTeam.teamName}
            </Link>
          </p>
        )}
        {error && <p className="error" style={{ marginTop: 14, marginBottom: 0 }}>{error}</p>}
      </div>

      {/* ── GRID ───────────────────────────────────────────────────────── */}
      <div className="grid-2">
        {sorted.map((team) => (
          <Link
            key={team.id}
            href={`/equipes/${team.id}`}
            style={{
              border: "1px solid var(--line)",
              borderRadius: 16,
              background: "rgba(13,18,30,0.85)",
              padding: "18px 22px",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
              transition: "transform 0.18s ease, border-color 0.18s ease",
              textDecoration: "none",
            }}
          >
            <div>
              <strong style={{ fontSize: 16, display: "block", marginBottom: 4 }}>
                {team.name}
              </strong>
              <span style={{ color: "var(--text-2)", fontSize: 13 }}>
                {team.membersCount} membre{team.membersCount !== 1 ? "s" : ""} · Créée le{" "}
                {new Date(team.createdAt).toLocaleDateString()}
              </span>
            </div>
            <span style={{ color: "var(--accent-orange)", fontSize: 13, fontWeight: 600, flexShrink: 0 }}>
              Voir →
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}
