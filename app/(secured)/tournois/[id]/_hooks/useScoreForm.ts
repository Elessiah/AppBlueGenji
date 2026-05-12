import { useState } from "react";
import type { BracketMatch } from "@/lib/shared/types";
import { mapError } from "../_lib/error-map";
import { useToast } from "@/components/ui/toast";

interface ScoreFormState {
  score1: string;
  score2: string;
  forfeitTeamId?: number;
}

export function useScoreForm(match: BracketMatch | null) {
  const { showError, showSuccess } = useToast();
  const [state, setState] = useState<ScoreFormState>({
    score1: match ? String(match.team1Score ?? 0) : "0",
    score2: match ? String(match.team2Score ?? 0) : "0",
    forfeitTeamId: match?.forfeitTeamId ?? undefined,
  });
  const [submitting, setSubmitting] = useState(false);

  const reset = () => {
    if (match) {
      setState({
        score1: String(match.team1Score ?? 0),
        score2: String(match.team2Score ?? 0),
        forfeitTeamId: match.forfeitTeamId ?? undefined,
      });
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
