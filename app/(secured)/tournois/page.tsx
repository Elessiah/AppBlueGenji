"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { formatLocalDateTime } from "@/lib/shared/dates";
import { SearchBar } from "@/components/SearchBar";
import type { TournamentBuckets, TournamentCard } from "@/lib/shared/types";
import { useToast } from "@/components/ui/toast";
import { CyberCard, CyberButton, Pill } from "@/components/cyber";
import { useSetPalette } from "@/lib/palette-context";

const emptyBuckets: TournamentBuckets = {
  upcoming: [],
  registration: [],
  running: [],
  finished: [],
};

function TournamentBucketColumn({
  title,
  items,
}: {
  title: string;
  items: TournamentCard[];
}) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <section style={{ marginBottom: 32 }}>
      <button
        onClick={() => setCollapsed((c) => !c)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "16px 0",
          width: "100%",
          border: "none",
          background: "transparent",
          cursor: "pointer",
          textAlign: "left",
        }}
      >
        <span className="eyebrow" style={{ margin: 0 }}>
          {title.toUpperCase()}
        </span>
        {!!items.length && (
          <Pill variant="blue" style={{ marginLeft: "auto" }}>
            {items.length}
          </Pill>
        )}
        <span
          style={{
            marginLeft: items.length ? 8 : "auto",
            color: "var(--ink-dim)",
            fontSize: 14,
            transform: collapsed ? "rotate(-90deg)" : "rotate(0deg)",
            transition: "transform 0.2s",
            display: "inline-block",
          }}
        >
          ▾
        </span>
      </button>

      {!collapsed && (!items.length ? (
        <p style={{ color: "var(--ink-mute)", fontSize: 14, padding: "12px 0", margin: 0 }}>
          Aucun tournoi dans cette catégorie.
        </p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 12 }}>
          {items.map((tournament) => (
            <Link key={tournament.id} href={`/tournois/${tournament.id}`} style={{ textDecoration: "none" }}>
              <CyberCard lift>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 12 }}>
                  <div>
                    <Pill variant="blue" style={{ marginBottom: 8, display: "inline-block" }}>
                      {tournament.game}
                    </Pill>
                    <h3 className="display" style={{ fontSize: 20, margin: "0 0 4px" }}>
                      {tournament.name}
                    </h3>
                    <p className="mono" style={{ color: "var(--ink-mute)", margin: 0, fontSize: 12 }}>
                      {formatLocalDateTime(tournament.startAt)} · {tournament.format === "SINGLE" ? "Simple élim." : "Double élim."}
                    </p>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div className="num" style={{ fontSize: 22, color: "var(--blue-500)" }}>
                      {tournament.registeredTeams}/{tournament.maxTeams}
                    </div>
                    <div className="mono" style={{ color: "var(--ink-dim)", fontSize: 12 }}>
                      ÉQUIPES
                    </div>
                  </div>
                </div>
                {tournament.description && (
                  <p style={{ color: "var(--ink-mute)", fontSize: 13, margin: 0, lineHeight: 1.5 }}>
                    {tournament.description}
                  </p>
                )}
              </CyberCard>
            </Link>
          ))}
        </div>
      ))}
    </section>
  );
}

export default function TournamentsPage() {
  const { showError } = useToast();
  const setPalette = useSetPalette();
  const [search, setSearch] = useState("");
  const [buckets, setBuckets] = useState<TournamentBuckets>(emptyBuckets);

  useEffect(() => {
    setPalette("blue");
  }, [setPalette]);

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
    load("").catch((e) => showError((e as Error).message));
  }, [showError]);

  const onSearch = async () => {
    try {
      await load(search);
    } catch (e) {
      showError((e as Error).message);
    }
  };

  return (
    <>
      <Link href="/" className="cta-float-home home">
        ⌂ Accueil
      </Link>
      <section className="fade-in container">
        <div className="section-head">
          <div>
            <span className="eyebrow">PLATEFORME</span>
            <h1 className="display" style={{ fontSize: 56, margin: "0 0 8px" }}>
              Tournois BlueGenji
            </h1>
            <p className="mono" style={{ color: "var(--ink-mute)", margin: 0 }}>
              SUIVI TEMPS RÉEL · PHASES MULTIPLES
            </p>
          </div>
          <Link href="/tournois/creer">
            <CyberButton variant="primary">+ Créer un tournoi</CyberButton>
          </Link>
        </div>

        <SearchBar
          value={search}
          onChange={setSearch}
          onSearch={onSearch}
          placeholder="Rechercher un tournoi..."
          rgb="90, 200, 255"
        />

        {(["upcoming", "registration", "running", "finished"] as const).map((key) => (
          <TournamentBucketColumn
            key={key}
            title={{
              upcoming: "Prochainement",
              registration: "Inscriptions ouvertes",
              running: "En cours",
              finished: "Terminés",
            }[key]}
            items={buckets[key]}
          />
        ))}
      </section>
    </>
  );
}
