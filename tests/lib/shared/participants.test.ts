import { describe, expect, it } from "@jest/globals";
import {
  PARTICIPANT_WORDING,
  entrantHref,
  isParticipantType,
  isSoloTournament,
  participantWording,
  soloEntryNameCandidates,
  toParticipantType,
} from "@/lib/shared/participants";

describe("type de participant", () => {
  it.each(["TEAM", "SOLO"])("reconnaît %s", (value) => {
    expect(isParticipantType(value)).toBe(true);
  });

  it.each([undefined, null, "", "solo", "PLAYER", 1, {}])(
    "rejette une valeur invalide (%p)",
    (value) => {
      expect(isParticipantType(value)).toBe(false);
      // Une valeur douteuse ne doit jamais transformer un tournoi par équipes
      // en tournoi individuel.
      expect(toParticipantType(value)).toBe("TEAM");
    },
  );

  it("ne considère individuel que SOLO", () => {
    expect(isSoloTournament("SOLO")).toBe(true);
    expect(isSoloTournament("TEAM")).toBe(false);
    expect(isSoloTournament(null)).toBe(false);
    expect(isSoloTournament(undefined)).toBe(false);
  });
});

describe("vocabulaire", () => {
  it("retombe sur le vocabulaire d'équipe par défaut", () => {
    expect(participantWording(null)).toBe(PARTICIPANT_WORDING.TEAM);
    expect(participantWording(undefined)).toBe(PARTICIPANT_WORDING.TEAM);
  });

  it("parle de joueurs en individuel", () => {
    const wording = participantWording("SOLO");
    expect(wording.one).toBe("joueur");
    expect(wording.many).toBe("joueurs");
    expect(wording.registerCta).toBe("M'inscrire");
    expect(wording.badge).toBe("Individuel");
  });

  it("ne signale rien de particulier pour un tournoi par équipes", () => {
    expect(participantWording("TEAM").badge).toBeNull();
  });

  it("renseigne tous les libellés dans les deux modes", () => {
    for (const wording of Object.values(PARTICIPANT_WORDING)) {
      for (const [key, value] of Object.entries(wording)) {
        if (key === "badge") continue;
        expect(typeof value).toBe("string");
        expect((value as string).length).toBeGreaterThan(0);
      }
    }
  });
});

describe("soloEntryNameCandidates", () => {
  it("propose d'abord le pseudo tel quel", () => {
    expect(soloEntryNameCandidates("ShadowNinja", 42)[0]).toBe("ShadowNinja");
  });

  it("propose ensuite un repli suffixé, puis un repli sans pseudo", () => {
    expect(soloEntryNameCandidates("ShadowNinja", 42)).toEqual([
      "ShadowNinja",
      "ShadowNinja #42",
      "Joueur #42",
    ]);
  });

  it("écarte un pseudo trop court comme premier candidat", () => {
    // Un nom de deux caractères est illisible dans un bracket.
    expect(soloEntryNameCandidates("Jo", 7)).toEqual(["Jo #7", "Joueur #7"]);
  });

  it("tient dans la colonne `bg_teams.name` (60 caractères)", () => {
    const long = "x".repeat(80);
    for (const candidate of soloEntryNameCandidates(long, 123456)) {
      expect(candidate.length).toBeLessThanOrEqual(60);
    }
  });

  it("trime le pseudo et ne propose jamais deux fois le même nom", () => {
    const candidates = soloEntryNameCandidates("  Nova  ", 3);
    expect(candidates[0]).toBe("Nova");
    expect(new Set(candidates).size).toBe(candidates.length);
  });

  it("reste utilisable pour un pseudo vide", () => {
    expect(soloEntryNameCandidates("   ", 9)).toEqual(["Joueur #9"]);
  });
});

describe("entrantHref", () => {
  it("renvoie vers le profil du joueur pour une entrée solo", () => {
    expect(entrantHref(12, { 12: 500 })).toBe("/joueurs/500");
  });

  it("renvoie vers la fiche d'équipe sinon", () => {
    expect(entrantHref(12, { 34: 500 })).toBe("/equipes/12");
    expect(entrantHref(12, {})).toBe("/equipes/12");
    expect(entrantHref(12, null)).toBe("/equipes/12");
    expect(entrantHref(12, undefined)).toBe("/equipes/12");
  });
});
