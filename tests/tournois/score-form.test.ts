import { describe, expect, it } from "@jest/globals";
import {
  decideScoreForm,
  isUntouched,
  parseScoreInput,
  scoreBlockerMessage,
  scoreFormStateFor,
  storedResultSignature,
  type ScoreFormState,
} from "@/app/(secured)/tournois/[id]/_lib/score-form";
import type { BracketMatch } from "@/lib/shared/types";
import type { MatchFormat } from "@/lib/shared/match-format";

const BO5: MatchFormat = { type: "BO", value: 5 };

function match(overrides: Partial<BracketMatch> = {}): BracketMatch {
  return {
    id: 7,
    roundNumber: 1,
    status: "READY",
    team1Id: 10,
    team2Id: 20,
    team1Score: null,
    team2Score: null,
    winnerTeamId: null,
    forfeitTeamId: null,
    ...overrides,
  } as unknown as BracketMatch;
}

function form(overrides: Partial<ScoreFormState> = {}): ScoreFormState {
  return { score1: "", score2: "", forfeitTeamId: undefined, ...overrides };
}

describe("scoreFormStateFor — valeurs d'ouverture du dialogue", () => {
  it("ouvre sur des champs vides quand aucun score n'a jamais été saisi", () => {
    // Le 0-0 d'autrefois était un score inventé : `hasScoreInput` le comptait
    // comme une saisie, et l'enregistrer verrouillait la manche précédente.
    expect(scoreFormStateFor(match())).toEqual({
      score1: "",
      score2: "",
      forfeitTeamId: undefined,
    });
  });

  it("ouvre sur le score du match, y compris un vrai zéro", () => {
    expect(scoreFormStateFor(match({ team1Score: 2, team2Score: 0 }))).toEqual({
      score1: "2",
      score2: "0",
      forfeitTeamId: undefined,
    });
  });

  it("reporte le forfait déjà déclaré", () => {
    expect(scoreFormStateFor(match({ forfeitTeamId: 20 })).forfeitTeamId).toBe(20);
  });

  it("revient à vide sans match (dialogue fermé)", () => {
    expect(scoreFormStateFor(null)).toEqual({
      score1: "",
      score2: "",
      forfeitTeamId: undefined,
    });
  });
});

describe("parseScoreInput", () => {
  it("lit un entier positif", () => {
    expect(parseScoreInput("3")).toBe(3);
    expect(parseScoreInput(" 0 ")).toBe(0);
  });

  it("refuse ce qui n'est pas un score", () => {
    // `input[type=number]` laisse passer bien plus que des chiffres.
    for (const raw of ["", "   ", "e", "3e2", "+3", "-1", "2.5", "1 2", "٣"]) {
      expect(parseScoreInput(raw)).toBeNull();
    }
  });
});

describe("storedResultSignature / isUntouched", () => {
  it("change dès que le résultat enregistré bouge", () => {
    const before = storedResultSignature(match());
    expect(storedResultSignature(match({ team1Score: 2, team2Score: 1 }))).not.toBe(before);
    expect(storedResultSignature(match({ forfeitTeamId: 10 }))).not.toBe(before);
    expect(storedResultSignature(match({ winnerTeamId: 10 }))).not.toBe(before);
    expect(storedResultSignature(match({ status: "AWAITING_CONFIRMATION" }))).not.toBe(before);
  });

  it("distingue deux matchs de même score", () => {
    expect(storedResultSignature(match({ id: 1, team1Score: 2, team2Score: 1 }))).not.toBe(
      storedResultSignature(match({ id: 2, team1Score: 2, team2Score: 1 })),
    );
  });

  it("est vide sans match", () => {
    expect(storedResultSignature(null)).toBe("");
  });

  it("reconnaît un formulaire resté sur les valeurs du match", () => {
    const m = match({ team1Score: 2, team2Score: 1 });
    expect(isUntouched(form({ score1: "2", score2: "1" }), m)).toBe(true);
    expect(isUntouched(form({ score1: "3", score2: "1" }), m)).toBe(false);
    expect(isUntouched(form({ score1: "2", score2: "1", forfeitTeamId: 10 }), m)).toBe(false);
  });
});

