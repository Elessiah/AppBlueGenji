import { describe, expect, it } from "@jest/globals";
import {
  firstMapFieldFollows,
  isByeMatch,
  matchPageDecision,
  matchPageIdsFromMemberPath,
  matchPageIdsFromSpectatorPath,
  matchPagePath,
  matchPageSides,
  matchPageStreams,
  selfManagementSteps,
  OW_SELF_MANAGEMENT_SETTINGS,
  SELF_MANAGEMENT_STEPS,
} from "@/lib/shared/match-page";
import { bracketMatch, matchCaster } from "../../helpers/bracket-match";

describe("matchPagePath", () => {
  it("donne la page du match dans l'espace connecté, ou sans compte", () => {
    expect(matchPagePath(12, 345)).toBe("/tournois/12/matchs/345");
    expect(matchPagePath(12, 345, true)).toBe("/suivre/tournois/12/matchs/345");
  });
});

describe("matchPageIdsFromMemberPath / matchPageIdsFromSpectatorPath", () => {
  it("relit les identifiants d'une page de match, barre finale tolérée", () => {
    expect(matchPageIdsFromMemberPath("/tournois/12/matchs/345")).toEqual({ tournamentId: 12, matchId: 345 });
    expect(matchPageIdsFromMemberPath("/tournois/12/matchs/345/")).toEqual({ tournamentId: 12, matchId: 345 });
    expect(matchPageIdsFromSpectatorPath("/suivre/tournois/7/matchs/8")).toEqual({ tournamentId: 7, matchId: 8 });
  });

  it("ignore toute autre page, et l'autre espace", () => {
    for (const path of [null, undefined, "", "/tournois/12", "/tournois/12/", "/tournois/12/matchs", "/tournois/12/matchs/"]) {
      expect(matchPageIdsFromMemberPath(path)).toBeNull();
    }
    expect(matchPageIdsFromMemberPath("/tournois/12/autre/3")).toBeNull();
    expect(matchPageIdsFromMemberPath("/tournois/12/matchs/3/extra")).toBeNull();
    expect(matchPageIdsFromMemberPath("/suivre/tournois/12/matchs/3")).toBeNull();
    expect(matchPageIdsFromSpectatorPath("/tournois/12/matchs/3")).toBeNull();
  });

  it("refuse un identifiant qui n'est pas un entier positif écrit en chiffres", () => {
    for (const bad of ["0", "-1", "1.5", "1e2", "0x1", "abc", "9007199254740993"]) {
      expect(matchPageIdsFromMemberPath(`/tournois/12/matchs/${bad}`)).toBeNull();
      expect(matchPageIdsFromMemberPath(`/tournois/${bad}/matchs/3`)).toBeNull();
    }
  });
});

describe("matchPageSides", () => {
  const base = { team1Id: 1, team2Id: 2, team1Name: "Alpha", team2Name: "Bravo" };

  it("met l'hôte à gauche, et le premier ban à l'autre équipe", () => {
    const [left, right] = matchPageSides(bracketMatch({ ...base, hostTeamId: 2, firstBanTeamId: 1 }));
    expect(left).toMatchObject({ slot: 2, teamId: 2, name: "Bravo", host: true, firstBan: false });
    expect(right).toMatchObject({ slot: 1, teamId: 1, name: "Alpha", host: false, firstBan: true });
  });

  it("garde l'ordre du plateau quand l'équipe 1 héberge", () => {
    const [left, right] = matchPageSides(bracketMatch({ ...base, hostTeamId: 1, firstBanTeamId: 2 }));
    expect([left.slot, right.slot]).toEqual([1, 2]);
    expect(left.host).toBe(true);
    expect(right.firstBan).toBe(true);
  });

  it("sans hôte connu (adversaire manquant), ni hôte ni ban, ordre du plateau", () => {
    const sides = matchPageSides(bracketMatch({ team1Id: 1, team1Name: "Alpha", team2Placeholder: "Vainqueur M2" }));
    expect(sides.map((side) => side.slot)).toEqual([1, 2]);
    expect(sides.every((side) => !side.host && !side.firstBan)).toBe(true);
    expect(sides[1]).toMatchObject({ teamId: null, name: null, placeholder: "Vainqueur M2" });
  });

  it("une case vide n'hérite jamais de l'hôte ni du ban", () => {
    const sides = matchPageSides(bracketMatch({ hostTeamId: null, firstBanTeamId: null }));
    expect(sides.some((side) => side.host || side.firstBan)).toBe(false);
  });
});

