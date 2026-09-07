import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";

jest.mock("@/lib/server/tournaments/repository");

import { reconcileEndurance } from "@/lib/server/tournaments/bg-survie";
import { createMatch } from "@/lib/server/tournaments/repository";
import type { BracketMatch, MatchStatus } from "@/lib/shared/types";
import { endurancePlayoffLinks } from "@/app/(secured)/tournois/[id]/_lib/endurance-sections";

const ROOT = join(__dirname, "..", "..");
const TOURNAMENT_DIR = join("app", "(secured)", "tournois", "[id]");
const read = (...parts: string[]) => readFileSync(join(ROOT, TOURNAMENT_DIR, ...parts), "utf8");

const VIEW = read("_components", "EnduranceView.tsx");
const PANELS = read("_components", "EnduranceRoundPanels.tsx");
const SECTIONS = read("_components", "BracketSections.tsx");
const TREE = read("_components", "BracketTree.tsx");
const PAGE = read("page.tsx");

describe("volets de manche — câblage de la vue", () => {
  it("rend ses cartes elle-même, comme les trois autres vues de plateau", () => {
    // La page rendait les cartes de ce mode à sa place (`renderMatch`) : elle
    // était la seule des quatre vues dans ce cas, et la seule à ne pas pouvoir
    // décider de la disposition de ses propres manches.
    expect(PANELS).toContain("<MatchRow");
    expect(VIEW).not.toContain("renderMatch");
    expect(PAGE).not.toContain("<MatchRow");
  });

  it("passe le format du tournoi jusqu'aux cartes", () => {
    // Le verrou de score se lit sur le format : une constante en dur mentirait
    // le jour où BG Survie et Survie divergeraient.
    expect(PAGE).toContain("format={detail.card.format}");
    expect(PANELS).toContain("format={format}");
  });

  it("déplie le volet où dort la cible d'une ancre", () => {
    // Une manche repliée n'est pas dans le DOM : sans cette ouverture, le hook
    // chercherait la carte jusqu'à renoncer, et le lien profond échouerait en
    // silence.
    expect(PANELS).toContain("useMatchAnchorTarget()");
    expect(PANELS).toContain("enduranceRoundOfMatch(");
    // On ajoute sans refermer : le lecteur reste libre de replier ensuite.
    expect(PANELS).toContain("prev.has(round) ? prev :");
  });

  it("suit la manche courante au fil du flux, sans rouvrir ce qui a été replié", () => {
    // Le volet à ouvrir change en cours de tournoi. Un état figé au montage
    // laisserait le lecteur sur une manche close ; rouvrir à chaque instantané
    // défairait son geste.
    expect(PANELS).toContain("lastAutoOpen");
    expect(PANELS).toContain("autoOpen === lastAutoOpen.current");
  });

  it("applique la même règle aux volets des tableaux à élimination", () => {
    // Les deux composants partagent leur chrome ; leur ouvrir un volet ne peut
    // pas suivre deux règles. Sur l'arbre final, le découpage se réorganise
    // même en cours de route (au-delà de trois tours, la « phase finale »
    // glisse d'une section à l'autre) : la section qui reçoit le tour vivant
    // naissait repliée, et rien ne l'ouvrait.
    expect(SECTIONS).toContain("lastAutoOpen");
    expect(SECTIONS).toContain("autoOpen === lastAutoOpen.current");
    expect(SECTIONS).toContain("prev.has(autoOpen) ? prev :");
  });

  it("partage le chrome des volets avec les tableaux à élimination", () => {
    // Deux copies du même en-tête auraient divergé au premier réglage.
    for (const source of [PANELS, SECTIONS]) {
      expect(source).toContain('from "./BoardPanel"');
      expect(source).toContain("<BoardPanel");
    }
    const panel = read("_components", "BoardPanel.tsx");
    expect(panel).toContain("aria-expanded={open}");
    expect(panel).toContain("aria-controls={panelId}");
  });
});

