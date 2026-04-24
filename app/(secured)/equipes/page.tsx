"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { TeamListItem } from "@/lib/shared/types";
import { formatLocalDate } from "@/lib/shared/dates";
import { SearchBar } from "@/components/SearchBar";
import { useToast } from "@/components/ui/toast";
import { CyberCard, CyberButton, TeamSigil } from "@/components/cyber";
import { useSetPalette } from "@/lib/palette-context";

function colorFromId(id: number): string {
  const colors = ["#5ac8ff", "#f5a524", "#8fd5ff", "#6bd48a", "#b4c8d4"];
  return colors[id % colors.length];
}

export default function TeamsPage() {
  const { showError } = useToast();
  const setPalette = useSetPalette();
  const [teams, setTeams] = useState<TeamListItem[]>([]);
  const [activeTeam, setActiveTeam] = useState<{ teamId: number; teamName: string } | null>(null);
  const [search, setSearch] = useState("");

  useEffect(() => {
    setPalette("blue");
  }, [setPalette]);

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
      .catch((e) => showError((e as Error).message));
  }, [showError]);

  const sorted = useMemo(() => {
    const term = search.trim().toLowerCase();
    return [...teams]
      .filter((t) => !term || t.name.toLowerCase().includes(term))
      .sort((a, b) => a.name.localeCompare(b.name, "fr"));
  }, [teams, search]);

  return (
    <>
      <Link href="/" className="cta-float-home home">
        ⌂ Accueil
      </Link>
      <section className="fade-in container">
        <div className="section-head">
          <div>
            <span className="eyebrow">COMMUNAUTÉ</span>
            <h1 className="display" style={{ fontSize: 56, margin: "0 0 8px" }}>
              Équipes BlueGenji
            </h1>
            <p className="mono" style={{ color: "var(--ink-mute)", margin: 0 }}>
              ANNUAIRE · ROSTER · PERFORMANCES
            </p>
          </div>
          {!activeTeam && (
            <Link href="/equipes/creer">
              <CyberButton variant="primary">+ Créer une équipe</CyberButton>
            </Link>
          )}
        </div>

        <SearchBar
          value={search}
          onChange={setSearch}
          onSearch={() => {}}
          placeholder="Rechercher une équipe..."
          rgb="90, 200, 255"
        />

        {activeTeam && (
          <div style={{ marginBottom: 24, padding: 12, background: "rgba(90,200,255,0.08)", border: "1px solid rgba(90,200,255,0.2)", borderRadius: 8 }}>
            <p className="mono" style={{ margin: 0, fontSize: 12, color: "var(--ink-mute)" }}>
              Équipe active :{" "}
              <Link href={`/equipes/${activeTeam.teamId}`} style={{ fontWeight: 700, color: "var(--blue-500)" }}>
                {activeTeam.teamName}
              </Link>
            </p>
          </div>
        )}

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 16 }}>
          {sorted.map((team) => (
            <Link key={team.id} href={`/equipes/${team.id}`} style={{ textDecoration: "none" }}>
              <CyberCard lift>
                <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
                  <TeamSigil letter={team.name[0]} color={colorFromId(team.id)} />
                  <div>
                    <h3 className="display" style={{ fontSize: 18, margin: 0 }}>
                      {team.name}
                    </h3>
                  </div>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <div>
                    <div className="num" style={{ fontSize: 18, color: "var(--blue-500)" }}>
                      {team.membersCount}
                    </div>
                    <div className="mono" style={{ color: "var(--ink-dim)", fontSize: 11 }}>
                      MEMBRES
                    </div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div className="mono" style={{ color: "var(--ink-mute)", fontSize: 12 }}>
                      {formatLocalDate(team.createdAt)}
                    </div>
                  </div>
                </div>
              </CyberCard>
            </Link>
          ))}
        </div>
      </section>
    </>
  );
}