describe("matchPageStreams", () => {
  const streams = [
    { id: 1, liveUrl: "https://twitch.tv/a1", staff: false },
    { id: 2, liveUrl: "https://twitch.tv/b1", staff: false },
    { id: 3, liveUrl: null, staff: false },
  ];
  const casters = [
    matchCaster({ userId: 10, pseudo: "A1", streamId: 1 }),
    matchCaster({ userId: 11, pseudo: "A2", streamId: 1 }),
    matchCaster({ userId: 12, pseudo: "B", streamId: 2 }),
    matchCaster({ userId: 13, pseudo: "C", streamId: 3 }),
  ];

  it("liste chaque stream avec ses casters, co-cast compris", () => {
    const rows = matchPageStreams(bracketMatch({ streams, casters, liveUrl: "https://twitch.tv/a1" }), "LIVE");
    expect(rows.map((row) => [row.id, row.url, row.casters.map((caster) => caster.pseudo)])).toEqual([
      [1, "https://twitch.tv/a1", ["A1", "A2"]],
      [2, "https://twitch.tv/b1", ["B"]],
      [3, null, ["C"]],
    ]);
  });

  it("place en tête le premier lien des vues compactes", () => {
    const rows = matchPageStreams(bracketMatch({ streams, casters, liveUrl: "https://twitch.tv/b1" }), "SCHEDULED");
    expect(rows.map((row) => row.id)).toEqual([2, 1, 3]);
  });

  it("tait les liens tant que le match n'est pas annoncé casté, garde les casters", () => {
    const rows = matchPageStreams(bracketMatch({ streams, casters, liveUrl: "https://twitch.tv/b1" }), "OFF");
    expect(rows.map((row) => row.id)).toEqual([1, 2, 3]);
    expect(rows.every((row) => row.url === null)).toBe(true);
  });

  it("écarte un stream sans caster ni lien ; garde celui du staff qui a un lien", () => {
    const rows = matchPageStreams(
      bracketMatch({
        streams: [
          { id: 4, liveUrl: null, staff: true },
          { id: 5, liveUrl: "https://twitch.tv/bluegenji", staff: true },
        ],
        casters: [],
      }),
      "LIVE",
    );
    expect(rows).toEqual([{ id: 5, url: "https://twitch.tv/bluegenji", casters: [] }]);
    expect(matchPageStreams(bracketMatch(), "LIVE")).toEqual([]);
  });

  it("un premier lien qu'aucun stream ne porte vient en tête, sans caster, comme sur la carte", () => {
    const rows = matchPageStreams(bracketMatch({ streams, casters, liveUrl: "https://twitch.tv/zz" }), "LIVE");
    expect(rows.map((row) => row.id)).toEqual([0, 1, 2, 3]);
    expect(rows[0]).toEqual({ id: 0, url: "https://twitch.tv/zz", casters: [] });
    // Lecture partielle : aucun stream, le premier lien reste.
    expect(matchPageStreams(bracketMatch({ liveUrl: "https://twitch.tv/zz" }), "SCHEDULED")).toEqual([
      { id: 0, url: "https://twitch.tv/zz", casters: [] },
    ]);
    // Match pas annoncé casté : rien.
    expect(matchPageStreams(bracketMatch({ liveUrl: "https://twitch.tv/zz" }), "OFF")).toEqual([]);
  });
});

