import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, jest } from "@jest/globals";

/**
 * Caractérisation de `reconcileSurvival` et `reconcileSwiss`, branche par
 * branche : mauvais format, aucune manche posée, manche en cours, manche close
 * (clôture ou manche suivante, récursion comprise), dans un tournoi simple et
 * dans une phase.
 *
 * La base simulée garde un état minimal (manche courante, rencontres encore
 * ouvertes par manche) pour que la récursion se termine comme en vrai. Chaque
 * cas relève **toutes** les requêtes et leurs paramètres, dans l'ordre, plus
 * les appels au dépôt et le résultat ; l'empreinte du relevé est comparée à
 * celle du code d'origine.
 */

jest.mock("@/lib/server/tournaments/repository");

import { reconcileSurvival } from "@/lib/server/tournaments/survival";
import { reconcileSwiss } from "@/lib/server/tournaments/swiss";
import { createMatch, finishTournament } from "@/lib/server/tournaments/repository";
import { type SqlQuery, fakeConnection } from "../helpers/sql-double";

type World = {
  format: string;
  state: string;
  current: number;
  totalRounds: number;
  teams: number[];
  statuses?: Record<number, string>;
  matches: Record<string, unknown>[];
  incomplete: Record<number, number>;
  /** Rencontres déjà posées pour la manche relue (`readRoundPlan`). */
  plan?: Record<string, unknown>[];
  /** Rencontres portant une saisie dans la manche relue. */
  scored?: number;
};

let trace: string[] = [];
let world: World;
let nextId = 500;

function standingRows(kind: "SURVIVAL" | "SWISS") {
  return world.teams.map((teamId, index) => {
    const status = world.statuses?.[teamId] ?? "ACTIVE";
    return kind === "SURVIVAL"
      ? {
          team_id: teamId,
          seed: index + 1,
          wins: 0,
          losses: 0,
          status,
          eliminated_round: status === "ACTIVE" ? null : 1,
          has_bye: 0,
          team_name: `T${teamId}`,
          logo_url: null,
        }
      : { team_id: teamId, seed: index + 1, status, forfeit_round: status === "ACTIVE" ? null : 1 };
  });
}

const execute = jest.fn<SqlQuery>(async (sql, params) => {
  const text = sql.replace(/\s+/g, " ").trim();
  const values = (params ?? []) as unknown[];
  trace.push(`sql ${text} ${JSON.stringify(values)}`);

  if (text.startsWith("SELECT format, state")) {
    if (world.format === "NONE") return [[], []];
    return [
      [
        {
          format: world.format,
          state: world.state,
          survival_rounds_before_first_cut: 1,
          survival_rounds_per_cut: 1,
          survival_current_round: world.current,
          survival_barrage_rounds: 0,
          swiss_total_rounds: world.totalRounds,
          swiss_current_round: world.current,
          swiss_points_win: 3,
          swiss_points_draw: 1,
          swiss_points_loss: 0,
          swiss_points_bye: 3,
          swiss_tiebreakers_json: null,
        },
      ],
      [],
    ];
  }
  if (text.startsWith("SELECT swiss_points_win")) {
    return [
      [
        {
          swiss_points_win: 3,
          swiss_points_draw: 1,
          swiss_points_loss: 0,
          swiss_points_bye: 3,
          swiss_tiebreakers_json: null,
        },
      ],
      [],
    ];
  }
  if (text.includes("FROM bg_survival_standings")) return [standingRows("SURVIVAL"), []];
  if (text.includes("FROM bg_swiss_standings")) return [standingRows("SWISS"), []];
  if (text.startsWith("SELECT round_number, status")) return [world.matches, []];
  if (text.startsWith("SELECT COUNT(*) AS c FROM bg_matches")) {
    if (text.includes("status <> 'COMPLETED'")) {
      return [[{ c: world.incomplete[Number(values[2])] ?? 0 }], []];
    }
    return [[{ c: world.scored ?? 0 }], []];
  }
  if (text.startsWith("SELECT team1_id, team2_id, is_bye")) return [world.plan ?? [], []];
  if (text.startsWith("SELECT")) return [[], []];
  if (/SET (survival|swiss)_current_round = \? WHERE id = \? AND/.test(text)) {
    world.current = Number(values[0]);
  }
  return [{ affectedRows: 1 }, []];
});
const connection = fakeConnection({ execute });

