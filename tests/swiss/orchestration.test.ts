import { describe, expect, it } from "@jest/globals";
import type { PoolConnection } from "mysql2/promise";
import {
  forfeitSwissTeam,
  generateSwissRound,
  initializeSwissTournament,
  parseTiebreakers,
  reconcileSwiss,
} from "@/lib/server/tournaments/swiss";
import { DEFAULT_SWISS_TIEBREAKERS } from "@/lib/shared/swiss";

/**
 * Base factice minimale : elle ne comprend pas le SQL, elle reconnaît les
 * requêtes du module par leurs fragments distinctifs et maintient en mémoire les
 * seules tables que l'orchestration relit (tournoi, standings, matchs).
 *
 * Elle sert à couvrir le **cycle de vie** — première ronde générée, ronde
 * suivante créée quand la précédente est complète, réappariement d'une ronde non
 * entamée, clôture à la dernière ronde — que les tests purs ne peuvent pas voir.
 */

type FakeMatch = {
  id: number;
  round: number;
  matchNumber: number;
  status: string;
  team1Id: number | null;
  team2Id: number | null;
  winnerTeamId: number | null;
  loserTeamId: number | null;
  isBye: number;
  hasScoreInput: boolean;
};

type FakeStanding = {
  teamId: number;
  seed: number;
  status: "ACTIVE" | "FORFEIT";
  forfeitRound: number | null;
};

type FakeDb = {
  conn: PoolConnection;
  tournament: Record<string, unknown>;
  matches: FakeMatch[];
  standings: FakeStanding[];
  /** Enregistre le résultat d'un match (comme le ferait un report de score). */
  play: (round: number, winnerOf: (m: FakeMatch) => number) => void;
  registrationRanks: Map<number, number>;
};

