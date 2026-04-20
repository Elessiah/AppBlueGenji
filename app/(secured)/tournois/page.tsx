"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { SearchBar } from "@/components/SearchBar";
import type { TournamentBuckets, TournamentCard } from "@/lib/shared/types";

const emptyBuckets: TournamentBuckets = {
  upcoming: [],
  registration: [],
  running: [],
  finished: [],
};

const BUCKET_META: Record<
  keyof TournamentBuckets,
  { title: string; rgb: string; icon: string }
> = {
  upcoming: { title: "Prochainement", rgb: "89,212,255", icon: "⏳" },
  registration: { title: "Inscriptions ouvertes", rgb: "79,224,162", icon: "📋" },
  running: { title: "En cours", rgb: "255,157,46", icon: "⚔️" },
  finished: { title: "Terminés", rgb: "143,156,176", icon: "🏁" },
};

function TournamentColumn({
  title,
  rgb,
  icon,
  items,
}: {
  title: string;
  rgb: string;
  icon: string;
  items: TournamentCard[];
}) {
  return (
    <section
      className="fade-in"
      style={{
        border: `1px solid rgba(${rgb},0.15)`,
        borderRadius: 20,
        background: "rgba(13,18,30,0.85)",
        overflow: "hidden",
        marginBottom: 20,
      }}
    >
      {/* Section header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "18px 24px",
          borderBottom: items.length > 0 ? `1px solid rgba(${rgb},0.12)` : "none",
          background: `rgba(${rgb},0.04)`,
        }}
      >
        <span style={{ fontSize: 18 }}>{icon}</span>
        <h3
          style={{
            fontFamily: "var(--font-title), sans-serif",
            fontSize: 18,
            margin: 0,
            letterSpacing: "0.02em",
            color: `rgb(${rgb})`,
          }}
        >
          {title}
        </h3>
        {items.length > 0 && (
          <span
            style={{
              marginLeft: "auto",
              padding: "2px 9px",
              borderRadius: 999,
              background: `rgba(${rgb},0.12)`,
              border: `1px solid rgba(${rgb},0.25)`,
              fontSize: 12,
              fontWeight: 700,
              color: `rgb(${rgb})`,
            }}
          >
            {items.length}
          </span>
        )}
      </div>

      {items.length === 0 ? (
        <p
          style={{
            color: "var(--text-2)",
            fontSize: 14,
            padding: "18px 24px",
            margin: 0,
          }}
        >
          Aucun tournoi dans cette catégorie.
        </p>
      ) : (
        <div style={{ padding: "14px 16px", display: "flex", flexDirection: "column", gap: 10 }}>
          {items.map((tournament) => (
            <Link
              key={tournament.id}
              href={`/tournois/${tournament.id}`}
              style={{
                border: `1px solid rgba(${rgb},0.12)`,
                borderRadius: 14,
                background: "rgba(0,0,0,0.2)",
                padding: "14px 18px",
                display: "block",
                textDecoration: "none",
                transition: "transform 0.16s ease, border-color 0.16s ease",
              }}
            >
              <strong style={{ fontSize: 15, display: "block", marginBottom: 4 }}>
                {tournament.name}
              </strong>
              {tournament.description && (
                <p
                  style={{
                    color: "var(--text-1)",
                    fontSize: 13,
                    margin: "0 0 8px",
                    lineHeight: 1.5,
                  }}
                >
                  {tournament.description}
                </p>
              )}
              <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
                <span style={{ color: "var(--text-2)", fontSize: 12 }}>
                  {tournament.format === "SINGLE" ? "Simple élim." : "Double élim."}
                </span>
                <span style={{ color: "var(--text-2)", fontSize: 12 }}>
                  {tournament.registeredTeams}/{tournament.maxTeams} équipes
                </span>
                <span style={{ color: "var(--text-2)", fontSize: 12 }}>
                  {new Date(tournament.startAt).toLocaleString()}
                </span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}

export default function TournamentsPage() {
  const [search, setSearch] = useState("");
  const [buckets, setBuckets] = useState<TournamentBuckets>(emptyBuckets);
  const [error, setError] = useState<string | null>(null);

  const load = async (term: string) => {
    const url = term.trim()
      ? `/api/tournaments?search=${encodeURIComponent(term.trim())}`
      : "/api/tournaments";
    const response = await fetch(url, { cache: "no-store" });
    const payload = (await response.json()) as {
      error?: string;
      buckets?: TournamentBuckets;
    };
    if (!response.ok || !payload.buckets) {
      throw new Error(payload.error || "TOURNAMENT_LIST_FAILED");
    }
    setBuckets(payload.buckets);
  };

  useEffect(() => {
    load("").catch((e) => setError((e as Error).message));
  }, []);

  const onSearch = async () => {
    setError(null);
    try {
      await load(search);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const sections = useMemo(
    () =>
      (["upcoming", "registration", "running", "finished"] as const).map((key) => ({
        key,
        ...BUCKET_META[key],
        items: buckets[key],
      })),
    [buckets],
  );

  return (
    <section className="fade-in">
      <Link href="/" className="cta-float-home" style={{ bottom: 28 }}>
        ⌂ Accueil
      </Link>
      {/* ── HEADER ─────────────────────────────────────────────────────── */}
      <div
        style={{
          position: "relative",
          borderRadius: 22,
          border: "1px solid rgba(79,224,162,0.15)",
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
              "radial-gradient(ellipse at 0% 50%, rgba(79,224,162,0.08) 0%, transparent 50%)",
          }}
        />
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            height: 3,
            background: "linear-gradient(90deg, transparent, #4fe0a2 40%, transparent)",
          }}
        />
        <div
          style={{
            position: "relative",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            gap: 16,
            marginBottom: 24,
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
                background: "linear-gradient(135deg, #f3f7ff 20%, #4fe0a2 100%)",
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
                backgroundClip: "text",
              }}
            >
              Tournois
            </h1>
            <p style={{ color: "var(--text-1)", margin: 0, fontSize: 15, lineHeight: 1.6 }}>
              Suivi en temps réel des tournois BlueGenji, triés par phase.
            </p>
          </div>
          <Link
            href="/tournois/creer"
            className="btn"
            style={{
              padding: "11px 22px",
              fontSize: 14,
              background: "rgba(79,224,162,0.15)",
              borderColor: "rgba(79,224,162,0.3)",
              flexShrink: 0,
              marginTop: 4,
            }}
          >
            + Créer mon tournoi
          </Link>
        </div>

        {/* Search */}
        <SearchBar
          value={search}
          onChange={setSearch}
          onSearch={onSearch}
          placeholder="Rechercher un tournoi…"
          rgb="79, 224, 162"
        />

        {error && <p className="error" style={{ marginTop: 14, marginBottom: 0 }}>{error}</p>}
      </div>

      {/* ── BUCKETS ────────────────────────────────────────────────────── */}
      {sections.map((section) => (
        <TournamentColumn
          key={section.key}
          title={section.title}
          rgb={section.rgb}
          icon={section.icon}
          items={section.items}
        />
      ))}
    </section>
  );
}