describe("isByeMatch", () => {
  it("vrai pour un seul engagé hors attente, d'un côté comme de l'autre", () => {
    expect(isByeMatch({ team1Id: 1, team2Id: null, status: "COMPLETED" })).toBe(true);
    expect(isByeMatch({ team1Id: null, team2Id: 2, status: "READY" })).toBe(true);
  });

  it("faux à deux engagés, sans engagé, ou en attente d'adversaire", () => {
    expect(isByeMatch({ team1Id: 1, team2Id: 2, status: "READY" })).toBe(false);
    expect(isByeMatch({ team1Id: null, team2Id: null, status: "PENDING" })).toBe(false);
    expect(isByeMatch({ team1Id: 1, team2Id: null, status: "PENDING" })).toBe(false);
  });
});

describe("matchPageDecision", () => {
  const playable = { team1Id: 1, team2Id: 2, status: "READY" as const };

  it("dit l'arbitre, puis l'autogestion, à tous", () => {
    expect(matchPageDecision(bracketMatch({ ...playable, refereeAssigned: true }), false)).toBe("REFEREE");
    expect(matchPageDecision(bracketMatch({ ...playable, refereeAssigned: true, selfManaged: true }), false)).toBe("REFEREE");
    expect(matchPageDecision(bracketMatch({ ...playable, selfManaged: true }), false)).toBe("SELF_MANAGED");
  });

  it("l'absence de décision ne se montre qu'au staff", () => {
    expect(matchPageDecision(bracketMatch(playable), true)).toBe("UNDECIDED");
    expect(matchPageDecision(bracketMatch(playable), false)).toBeNull();
  });

  it("se tait sur un match terminé ou une exemption, garde un match encore en attente", () => {
    expect(matchPageDecision(bracketMatch({ ...playable, status: "COMPLETED", refereeAssigned: true }), true)).toBeNull();
    expect(matchPageDecision(bracketMatch({ team1Id: 1, team2Id: null, status: "READY" }), true)).toBeNull();
    expect(matchPageDecision(bracketMatch({ team1Id: 1, team2Id: null, status: "PENDING" }), true)).toBe("UNDECIDED");
    expect(matchPageDecision(bracketMatch({ status: "PENDING", selfManaged: true }), false)).toBe("SELF_MANAGED");
  });
});

describe("firstMapFieldFollows", () => {
  it("reprend la carte du plateau tant que le champ n'est pas modifié", () => {
    expect(firstMapFieldFollows("Ilios", false, null)).toBe(true);
    expect(firstMapFieldFollows(null, false, null)).toBe(true);
    expect(firstMapFieldFollows("Ilios", true, null)).toBe(false);
  });

  it("après un enregistrement, garde la saisie jusqu'à ce que le plateau porte la carte envoyée", () => {
    // Instantané pas encore relu : l'ancienne carte ne revient pas.
    expect(firstMapFieldFollows("Ilios", true, "Busan")).toBe(false);
    expect(firstMapFieldFollows("Ilios", false, "Busan")).toBe(false);
    expect(firstMapFieldFollows("Busan", true, "Busan")).toBe(true);
  });

  it("une carte effacée (envoi vide) se reconnaît au plateau sans carte", () => {
    expect(firstMapFieldFollows(null, true, "")).toBe(true);
    expect(firstMapFieldFollows("Ilios", true, "")).toBe(false);
  });
});

describe("selfManagementSteps", () => {
  it("donne les quatre étapes dans l'ordre, l'invitation des casters avec un caster", () => {
    expect(selfManagementSteps(1)).toEqual(["hostCreates", "managersInvite", "settings", "inviteCasters"]);
    expect(selfManagementSteps(3)).toEqual([...SELF_MANAGEMENT_STEPS]);
  });

  it("réglages Overwatch : compétitif, killcam, pause, dans cet ordre", () => {
    expect(OW_SELF_MANAGEMENT_SETTINGS).toEqual(["competitive", "killcamOff", "pauseOnDisconnect"]);
  });

  it("sans caster, rien à inviter", () => {
    expect(selfManagementSteps(0)).toEqual(["hostCreates", "managersInvite", "settings"]);
  });
});
