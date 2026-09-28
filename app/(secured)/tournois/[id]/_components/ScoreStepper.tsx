"use client";

import { parseScoreInput } from "../_lib/score-form";
import { EntrantLogo } from "./EntrantName";
import styles from "./ScoreDialog.module.css";

interface ScoreStepperProps {
  id: string;
  /** Engagé du côté saisi — sert à son emblème ; `null` sur une case vide. */
  teamId: number | null;
  teamName: string;
  value: string;
  max: number;
  disabled: boolean;
  onChange: (value: string) => void;
}

/**
 * Un côté du score, partagé par la modale d'arbitrage et celle des engagés
 * (`PlayerScoreDialog`). Les deux équipes partageaient jusqu'ici deux blocs de
 * balises identiques recopiés l'un sous l'autre — une correction sur l'un se
 * perdait sur l'autre.
 */
export function ScoreStepper({ id, teamId, teamName, value, max, disabled, onChange }: ScoreStepperProps) {
  const parsed = parseScoreInput(value);
  // Un champ vide n'est pas une erreur : c'est un score pas encore saisi. Seule
  // une valeur illisible ou hors plage se signale en rouge.
  const invalid = value.trim() !== "" && (parsed === null || parsed > max);
  const step = (delta: number) => onChange(String(Math.min(max, Math.max(0, (parsed ?? 0) + delta))));

  return (
    <div>
      <label className={styles.sideLabel} htmlFor={id}>
        {/* L'emblème est décoratif : le nom accessible du champ reste le nom
            de l'équipe, écrit juste à côté. Pas de case réservée sur un côté
            vide : seule, elle ne ferait qu'un retrait blanc devant le libellé. */}
        {teamId !== null && <EntrantLogo teamId={teamId} name={teamName} size={20} />}
        <span className={styles.sideLabelText}>{teamName}</span>
      </label>
      <div className={styles.stepper}>
        <button
          type="button"
          className={styles.step}
          onClick={() => step(-1)}
          // Désactivé sur un vrai zéro, pas sur un champ vide : depuis le vide,
          // « − » est le seul moyen d'atteindre 0 aux boutons — un 3-0 se saisit
          // autrement au clavier, ce qui n'existe pas sur mobile.
          disabled={disabled || parsed === 0}
          aria-label={`Retirer une manche à ${teamName}`}
        >
          −
        </button>
        <input
          id={id}
          className={styles.field}
          type="number"
          inputMode="numeric"
          min={0}
          max={max}
          step={1}
          value={value}
          placeholder="—"
          aria-invalid={invalid}
          aria-label={`Manches gagnées par ${teamName}`}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
        />
        <button
          type="button"
          className={styles.step}
          onClick={() => step(1)}
          disabled={disabled || (parsed ?? 0) >= max}
          aria-label={`Ajouter une manche à ${teamName}`}
        >
          +
        </button>
      </div>
    </div>
  );
}
