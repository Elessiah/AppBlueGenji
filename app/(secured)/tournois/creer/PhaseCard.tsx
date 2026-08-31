"use client";

import { CSSProperties } from "react";
import type { PhaseConfig } from "@/lib/shared/tournament-phases";
import type { PhaseFormat } from "@/lib/shared/types";
import { MIN_PHASES } from "@/lib/shared/tournament-phases";
import { Pill } from "@/components/cyber";
import {
  phaseFormatLabel,
  phaseSummary,
} from "./phase-form";

const HINT: CSSProperties = {
  margin: "2px 0 0",
  fontSize: 12.5,
  color: "var(--ink-mute)",
  lineHeight: 1.5,
};

const FULL_WIDTH: CSSProperties = { gridColumn: "1 / -1" };
const GRID: CSSProperties = { gap: 16 };

interface PhaseCardProps {
  phase: PhaseConfig;
  isLast: boolean;
  isExpanded: boolean;
  totalPhases: number;
  maxTeams: number;
  /** Plan verrouillé : consultable, mais plus modifiable (édition restreinte). */
  disabled?: boolean;
  onToggleExpand: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onRemove: () => void;
  onUpdate: (phase: PhaseConfig) => void;
}

export function PhaseCard({
  phase,
  isLast,
  isExpanded,
  totalPhases,
  maxTeams,
  disabled = false,
  onToggleExpand,
  onMoveUp,
  onMoveDown,
  onRemove,
  onUpdate,
}: PhaseCardProps) {
  const canMoveUp = !disabled && phase.position > 1;
  const canMoveDown = !disabled && phase.position < totalPhases;
  const canRemove = !disabled && totalPhases > MIN_PHASES;

  return (
    <div
      style={{
        border: "1px solid var(--line-soft)",
        borderRadius: 10,
        overflow: "hidden",
      }}
    >
      {/* Collapsed header */}
      <button
        type="button"
        onClick={onToggleExpand}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "14px 16px",
          backgroundColor: isExpanded ? "rgba(90, 200, 255, 0.07)" : "transparent",
          border: "none",
          cursor: "pointer",
          transition: "background-color 0.2s ease",
        }}
      >
        {/* Position badge */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: 32,
            height: 32,
            backgroundColor: "var(--line-soft)",
            borderRadius: 6,
            fontSize: 14,
            fontWeight: 600,
            color: "var(--ink)",
            flexShrink: 0,
          }}
        >
          {phase.position}
        </div>

        {/* Name or format label + summary */}
        <div style={{ flex: 1, textAlign: "left", minWidth: 0 }}>
          <div
            style={{
              fontSize: 14,
              fontWeight: 500,
              color: "var(--ink)",
              marginBottom: 2,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {phase.name || phaseFormatLabel(phase.format)}
          </div>
          <div
            style={{
              fontSize: 12,
              color: "var(--ink-mute)",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {phaseSummary(phase, isLast)}
          </div>
        </div>

        {/* Last-phase badge */}
        {isLast && (
          <Pill variant="blue" style={{ flexShrink: 0 }}>
            Phase finale
          </Pill>
        )}

        {/* Controls */}
        <div
          style={{
            display: "flex",
            gap: 6,
            flexShrink: 0,
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            onClick={onMoveUp}
            disabled={!canMoveUp}
            aria-label={`Monter la phase ${phase.position}`}
            style={{
              width: 32,
              height: 32,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: "transparent",
              border: `1px solid var(--line-strong-cy)`,
              borderRadius: 6,
              cursor: canMoveUp ? "pointer" : "not-allowed",
              color: canMoveUp ? "var(--ink)" : "var(--ink-mute)",
              fontSize: 14,
              transition: "all 0.2s ease",
            }}
            onMouseEnter={(e) => {
              if (canMoveUp) {
                (e.currentTarget as HTMLButtonElement).style.backgroundColor =
                  "rgba(90, 200, 255, 0.1)";
              }
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLButtonElement).style.backgroundColor =
                "transparent";
            }}
          >
            ↑
          </button>

          <button
            type="button"
            onClick={onMoveDown}
            disabled={!canMoveDown}
            aria-label={`Descendre la phase ${phase.position}`}
            style={{
              width: 32,
              height: 32,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: "transparent",
              border: `1px solid var(--line-strong-cy)`,
              borderRadius: 6,
              cursor: canMoveDown ? "pointer" : "not-allowed",
              color: canMoveDown ? "var(--ink)" : "var(--ink-mute)",
              fontSize: 14,
              transition: "all 0.2s ease",
            }}
            onMouseEnter={(e) => {
              if (canMoveDown) {
                (e.currentTarget as HTMLButtonElement).style.backgroundColor =
                  "rgba(90, 200, 255, 0.1)";
              }
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLButtonElement).style.backgroundColor =
                "transparent";
            }}
          >
            ↓
          </button>

          <button
            type="button"
            onClick={onRemove}
            disabled={!canRemove}
            aria-label={`Supprimer la phase ${phase.position}`}
            style={{
              width: 32,
              height: 32,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: "transparent",
              border: `1px solid var(--line-strong-cy)`,
              borderRadius: 6,
              cursor: canRemove ? "pointer" : "not-allowed",
              color: canRemove ? "var(--ink)" : "var(--ink-mute)",
              fontSize: 14,
              transition: "all 0.2s ease",
            }}
            onMouseEnter={(e) => {
              if (canRemove) {
                (e.currentTarget as HTMLButtonElement).style.backgroundColor =
                  "rgba(255, 110, 130, 0.1)";
              }
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLButtonElement).style.backgroundColor =
                "transparent";
            }}
          >
            ✕
          </button>
        </div>

        {/* Chevron */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            fontSize: 12,
            color: "var(--ink-mute)",
            flexShrink: 0,
            transform: isExpanded ? "rotate(180deg)" : "rotate(0deg)",
            transition: "transform 0.2s ease",
          }}
        >
          ▼
        </div>
      </button>

      {/* Expanded content */}
      {isExpanded && (
        <div
          style={{
            borderTop: "1px solid var(--line-soft)",
            padding: "16px",
            backgroundColor: "rgba(90, 200, 255, 0.03)",
          }}
        >
          <div className="form-grid" style={GRID}>
            {/* Phase name */}
            <div className="field">
              <label htmlFor={`phase-name-${phase.position}`}>
                Nom de la phase (optionnel)
              </label>
              <input
                id={`phase-name-${phase.position}`}
                type="text"
                disabled={disabled}
                value={phase.name || ""}
                onChange={(e) =>
                  onUpdate({
                    ...phase,
                    name: e.target.value || null,
                  })
                }
                placeholder={`Phase ${phase.position}`}
              />
            </div>

            {/* Format select */}
            <div className="field">
              <label htmlFor={`phase-format-${phase.position}`}>Format</label>
              <select
                id={`phase-format-${phase.position}`}
                disabled={disabled}
                value={phase.format}
                onChange={(e) =>
                  onUpdate({
                    ...phase,
                    format: e.target.value as PhaseFormat,
                  })
                }
              >
                <option value="SINGLE">Élimination simple</option>
                <option value="DOUBLE">Double élimination</option>
                <option value="SWISS">Ronde suisse</option>
                <option value="SURVIVAL">Survie</option>
              </select>
            </div>

            {/* Qualifier mode and value (hidden on last phase) */}
            {!isLast && (
              <>
                <div className="field">
                  <label htmlFor={`phase-mode-${phase.position}`}>
                    Mode de qualification
                  </label>
                  <select
                    id={`phase-mode-${phase.position}`}
                    disabled={disabled}
                    value={phase.qualifierMode}
                    onChange={(e) =>
                      onUpdate({
                        ...phase,
                        qualifierMode: e.target.value as "COUNT" | "PERCENT",
                      })
                    }
                  >
                    <option value="COUNT">Nombre d'équipes</option>
                    <option value="PERCENT">Pourcentage</option>
                  </select>
                </div>

                <div className="field">
                  <label htmlFor={`phase-qualifier-${phase.position}`}>
                    {phase.qualifierMode === "COUNT"
                      ? "Nombre d'équipes qualifiées"
                      : "Pourcentage qualifié"}
                  </label>
                  <input
                    id={`phase-qualifier-${phase.position}`}
                    type="number"
                    min={phase.qualifierMode === "COUNT" ? 1 : 1}
                    max={phase.qualifierMode === "COUNT" ? maxTeams : 99}
                    disabled={disabled}
                    value={phase.qualifierValue}
                    onChange={(e) =>
                      onUpdate({
                        ...phase,
                        qualifierValue: Number(e.target.value),
                      })
                    }
                  />
                </div>
              </>
            )}

            {/* Swiss rounds */}
            {phase.format === "SWISS" && (
              <div className="field">
                <label htmlFor={`phase-swiss-${phase.position}`}>
                  Nombre de manches
                </label>
                <input
                  id={`phase-swiss-${phase.position}`}
                  type="number"
                  min={1}
                  max={20}
                  disabled={disabled}
                  value={phase.swissTotalRounds || ""}
                  onChange={(e) =>
                    onUpdate({
                      ...phase,
                      swissTotalRounds: e.target.value ? Number(e.target.value) : null,
                    })
                  }
                  placeholder="Automatique"
                />
                <p style={HINT}>Laissez vide pour automatique.</p>
              </div>
            )}

            {/* Survival cadence */}
            {phase.format === "SURVIVAL" && (
              <>
                <div className="field">
                  <label htmlFor={`phase-survival-before-${phase.position}`}>
                    Rounds avant la première coupe
                  </label>
                  <input
                    id={`phase-survival-before-${phase.position}`}
                    type="number"
                    min={1}
                    max={50}
                    disabled={disabled}
                    value={phase.survivalRoundsBeforeFirstCut || 3}
                    onChange={(e) =>
                      onUpdate({
                        ...phase,
                        survivalRoundsBeforeFirstCut: Number(e.target.value),
                      })
                    }
                  />
                  <p style={HINT}>
                    Laisse le classement se former avant la première élimination.
                  </p>
                </div>

                <div className="field">
                  <label htmlFor={`phase-survival-per-${phase.position}`}>
                    Rounds entre les coupes suivantes
                  </label>
                  <input
                    id={`phase-survival-per-${phase.position}`}
                    type="number"
                    min={1}
                    max={50}
                    disabled={disabled}
                    value={phase.survivalRoundsPerCut || 3}
                    onChange={(e) =>
                      onUpdate({
                        ...phase,
                        survivalRoundsPerCut: Number(e.target.value),
                      })
                    }
                  />
                  <p style={HINT}>Cadence appliquée après la première coupe.</p>
                </div>
              </>
            )}

            {/* Third place (single elimination, not last phase) */}
            {phase.format === "SINGLE" && !isLast && (
              <div className="field" style={FULL_WIDTH}>
                <label
                  htmlFor={`phase-third-${phase.position}`}
                  style={{ marginBottom: 6 }}
                >
                  Options supplémentaires
                </label>
                <div
                  className="checkbox-card"
                  onClick={
                    disabled
                      ? undefined
                      : () =>
                          onUpdate({
                            ...phase,
                            hasThirdPlaceMatch: !phase.hasThirdPlaceMatch,
                          })
                  }
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    gap: 12,
                    padding: "14px 16px",
                    border: `1.5px solid ${
                      phase.hasThirdPlaceMatch
                        ? "var(--blue-500)"
                        : "var(--line-strong-cy)"
                    }`,
                    borderRadius: 10,
                    cursor: disabled ? "not-allowed" : "pointer",
                    transition: "border-color 0.2s ease, background-color 0.2s ease",
                    backgroundColor: phase.hasThirdPlaceMatch
                      ? "rgba(90, 200, 255, 0.07)"
                      : "transparent",
                  }}
                >
                  <input
                    id={`phase-third-${phase.position}`}
                    type="checkbox"
                    disabled={disabled}
                    checked={phase.hasThirdPlaceMatch}
                    onChange={(e) =>
                      onUpdate({
                        ...phase,
                        hasThirdPlaceMatch: e.target.checked,
                      })
                    }
                    style={{
                      width: 18,
                      height: 18,
                      accentColor: "var(--blue-500)",
                      cursor: "pointer",
                      flexShrink: 0,
                      marginTop: 2,
                    }}
                  />
                  <div style={{ flex: 1 }}>
                    <label
                      htmlFor={`phase-third-${phase.position}`}
                      style={{
                        display: "block",
                        margin: "0 0 4px",
                        cursor: "pointer",
                        userSelect: "none",
                        fontSize: 14,
                        fontWeight: 500,
                        color: "var(--ink)",
                      }}
                    >
                      Petite finale
                    </label>
                    <p style={{ ...HINT, margin: 0 }}>
                      Ajoute un match pour déterminer la 3ᵉ place entre les deux
                      perdants des demi-finales.
                    </p>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
