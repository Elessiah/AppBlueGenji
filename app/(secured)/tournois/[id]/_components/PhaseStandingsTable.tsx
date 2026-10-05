"use client";

import type { TournamentPhaseStanding } from "@/lib/shared/types";
import { Pill } from "@/components/cyber";
import { useParticipantWording } from "../_lib/entrant-link";
import { EntrantName } from "./EntrantName";

interface PhaseStandingsTableProps {
  standings: TournamentPhaseStanding[];
}

export function PhaseStandingsTable({ standings }: Readonly<PhaseStandingsTableProps>) {
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
          <EntrantName
            teamId={standing.teamId}
            name={standing.teamName}
            textStyle={{ overflowWrap: "anywhere" }}
          />
          <span data-label="Rang">{standing.rank ?? "-"}</span>
          <span data-label="Qualifiée">
            {standing.qualified ? (
              <Pill variant="success" style={{ fontSize: 12 }}>
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
