"use client";

import { CSSProperties, useEffect, useRef, useState } from "react";
import type { PhaseConfig } from "@/lib/shared/tournament-phases";
import {
  MAX_PHASES,
  resolvePhasePlan,
  describePhasePlan,
  findPhaseIssue,
} from "@/lib/shared/tournament-phases";
import { CyberButton } from "@/components/cyber";
import { focusFlaggedField } from "@/lib/shared/field-errors";
import { PhaseCard } from "./PhaseCard";
import {
  movePhase,
  removePhase,
  addPhase,
  phaseFieldId,
  phaseIssueMessage,
} from "./phase-form";

const HINT: CSSProperties = {
  margin: "2px 0 0",
  fontSize: 12.5,
  color: "var(--ink-mute)",
  lineHeight: 1.5,
};

interface PhaseBuilderProps {
  phases: PhaseConfig[];
  maxTeams: number;
  /** Plan verrouillé : consultable, mais plus modifiable (édition restreinte). */
  disabled?: boolean;
  /**
   * Demande de focus sur le réglage fautif, incrémentée par le formulaire quand
   * il refuse l'envoi d'un plan invalide : la phase en cause est dépliée (son
   * champ n'existe pas repliée), puis le champ reçoit le focus — la consigne et
   * l'endroit arrivent ensemble, comme pour les autres champs du formulaire.
   */
  focusRequest?: number;
  onChange: (phases: PhaseConfig[]) => void;
}

export function PhaseBuilder({
  phases,
  maxTeams,
  disabled = false,
  focusRequest = 0,
  onChange,
}: PhaseBuilderProps) {
  const [expandedIndex, setExpandedIndex] = useState<number | null>(0);
  const [pendingFocusId, setPendingFocusId] = useState<string | null>(null);

  const handleToggleExpand = (index: number) => {
    setExpandedIndex(expandedIndex === index ? null : index);
  };

  const handleMoveUp = (index: number) => {
    onChange(movePhase(phases, index, -1));
  };

  const handleMoveDown = (index: number) => {
    onChange(movePhase(phases, index, 1));
  };

  const handleRemove = (index: number) => {
    onChange(removePhase(phases, index));
  };

  const handleUpdate = (index: number, phase: PhaseConfig) => {
    const updated = [...phases];
    updated[index] = phase;
    onChange(updated);
  };

  const handleAddPhase = () => {
    onChange(addPhase(phases, "SINGLE"));
  };

  const plan = resolvePhasePlan(maxTeams, phases);
  const descriptions = describePhasePlan(plan);
  const issue = findPhaseIssue(phases);
  const issueMessage = issue ? phaseIssueMessage(issue) : null;

  // Lu par une référence : l'effet ne doit répondre qu'à une **nouvelle**
  // demande, pas à chaque frappe qui change le défaut du plan.
  const issueRef = useRef(issue);
  issueRef.current = issue;
  // Dernière demande déjà servie, relevée au montage : le constructeur se
  // démonte quand on quitte le format multi-phases, et une demande ancienne ne
  // doit pas être rejouée à son retour — le focus quitterait le sélecteur de
  // format sans qu'aucun envoi ne l'ait demandé.
  const handledRequest = useRef(focusRequest);

  useEffect(() => {
    if (focusRequest === handledRequest.current) return;
    handledRequest.current = focusRequest;
    const current = issueRef.current;
    if (!current || current.phaseIndex === null || current.field === null) return;
    setExpandedIndex(current.phaseIndex);
    setPendingFocusId(phaseFieldId(current.phaseIndex + 1, current.field));
  }, [focusRequest]);

  // Second temps : le champ n'existe qu'une fois la phase dépliée et rendue.
  useEffect(() => {
    if (!pendingFocusId) return;
    // Même geste que `useFieldErrors` : un focus marqué, qu'un contrôle réagissant
    // au focus ne prend pas pour un geste du joueur.
    focusFlaggedField(document.getElementById(pendingFocusId));
    setPendingFocusId(null);
  }, [pendingFocusId]);

  return (
    <div>
      {/* Phase list */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 10,
          marginBottom: 24,
        }}
      >
        {phases.map((phase, index) => (
          <PhaseCard
            key={`${phase.position}-${phase.format}`}
            phase={phase}
            isLast={index === phases.length - 1}
            isExpanded={expandedIndex === index}
            totalPhases={phases.length}
            maxTeams={maxTeams}
            disabled={disabled}
            issue={
              issue && issueMessage && issue.phaseIndex === index && issue.field
                ? { field: issue.field, message: issueMessage }
                : null
            }
            onToggleExpand={() => handleToggleExpand(index)}
            onMoveUp={() => handleMoveUp(index)}
            onMoveDown={() => handleMoveDown(index)}
            onRemove={() => handleRemove(index)}
            onUpdate={(updated) => handleUpdate(index, updated)}
          />
        ))}
      </div>

      {/* Add phase button */}
      <div style={{ marginBottom: 24 }}>
        <CyberButton
          variant="ghost"
          onClick={handleAddPhase}
          disabled={disabled || phases.length >= MAX_PHASES}
          title={
            phases.length >= MAX_PHASES ? "Maximum de phases atteint" : undefined
          }
          style={{
            opacity: disabled || phases.length >= MAX_PHASES ? 0.5 : 1,
            cursor: disabled || phases.length >= MAX_PHASES ? "not-allowed" : "pointer",
          }}
        >
          + Ajouter une phase
        </CyberButton>
        {phases.length >= MAX_PHASES && (
          <p style={HINT}>Maximum de {MAX_PHASES} phases atteint.</p>
        )}
      </div>

      {/* Live preview */}
      <div
        style={{
          padding: "16px",
          backgroundColor: "rgba(90, 200, 255, 0.03)",
          border: "1px solid var(--line-soft)",
          borderRadius: 10,
          marginBottom: 24,
        }}
      >
        <p
          style={{
            margin: "0 0 12px",
            fontSize: 13,
            fontWeight: 500,
            color: "var(--ink)",
          }}
        >
          Aperçu du plan
        </p>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {descriptions.map((desc, idx) => {
            const isSkipped = plan[idx]?.skipped;
            return (
              <div
                key={idx}
                style={{
                  fontSize: 13,
                  color: isSkipped ? "var(--ink-mute)" : "var(--ink)",
                  opacity: isSkipped ? 0.6 : 1,
                  lineHeight: 1.4,
                }}
              >
                {desc}
              </div>
            );
          })}
        </div>

        {/* Mode explanation */}
        <p
          style={{
            ...HINT,
            marginTop: 12,
            marginBottom: 0,
          }}
        >
          Un nombre fixe fait sauter la phase si moins d'équipes se présentent ;
          un pourcentage s'adapte au nombre réel d'inscrites.
        </p>
      </div>

      {/* Validation error */}
      {issueMessage && (
        <div
          style={{
            padding: "12px 16px",
            backgroundColor: "rgba(255, 110, 130, 0.07)",
            border: "1px solid rgba(255, 110, 130, 0.3)",
            borderRadius: 10,
            marginBottom: 24,
          }}
        >
          <p
            style={{
              margin: 0,
              fontSize: 13,
              color: "var(--red-live)",
              lineHeight: 1.4,
            }}
          >
            {issueMessage}
          </p>
        </div>
      )}
    </div>
  );
}
