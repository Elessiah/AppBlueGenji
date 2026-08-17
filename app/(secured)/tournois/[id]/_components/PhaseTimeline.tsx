"use client";

import type { TournamentPhase } from "@/lib/shared/types";
import { Pill, ScrollArea } from "@/components/cyber";
import { phaseFormatLabel, phaseStateLabel, phaseSubtitle } from "../_lib/phases";

interface PhaseTimelineProps {
  phases: TournamentPhase[];
  selectedPhaseId: number | null;
  currentPhaseId: number | null;
  onSelect: (phaseId: number) => void;
}

export function PhaseTimeline({
  phases,
  selectedPhaseId,
  currentPhaseId,
  onSelect,
}: PhaseTimelineProps) {
  return (
    <ScrollArea
      orientation="x"
      ariaLabel="Phases du tournoi — défilement horizontal"
      style={{ marginBottom: 20 }}
    >
      <div style={{ display: "flex", gap: 10 }}>
        {phases.map((phase, idx) => {
          const isSelected = phase.id === selectedPhaseId;
          const isCurrent = phase.id === currentPhaseId;
          const isSkipped = phase.state === "SKIPPED";
          const isLast = idx === phases.length - 1;
          const label = phase.name || phaseFormatLabel(phase.format);
          const subtitle = phaseSubtitle(phase, isLast);
          const state = phaseStateLabel(phase.state);

          return (
            <button
              key={phase.id}
              type="button"
              onClick={() => !isSkipped && onSelect(phase.id)}
              disabled={isSkipped}
              aria-current={isSelected ? "step" : undefined}
              style={{
                flexShrink: 0,
                padding: "12px 14px",
                border: isSelected
                  ? "1px solid var(--blue-100)"
                  : "1px solid var(--line-soft)",
                borderRadius: 8,
                background: isSelected
                  ? "rgba(90, 200, 255, 0.08)"
                  : "transparent",
                cursor: isSkipped ? "not-allowed" : "pointer",
                textAlign: "left",
                transition: "all 0.15s ease",
                opacity: isSkipped ? 0.5 : 1,
              }}
              onMouseEnter={(e) => {
                if (!isSelected && !isSkipped) {
                  e.currentTarget.style.borderColor = "rgba(90, 200, 255, 0.5)";
                }
              }}
              onMouseLeave={(e) => {
                if (!isSelected) {
                  e.currentTarget.style.borderColor = "var(--line-soft)";
                }
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                <span
                  className="num"
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    color: "var(--text-2)",
                    minWidth: 20,
                  }}
                >
                  {idx + 1}
                </span>
                <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text-0)" }}>
                  {label}
                </span>
              </div>
              {subtitle && (
                <div style={{ fontSize: 11, color: "var(--text-2)", marginBottom: 6 }}>
                  {subtitle}
                </div>
              )}
              <Pill
                variant={isCurrent ? "live" : "blue"}
                style={{ fontSize: 10, padding: "2px 8px" }}
              >
                {state}
              </Pill>
            </button>
          );
        })}
      </div>
    </ScrollArea>
  );
}
