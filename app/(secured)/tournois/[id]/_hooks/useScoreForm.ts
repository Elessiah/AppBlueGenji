import { useState } from "react";
import type { BracketMatch } from "@/lib/shared/types";
import { mapError } from "../_lib/error-map";
import {
  decideScoreForm,
  isUntouched,
  scoreBlockerMessage,
  scoreFormStateFor,
  storedResultSignature,
  type ScoreFormState,
} from "../_lib/score-form";
import { useToast } from "@/components/ui/toast";
import { useMatchFormat } from "../_lib/match-format-context";

export function useScoreForm(match: BracketMatch | null) {
  const { showError, showSuccess } = useToast();
  const matchFormat = useMatchFormat();
  const [state, setState] = useState<ScoreFormState>(() => scoreFormStateFor(match));
  const [submitting, setSubmitting] = useState(false);

  // Le dialogue reste monté entre deux ouvertures : sans resynchronisation, il
  // rouvrirait sur le score du match précédemment édité. On se réaligne sur
  // l'**empreinte du résultat enregistré**, pas seulement sur l'identifiant du
  // match — le match reçu vient de la liste rafraîchie par le flux SSE, et il
  // peut donc changer sans que le dialogue soit refermé (un autre membre du
  // staff saisit le score pendant que celui-ci l'a sous les yeux).
  //
  // Ce qui arrive alors dépend de ce que le lecteur a fait :
  // · rien saisi → on adopte silencieusement la nouvelle valeur ;
  // · une saisie en cours → on la garde, et on signale le désaccord plutôt que
  //   de l'effacer ou de la laisser écraser le travail de l'autre.
  const [synced, setSynced] = useState(() => ({
    signature: storedResultSignature(match),
    // Valeurs adoptées au dernier alignement : c'est à elles que se compare la
    // saisie courante pour savoir si le lecteur a tapé quelque chose. Comparer
    // au match qui *arrive* ne le dirait pas — il a précisément changé.
    baseline: scoreFormStateFor(match),
  }));
  const [conflict, setConflict] = useState(false);

  const signature = storedResultSignature(match);
  if (signature !== synced.signature) {
    const untouched = sameFormState(state, synced.baseline);
    const next = scoreFormStateFor(match);
    setSynced({ signature, baseline: next });

    if (untouched) {
      setState(next);
      setConflict(false);
    } else {
      setConflict(true);
    }
  }

  /** Reprendre la valeur enregistrée, en abandonnant la saisie en cours. */
  const adoptStoredResult = () => {
    const next = scoreFormStateFor(match);
    setSynced({ signature, baseline: next });
    setState(next);
    setConflict(false);
  };

  const decision = decideScoreForm(state, {
    format: matchFormat,
    decided: match?.winnerTeamId != null,
  });

  const submit = async (action: "save" | "resolve") => {
    if (!match) return false;

    const blocker = action === "save" ? decision.saveBlocker : decision.resolveBlocker;
    if (blocker) {
      showError(scoreBlockerMessage(blocker, matchFormat));
      return false;
    }

    setSubmitting(true);
    try {
      const endpoint =
        action === "save"
          ? `/api/admin/matches/${match.id}/scores`
          : `/api/admin/matches/${match.id}/resolve`;
      const method = action === "save" ? "PATCH" : "POST";

      const body: { team1Score?: number; team2Score?: number; forfeitTeamId?: number } = {};
      if (state.forfeitTeamId !== undefined) {
        body.forfeitTeamId = state.forfeitTeamId;
      } else if (decision.scores) {
        body.team1Score = decision.scores.team1;
        body.team2Score = decision.scores.team2;
      } else {
        // `decideScoreForm` a déjà écarté ce cas : sans scores ni forfait, les
        // deux actions sont bloquées. Garde-fou de dernier recours.
        showError(scoreBlockerMessage("INCOMPLETE", matchFormat));
        return false;
      }

      const response = await fetch(endpoint, {
        method,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });

      const payload = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(payload.error || "API_ERROR");

      showSuccess(
        action === "save"
          ? "Score enregistré : le match reste en cours."
          : "Résultat validé : le plateau est à jour.",
      );
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
    decision,
    /** Le résultat enregistré a changé pendant qu'une saisie était en cours. */
    conflict,
    adoptStoredResult,
    /** Une saisie est en cours, non enregistrée. */
    dirty: !isUntouched(state, match),
    setScore1: (val: string) => setState((s) => ({ ...s, score1: val })),
    setScore2: (val: string) => setState((s) => ({ ...s, score2: val })),
    setForfeitTeamId: (id?: number) => setState((s) => ({ ...s, forfeitTeamId: id })),
    submit,
  };
}

function sameFormState(a: ScoreFormState, b: ScoreFormState): boolean {
  return (
    a.score1 === b.score1 && a.score2 === b.score2 && a.forfeitTeamId === b.forfeitTeamId
  );
}
