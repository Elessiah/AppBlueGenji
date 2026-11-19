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
import { MatchPageScope } from "@/app/(secured)/tournois/[id]/_lib/match-page-context";
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
        launchPhase
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
  it("spectateur : aucun geste, seulement la page du match en principale", () => {
    const html = card(launched());
    expect(html.match(/data-action="/g)).toHaveLength(1);
    expect(html).toContain('data-action="matchPage" data-primary="true"');
  });

  it("engagé : la page du match passe au menu, derrière son score", () => {
    const html = card(launched(), { myTeamId: 10, canReport: true, playerScore: true });
    expect(html).toContain('data-action="matchPage">');
    expect(html).not.toContain('data-action="matchPage" data-primary');
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

  it("diffusion : un porteur de `live` seul n'a ni rediff ni réglage de diffusion sur la carte", () => {
    // `docs/features/CAST_SETTINGS.md` : un porteur de `live` qui ne caste pas
    // n'a plus de réglage de diffusion ; la rediff de la carte demande aussi
    // `tournaments`.
    const html = card(played, { canManage: true });
    expect(html).not.toContain('data-action="replay"');
    expect(html).not.toContain('data-action="castConfig"');
    expect(html).not.toContain('data-action="liveConfig"');
  });

  it("diffusion : le caster d'un match joué garde « Configurer ma diffusion » (rediff comprise)", () => {
    // `viewerUserId` du fournisseur : 1.
    const mine = bracketMatch({ ...played, casters: [{ userId: 1, pseudo: "Moi", streamId: 1, ready: false }] });
    expect(card(mine, { canManage: true })).toContain("Configurer ma diffusion : Alpha contre Bravo");
  });

  it("diffusion : le staff `tournaments` garde la diffusion de l'organisation", () => {
    expect(card(launched(), { canSchedule: true, canManage: true })).toContain('data-action="liveConfig"');
  });

  it("matchCard_tournamentsWithoutLive_noLiveConfig", () => {
    // Les routes de la diffusion (`/api/admin/matches/[id]/live`) demandent `live` :
    // sans elle, le bouton ne mènerait qu'à des refus.
    expect(card(launched(), { canSchedule: true })).not.toContain('data-action="liveConfig"');
  });

  it("matchCard_playedUncastMatchForOrganisationStaff_offersReplay", () => {
    // Joué sans diffusion marquée : aucune fenêtre de diffusion ne s'ouvre ; la
    // rediff a son entrée sur la carte, comme pour tout match joué.
    const html = card(played, { canSchedule: true, canManage: true });
    expect(html).toContain("Ajouter la rediff : Alpha contre Bravo");
    expect(html).not.toContain('data-action="liveConfig"');
  });

  const REPLAY_ADD = "Ajouter la rediff : Alpha contre Bravo";
  const staff = { canSchedule: true, canManage: true };
  const casterNamed = (userId: number) => [{ userId, pseudo: "Caster", streamId: 1, ready: false }];

  it("matchCard_completedWithCaster_staffStillSeesReplay", () => {
    const html = card(bracketMatch({ ...played, casters: casterNamed(77) }), staff);
    expect(html).toContain(REPLAY_ADD);
  });

  it("matchCard_completedViewerIsCaster_staffSeesCastConfigAndReplay", () => {
    const html = card(bracketMatch({ ...played, casters: casterNamed(1) }), staff);
    expect(html).toContain('data-action="castConfig"');
    expect(html).toContain(REPLAY_ADD);
  });

  it("matchCard_tournamentsWithoutLive_noReplay", () => {
    expect(card(played, { canSchedule: true })).not.toContain('data-action="replay"');
  });

  it("matchCard_spectator_noReplay", () => {
    expect(card(played)).not.toContain('data-action="replay"');
  });

  it("matchCard_notCompleted_noReplay", () => {
    expect(card(launched(), staff)).not.toContain('data-action="replay"');
  });

  it("matchCard_forfeit_noReplay", () => {
    const forfeit = bracketMatch({ ...played, forfeitTeamId: 20 });
    expect(card(forfeit, staff)).not.toContain('data-action="replay"');
  });

  it("matchCard_reopenedWithExistingLink_staffSeesRemoveEntry", () => {
    // Le match rouvert ne peut plus porter de rediff : seul le retrait reste.
    const reopened = launched({ replayUrl: "https://www.youtube.com/watch?v=abcdefghijk" });
    const html = card(reopened, staff);
    expect(html).toContain("Retirer la rediff : Alpha contre Bravo");
    expect(html).not.toContain("Modifier la rediff");
  });

  it("matchCard_completedWithLink_staffSeesEditEntry", () => {
    const linked = bracketMatch({ ...played, replayUrl: "https://www.youtube.com/watch?v=abcdefghijk" });
    expect(card(linked, staff)).toContain("Modifier la rediff : Alpha contre Bravo");
  });

  it("matchCard_completedForStaff_replayStaysInMenu", () => {
    const html = card(played, staff);
    expect(html).toContain('<li data-action="replay">');
    expect(html).toContain('<li data-action="matchPage" data-primary="true">');
  });

  it("matchCard_onMatchPageWithOtherActions_replayNotPrimary", () => {
    const html = wrap(
      staff,
      <MatchPageScope value>
        <MatchRow
          match={played}
          adminResolvable={false}
          onOpenAdminModal={() => undefined}
          scoreLocked={false}
          roundNumber={1}
        />
      </MatchPageScope>,
    );
    expect(html).not.toContain('data-action="matchPage"');
    expect(html).toContain('<li data-action="replay">');
  });

  it("matchCard_doubleForfeitWithoutLink_noReplay", () => {
    const doubleForfeit = bracketMatch({ ...played, winnerTeamId: null, doubleForfeit: true });
    expect(card(doubleForfeit, staff)).not.toContain('data-action="replay"');
  });

  it("matchCard_forfeitWithStoredLink_staffSeesRemoveEntry", () => {
    const forfeit = bracketMatch({
      ...played,
      forfeitTeamId: 20,
      replayUrl: "https://www.youtube.com/watch?v=abcdefghijk",
    });
    expect(card(forfeit, staff)).toContain("Retirer la rediff : Alpha contre Bravo");
  });

  it("matchCard_completedWithOfficialLive_staffSeesLiveConfigAndReplay", () => {
    const html = card(bracketMatch({ ...played, casters: casterNamed(77), liveTrigger: "MANUAL" }), staff);
    expect(html).toContain('data-action="liveConfig"');
    expect(html).toContain('<li data-action="replay">Ajouter la rediff : Alpha contre Bravo</li>');
    // Ordre du menu : la rediff suit la diffusion officielle.
    expect(html.indexOf('data-action="liveConfig"')).toBeLessThan(html.indexOf('data-action="replay"'));
  });

});

describe("MatchRow — la carte ne s'ouvre jamais plus large que la route", () => {
  it("matchCard_liveOnlyCasterOfPlayedMatch_noMenuReplay", () => {
    // `mayEditReplay` admet ce caster (`live` seule, son cast) ; la carte, elle,
    // exige aussi `tournaments` : son entrée est sa fenêtre de diffusion.
    const mine = bracketMatch({ ...played, casters: [{ userId: 1, pseudo: "Moi", streamId: 1, ready: false }] });
    const html = card(mine, { canManage: true });
    expect(html).toContain('data-action="castConfig"');
    expect(html).not.toContain('data-action="replay"');
  });
});
