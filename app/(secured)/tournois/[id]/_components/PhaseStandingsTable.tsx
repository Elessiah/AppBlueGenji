"use client";

import Link from "next/link";
import type { TournamentPhaseStanding } from "@/lib/shared/types";
import { Pill } from "@/components/cyber";

interface PhaseStandingsTableProps {
  standings: TournamentPhaseStanding[];
}

export function PhaseStandingsTable({ standings }: PhaseStandingsTableProps) {
  return (
    <div className="table-like">
      <div className="table-row table-header">
        <span>Équipe</span>
        <span>Rang</span>
        <span>Qualifiée</span>
      </div>
      {standings.map((standing) => (
        <div key={standing.teamId} className="table-row">
          <Link
            href={`/equipes/${standing.teamId}`}
            style={{
              textDecoration: "none",
              color: "inherit",
            }}
          >
            {standing.teamName}
          </Link>
          <span>{standing.rank ?? "-"}</span>
          <span>
            {standing.qualified ? (
              <Pill variant="blue" style={{ fontSize: 12 }}>
                ✓
              </Pill>
            ) : (
              "-"
            )}
          </span>
        </div>
      ))}
    </div>
  );
}
