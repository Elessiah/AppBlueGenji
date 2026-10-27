import { describe, expect, it } from "@jest/globals";
import {
  formatStaffMatchActionLog,
  formatStaffTournamentActionLog,
  type StaffMatchAction,
  type StaffTournamentAction,
} from "@/lib/shared/bot-logs";

const MATCH_ACTIONS: StaffMatchAction[] = [
  "RESULT_VALIDATED",
  "SCORES_SAVED",
  "FORCE_LAUNCHED",
  "HOST_SET",
  "HOST_CLEARED",
  "LIVE_CONFIGURED",
  "LIVE_REMOVED",
  "ON_AIR",
  "OFF_AIR",
  "REPLAY_SET",
  "REPLAY_REMOVED",
];
const TOURNAMENT_ACTIONS: StaffTournamentAction[] = [
  "EDITED",
  "SEEDING_REORDERED",
  "ADVANCED",
  "GHOST_TEAMS_REGISTERED",
  "IMAGE_SET",
  "IMAGE_UPDATED",
  "IMAGE_REMOVED",
  "LIVE_URL_SET",
  "LIVE_URL_REMOVED",
];

const tournament = { id: 7, name: "Coupe d'hiver" };
const base = {
  tournament,
  matchId: 42,
  bracket: "UPPER",
  roundNumber: 2,
  team1: { name: "Renards", participantType: "TEAM" as const },
  team2: { name: "Nova", participantType: "TEAM" as const },
};

describe("formatStaffMatchActionLog", () => {
  it("écrit une ligne d'entame commune, auteur anonyme", () => {
    expect(formatStaffMatchActionLog({ ...base, action: "RESULT_VALIDATED" })).toBe(
      "🛠️ Résultat validé — « Coupe d'hiver » (#7) : Manche 2 — Renards vs Nova (#42), par le staff.",
    );
    expect(formatStaffMatchActionLog({ ...base, action: "FORCE_LAUNCHED" })).toBe(
      "🛠️ Lancement forcé — « Coupe d'hiver » (#7) : Manche 2 — Renards vs Nova (#42), par le staff.",
    );
  });

  it("n'écrit que le tournoi quand le match ne doit pas être désigné", () => {
    const line = formatStaffMatchActionLog({ ...base, action: "SCORES_SAVED", withoutMatch: true });
    expect(line).toBe("🛠️ Score enregistré — « Coupe d'hiver » (#7), par le staff.");
    expect(line).not.toMatch(/Renards|Nova|#42|Manche/);
    expect(formatStaffMatchActionLog({ ...base, action: "SCORES_SAVED", withoutMatch: false })).toContain("(#42)");
  });

  it("a un libellé distinct par geste, chacun sur une ligne", () => {
    const lines = MATCH_ACTIONS.map((action) => formatStaffMatchActionLog({ ...base, action }));
    expect(new Set(lines).size).toBe(MATCH_ACTIONS.length);
    for (const line of lines) {
      expect(line).not.toContain("\n");
      expect(line.endsWith(", par le staff.")).toBe(true);
    }
  });

  it("écrit « un caster » pour un geste de diffusion d'un caster", () => {
    expect(formatStaffMatchActionLog({ ...base, action: "ON_AIR", author: "CASTER" })).toBe(
      "🛠️ Mis à l'antenne — « Coupe d'hiver » (#7) : Manche 2 — Renards vs Nova (#42), par un caster.",
    );
    expect(formatStaffMatchActionLog({ ...base, action: "ON_AIR", author: "STAFF" })).toBe(
      formatStaffMatchActionLog({ ...base, action: "ON_AIR" }),
    );
  });

  it("n'écrit jamais le pseudo d'un joueur en tournoi individuel", () => {
    const line = formatStaffMatchActionLog({
      ...base,
      team1: { name: "PseudoUn", participantType: "SOLO" },
      team2: { name: "PseudoDeux", participantType: "SOLO" },
      action: "ON_AIR",
    });
    expect(line).not.toMatch(/Pseudo/);
    expect(line).toContain("un joueur vs un joueur");
  });

  it("lit « TBD » pour une place vide, « Ronde N » en suisse", () => {
    const line = formatStaffMatchActionLog({ ...base, team2: null, swiss: true, roundNumber: 3, action: "HOST_SET" });
    expect(line).toContain("Ronde 3 — Renards vs TBD (#42)");
  });

  it("neutralise les mentions d'un nom d'équipe ou de tournoi", () => {
    const line = formatStaffMatchActionLog({
      ...base,
      tournament: { id: 7, name: "@everyone" },
      team1: { name: "@here", participantType: "TEAM" },
      action: "REPLAY_SET",
    });
    expect(line).not.toContain("@everyone");
    expect(line).not.toContain("@here");
  });
});

describe("formatStaffTournamentActionLog", () => {
  it("écrit le geste et le tournoi, auteur anonyme", () => {
    expect(formatStaffTournamentActionLog({ tournament, action: "EDITED" })).toBe(
      "🛠️ Tournoi modifié — « Coupe d'hiver » (#7), par le staff.",
    );
  });

  it("ajoute le compte des équipes fantômes", () => {
    expect(formatStaffTournamentActionLog({ tournament, action: "GHOST_TEAMS_REGISTERED", count: 3 })).toBe(
      "🛠️ Équipes fantômes inscrites — « Coupe d'hiver » (#7) (3), par le staff.",
    );
  });

  it("a un libellé distinct par geste", () => {
    const lines = TOURNAMENT_ACTIONS.map((action) => formatStaffTournamentActionLog({ tournament, action }));
    expect(new Set(lines).size).toBe(TOURNAMENT_ACTIONS.length);
    for (const line of lines) expect(line.endsWith(", par le staff.")).toBe(true);
  });
});