function fakeDb(options: {
  format?: string;
  state?: string;
  teamCount: number;
  totalRounds?: number | null;
  currentRound?: number;
  /** Forme brute de la colonne JSON des départages (tableau ou chaîne). */
  tiebreakers?: unknown;
}): FakeDb {
  const tournament: Record<string, unknown> = {
    format: options.format ?? "SWISS",
    state: options.state ?? "RUNNING",
    swiss_total_rounds: options.totalRounds === undefined ? 3 : options.totalRounds,
    swiss_current_round: options.currentRound ?? 0,
    swiss_points_win: 3,
    swiss_points_draw: 1,
    swiss_points_loss: 0,
    swiss_points_bye: 3,
    swiss_tiebreakers_json: options.tiebreakers ?? null,
  };

  const standings: FakeStanding[] = Array.from({ length: options.teamCount }, (_, i) => ({
    teamId: i + 1,
    seed: i + 1,
    status: "ACTIVE",
    forfeitRound: null,
  }));

  const matches: FakeMatch[] = [];
  const registrationRanks = new Map<number, number>();
  let nextMatchId = 100;

  const conn = {
    execute: async (sql: string, params: unknown[] = []) => {
      const q = sql.replace(/\s+/g, " ").trim();

      if (q.startsWith("SELECT format, state")) return [[{ ...tournament }], []];

      if (q.includes("FROM bg_swiss_standings WHERE tournament_id = ? ORDER BY seed")) {
        return [
          standings.map((s) => ({
            team_id: s.teamId,
            seed: s.seed,
            status: s.status,
            forfeit_round: s.forfeitRound,
          })),
          [],
        ];
      }

      if (q.startsWith("SELECT status FROM bg_swiss_standings")) {
        const found = standings.find((s) => s.teamId === Number(params[1]));
        return [found ? [{ status: found.status }] : [], []];
      }

      if (q.includes("FROM bg_tournament_registrations r")) {
        return [standings.map((s) => ({ team_id: s.teamId })), []];
      }

      if (q.startsWith("SELECT round_number, status, team1_id")) {
        return [
          matches.map((m) => ({
            round_number: m.round,
            status: m.status,
            team1_id: m.team1Id,
            team2_id: m.team2Id,
            winner_team_id: m.winnerTeamId,
            loser_team_id: m.loserTeamId,
            is_bye: m.isBye,
          })),
          [],
        ];
      }

      if (q.startsWith("SELECT team1_id, team2_id, is_bye FROM bg_matches")) {
        const round = Number(params[1]);
        return [
          matches
            .filter((m) => m.round === round)
            .sort((a, b) => a.matchNumber - b.matchNumber)
            .map((m) => ({ team1_id: m.team1Id, team2_id: m.team2Id, is_bye: m.isBye })),
          [],
        ];
      }

      // roundHasScoreInput
      if (q.includes("AND is_bye = 0 AND (team1_score IS NOT NULL")) {
        const round = Number(params[1]);
        const c = matches.filter((m) => m.round === round && !m.isBye && m.hasScoreInput).length;
        return [[{ c }], []];
      }

      // Matchs non terminés de la ronde courante
      if (q.includes("AND status <> 'COMPLETED'") && q.startsWith("SELECT COUNT(*)")) {
        const round = Number(params[1]);
        const c = matches.filter((m) => m.round === round && m.status !== "COMPLETED").length;
        return [[{ c }], []];
      }

      // Match en cours d'une équipe (forfait)
      if (q.startsWith("SELECT id, team1_id, team2_id FROM bg_matches")) {
        const [, round, teamId] = params.map(Number);
        const found = matches.find(
          (m) =>
            m.round === round &&
            m.status !== "COMPLETED" &&
            (m.team1Id === teamId || m.team2Id === teamId),
        );
        return [found ? [{ id: found.id, team1_id: found.team1Id, team2_id: found.team2Id }] : [], []];
      }

      if (q.startsWith("INSERT INTO bg_matches")) {
        const [, , round, matchNumber] = params.map(Number);
        const id = ++nextMatchId;
        matches.push({
          id,
          round,
          matchNumber,
          status: "PENDING",
          team1Id: null,
          team2Id: null,
          winnerTeamId: null,
          loserTeamId: null,
          isBye: 0,
          hasScoreInput: false,
        });
        return [{ insertId: id }, []];
      }

      if (q.startsWith("UPDATE bg_matches SET team1_id = ?, team2_id = ?, swiss_round")) {
        const match = matches.find((m) => m.id === Number(params[3]))!;
        match.team1Id = params[0] === null ? null : Number(params[0]);
        match.team2Id = params[1] === null ? null : Number(params[1]);
        match.status = "READY";
        return [{}, []];
      }

      if (q.startsWith("UPDATE bg_matches SET team1_id = ?, team2_id = NULL")) {
        const match = matches.find((m) => m.id === Number(params[3]))!;
        match.team1Id = Number(params[0]);
        match.team2Id = null;
        match.isBye = 1;
        match.status = "COMPLETED";
        match.winnerTeamId = Number(params[2]);
        return [{}, []];
      }

      // Résolution d'un match par forfait
      if (q.startsWith("UPDATE bg_matches SET status = 'COMPLETED'")) {
        const match = matches.find((m) => m.id === Number(params[5]))!;
        match.status = "COMPLETED";
        match.winnerTeamId = Number(params[0]);
        match.loserTeamId = Number(params[1]);
        match.hasScoreInput = true;
        return [{}, []];
      }

      if (q.startsWith("DELETE FROM bg_matches")) {
        const round = Number(params[1]);
        for (let i = matches.length - 1; i >= 0; i--) {
          if (matches[i].round === round) matches.splice(i, 1);
        }
        return [{}, []];
      }

      if (q.startsWith("INSERT INTO bg_swiss_standings")) {
        const [, teamId, seed] = params.map(Number);
        const existing = standings.find((s) => s.teamId === teamId);
        if (existing) {
          existing.seed = seed;
          existing.status = "ACTIVE";
          existing.forfeitRound = null;
        } else {
          standings.push({ teamId, seed, status: "ACTIVE", forfeitRound: null });
        }
        return [{}, []];
      }

      if (q.startsWith("UPDATE bg_swiss_standings SET status = 'FORFEIT'")) {
        const found = standings.find((s) => s.teamId === Number(params[2]))!;
        found.status = "FORFEIT";
        found.forfeitRound = Number(params[0]);
        return [{}, []];
      }

      // Persistance du classement : relue seulement par l'affichage.
      if (q.startsWith("UPDATE bg_swiss_standings SET points")) return [{}, []];

      if (q.startsWith("UPDATE bg_tournament_registrations SET final_rank")) {
        // `CASE team_id WHEN ? THEN ? …` : les paramètres vont par paires.
        const teamCount = standings.length;
        for (let i = 0; i < teamCount * 2; i += 2) {
          registrationRanks.set(Number(params[i]), Number(params[i + 1]));
        }
        return [{}, []];
      }

      if (q.startsWith("UPDATE bg_tournaments SET state = 'FINISHED'")) {
        tournament.state = "FINISHED";
        return [{}, []];
      }
      if (q.startsWith("UPDATE bg_tournaments SET swiss_total_rounds")) {
        tournament.swiss_total_rounds = Number(params[0]);
        return [{}, []];
      }
      if (q.startsWith("UPDATE bg_tournaments SET bracket_size")) {
        tournament.bracket_size = Number(params[0]);
        return [{}, []];
      }
      if (q.startsWith("UPDATE bg_tournaments SET swiss_current_round")) {
        tournament.swiss_current_round = Number(params[0]);
        return [{}, []];
      }

      return [[], []];
    },
  } as unknown as PoolConnection;

  return {
    conn,
    tournament,
    matches,
    standings,
    registrationRanks,
    play: (round, winnerOf) => {
      for (const m of matches.filter((x) => x.round === round && x.status !== "COMPLETED")) {
        const winner = winnerOf(m);
        m.status = "COMPLETED";
        m.winnerTeamId = winner;
        m.loserTeamId = winner === m.team1Id ? m.team2Id : m.team1Id;
        m.hasScoreInput = true;
      }
    },
  };
}