beforeEach(() => {
  jest.clearAllMocks();
  trace = [];
  nextId = 500;
  jest.mocked(createMatch).mockImplementation(async (_c, tournamentId, bracket, round, number, phaseId) => {
    nextId += 1;
    trace.push(`create ${nextId} ${tournamentId} ${bracket} ${round} ${number} ${phaseId}`);
    return nextId;
  });
  jest.mocked(finishTournament).mockImplementation(async (_c, tournamentId) => {
    trace.push(`finish ${tournamentId}`);
  });
});

function played(round: number, winner: number, loser: number) {
  return {
    round_number: round,
    status: "COMPLETED",
    team1_id: winner,
    team2_id: loser,
    winner_team_id: winner,
    loser_team_id: loser,
    is_bye: 0,
    double_forfeit: 0,
  };
}

function pending(round: number, team1: number, team2: number) {
  return {
    round_number: round,
    status: "READY",
    team1_id: team1,
    team2_id: team2,
    winner_team_id: null,
    loser_team_id: null,
    is_bye: 0,
    double_forfeit: 0,
  };
}

function digest(result: unknown): string {
  const text = `${JSON.stringify(result)}\n${trace.join("\n")}`;
  return `${trace.length}/${createHash("sha256").update(text).digest("hex").slice(0, 16)}`;
}

type Case = {
  name: string;
  world: World;
  phaseId?: number;
  targetTeams?: number;
};

const FOUR = [11, 12, 13, 14];

const SURVIVAL_CASES: Case[] = [
  { name: "mauvais format", world: { format: "SWISS", state: "RUNNING", current: 1, totalRounds: 0, teams: FOUR, matches: [], incomplete: {} } },
  { name: "introuvable", world: { format: "NONE", state: "RUNNING", current: 1, totalRounds: 0, teams: FOUR, matches: [], incomplete: {} } },
  { name: "aucune manche, une équipe", world: { format: "SURVIVAL", state: "RUNNING", current: 0, totalRounds: 0, teams: [11], matches: [], incomplete: {} } },
  { name: "aucune manche, une équipe, phase", phaseId: 4, world: { format: "SURVIVAL", state: "RUNNING", current: 0, totalRounds: 0, teams: [11], matches: [], incomplete: {} } },
  { name: "aucune manche, quatre équipes", world: { format: "SURVIVAL", state: "RUNNING", current: 0, totalRounds: 0, teams: FOUR, matches: [], incomplete: {} } },
  { name: "manche en cours", world: { format: "SURVIVAL", state: "RUNNING", current: 1, totalRounds: 0, teams: FOUR, matches: [pending(1, 11, 14), pending(1, 12, 13)], incomplete: { 1: 2 } } },
  { name: "manche en cours, une seule active", world: { format: "SURVIVAL", state: "RUNNING", current: 1, totalRounds: 0, teams: FOUR, statuses: { 12: "ELIMINATED", 13: "ELIMINATED", 14: "FORFEIT" }, matches: [pending(1, 11, 14)], incomplete: { 1: 1 } } },
  { name: "manche close, cible atteinte", world: { format: "SURVIVAL", state: "RUNNING", current: 1, totalRounds: 0, teams: [11, 12], matches: [played(1, 11, 12)], incomplete: {} } },
  { name: "manche close, cible atteinte, phase", phaseId: 4, targetTeams: 2, world: { format: "SURVIVAL", state: "RUNNING", current: 1, totalRounds: 0, teams: FOUR, matches: [played(1, 11, 14), played(1, 12, 13)], incomplete: {} } },
  { name: "manche close, manche suivante posée", world: { format: "SURVIVAL", state: "RUNNING", current: 1, totalRounds: 0, teams: FOUR, matches: [played(1, 11, 14), played(1, 12, 13)], incomplete: { 2: 2 } } },
  { name: "manche close, manche suivante, phase", phaseId: 4, world: { format: "SURVIVAL", state: "RUNNING", current: 1, totalRounds: 0, teams: FOUR, matches: [played(1, 11, 14), played(1, 12, 13)], incomplete: { 2: 2 } } },
  { name: "manche suivante saisie, appariements périmés", world: { format: "SURVIVAL", state: "RUNNING", current: 1, totalRounds: 0, teams: FOUR, matches: [played(1, 11, 14), played(1, 12, 13)], incomplete: {}, plan: [{ team1_id: 14, team2_id: 13, is_bye: 0 }], scored: 1 } },
  { name: "manche en cours, suivante saisie", world: { format: "SURVIVAL", state: "RUNNING", current: 1, totalRounds: 0, teams: FOUR, matches: [pending(1, 11, 14), pending(1, 12, 13)], incomplete: { 1: 2 }, plan: [{ team1_id: 14, team2_id: 13, is_bye: 0 }], scored: 0 } },
  { name: "terminé", world: { format: "SURVIVAL",state: "FINISHED", current: 1, totalRounds: 0, teams: [11, 12], matches: [played(1, 11, 12)], incomplete: {} } },
  { name: "terminé, phase", phaseId: 4, world: { format: "SURVIVAL", state: "FINISHED", current: 1, totalRounds: 0, teams: [11, 12], matches: [played(1, 11, 12)], incomplete: {} } },
];

