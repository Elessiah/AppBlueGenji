"use client";

import Link from "next/link";
import type { TournamentPhaseStanding } from "@/lib/shared/types";
import { Pill } from "@/components/cyber";
import { useEntrantLink, useParticipantWording } from "../_lib/entrant-link";

interface PhaseStandingsTableProps {
  standings: TournamentPhaseStanding[];
}

export function PhaseStandingsTable({ standings }: PhaseStandingsTableProps) {
  const entrantLink = useEntrantLink();
  const wording = useParticipantWording();

  return (
    <div className="table-like">
      <div className="table-row table-header">
        <span>{wording.oneCapitalized}</span>
        <span>Rang</span>
        <span>Qualifiée</span>
      </div>
      {standings.map((standing) => (
        <div key={standing.teamId} className="table-row">
          <Link
            href={entrantLink(standing.teamId)}
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
