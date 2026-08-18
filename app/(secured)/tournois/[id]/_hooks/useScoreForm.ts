import { useState } from "react";
import type { BracketMatch } from "@/lib/shared/types";
import { mapError } from "../_lib/error-map";
import { scoreFormStateFor, type ScoreFormState } from "../_lib/score-form";
import { useToast } from "@/components/ui/toast";
import { checkMatchScores, matchScoreViolationMessage } from "@/lib/shared/match-format";
import { useMatchFormat } from "../_lib/match-format-context";

export function useScoreForm(match: BracketMatch | null) {
  const { showError, showSuccess } = useToast();
  const matchFormat = useMatchFormat();
  const [state, setState] = useState<ScoreFormState>(() => scoreFormStateFor(match));
  const [submitting, setSubmitting] = useState(false);

  // Le dialogue reste monté entre deux ouvertures : sans resynchronisation, il
  // rouvrirait sur le score du match précédemment édité. On réaligne dès que le
  // match change (y compris au passage par `null`, à la fermeture), pour repartir
  // du score réel du match — 0-0 s'il n'a jamais été saisi.
  const [syncedMatchId, setSyncedMatchId] = useState<number | null>(match?.id ?? null);
  if ((match?.id ?? null) !== syncedMatchId) {
    setSyncedMatchId(match?.id ?? null);
    setState(scoreFormStateFor(match));
  }

  const reset = () => {
    if (match) {
      setState(scoreFormStateFor(match));
    }
  };

  const submit = async (action: "save" | "resolve") => {
    if (!match) return;
    setSubmitting(true);
    try {
      const endpoint = action === "save" ? `/api/admin/matches/${match.id}/scores` : `/api/admin/matches/${match.id}/resolve`;
      const method = action === "save" ? "PATCH" : "POST";

      const body: { team1Score?: number; team2Score?: number; forfeitTeamId?: number } = {};
      if (state.forfeitTeamId) {
        body.forfeitTeamId = state.forfeitTeamId;
      } else {
        const s1 = Number(state.score1);
        const s2 = Number(state.score2);
        if (!Number.isFinite(s1) || !Number.isFinite(s2)) throw new Error("INVALID_SCORES");
        if (action === "resolve" && s1 === s2) throw new Error("DRAW_NOT_ALLOWED");
        // Même règle que le serveur : une sauvegarde ne contrôle que le
        // plafond, désigner un vainqueur exige d'atteindre l'objectif.
        const violation = checkMatchScores(matchFormat, s1, s2, {
          decisive: action === "resolve",
        });
        if (violation) {
          showError(matchScoreViolationMessage(matchFormat, violation));
          return false;
        }
        body.team1Score = s1;
        body.team2Score = s2;
      }

      const response = await fetch(endpoint, {
        method,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });

      const payload = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(payload.error || "API_ERROR");

      showSuccess(`Match #${match.id} ${action === "save" ? "sauvegardé" : "résolu"}.`);
      return true;
    } catch (e) {
      showError(mapError((e as Error).message));
      return false;
    } finally {
      setSubmitting(false);
    }
  };

  return {
    score1: state.score1,
    score2: state.score2,
    forfeitTeamId: state.forfeitTeamId,
    submitting,
    setScore1: (val: string) => setState((s) => ({ ...s, score1: val })),
    setScore2: (val: string) => setState((s) => ({ ...s, score2: val })),
    setForfeitTeamId: (id?: number) => setState((s) => ({ ...s, forfeitTeamId: id })),
    submit,
    reset,
  };
}
