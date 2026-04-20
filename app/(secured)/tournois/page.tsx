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

const BUCKET_META: Record<keyof TournamentBuckets, { title: string; rgb: string; icon: string }> = {
  upcoming: { title: "Prochainement", rgb: "70,200,180", icon: "⏳" },
  registration: { title: "Inscriptions ouvertes", rgb: "79,224,162", icon: "📋" },
  running: { title: "En cours", rgb: "150,225,60", icon: "⚔️" },
  finished: { title: "Terminés", rgb: "100,115,130", icon: "🏁" },
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
      className="fade-in ds-block"
      style={{ borderColor: `rgba(${rgb},0.18)`, marginBottom: 20, overflow: "hidden", padding: 0 }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "18px 24px",
          borderBottom: items.length ? `1px solid rgba(${rgb},0.15)` : "none",
          background: `rgba(${rgb},0.05)`,
        }}
      >
        <span style={{ fontSize: 18 }}>{icon}</span>
        <h3
          style={{
            margin: 0,
            fontFamily: "var(--font-title), sans-serif",
            letterSpacing: "0.02em",
            color: `rgb(${rgb})`,
          }}
        >
          {title}
        </h3>
        {!!items.length && (
          <span
            className="ds-chip"
            style={{
              marginLeft: "auto",
              letterSpacing: 0,
              textTransform: "none",
              fontWeight: 600,
              borderColor: `rgba(${rgb},0.35)`,
              background: `rgba(${rgb},0.1)`,
              color: `rgb(${rgb})`,
            }}
          >
            {items.length}
          </span>
        )}
      </div>

      {!items.length ? (
        <p style={{ color: "var(--text-2)", fontSize: 14, padding: "18px 24px", margin: 0 }}>
          Aucun tournoi dans cette catégorie.
        </p>
      ) : (
        <div style={{ padding: "14px 16px", display: "flex", flexDirection: "column", gap: 10 }}>
          {items.map((tournament) => (
            <Link
              key={tournament.id}
              href={`/tournois/${tournament.id}`}
              style={{
                border: `1px solid rgba(${rgb},0.16)`,
                borderRadius: 14,
                background: "rgba(0,0,0,0.2)",
                padding: "14px 18px",
                display: "block",
                textDecoration: "none",
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
    <>
      <Link href="/" className="cta-float-home home" style={{ bottom: 28 }}>
        ⌂ Accueil
      </Link>
      <section className="fade-in">

      <div className="ds-header green" style={{ marginBottom: 28 }}>
        <div className="ds-header-body">
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "flex-start",
              gap: 16,
              marginBottom: 24,
            }}
          >
            <div>
              <h1 className="ds-title green" style={{ fontSize: "clamp(32px, 3.5vw, 48px)" }}>
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

          <SearchBar
            value={search}
            onChange={setSearch}
            onSearch={onSearch}
            placeholder="Rechercher un tournoi..."
            rgb="79, 224, 162"
          />

          {error && (
            <p className="error" style={{ marginTop: 14, marginBottom: 0 }}>
              {error}
            </p>
          )}
        </div>
      </div>

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
    </>
  );
}