/** Le vainqueur est toujours l'équipe la mieux seedée (résultat déterministe). */
const favourite = (m: FakeMatch): number => Math.min(m.team1Id!, m.team2Id!);

const roundsOf = (db: FakeDb): number[] => [...new Set(db.matches.map((m) => m.round))].sort();

describe("swiss — parseTiebreakers", () => {
  it("accepte un tableau déjà désérialisé (comportement réel de la colonne JSON)", () => {
    expect(parseTiebreakers(["buchholz", "head-to-head"])).toEqual(["buchholz", "head-to-head"]);
  });

  it("accepte encore la forme chaîne (dump SQL, driver alternatif)", () => {
    expect(parseTiebreakers('["buchholz"]')).toEqual(["buchholz"]);
  });

  it("retombe sur l'ordre par défaut si la colonne est vide, nulle ou illisible", () => {
    expect(parseTiebreakers(null)).toEqual(DEFAULT_SWISS_TIEBREAKERS);
    expect(parseTiebreakers("")).toEqual(DEFAULT_SWISS_TIEBREAKERS);
    expect(parseTiebreakers("pas du json")).toEqual(DEFAULT_SWISS_TIEBREAKERS);
    expect(parseTiebreakers([])).toEqual(DEFAULT_SWISS_TIEBREAKERS);
  });

  it("écarte les départages inconnus plutôt que de les propager", () => {
    expect(parseTiebreakers(["buchholz", "pile-ou-face"] as never)).toEqual(["buchholz"]);
    expect(parseTiebreakers(["pile-ou-face"] as never)).toEqual(DEFAULT_SWISS_TIEBREAKERS);
  });
});