describe("play-offs — le vrai arbre, et non une liste de cartes", () => {
  it("emprunte le composant de l'élimination simple", () => {
    expect(VIEW).toContain("<BracketSections");
    expect(VIEW).toContain('bracketType="UPPER"');
    // La petite finale est un tableau à part : alignée dans la dernière colonne
    // de l'arbre, elle se nommerait « Finale 2 » et semblerait mener quelque part.
    expect(VIEW).toContain('bracketType="THIRD_PLACE"');
    expect(VIEW).toContain("splitPlayoffBrackets(");
  });

  it("dessine ses traits avec les liens dérivés, faute de liens en base", () => {
    expect(VIEW).toContain("endurancePlayoffLinks(");
    expect(VIEW).toContain("resolveNextMatchId={resolvePlayoffNext}");
    expect(SECTIONS).toContain("resolveNextMatchId={resolveNextMatchId}");
  });

  it("nomme ses stades sur le tableau complet, pas sur les tours déjà posés", () => {
    // L'arbre pousse un tour à la fois : sans ce compte, les quarts de finale
    // s'appellent « Finale » tant qu'ils sont le seul tour posé.
    expect(VIEW).toContain("endurancePlayoffRoundCount(");
    expect(VIEW).toContain("plannedRounds={playoffRounds}");
    expect(SECTIONS).toContain("buildSections(roundNums, bracketType, totalRounds)");
  });

  it("garde une clé de volet stable quand un tour rejoint la section", () => {
    // Le titre change en grandissant (« Finale » → « Phase finale ») ; l'état
    // ouvert est gardé par clé, et le volet se refermait donc tout seul.
    const lib = readFileSync(join(ROOT, TOURNAMENT_DIR, "_lib", "bracket-sections.ts"), "utf8");
    expect(lib).toContain("key: String(chunk[0])");
    expect(lib).toContain("key: String(finalRounds[0])");
  });

  it("laisse le comportement d'origine aux tableaux qui portent leurs liens", () => {
    // La prop est **optionnelle** : sans elle, l'arbre lit `nextWinnerMatchId`
    // comme il l'a toujours fait. Une élimination simple ne doit rien changer.
    expect(TREE).toContain("resolveNextMatchId?: (match: BracketMatch) => number | null");
    expect(TREE).toContain("(match.nextWinnerMatchId ?? match.nextLoserMatchId)");
  });
});

/**
 * Le pont le plus fragile de cette vue : les liens de l'arbre sont **dérivés**
 * d'une règle qui vit côté serveur (`finalizePlayoffsIfDone` apparie les
 * vainqueurs deux à deux dans l'ordre des numéros de match). Si cette règle
 * changeait, l'interface dessinerait des traits faux sans qu'aucun test
 * d'interface ne s'en aperçoive — les cartes seraient toutes là, simplement
 * reliées de travers.
 *
 * On fait donc produire un tour de play-offs par le **vrai service**, et on
 * confronte les rencontres qu'il crée aux liens qu'annonce le module pur.
 */
