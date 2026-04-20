"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { PublicUserProfile } from "@/lib/shared/types";
import { SearchBar } from "@/components/SearchBar";

export default function PlayersPage() {
  const [players, setPlayers] = useState<PublicUserProfile[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  useEffect(() => {
    fetch("/api/players", { cache: "no-store" })
      .then(async (response) => {
        const payload = (await response.json()) as { error?: string; players?: PublicUserProfile[] };
        if (!response.ok || !payload.players) {
          throw new Error(payload.error || "PLAYERS_LOAD_FAILED");
        }
        setPlayers(payload.players);
      })
      .catch((e) => setError((e as Error).message));
  }, []);

  const sorted = useMemo(() => {
    const term = search.trim().toLowerCase();
    return [...players]
      .filter((p) => !term || p.pseudo.toLowerCase().includes(term))
      .sort((a, b) => a.pseudo.localeCompare(b.pseudo, "fr"));
  }, [players, search]);

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
          marginBottom: 28,
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
            background:
              "linear-gradient(90deg, transparent, #59d4ff 40%, transparent)",
          }}
        />
        <div style={{ position: "relative" }}>
          <h1
            style={{
              fontFamily: "var(--font-title), sans-serif",
              fontSize: "clamp(32px, 3.5vw, 48px)",
              fontWeight: 700,
              letterSpacing: "0.02em",
              margin: "0 0 10px",
              background: "linear-gradient(135deg, #f3f7ff 20%, #59d4ff 100%)",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
              backgroundClip: "text",
            }}
          >
            Joueurs
          </h1>
          <p style={{ color: "var(--text-1)", margin: 0, fontSize: 15, lineHeight: 1.6 }}>
            Annuaire des joueurs inscrits, triés alphabétiquement.
          </p>
          <div style={{ marginTop: 20 }}>
            <SearchBar
              value={search}
              onChange={setSearch}
              onSearch={() => {}}
              placeholder="Rechercher un joueur…"
              rgb="89, 212, 255"
            />
          </div>
          {error && <p className="error" style={{ marginTop: 14 }}>{error}</p>}
        </div>
      </div>

      {/* ── GRID ───────────────────────────────────────────────────────── */}
      <div className="grid-3">
        {sorted.map((player) => (
          <Link
            key={player.id}
            href={`/joueurs/${player.id}`}
            style={{
              border: "1px solid var(--line)",
              borderRadius: 16,
              background: "rgba(13,18,30,0.85)",
              padding: "16px 18px",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
              transition: "transform 0.18s ease, border-color 0.18s ease",
              textDecoration: "none",
            }}
          >
            <span className="avatar-chip">
              <Image
                className="avatar"
                src={player.avatarUrl || "/vercel.svg"}
                alt={player.pseudo}
                width={36}
                height={36}
                unoptimized
                referrerPolicy="no-referrer"
              />
              <strong style={{ fontSize: 15 }}>{player.pseudo}</strong>
            </span>
            <span style={{ color: "var(--accent-blue)", fontSize: 13, fontWeight: 600 }}>
              Voir →
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}