const SWISS_CASES: Case[] = [
  { name: "mauvais format", world: { format: "SURVIVAL", state: "RUNNING", current: 1, totalRounds: 3, teams: FOUR, matches: [], incomplete: {} } },
  { name: "introuvable", world: { format: "NONE", state: "RUNNING", current: 1, totalRounds: 3, teams: FOUR, matches: [], incomplete: {} } },
  { name: "sans engagée", world: { format: "SWISS", state: "RUNNING", current: 0, totalRounds: 3, teams: [], matches: [], incomplete: {} } },
  { name: "aucune ronde, une équipe", world: { format: "SWISS", state: "RUNNING", current: 0, totalRounds: 3, teams: [11], matches: [], incomplete: {} } },
  { name: "aucune ronde, une équipe, phase", phaseId: 4, world: { format: "SWISS", state: "RUNNING", current: 0, totalRounds: 3, teams: [11], matches: [], incomplete: {} } },
  { name: "aucune ronde, quatre équipes", world: { format: "SWISS", state: "RUNNING", current: 0, totalRounds: 3, teams: FOUR, matches: [], incomplete: {} } },
  { name: "ronde en cours", world: { format: "SWISS", state: "RUNNING", current: 1, totalRounds: 3, teams: FOUR, matches: [pending(1, 11, 13), pending(1, 12, 14)], incomplete: { 1: 2 } } },
  { name: "ronde en cours, une seule active", world: { format: "SWISS", state: "RUNNING", current: 1, totalRounds: 3, teams: FOUR, statuses: { 12: "FORFEIT", 13: "FORFEIT", 14: "FORFEIT" }, matches: [pending(1, 11, 13)], incomplete: { 1: 1 } } },
  { name: "dernière ronde close", world: { format: "SWISS", state: "RUNNING", current: 3, totalRounds: 3, teams: FOUR, matches: [played(1, 11, 13), played(1, 12, 14), played(2, 11, 12), played(2, 13, 14), played(3, 11, 14), played(3, 12, 13)], incomplete: {} } },
  { name: "dernière ronde close, phase", phaseId: 4, world: { format: "SWISS", state: "RUNNING", current: 3, totalRounds: 3, teams: FOUR, matches: [played(1, 11, 13), played(1, 12, 14), played(2, 11, 12), played(2, 13, 14), played(3, 11, 14), played(3, 12, 13)], incomplete: {} } },
  { name: "ronde close, une seule active", world: { format: "SWISS", state: "RUNNING", current: 1, totalRounds: 3, teams: FOUR, statuses: { 12: "FORFEIT", 13: "FORFEIT", 14: "FORFEIT" }, matches: [played(1, 11, 13)], incomplete: {} } },
  { name: "ronde close, ronde suivante posée", world: { format: "SWISS", state: "RUNNING", current: 1, totalRounds: 3, teams: FOUR, matches: [played(1, 11, 13), played(1, 12, 14)], incomplete: { 2: 2 } } },
  { name: "ronde close, ronde suivante, phase", phaseId: 4, world: { format: "SWISS", state: "RUNNING", current: 1, totalRounds: 3, teams: FOUR, matches: [played(1, 11, 13), played(1, 12, 14)], incomplete: { 2: 2 } } },
  { name: "ronde suivante saisie, appariements périmés", world: { format: "SWISS", state: "RUNNING", current: 1, totalRounds: 3, teams: FOUR, matches: [played(1, 11, 13), played(1, 12, 14)], incomplete: {}, plan: [{ team1_id: 13, team2_id: 14, is_bye: 0 }], scored: 1 } },
  { name: "terminé", world: { format: "SWISS",state: "FINISHED", current: 3, totalRounds: 3, teams: FOUR, matches: [played(1, 11, 13), played(1, 12, 14)], incomplete: {} } },
  { name: "terminé, phase", phaseId: 4, world: { format: "SWISS", state: "FINISHED", current: 3, totalRounds: 3, teams: FOUR, matches: [played(1, 11, 13), played(1, 12, 14)], incomplete: {} } },
];