describe("swiss — initializeSwissTournament", () => {
  it("crée une ligne de classement par équipe et calcule le nombre de rondes", async () => {
    const db = fakeDb({ teamCount: 8, totalRounds: null });
    await initializeSwissTournament(1, db.conn);

    expect(db.standings).toHaveLength(8);
    expect(db.standings.map((s) => s.seed)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    // ⌈log₂(8)⌉ + 1
    expect(db.tournament.swiss_total_rounds).toBe(4);
    expect(db.tournament.bracket_size).toBe(8);
  });

  it("respecte un nombre de rondes fixé par l'organisateur", async () => {
    const db = fakeDb({ teamCount: 8, totalRounds: 3 });
    await initializeSwissTournament(1, db.conn);
    expect(db.tournament.swiss_total_rounds).toBe(3);
  });

  it("ne touche pas à un tournoi d'un autre format", async () => {
    const db = fakeDb({ teamCount: 8, format: "SINGLE", totalRounds: null });
    await initializeSwissTournament(1, db.conn);
    expect(db.tournament.swiss_total_rounds).toBeNull();
  });
});

describe("swiss — generateSwissRound", () => {
  it("crée la première ronde en opposant moitié haute et moitié basse", async () => {
    const db = fakeDb({ teamCount: 8 });
    await generateSwissRound(1, db.conn);

    expect(db.matches).toHaveLength(4);
    expect(db.matches.map((m) => [m.team1Id, m.team2Id])).toEqual([
      [1, 5],
      [2, 6],
      [3, 7],
      [4, 8],
    ]);
    expect(db.tournament.swiss_current_round).toBe(1);
  });

  it("effectif impair : une victoire d'office, déjà résolue", async () => {
    const db = fakeDb({ teamCount: 7 });
    await generateSwissRound(1, db.conn);

    const byes = db.matches.filter((m) => m.isBye === 1);
    expect(db.matches).toHaveLength(4);
    expect(byes).toHaveLength(1);
    expect(byes[0]).toMatchObject({ team1Id: 7, status: "COMPLETED", winnerTeamId: 7 });
  });

  it("ne génère rien en deçà de deux équipes", async () => {
    const db = fakeDb({ teamCount: 1 });
    await generateSwissRound(1, db.conn);
    expect(db.matches).toHaveLength(0);
  });

  it("est sans effet si la première ronde existe déjà", async () => {
    const db = fakeDb({ teamCount: 8 });
    await generateSwissRound(1, db.conn);
    await generateSwissRound(1, db.conn);
    expect(db.matches).toHaveLength(4);
  });
});

describe("swiss — reconcileSwiss", () => {
  it("ne génère pas la ronde suivante tant que la ronde courante est en cours", async () => {
    const db = fakeDb({ teamCount: 8, totalRounds: 3 });
    await generateSwissRound(1, db.conn);

    db.matches[0].status = "COMPLETED";
    db.matches[0].winnerTeamId = 1;
    await reconcileSwiss(1, db.conn);

    expect(roundsOf(db)).toEqual([1]);
  });

  it("enchaîne la ronde suivante dès que la ronde courante est complète", async () => {
    const db = fakeDb({ teamCount: 8, totalRounds: 3 });
    await generateSwissRound(1, db.conn);
    db.play(1, favourite);
    await reconcileSwiss(1, db.conn);

    expect(roundsOf(db)).toEqual([1, 2]);
    expect(db.tournament.swiss_current_round).toBe(2);

    // Ronde 2 : les gagnantes (1-4) s'affrontent entre elles, les perdantes aussi.
    const round2 = db.matches.filter((m) => m.round === 2);
    expect(round2).toHaveLength(4);
    expect(round2.map((m) => [m.team1Id, m.team2Id])).toEqual([
      [1, 2],
      [3, 4],
      [5, 6],
      [7, 8],
    ]);
  });

  it("ne réapparie jamais deux équipes qui se sont déjà rencontrées", async () => {
    const db = fakeDb({ teamCount: 8, totalRounds: 3 });
    await generateSwissRound(1, db.conn);

    for (let round = 1; round <= 3; round++) {
      db.play(round, favourite);
      await reconcileSwiss(1, db.conn);
    }

    const seen = new Set<string>();
    for (const m of db.matches.filter((x) => x.isBye === 0)) {
      const key = [m.team1Id, m.team2Id].sort((a, b) => a! - b!).join("-");
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
  });

  it("clôt le tournoi et classe les inscriptions à la dernière ronde", async () => {
    const db = fakeDb({ teamCount: 4, totalRounds: 2 });
    await generateSwissRound(1, db.conn);

    db.play(1, favourite);
    await reconcileSwiss(1, db.conn);
    expect(db.tournament.state).toBe("RUNNING");

    db.play(2, favourite);
    await reconcileSwiss(1, db.conn);

    expect(db.tournament.state).toBe("FINISHED");
    expect(roundsOf(db)).toEqual([1, 2]);
    // L'équipe 1 gagne tout : rang 1. Les rangs couvrent 1..4 sans trou.
    expect(db.registrationRanks.get(1)).toBe(1);
    expect([...db.registrationRanks.values()].sort()).toEqual([1, 2, 3, 4]);
  });

  it("réapparie une ronde non entamée quand une correction change le classement", async () => {
    const db = fakeDb({ teamCount: 8, totalRounds: 3 });
    await generateSwissRound(1, db.conn);
    db.play(1, favourite);
    await reconcileSwiss(1, db.conn);

    const before = db.matches
      .filter((m) => m.round === 2)
      .map((m) => `${m.team1Id}-${m.team2Id}`);

    // Un arbitre inverse le résultat du premier match : 5 gagne, 1 perd.
    const corrected = db.matches.find((m) => m.round === 1 && m.team1Id === 1)!;
    corrected.winnerTeamId = 5;
    corrected.loserTeamId = 1;
    await reconcileSwiss(1, db.conn);

    const after = db.matches
      .filter((m) => m.round === 2)
      .map((m) => `${m.team1Id}-${m.team2Id}`);

    expect(after).not.toEqual(before);
    // 5 est passée dans le groupe des gagnantes (2, 3, 4, 5), 1 dans celui des
    // perdantes (1, 6, 7, 8) — les paires suivent.
    expect(after).toEqual(["2-3", "4-5", "1-6", "7-8"]);
  });

  it("laisse intacte une ronde déjà entamée, même si le classement a bougé", async () => {
    const db = fakeDb({ teamCount: 8, totalRounds: 3 });
    await generateSwissRound(1, db.conn);
    db.play(1, favourite);
    await reconcileSwiss(1, db.conn);

    // Une équipe a déjà saisi un score en ronde 2 : les paires sont figées.
    db.matches.find((m) => m.round === 2)!.hasScoreInput = true;
    const before = db.matches
      .filter((m) => m.round === 2)
      .map((m) => `${m.team1Id}-${m.team2Id}`);

    const corrected = db.matches.find((m) => m.round === 1 && m.team1Id === 1)!;
    corrected.winnerTeamId = 5;
    corrected.loserTeamId = 1;
    await reconcileSwiss(1, db.conn);

    expect(db.matches.filter((m) => m.round === 2).map((m) => `${m.team1Id}-${m.team2Id}`)).toEqual(
      before,
    );
  });

  it("est idempotent : rejouer la réconciliation ne crée pas de ronde en double", async () => {
    const db = fakeDb({ teamCount: 8, totalRounds: 3 });
    await generateSwissRound(1, db.conn);
    db.play(1, favourite);

    await reconcileSwiss(1, db.conn);
    const snapshot = db.matches.length;
    await reconcileSwiss(1, db.conn);
    await reconcileSwiss(1, db.conn);

    expect(db.matches).toHaveLength(snapshot);
    expect(db.tournament.swiss_current_round).toBe(2);
  });

  it("ne touche pas à un tournoi déjà terminé ni à un autre format", async () => {
    const finished = fakeDb({ teamCount: 8, state: "FINISHED" });
    await reconcileSwiss(1, finished.conn);
    expect(finished.matches).toHaveLength(0);

    const single = fakeDb({ teamCount: 8, format: "SINGLE" });
    await reconcileSwiss(1, single.conn);
    expect(single.matches).toHaveLength(0);
  });

  it("clôt immédiatement un tournoi démarré à une seule équipe", async () => {
    const db = fakeDb({ teamCount: 1, totalRounds: 3 });
    await generateSwissRound(1, db.conn);
    await reconcileSwiss(1, db.conn);

    expect(db.tournament.state).toBe("FINISHED");
  });
});

describe("swiss — forfeitSwissTeam", () => {
  it("résout le match en cours en faveur de l'adversaire et sort l'équipe", async () => {
    const db = fakeDb({ teamCount: 8, totalRounds: 3 });
    await generateSwissRound(1, db.conn);

    await forfeitSwissTeam(1, 5, db.conn);

    const match = db.matches.find((m) => m.round === 1 && m.team1Id === 1)!;
    expect(match).toMatchObject({ status: "COMPLETED", winnerTeamId: 1, loserTeamId: 5 });
    expect(db.standings.find((s) => s.teamId === 5)).toMatchObject({
      status: "FORFEIT",
      forfeitRound: 1,
    });
  });

  it("l'équipe sortie n'est plus appariée aux rondes suivantes", async () => {
    const db = fakeDb({ teamCount: 8, totalRounds: 3 });
    await generateSwissRound(1, db.conn);
    await forfeitSwissTeam(1, 5, db.conn);

    db.play(1, favourite);
    await reconcileSwiss(1, db.conn);

    const round2Teams = db.matches
      .filter((m) => m.round === 2)
      .flatMap((m) => [m.team1Id, m.team2Id]);
    expect(round2Teams).not.toContain(5);
    // Effectif redevenu impair : une victoire d'office est distribuée.
    expect(db.matches.filter((m) => m.round === 2 && m.isBye === 1)).toHaveLength(1);
  });

  it("refuse un forfait hors mode suisse, hors tournoi en cours, ou déjà déclaré", async () => {
    const single = fakeDb({ teamCount: 4, format: "SINGLE" });
    await expect(forfeitSwissTeam(1, 1, single.conn)).rejects.toThrow("NOT_SWISS");

    const upcoming = fakeDb({ teamCount: 4, state: "REGISTRATION" });
    await expect(forfeitSwissTeam(1, 1, upcoming.conn)).rejects.toThrow("TOURNAMENT_NOT_RUNNING");

    const db = fakeDb({ teamCount: 4 });
    await generateSwissRound(1, db.conn);
    await forfeitSwissTeam(1, 3, db.conn);
    await expect(forfeitSwissTeam(1, 3, db.conn)).rejects.toThrow("TEAM_ALREADY_OUT");
    await expect(forfeitSwissTeam(1, 99, db.conn)).rejects.toThrow("TEAM_NOT_IN_TOURNAMENT");
  });
});
