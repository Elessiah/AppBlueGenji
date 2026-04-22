"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { TeamListItem } from "@/lib/shared/types";
import { formatLocalDate } from "@/lib/shared/dates";
import { SearchBar } from "@/components/SearchBar";
import { useToast } from "@/components/ui/toast";

export default function TeamsPage() {
  const { showError } = useToast();
  const [teams, setTeams] = useState<TeamListItem[]>([]);
  const [activeTeam, setActiveTeam] = useState<{ teamId: number; teamName: string } | null>(null);
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
      <Link href="/" className="cta-float-home home" style={{ bottom: 28, padding: "14px 20px", fontSize: 15, fontWeight: 600, background: "rgba(255,157,46,0.15)", borderColor: "rgba(255,157,46,0.3)", boxShadow: "0 4px 12px rgba(0,0,0,0.15)" }}>
        ⌂ Accueil
      </Link>
      <section className="fade-in">
      <div className="ds-header orange" style={{ marginBottom: 28 }}>
        <div className="ds-header-body">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16 }}>
            <div>
              <h1 className="ds-title orange" style={{ fontSize: "clamp(32px, 3.5vw, 48px)" }}>
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
              placeholder="Rechercher une équipe..."
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
        </div>
      </div>

      <div className="grid-2">
        {sorted.map((team) => (
          <Link
            key={team.id}
            href={`/equipes/${team.id}`}
            className="ds-block"
            style={{
              borderRadius: 16,
              padding: "18px 22px",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
              textDecoration: "none",
            }}
          >
            <div>
              <strong style={{ fontSize: 16, display: "block", marginBottom: 4 }}>{team.name}</strong>
              <span style={{ color: "var(--text-2)", fontSize: 13 }}>
                {team.membersCount} membre{team.membersCount !== 1 ? "s" : ""} — Créée le{" "}
                {formatLocalDate(team.createdAt)}
              </span>
            </div>
            <span style={{ color: "var(--accent-orange)", fontSize: 13, fontWeight: 600, flexShrink: 0 }}>
              Voir →
            </span>
          </Link>
        ))}
      </div>
      </section>
    </>
  );
}