const SURVIVAL_GOLDEN: Record<string, string> = {
  "mauvais format": "1/46eca4a5f8f1ccb2",
  "introuvable": "1/46eca4a5f8f1ccb2",
  "aucune manche, une équipe": "7/8c6278e1c52a59b2",
  "aucune manche, une équipe, phase": "4/5eee6c4e9293ea2e",
  "aucune manche, quatre équipes": "4/bc20158f675c6f92",
  "manche en cours": "10/be02281041a19a8b",
  "manche en cours, une seule active": "8/ab0e0324a6cb958b",
  "manche close, cible atteinte": "8/407ba00c5cf7bbd9",
  "manche close, cible atteinte, phase": "5/89490e4d9d0581c7",
  "manche close, manche suivante posée": "17/1a3516d5d4422395",
  "manche close, manche suivante, phase": "17/13555cefbccd5d7d",
  "manche suivante saisie, appariements périmés": "7/40d80ee3794414a3",
  "manche en cours, suivante saisie": "12/d52da7dc422a0e80",
  "terminé": "7/9dba66a902234d01",
  "terminé, phase": "4/13b8ea86fed007b5",
};
const SWISS_GOLDEN: Record<string, string> = {
  "mauvais format": "1/520e4b583c422363",
  "introuvable": "1/520e4b583c422363",
  "sans engagée": "2/49bb3333eb0764b2",
  "aucune ronde, une équipe": "7/ced0e2d3e629ce72",
  "aucune ronde, une équipe, phase": "5/884896ef5735a0b7",
  "aucune ronde, quatre équipes": "4/d7c77178c2742be9",
  "ronde en cours": "10/a58e307224e3175c",
  "ronde en cours, une seule active": "5/accd980735c99f0b",
  "dernière ronde close": "8/78ce703d8df7a2b0",
  "dernière ronde close, phase": "6/4bf9e1b009c06406",
  "ronde close, une seule active": "8/bef0b7372eea6ee1",
  "ronde close, ronde suivante posée": "21/88235d9e2c72a5db",
  "ronde close, ronde suivante, phase": "23/1993d29997574152",
  "ronde suivante saisie, appariements périmés": "7/f78f1e6db2e14650",
  "terminé": "7/bc265050d28b8898",
  "terminé, phase": "5/24dfa6ed9fd6146c",
};

describe("reconcileSurvival — relevé exact", () => {
  it.each(SURVIVAL_CASES)("$name", async (testCase) => {
    world = structuredClone(testCase.world);
    const options =
      testCase.phaseId === undefined && testCase.targetTeams === undefined
        ? undefined
        : { phaseId: testCase.phaseId, targetTeams: testCase.targetTeams };
    const result = await reconcileSurvival(7, connection, options);
    expect(digest(result)).toBe(SURVIVAL_GOLDEN[testCase.name]);
  });
});

describe("reconcileSwiss — relevé exact", () => {
  it.each(SWISS_CASES)("$name", async (testCase) => {
    world = structuredClone(testCase.world);
    const options = testCase.phaseId === undefined ? undefined : { phaseId: testCase.phaseId };
    const result = await reconcileSwiss(7, connection, options);
    expect(digest(result)).toBe(SWISS_GOLDEN[testCase.name]);
  });
});
