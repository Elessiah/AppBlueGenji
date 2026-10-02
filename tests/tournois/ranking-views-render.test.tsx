import { describe, expect, it } from "@jest/globals";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";
import { EntrantProvider } from "@/app/(secured)/tournois/[id]/_lib/entrant-link";
import { SurvivalRounds, SurvivalView } from "@/app/(secured)/tournois/[id]/_components/SurvivalView";
import { SwissRounds, SwissView } from "@/app/(secured)/tournois/[id]/_components/SwissView";
import { ToastProvider } from "@/components/ui/toast";
import { buildEntrantLogoMap } from "@/lib/shared/entrant-logos";
import type { SurvivalMeta, SurvivalStandingRow, SwissMeta, SwissStandingRow } from "@/lib/shared/types";
import { bracketMatch } from "../helpers/bracket-match";

/**
 * Rendu figé des vues survie et ronde suisse. Les deux vues partagent leurs
 * colonnes de manches et leur bandeau de championne (`RoundColumns`) : ces
 * instantanés, pris avant la mise en commun, prouvent que le balisage rendu
 * n'a pas bougé d'un caractère — et le gardent.
 */

const noop = () => undefined;

// Exemptions seules : la carte d'une exemption ne demande aucun contexte de
// match, le rendu reste isolé.
const byes = [1, 2, 3].map((round) =>
  bracketMatch({ id: round, roundNumber: round, matchNumber: 1, team1Id: 10, team1Name: "Alpha", team2Id: null }),
);

function wrap(element: ReactElement): string {
  return renderToStaticMarkup(
    <ToastProvider>
      <EntrantProvider participantType="TEAM" soloUserIds={{}} logos={buildEntrantLogoMap([])}>
        {element}
      </EntrantProvider>
    </ToastProvider>,
  );
}

function survivalRow(overrides: Partial<SurvivalStandingRow> = {}): SurvivalStandingRow {
  return {
    teamId: 10,
    teamName: "Alpha",
    logoUrl: null,
    seed: 1,
    wins: 2,
    losses: 0,
    status: "ACTIVE",
    eliminatedRound: null,
    rank: 1,
    ...overrides,
  };
}

function survival(overrides: Partial<SurvivalMeta> = {}): SurvivalMeta {
  return {
    roundsBeforeFirstCut: 2,
    roundsPerCut: 1,
    currentRound: 3,
    barrageRounds: 1,
    standings: [
      survivalRow(),
      survivalRow({ teamId: 11, teamName: "Bravo", rank: 2, wins: 1, losses: 1 }),
      survivalRow({ teamId: 12, teamName: "Charlie", rank: 3, wins: 1, losses: 1 }),
      survivalRow({ teamId: 13, teamName: "Delta", rank: 4, status: "ELIMINATED", eliminatedRound: 2 }),
      survivalRow({ teamId: 14, teamName: "Echo", rank: 5, status: "FORFEIT" }),
    ],
    ...overrides,
  };
}

function swissRow(overrides: Partial<SwissStandingRow> = {}): SwissStandingRow {
  return {
    teamId: 10,
    teamName: "Alpha",
    logoUrl: null,
    seed: 1,
    points: 6,
    wins: 2,
    draws: 0,
    losses: 0,
    byes: 1,
    buchholz: 3,
    status: "ACTIVE",
    rank: 1,
    ...overrides,
  };
}

function swiss(overrides: Partial<SwissMeta> = {}): SwissMeta {
  return {
    totalRounds: 3,
    currentRound: 2,
    pointsForWin: 3,
    pointsForDraw: 1,
    pointsForLoss: 0,
    pointsForBye: 3,
    tiebreakers: ["buchholz", "head-to-head"],
    standings: [
      swissRow(),
      swissRow({ teamId: 11, teamName: "Bravo", rank: 2, points: 3, wins: 1, losses: 1, byes: 0 }),
      swissRow({ teamId: 12, teamName: "Charlie", rank: 3, points: 0, status: "FORFEIT", byes: 0 }),
    ],
    ...overrides,
  };
}

describe("vue survie — rendu inchangé", () => {
  it.each<[string, boolean]>([
    ["en cours", false],
    ["close", true],
  ])("tournoi %s", (_label, isFinished) => {
    expect(
      wrap(
        <SurvivalView
          survival={survival()}
          matches={byes}
          allTournamentMatches={byes}
          myTeamId={11}
          isFinished={isFinished}
          adminResolvable={() => false}
          onOpenAdminModal={noop}
          canForfeit={(id) => id !== 12}
          onForfeit={noop}
        />,
      ),
    ).toMatchSnapshot();
  });

  it("sans barrage, cadence espacée", () => {
    expect(
      wrap(
        <SurvivalView
          survival={survival({ barrageRounds: 0, roundsPerCut: 2, roundsBeforeFirstCut: 3, currentRound: 1 })}
          matches={[]}
          allTournamentMatches={[]}
          myTeamId={null}
          isFinished={false}
          adminResolvable={() => false}
          onOpenAdminModal={noop}
          canForfeit={() => false}
          onForfeit={noop}
          emptyLabel="Rien encore"
        />,
      ),
    ).toMatchSnapshot();
  });

  it("manches seules", () => {
    expect(
      wrap(
        <SurvivalRounds
          matches={byes}
          allTournamentMatches={byes}
          cutSchedule={{ roundsBeforeFirstCut: 1, roundsPerCut: 1, barrageRounds: 1 }}
          adminResolvable={() => false}
          onOpenAdminModal={noop}
          emptyLabel="Rien"
        />,
      ),
    ).toMatchSnapshot();
  });
});

describe("vue ronde suisse — rendu inchangé", () => {
  it.each<[string, boolean]>([
    ["en cours", false],
    ["close", true],
  ])("tournoi %s", (_label, isFinished) => {
    expect(
      wrap(
        <SwissView
          swiss={swiss()}
          matches={byes}
          allTournamentMatches={byes}
          myTeamId={10}
          isFinished={isFinished}
          adminResolvable={() => false}
          onOpenAdminModal={noop}
          canForfeit={() => true}
          onForfeit={noop}
        />,
      ),
    ).toMatchSnapshot();
  });

  it("sans équipe ni manche", () => {
    expect(
      wrap(
        <SwissView
          swiss={swiss({ standings: [], currentRound: 0, pointsForWin: 1 })}
          matches={[]}
          allTournamentMatches={[]}
          myTeamId={null}
          isFinished={false}
          adminResolvable={() => false}
          onOpenAdminModal={noop}
          canForfeit={() => false}
          onForfeit={noop}
          emptyLabel="Rien encore"
        />,
      ),
    ).toMatchSnapshot();
  });

  it("rondes seules", () => {
    expect(
      wrap(
        <SwissRounds
          matches={byes}
          allTournamentMatches={byes}
          totalRounds={3}
          adminResolvable={() => false}
          onOpenAdminModal={noop}
          emptyLabel="Rien"
        />,
      ),
    ).toMatchSnapshot();
  });
});
