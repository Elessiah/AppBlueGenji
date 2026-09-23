import { describe, expect, it } from "@jest/globals";
import {
  PLAYER_ROSTER_STATUS_LABEL,
  isFreeAgent,
  playerRosterStatus,
} from "@/lib/shared/player-roster-status";

const team = { id: 7 };

describe("playerRosterStatus", () => {
  it("range un joueur dans un roster, quelle que soit son ouverture au recrutement", () => {
    expect(playerRosterStatus({ team, openToRecruitment: true })).toBe("ROSTER");
    expect(playerRosterStatus({ team, openToRecruitment: false })).toBe("ROSTER");
  });

  it("annonce « free agent » sans roster et ouvert au recrutement", () => {
    expect(playerRosterStatus({ team: null, openToRecruitment: true })).toBe("FREE_AGENT");
  });

  it("annonce « sans équipe » sans roster et fermé au recrutement", () => {
    expect(playerRosterStatus({ team: null, openToRecruitment: false })).toBe("UNAFFILIATED");
  });

  it("tient un champ absent pour ouvert — c'est le défaut de la colonne", () => {
    expect(playerRosterStatus({})).toBe("FREE_AGENT");
    expect(playerRosterStatus({ team: undefined })).toBe("FREE_AGENT");
  });
});

describe("isFreeAgent", () => {
  it("n'est vrai que sur le statut « free agent »", () => {
    expect(isFreeAgent({ team: null, openToRecruitment: true })).toBe(true);
    expect(isFreeAgent({ team: null, openToRecruitment: false })).toBe(false);
    expect(isFreeAgent({ team, openToRecruitment: true })).toBe(false);
  });

  it("se passe directement à un `filter` — c'est son usage sur l'annuaire", () => {
    const players = [
      { team, openToRecruitment: true },
      { team: null, openToRecruitment: true },
      { team: null, openToRecruitment: false },
      { team: null },
    ];
    expect(players.filter(isFreeAgent)).toHaveLength(2);
  });
});

describe("PLAYER_ROSTER_STATUS_LABEL", () => {
  it("donne un libellé à chacun des trois statuts", () => {
    expect(PLAYER_ROSTER_STATUS_LABEL.ROSTER).toBe("ROSTER");
    expect(PLAYER_ROSTER_STATUS_LABEL.FREE_AGENT).toBe("FREE AGENT");
    expect(PLAYER_ROSTER_STATUS_LABEL.UNAFFILIATED).toBe("SANS ÉQUIPE");
  });

  it("ne rend jamais « FREE AGENT » à un joueur fermé au recrutement", () => {
    const label = PLAYER_ROSTER_STATUS_LABEL[
      playerRosterStatus({ team: null, openToRecruitment: false })
    ];
    expect(label).not.toContain("FREE");
  });
});
