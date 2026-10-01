import { describe, expect, it } from "@jest/globals";

import { adminProposalNotice, forfeitParties } from "@/app/(secured)/tournois/[id]/_lib/score-form";

describe("adminProposalNotice", () => {
  const proposal = { team1Score: 3, team2Score: 1, proposedBy: "team1" as const };

  it("rien sans proposition", () => {
    expect(adminProposalNotice(null, "A", "B", false)).toBeNull();
  });

  it("nomme l'auteur, l'attendu et le geste à faire", () => {
    expect(adminProposalNotice(proposal, "A", "B", false)).toBe(
      "Score proposé par A (3 – 1), en attente de confirmation de B. Vérifie-le puis valide le résultat pour le confirmer.",
    );
  });

  it("proposition de l'équipe 2, saisie en cours", () => {
    expect(adminProposalNotice({ ...proposal, proposedBy: "team2" }, "A", "B", true)).toBe(
      "Score proposé par B (3 – 1), en attente de confirmation de A. Ta saisie le remplace.",
    );
  });
});

describe("forfeitParties", () => {
  it("rien sans forfait nominatif", () => {
    expect(forfeitParties(undefined, 1, "A", "B")).toBeNull();
  });

  it("forfait de l'une ou de l'autre engagée", () => {
    expect(forfeitParties(1, 1, "A", "B")).toEqual({ out: "A", through: "B" });
    expect(forfeitParties(2, 1, "A", "B")).toEqual({ out: "B", through: "A" });
  });
});
