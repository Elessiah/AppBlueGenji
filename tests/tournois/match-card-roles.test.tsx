import { describe, expect, it, jest } from "@jest/globals";

// Pied d'action remplacé par une sonde qui écrit toutes ses actions
// (`tests/helpers/match-card-actions-probe.ts`) : le vrai ne monte la liste
// « Plus d'actions » qu'à l'ouverture, qu'un rendu statique ne provoque pas.
jest.mock("@/app/(secured)/tournois/[id]/_components/MatchCardActions", () =>
  jest
    .requireActual<typeof import("../helpers/match-card-actions-probe")>("../helpers/match-card-actions-probe")
    .probeModule(),
);

import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MatchRow } from "@/app/(secured)/tournois/[id]/_components/MatchRow";
import { LiveProvider } from "@/app/(secured)/tournois/[id]/_lib/live-context";
import { IssueReportProvider } from "@/app/(secured)/tournois/[id]/_lib/issue-report-context";
import { PlayerScoreProvider } from "@/app/(secured)/tournois/[id]/_lib/player-score-context";
import { ToastProvider } from "@/components/ui/toast";
import type { BracketMatch } from "@/lib/shared/types";
import { bracketMatch } from "../helpers/bracket-match";

/**
 * Carte de match entière (`MatchRow`) : chaque public retrouve ses actions, et
 * la bonne passe en principale (`docs/features/MATCH_CARD_LAYOUT.md`).
 */

type Viewer = {
  canManage?: boolean;
  canSchedule?: boolean;
  myTeamId?: number | null;
  canReport?: boolean;
  playerScore?: boolean;
  adminResolvable?: boolean;
  scoreLocked?: boolean;
};

function wrap(viewer: Viewer, child: ReactNode) {
  return renderToStaticMarkup(
    <ToastProvider>
      <LiveProvider
        canManage={viewer.canManage ?? false}
        canSchedule={viewer.canSchedule ?? false}
        refereeScheduling={false}
        openConfig={() => undefined}
        openSchedule={() => undefined}
        openReplay={() => undefined}
        viewerUserId={1}
        myTeamId={viewer.myTeamId ?? null}
        castBlock={null}
      >
        <IssueReportProvider canReport={viewer.canReport ?? false} openReport={() => undefined}>
          <PlayerScoreProvider
            canOpen={() => viewer.playerScore ?? false}
            canReportScore={() => true}
            open={() => undefined}
          >
            {child}
          </PlayerScoreProvider>
        </IssueReportProvider>
      </LiveProvider>
    </ToastProvider>,
  );
}

function card(match: BracketMatch, viewer: Viewer = {}) {
  return wrap(
    viewer,
    <MatchRow
      match={match}
      adminResolvable={viewer.adminResolvable ?? false}
      onOpenAdminModal={() => undefined}
      scoreLocked={viewer.scoreLocked ?? false}
      roundNumber={1}
    />,
  );
}

const launched = (overrides: Partial<BracketMatch> = {}) =>
  bracketMatch({
    id: 42,
    status: "READY",
    team1Id: 10,
    team2Id: 20,
    team1Name: "Alpha",
    team2Name: "Bravo",
    launchedAt: "2026-09-24T20:00:00.000Z",
    ...overrides,
  });

const played = bracketMatch({
  id: 43,
  status: "COMPLETED",
  team1Id: 10,
  team2Id: 20,
  team1Name: "Alpha",
  team2Name: "Bravo",
  team1Score: 2,
  team2Score: 1,
  winnerTeamId: 10,
  loserTeamId: 20,
});

describe("MatchRow — chaque public retrouve ses actions", () => {
  it("spectateur : aucune action", () => {
    expect(card(launched())).not.toContain("data-action=");
  });

  it("engagé : saisie du score en principale, lancement et signalement au menu", () => {
    const html = card(launched(), { myTeamId: 10, canReport: true, playerScore: true });
    expect(html).toContain('data-action="playerScore" data-primary="true"');
    expect(html).toContain('data-action="openLaunch"');
    expect(html).toContain("Signaler un problème : Alpha contre Bravo");
    expect(html).not.toContain('data-action="report" data-primary');
  });

  it("engagé d'un autre match : ni saisie ni signalement sur cette carte", () => {
    const html = card(launched(), { myTeamId: 99, canReport: true });
    expect(html).not.toContain('data-action="report"');
    expect(html).not.toContain('data-action="playerScore"');
  });

  it("arbitrage : le score en principale, la date et l'hôte au menu", () => {
    const html = card(launched(), { canSchedule: true, adminResolvable: true });
    expect(html).toContain('data-action="adminScore" data-primary="true"');
    expect(html).toContain("Éditer le score : Alpha contre Bravo");
    expect(html).toContain('data-action="schedule"');
    expect(html).toContain('data-action="hostSwap"');
  });

  it("arbitrage, score verrouillé : plus de bouton de score, le constat reste", () => {
    const html = card(played, { adminResolvable: true, scoreLocked: true });
    expect(html).not.toContain('data-action="adminScore"');
    expect(html).toContain("Score verrouillé");
  });

  it("diffusion : la rediff d'un match joué reste offerte", () => {
    expect(card(played, { canManage: true })).toContain("Ajouter la rediff : Alpha contre Bravo");
  });
});