describe("decideScoreForm — saisie incomplète", () => {
  it("bloque les deux actions tant qu'un champ est vide", () => {
    const decision = decideScoreForm(form({ score1: "2" }), { format: BO5, decided: false });

    expect(decision.scores).toBeNull();
    expect(decision.canSave).toBe(false);
    expect(decision.canResolve).toBe(false);
    expect(decision.saveBlocker).toBe("INCOMPLETE");
    expect(decision.resolveBlocker).toBe("INCOMPLETE");
  });

  it("bloque aussi une saisie illisible", () => {
    const decision = decideScoreForm(form({ score1: "e", score2: "1" }), {
      format: null,
      decided: false,
    });
    expect(decision.saveBlocker).toBe("INCOMPLETE");
  });
});

describe("decideScoreForm — format de match", () => {
  it("laisse enregistrer un score en cours de rencontre, sans le trancher", () => {
    // 1-0 en BO5 : légitime à noter, pas à déclarer vainqueur.
    const decision = decideScoreForm(form({ score1: "1", score2: "0" }), {
      format: BO5,
      decided: false,
    });

    expect(decision.canSave).toBe(true);
    expect(decision.canResolve).toBe(false);
    expect(decision.resolveBlocker).toBe("BELOW_FORMAT");
  });

  it("autorise les deux quand le vainqueur atteint l'objectif", () => {
    const decision = decideScoreForm(form({ score1: "3", score2: "2" }), {
      format: BO5,
      decided: false,
    });

    expect(decision).toMatchObject({
      scores: { team1: 3, team2: 2 },
      canSave: true,
      canResolve: true,
      saveBlocker: null,
      resolveBlocker: null,
    });
  });

  it("refuse tout au-dessus du plafond du format", () => {
    for (const state of [form({ score1: "4", score2: "0" }), form({ score1: "3", score2: "3" })]) {
      const decision = decideScoreForm(state, { format: BO5, decided: false });
      expect(decision.canSave).toBe(false);
      expect(decision.canResolve).toBe(false);
      expect(decision.saveBlocker).toBe("EXCEEDS_FORMAT");
    }
  });

  it("sans format, seule l'égalité empêche de trancher", () => {
    expect(
      decideScoreForm(form({ score1: "12", score2: "9" }), { format: null, decided: false }),
    ).toMatchObject({ canSave: true, canResolve: true });

    expect(
      decideScoreForm(form({ score1: "2", score2: "2" }), { format: null, decided: false }),
    ).toMatchObject({ canResolve: false, resolveBlocker: "DRAW" });
  });
});

describe("decideScoreForm — match déjà tranché", () => {
  it("interdit l'enregistrement mais laisse re-trancher", () => {
    // La route d'enregistrement n'écrit pas le vainqueur : sur un match acquis,
    // elle laisserait le score et la qualifiée se contredire.
    const decision = decideScoreForm(form({ score1: "3", score2: "1" }), {
      format: BO5,
      decided: true,
    });

    expect(decision.canSave).toBe(false);
    expect(decision.saveBlocker).toBe("ALREADY_DECIDED");
    expect(decision.canResolve).toBe(true);
  });

  it("s'applique aussi au forfait", () => {
    const decision = decideScoreForm(form({ forfeitTeamId: 10 }), {
      format: BO5,
      decided: true,
    });

    expect(decision.canSave).toBe(false);
    expect(decision.canResolve).toBe(true);
  });
});

describe("decideScoreForm — forfait", () => {
  it("remplace le score et ignore le format", () => {
    const decision = decideScoreForm(form({ score1: "9", score2: "9", forfeitTeamId: 20 }), {
      format: BO5,
      decided: false,
    });

    expect(decision.scores).toBeNull();
    expect(decision.canSave).toBe(true);
    expect(decision.canResolve).toBe(true);
  });
});

describe("scoreBlockerMessage", () => {
  it("chiffre les violations avec le format du tournoi", () => {
    expect(scoreBlockerMessage("BELOW_FORMAT", BO5)).toContain("3 manches");
    expect(scoreBlockerMessage("EXCEEDS_FORMAT", BO5)).toContain("BO5");
  });

  it("nomme les autres refus en clair", () => {
    expect(scoreBlockerMessage("INCOMPLETE", null)).toBe("Renseigne les deux scores.");
    expect(scoreBlockerMessage("DRAW", null)).toContain("vainqueur");
    expect(scoreBlockerMessage("ALREADY_DECIDED", null)).toContain("Valider le résultat");
  });
});