describe("endurancePlayoffLinks — accordé sur ce que crée le moteur", () => {
  const TOURNAMENT_ID = 7;
  /**
   * Quarts de finale, tels que le tableau imposé les pose sur un classement
   * 1..8 : 8v4, 6v2, 1v5 puis 3v7. Les appariements ne sont pas décoratifs —
   * l'arbre est relu avant d'être enchaîné (`repairPlayoffBracket`), et un
   * plateau qui ne descend pas du classement serait jugé périmé.
   */
  const QUARTERS = [
    { id: 101, match_number: 1, teams: [8, 4], winner: 8, loser: 4 },
    { id: 102, match_number: 2, teams: [6, 2], winner: 6, loser: 2 },
    { id: 103, match_number: 3, teams: [1, 5], winner: 1, loser: 5 },
    { id: 104, match_number: 4, teams: [3, 7], winner: 3, loser: 7 },
  ];

  const mockMatch = (overrides: Partial<BracketMatch>): BracketMatch => ({
    id: 1,
    tournamentId: TOURNAMENT_ID,
    bracket: "UPPER",
    roundNumber: 1000,
    matchNumber: 1,
    status: "COMPLETED" as MatchStatus,
    team1Id: null,
    team2Id: null,
    team1Name: null,
    team2Name: null,
    team1Placeholder: null,
    team2Placeholder: null,
    team1Score: null,
    team2Score: null,
    winnerTeamId: null,
    loserTeamId: null,
    forfeitTeamId: null,
    nextWinnerMatchId: null,
    nextWinnerSlot: null,
    nextLoserMatchId: null,
    nextLoserSlot: null,
    scoreDeadlineAt: null,
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  });

  function makeConn() {
    const execute = jest.fn(async (sql: unknown) => {
      const query = String(sql);
      if (query.includes("FROM bg_tournaments WHERE id = ?")) {
        return [
          [
            {
              format: "BG_SURVIE",
              state: "RUNNING",
              match_format_type: null,
              match_format_value: null,
              endurance_start_points: 3,
              endurance_win_delta: 1,
              endurance_loss_delta: 1,
              endurance_playoff_size: 8,
              endurance_max_rounds: null,
              endurance_current_round: 1,
              // L'arbre est lancé : `reconcileEndurance` part droit sur
              // `finalizePlayoffsIfDone`, la seule chose qu'on veut exercer.
              endurance_playoffs_started: 1,
              has_third_place_match: 0,
            },
          ],
        ];
      }
      if (query.includes("FROM bg_endurance_standings") && query.includes("status = 'FORFEIT'")) {
        return [[]];
      }
      if (query.includes("FROM bg_endurance_standings")) {
        return [
          [1, 2, 3, 4, 5, 6, 7, 8].map((teamId) => ({
            team_id: teamId,
            seed: teamId,
            points: 3,
            wins: 0,
            losses: 0,
            status: "ACTIVE",
            eliminated_round: null,
            rank: teamId,
          })),
        ];
      }
      // `finalizePlayoffsIfDone` : le dernier tour posé est celui des quarts.
      if (query.includes("SELECT DISTINCT round_number FROM bg_matches")) {
        return [[{ round_number: 1000 }]];
      }
      if (query.includes("SELECT id, bracket, status")) {
        return [
          QUARTERS.map((quarter) => ({
            id: quarter.id,
            bracket: "UPPER",
            status: "COMPLETED",
            team1_id: quarter.teams[0],
            team2_id: quarter.teams[1],
            team1_score: 3,
            team2_score: 0,
            winner_team_id: quarter.winner,
            loser_team_id: quarter.loser,
            forfeit_team_id: null,
            is_bye: 0,
          })),
        ];
      }
      return [[]];
    });

    return { execute } as never as Parameters<typeof reconcileEndurance>[1] & {
      execute: jest.Mock;
    };
  }

  beforeEach(() => {
    jest.clearAllMocks();
    let nextId = 200;
    (createMatch as jest.Mock).mockImplementation(async () => (nextId += 1) as never);
  });
  afterEach(() => jest.restoreAllMocks());

  it("relie chaque quart au demi que le service lui a effectivement créé", async () => {
    const conn = makeConn();
    await reconcileEndurance(TOURNAMENT_ID, conn);

    // Ce que le service a créé : une rencontre par appel à `createMatch`, dont
    // les équipes sont posées par l'`UPDATE` qui suit.
    const created = (createMatch as jest.Mock).mock.results.map(
      (result) => (result.value as Promise<number>) as unknown,
    );
    expect(created).toHaveLength(2);

    const semiIds = await Promise.all(created as Promise<number>[]);
    const teamsOf = new Map<number, number[]>();
    for (const [sql, params] of conn.execute.mock.calls as [string, unknown[]][]) {
      if (!String(sql).includes("team1_id = ?, team2_id = ?")) continue;
      // [team1, team2, statut, bye, score1, score2, vainqueur, id]
      const values = params as (number | null)[];
      teamsOf.set(Number(values[7]), [Number(values[0]), Number(values[1])]);
    }

    // Demi 1 = vainqueurs des quarts 1 et 2 ; demi 2 = ceux des quarts 3 et 4.
    expect(teamsOf.get(semiIds[0])).toEqual([8, 6]);
    expect(teamsOf.get(semiIds[1])).toEqual([1, 3]);

    // Et c'est exactement ce que le module pur annonce, sur le même plateau.
    const links = endurancePlayoffLinks([
      ...QUARTERS.map((quarter) =>
        mockMatch({
          id: quarter.id,
          roundNumber: 1000,
          matchNumber: quarter.match_number,
          winnerTeamId: quarter.winner,
        }),
      ),
      ...semiIds.map((id, index) =>
        mockMatch({ id, roundNumber: 1001, matchNumber: index + 1, status: "READY" }),
      ),
    ]);

    expect(links.get(101)).toBe(semiIds[0]);
    expect(links.get(102)).toBe(semiIds[0]);
    expect(links.get(103)).toBe(semiIds[1]);
    expect(links.get(104)).toBe(semiIds[1]);
  });
});
